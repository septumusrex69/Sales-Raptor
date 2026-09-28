import { useMemo, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { DictateButton } from '../../components/ui/Dictate'
import { raiseQuery, stageForAssignee } from '../../lib/accountQueries'
import {
  categoryExamples, explanationMissing,
  CATEGORY_NEEDING_EXPLANATION, EXPLANATION_MIN_LENGTH, QUERY_CATEGORIES,
  ESCALATION_KINDS, ESCALATION_KIND_ORDER, type EscalationKind,
} from '../../lib/disputeCategories'
import { chargeMessage } from '../../lib/accountCharges'
import type { User } from '../../types'

const TODAY = new Date().toISOString().slice(0, 10)

/**
 * Raising a dispute.
 *
 * The front door to the dispute system. Raising one used to mean finding a panel three cards down
 * the right-hand column, which is a fine place to WORK a dispute and a poor place to discover that
 * you can start one — the action bar is where a collector looks for something to do.
 *
 * On the words: when a DEBTOR says something is wrong it is a dispute, and when a CLIENT asks us
 * something it is a query. The firm made that distinction so that "there's a query on this
 * account" stops being ambiguous about who is unhappy. This modal is the debtor's side, which is
 * why every word in it says dispute.
 *
 * An internal escalation and a debtor's dispute are the same object deliberately. All three are
 * "this account needs somebody else's attention", all three need an owner, a chase date and an
 * answer, and building three of them would mean three queues and three places to look.
 *
 * The firm asked for one door called Escalate, with three reasons behind it: the debtor disputes
 * the account, an agent wants a team leader's decision, or the debtor simply will not pay and
 * collections has nothing left to try — which is a recommendation to instruct the attorneys.
 *
 * WHAT DIFFERS BETWEEN THEM IS WHO PAYS. A dispute raises Annexure B item 3, because the debtor's
 * objection is what caused someone else's time to be spent. The other two are the firm's own
 * business — supervising its staff, and deciding whether to sue — and a debtor is never billed
 * for either. raiseQuery refuses to charge on anything but a dispute; this screen simply does not
 * offer the box.
 */
export function EscalateModal({ accountId, users, clientLiaison, actor, alreadyDisputed, onClose, onDone }: {
  accountId: string
  users: User[]
  /** The liaison on this debtor's client, which is who a client query goes to by default. */
  clientLiaison: User | undefined
  /** The person escalating. `teamId` is what makes "my team leader" answerable -- see `mine`. */
  actor: { id: string | null; name: string | null; teamId?: string }
  /**
   * THE DISPUTE ALREADY OPEN ON THIS ACCOUNT, IF THERE IS ONE.
   *
   * THE FIRM: "there should only be one dispute allowed to be open at a specific time... he can
   * dispute multiple things in one dispute." `one_open_dispute_per_account` refuses a second and
   * the refusal is a good one, but it arrives AFTER a collector has chosen a classification and
   * typed out what the debtor said, with the debtor still on the telephone. So the option is not
   * offered, and it says which dispute to add it to instead.
   *
   * THE OTHER TWO KINDS ARE UNTOUCHED. Asking a team leader for help and recommending litigation
   * start no clock and hold nothing; an open dispute is no reason to refuse either.
   */
  alreadyDisputed: boolean
  onClose: () => void
  onDone: () => Promise<void>
}) {
  /* DISPUTE IS THE DEFAULT, EXCEPT WHERE IT IS NOT AVAILABLE -- a box opening on an option that
     cannot be chosen reads as broken. */
  const [kind, setKind] = useState<EscalationKind>(alreadyDisputed ? 'help' : 'dispute')
  const [toId, setToId] = useState(clientLiaison?.id ?? '')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [chaseOn, setChaseOn] = useState('')
  /*
   * HOW IT REACHED US, AND IT IS THE FIELD THAT DECIDES WHAT HAPPENS NEXT.
   *
   * THE FIRM: "creating a dispute from what a debtor said doesn't do anything. It shouldn't have a
   * workflow. But receiving an email with a written dispute, that." Verbal starts the sequence
   * that asks for it in writing; written starts the real one and stops the collection sequences.
   *
   * VERBAL IS THE DEFAULT because it is what happens on a telephone, which is where nearly every
   * dispute is first heard -- and it is the one that claims less: a dispute marked written that is
   * not stops a statutory sequence on a document nobody has.
   */
  const [reached, setReached] = useState<'verbal' | 'written'>('verbal')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * THREE PEOPLE, AND THE FIRST OF THEM IS *MINE*.
   *
   * THE FIRM: "each person can only escalate it to their team leader or to the client liaison who
   * is working on the file, or to the client liaison manager."
   *
   * IT OFFERED EVERY PRE-LEGAL TEAM LEADER IN THE FIRM, which is nearly the fault the list was
   * narrowed from in the first place: a dispute handed to whoever came to mind first ends up
   * parked with somebody who has no standing over the person who raised it. A team leader leads
   * ONE team, and the one that can answer for this agent is the one whose team they are in.
   *
   * ABSENT RATHER THAN EMPTY where somebody has no team -- the call centre manager leads every
   * team and belongs to none -- so the group simply does not appear rather than offering nobody.
   */
  const myLeaders = useMemo(
    () => users.filter((u) => u.role === 'Pre-legal Team Leader'
      && u.id !== clientLiaison?.id
      && !!actor.teamId && u.teamId === actor.teamId),
    [users, clientLiaison?.id, actor.teamId],
  )
  /*
   * AND THE LIAISON MANAGER, who is the rung above the liaison: the person to take it to when the
   * liaison who owns the client cannot answer it, or is the one being waited on.
   */
  const liaisonManagers = useMemo(
    () => users.filter((u) => u.role === 'Liaison Manager' && u.id !== clientLiaison?.id),
    [users, clientLiaison?.id],
  )
  /* What `Ask a team leader` suggests, and what the charge rule reads. */
  const teamLeaders = myLeaders

  /*
   * Whether the debtor pays for this follows one question: did the dispute go to somebody else?
   *
   * Keeping it yourself is you writing down what you are about to deal with — that is the job,
   * and billing a debtor for it would not survive being asked about. Handing it to another person
   * is work the account caused someone else to do, which is what item 3 is for.
   *
   * Still a checkbox rather than decided silently. The rule is right almost always; the person
   * doing it is the one who knows when it is not.
   */
  const examples = categoryExamples(category)
  /*
   * "Other" means "not one of the nine", which tells a reader nothing on its own. So it is the one
   * classification that will not be accepted without the words — long enough that "n/a" and a
   * stray keystroke do not pass, short enough that a real sentence always does.
   */
  const needsExplanation = ESCALATION_KINDS[kind].needsCategory && explanationMissing(category, description)

  /*
   * The debtor pays when the dispute is given to somebody.
   *
   * Unassigned means nobody has been put to work on it yet, so there is nothing to recover. The
   * moment it has a name on it -- anyone's, including your own -- somebody's time is being spent
   * on this account because of this dispute, and that is what item 3 is for. This was keyed to
   * "somebody other than you", which quietly let the commonest case of all go unbilled.
   *
   * Still a checkbox: the rule is right almost always, and the person doing it knows when it is
   * not.
   */
  const assigned = !!toId
  const [chargeTouched, setChargeTouched] = useState(false)
  const [charge, setCharge] = useState(assigned)
  const chargeDebtor = chargeTouched ? charge : assigned

  async function submit() {
    if (!description.trim()) return
    setBusy(true); setError(null)
    try {
      const { charge: raised } = await raiseQuery({
        accountId,
        description,
        kind,
        category,
        ownerId: toId || null,
        stage: stageForAssignee(users.find((u) => u.id === toId)?.role, !!toId && toId === clientLiaison?.id),
        chaseOn: chaseOn || null,
        raisedBy: actor.id,
        raisedByName: actor.name,
        charge: chargeDebtor,
        /* Only a dispute has a stage. raiseQuery ignores it on the other two and the database
           refuses the dates there anyway -- nobody alleges an agent asking for help. */
        reached: kind === 'dispute' ? reached : undefined,
      })
      await onDone()
      onClose()
      if (raised) console.info(chargeMessage(raised, '3'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Escalate this account" onClose={onClose} width={520}>
      <div className="space-y-3">
        {/*
          WHY it is being escalated, before who it goes to — because the reason decides everything
          underneath it: whether there is a classification to pick, who it would normally go to,
          and whether the debtor pays.
        */}
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-slate-700 mb-1.5">Why are you escalating it?</legend>
          {ESCALATION_KIND_ORDER.map((k) => {
            /* SHOWN AND UNSELECTABLE RATHER THAN REMOVED. A missing option reads as a screen that
               is broken or a permission somebody lacks; a greyed one with the reason under it
               reads as the rule it is. */
            const barred = k === 'dispute' && alreadyDisputed
            return (
            <label key={k}
              className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-colors ${
                barred ? 'border-slate-100 bg-slate-50 cursor-not-allowed opacity-60'
                  : kind === k ? 'border-brand-500 bg-brand-50/50 cursor-pointer'
                    : 'border-slate-200 hover:bg-slate-50 cursor-pointer'
              }`}>
              <input type="radio" name="escalation-kind" value={k} checked={kind === k} disabled={barred}
                onChange={() => {
                  setKind(k)
                  // A classification only means something on a dispute, so it is dropped rather
                  // than carried across — the database refuses one on the other two anyway.
                  if (k !== 'dispute') setCategory('')
                  const meta = ESCALATION_KINDS[k]
                  const suggested = meta.goesTo === 'team_leader' ? teamLeaders[0]?.id : clientLiaison?.id
                  setToId(suggested ?? '')
                }}
                className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm text-slate-800">{ESCALATION_KINDS[k].label}</span>
                <span className="block text-[11px] text-slate-500">
                  {barred
                    ? 'There is already an open dispute on this account. A debtor may dispute several things, but in one dispute — add it to that one.'
                    : ESCALATION_KINDS[k].blurb}
                </span>
              </span>
            </label>
            )
          })}
        </fieldset>

        {/*
          HOW IT REACHED US, AND IT IS NOT A DETAIL: it decides which sequence answers the debtor.
          
          THE FIRM: "it should have an option to say that this query was a verbal query by the
          debtor. And we should send an email... you stated that you have a dispute, please put
          your dispute in writing, you have until this time. It also should have an option to say
          that we've received a dispute. And that's when the real workflow starts."
          
          ONLY ON A DISPUTE. An agent asking a team leader for a decision was not alleged by
          anybody, and the database refuses the dates on the other two escalations.
          
          EACH SAYS WHAT WILL HAPPEN, because one of them stops a statutory sequence and the other
          does not, and that is not something to discover afterwards.
        */}
        {kind === 'dispute' && (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-slate-700 mb-1.5">How did it reach us?</legend>
            {([
              ['verbal', 'The debtor told us',
                'We ask for it in writing, with a date to send it by. Collection carries on until it arrives.'],
              ['written', 'We have it in writing',
                'The real dispute sequence starts and the collection sequences stop until we have answered it.'],
            ] as const).map(([value, label, what]) => (
              <label key={value}
                className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  reached === value ? 'border-brand-500 bg-brand-50/50' : 'border-slate-200 hover:bg-slate-50'
                }`}>
                <input type="radio" name="dispute-reached" value={value} checked={reached === value}
                  onChange={() => setReached(value)} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm text-slate-800">{label}</span>
                  <span className="block text-[11px] text-slate-500">{what}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Give it to</span>
          <select
            value={toId}
            onChange={(e) => setToId(e.target.value)}
            className="w-full mt-1 text-sm rounded-lg border border-slate-200 px-2.5 py-2 bg-white"
          >
            <option value="">Nobody yet — leave it unassigned</option>
            {clientLiaison && (
              <optgroup label="Client liaison">
                <option value={clientLiaison.id}>{clientLiaison.name} — looks after this client</option>
              </optgroup>
            )}
            {myLeaders.length > 0 && (
              <optgroup label="Your team leader">
                {myLeaders.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </optgroup>
            )}
            {liaisonManagers.length > 0 && (
              <optgroup label="Liaison manager">
                {liaisonManagers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </optgroup>
            )}
          </select>
          {/* THE LIST IS SHORT ON PURPOSE and says so, or somebody hunts for a name that is not
              there and concludes the screen is broken. */}
          <span className="block text-[11px] text-slate-500 mt-1">
            Your team leader, the liaison who looks after this client, or the liaison manager.
          </span>
          {!clientLiaison && (
            <span className="block text-[11px] text-gold-600 mt-1">
              This client has no liaison set. Set one on the client record and it will be offered here.
            </span>
          )}
        </label>

        <label className="block">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-slate-700">
              {kind === 'dispute' ? 'What is the issue?'
                : kind === 'help' ? 'What do you need decided?'
                : 'Why has collecting run out of road?'}
            </span>
            {/*
              DICTATED, AT THE FIRM'S REQUEST: "if we raise a dispute, first of all, there should
              be a dictate so you can speak to the dispute." This is written with the debtor still
              on the telephone, and what they are actually objecting to is the whole of what a
              liaison has to answer -- typed in a hurry it becomes "says he paid", which is not
              something anybody can investigate. The same control the call note and the cancelled
              arrangement use, so the language somebody dictates in is remembered once.
            */}
            <DictateButton size="small" value={description} onChange={setDescription} />
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            autoFocus
            placeholder={category === CATEGORY_NEEDING_EXPLANATION
              ? 'Required for "Other" — say what the debtor is actually disputing.'
              : ESCALATION_KINDS[kind].placeholder}
            className="w-full mt-1 text-sm rounded-lg border border-slate-200 px-2.5 py-2 resize-none"
          />
        </label>

        <div className={ESCALATION_KINDS[kind].needsCategory ? 'grid grid-cols-2 gap-3' : ''}>
          {/* A classification says why the DEBTOR is objecting, so it exists only on a dispute.
              The database refuses one on the other two — account_queries_category_only_on_dispute. */}
          <label className={ESCALATION_KINDS[kind].needsCategory ? 'block' : 'hidden'}>
            <span className="text-sm font-medium text-slate-700">Classification</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full mt-1 text-sm rounded-lg border border-slate-200 px-2.5 py-2 bg-white">
              <option value="">None</option>
              {QUERY_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.value}</option>)}
            </select>
            {/* The examples sit under the choice, where somebody on a call can actually read them.
                A taxonomy nobody can apply in five seconds gets applied wrongly. */}
            {examples && <span className="block text-[11px] text-slate-500 mt-1">{examples}</span>}
          </label>
          {/*
            "CHASE ON" READ AS CHASING THE CLIENT. The firm, looking at this box: "I don't know
            what the chase the client means." It is not about the client at all -- it is the day
            this escalation comes back to whoever raised it if nobody has answered it. Said in
            those words instead.
          */}
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Follow it up on</span>
            <input type="date" value={chaseOn} min={TODAY} onChange={(e) => setChaseOn(e.target.value)}
              className="w-full mt-1 text-sm rounded-lg border border-slate-200 px-2.5 py-2" />
            <span className="block text-[11px] text-slate-500 mt-1">
              When this comes back to you if it has not been answered.
            </span>
          </label>
        </div>

        {/*
          Only on a dispute, and not merely hidden: raiseQuery refuses to charge on the other two
          whatever this screen sends. Asking an agent whether to bill a debtor for the firm
          supervising its own staff is a question with one right answer, so it is not asked.
        */}
        {ESCALATION_KINDS[kind].chargeable ? (
        <label className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-100">
          <input
            type="checkbox"
            checked={chargeDebtor}
            onChange={(e) => { setChargeTouched(true); setCharge(e.target.checked) }}
            className="mt-0.5"
          />
          <span className="text-sm text-slate-700">
            Charge the debtor R25 plus VAT
            <span className="block text-[11px] text-slate-500 mt-0.5">
              Annexure B item 3, &ldquo;other necessary expenses not specifically provided for&rdquo;. It is a
              total for the account, so it charges nothing if this account has already had it.
              {assigned
                ? ' Ticked because somebody is being put to work on this dispute.'
                : ' Unticked because it is unassigned — nobody is spending time on it yet.'}
            </span>
          </span>
        </label>
        ) : (
          <p className="text-sm text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2.5">
            <span className="font-medium text-slate-700">Nothing is charged.</span>{' '}
            {kind === 'help'
              ? 'Asking a team leader what to do is the firm supervising its own staff, not an expense of collecting from this debtor.'
              : 'Deciding whether to sue is the firm\u2019s own business. The attorneys\u2019 costs are a separate matter if it goes ahead.'}
          </p>
        )}

        {needsExplanation && (
          <p className="text-sm text-slate-500">
            &ldquo;Other&rdquo; needs an explanation — at least {EXPLANATION_MIN_LENGTH} characters saying what this
            actually is, so whoever picks it up later does not have to guess.
          </p>
        )}
        {error && <p className="text-sm text-negative-700">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={submit}
            disabled={busy || !description.trim() || needsExplanation}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-brand-600 text-white disabled:opacity-40"
          >
            <ShieldAlert size={15} />
            {busy ? 'Escalating…'
              : kind === 'dispute' ? 'Raise dispute'
              : kind === 'help' ? 'Ask for help'
              : 'Recommend litigation'}
          </button>
          <button onClick={onClose} className="text-sm text-slate-600 hover:text-slate-800 px-2">Cancel</button>
        </div>
      </div>
    </Modal>
  )
}
