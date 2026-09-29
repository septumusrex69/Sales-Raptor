import { useMemo, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { DictateButton } from '../../components/ui/Dictate'
import { raiseQuery, stageForAssignee, REQUEST_KINDS, type AccountQuery } from '../../lib/accountQueries'
import {
  categoryExamples, explanationMissing,
  CATEGORY_NEEDING_EXPLANATION, EXPLANATION_MIN_LENGTH, QUERY_CATEGORIES,
  ESCALATION_KINDS, ESCALATION_KIND_ORDER, type EscalationKind,
} from '../../lib/disputeCategories'
import { chargeMessage } from '../../lib/accountCharges'
import { raiseTicketFromEmail } from '../../lib/userMail'
import { useAuth } from '../../store/AuthContext'
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
export function EscalateModal({
  accountId, users, clientLiaison, actor, alreadyDisputed, fromEmail, initialKind, openQueries = [],
  onClose, onDone,
}: {
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
  /**
   * THE MESSAGE THIS WAS OPENED ON, where it was opened on one.
   *
   * THE FIRM, LOOKING AT THE TWO BUTTONS ON AN EMAIL: "if it says this is a dispute, it should
   * take you to kind of like creating a real dispute... it should ask you, what is the issue
   * where you can dictate and stuff. But you should be able to decide what to do with it as well.
   * Maybe you don't want to escalate it. Maybe you can resolve it yourself."
   *
   * What those buttons used to do was post straight to /api/email/ticket: a dispute with no
   * classification, nobody's name on it, no chase date and no words but the email's own -- and
   * item 3 charged on the press. Now they open this box, and the box submits through the SAME
   * endpoint, because the endpoint is what files the attachments and links the thread. Nothing
   * about the questions changes; what changes is that they get asked.
   */
  fromEmail?: {
    id: string
    subject: string | null
    body: string | null
    attachmentNames: string[]
  }
  /** Which of the two buttons was pressed. Ignored where there is no email. */
  initialKind?: EscalationKind
  /**
   * THE TICKETS ALREADY OPEN ON THIS ACCOUNT, so this email can be ADDED to one.
   *
   * THE FIRM'S OWN SEQUENCE, in full: "if the debtor disputes something and says he's going to
   * email it, then the moment that the email comes, you can say, link it to a current dispute and
   * then you can choose the dispute that is there available. Then it's that email and they need
   * to automatically know that we've received the dispute."
   *
   * That last clause is the whole of it. A dispute carries `alleged_on`, `received_on` and
   * `in_writing` as three separate columns precisely so a verbal dispute and a written one are
   * different events -- and until now nothing reached the second two from an email. Linking sets
   * them, which ends the sequence that was asking for it in writing and starts the real one.
   */
  openQueries?: AccountQuery[]
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { session } = useAuth()
  /*
   * WHAT THIS EMAIL BELONGS TO: a ticket already open, or a new one.
   *
   * `link:<id>` or `new`. Only meaningful in fromEmail mode -- without an email there is nothing
   * to attach to anything, and the box is the ordinary Escalate box it has always been.
   *
   * IT DEFAULTS TO LINKING A DISPUTE AND NEVER TO LINKING ANYTHING ELSE. Pressing "this is a
   * dispute" on an account that already has one open has exactly one honest reading -- the
   * writing the debtor promised has arrived -- and it is also the only reading the database
   * permits, because one_open_dispute_per_account refuses a second. A request is the opposite:
   * several are open at once and a new email is usually a new one, so it starts on `new` with the
   * open ones offered underneath.
   */
  /*
   * A DISPUTE, AND ONLY A DISPUTE.
   *
   * THE FIRM: "it should be able to link to an open dispute for sure, but it should not be able to
   * link to an open query, like an open information request, because an information request is an
   * internal thing... it just creates the complexity of the dispute handling procedure much
   * worse."
   *
   * IT USED TO OFFER EVERY OPEN TICKET OF EITHER KIND. On an account with two requests open and no
   * dispute, pressing "This is a dispute" showed two options both reading "Add it to the open
   * request" -- which is what the firm hit, and what they described as not being asked WHICH
   * dispute. Worse than confusing: the endpoint accepted it, so a debtor's written dispute would
   * have been filed as "an email was filed against this request", with no dispute recorded, no
   * `in_writing`, no sequence started and the collection letters still running.
   *
   * A REQUEST IS THE FIRM'S OWN ERRAND -- asking a client for a statement or a proof of delivery.
   * Nothing a debtor sends belongs on one.
   */
  const linkable = useMemo(
    () => (fromEmail
      ? openQueries.filter((q) => q.status !== 'closed' && q.kind === 'dispute')
      : []),
    [fromEmail, openQueries],
  )
  const openDispute = linkable.find((q) => q.kind === 'dispute') ?? null
  const [target, setTarget] = useState<string>(
    fromEmail && initialKind === 'dispute' && openDispute ? `link:${openDispute.id}` : 'new',
  )
  const linkedTo = target.startsWith('link:')
    ? linkable.find((q) => q.id === target.slice(5)) ?? null
    : null

  /* DISPUTE IS THE DEFAULT, EXCEPT WHERE IT IS NOT AVAILABLE -- a box opening on an option that
     cannot be chosen reads as broken. On an email it is whichever button was pressed. */
  const [kind, setKind] = useState<EscalationKind>(
    fromEmail && initialKind ? initialKind : (alreadyDisputed ? 'help' : 'dispute'),
  )
  const [toId, setToId] = useState(clientLiaison?.id ?? '')
  /*
   * THE EMAIL'S OWN WORDS, ALREADY IN THE BOX.
   *
   * THE RETYPING IS WHERE DISPUTES GET MIS-RECORDED -- it is the step most likely to be shortened
   * at half past four, and what the debtor actually wrote is the thing a finding has to answer.
   * Capped at the same 4 000 the endpoint caps at, so what is shown is what would be stored;
   * anything longer is a quoted thread and the full text is one press away on the email itself.
   */
  const [description, setDescription] = useState(() => {
    if (!fromEmail) return ''
    const written = (fromEmail.body ?? '').replace(/\r\n/g, '\n').trim()
    const capped = written.length > 4000 ? `${written.slice(0, 4000)}…` : written
    return capped || (fromEmail.subject ?? '').trim()
  })
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
  /*
   * WHAT A REQUEST IS ASKING FOR. The statement is the ordinary case by a distance -- it is the
   * document a handover most often arrives without.
   */
  const [requestFor, setRequestFor] = useState<string>(REQUEST_KINDS[0].value)
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
   * EVERYBODY THE THREE GROUPS ABOVE DO NOT ALREADY OFFER, for a request only.
   *
   * Filtered rather than concatenated so nobody appears twice: a liaison manager who is also this
   * client's liaison is one person, and a select with their name in it twice reads as two people
   * with the same name.
   */
  const alreadyOffered = useMemo(
    () => new Set([clientLiaison?.id, ...myLeaders.map((u) => u.id), ...liaisonManagers.map((u) => u.id)]
      .filter((id): id is string => !!id)),
    [clientLiaison?.id, myLeaders, liaisonManagers],
  )
  const everybodyElse = useMemo(
    () => users.filter((u) => !alreadyOffered.has(u.id)),
    [users, alreadyOffered],
  )

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
  /*
   * THE SAME QUESTION ASKED PLAINLY, BECAUSE THE FIRM ASKED FOR IT TO BE.
   *
   * "You should be able to decide what to do with it as well. Maybe you don't want to escalate
   * it. Maybe you can resolve it yourself... you can escalate it or basically resolve it
   * yourself."
   *
   * The Give it to picker has always been able to express both -- your own name is in it -- but
   * it never SAID so, and a picker headed "Give it to" reads as a question about which colleague
   * rather than a question about whether. On a written dispute that matters: collection has
   * stopped either way, and somebody who thinks the only options are other people's names parks
   * it with a liaison who did not need it.
   *
   * ONLY ON A DISPUTE OFF AN EMAIL. Everywhere else the picker's own wording is the question, and
   * a second fieldset above it would be a screen asking twice.
   */
  const askKeepOrEscalate = !!fromEmail && (linkedTo ? linkedTo.kind === 'dispute' : kind === 'dispute')
  const [keepIt, setKeepIt] = useState(false)
  /* Keeping it means it is YOURS, not that it is nobody's: an unassigned ticket sits on the board
     and is counted on nobody's badge -- nav_counts reads owner_id. */
  const ownerId = keepIt ? (actor.id ?? null) : (toId || null)

  const assigned = !!ownerId
  const [chargeTouched, setChargeTouched] = useState(false)
  const [charge, setCharge] = useState(assigned)
  const chargeDebtor = chargeTouched ? charge : assigned


  async function submit() {
    if (!linkedTo && !description.trim()) return
    setBusy(true); setError(null)

    /*
     * OFF AN EMAIL IT GOES THROUGH THE ENDPOINT, NOT raiseQuery. The endpoint is what fetches the
     * attachments out of the mailbox, files them as documents against the ticket, and writes
     * query_id onto the thread -- none of which a browser can do, because the attachments were
     * deliberately never copied into Raptor. What is raised is the same row either way.
     */
    if (fromEmail) {
      const token = session?.access_token
      if (!token) { setBusy(false); setError('Your session has expired. Sign in again.'); return }
      const result = await raiseTicketFromEmail({
        accessToken: token,
        accountEmailId: fromEmail.id,
        queryId: linkedTo?.id ?? null,
        kind: kind === 'request' ? 'request' : 'dispute',
        requestFor: kind === 'request' ? requestFor : undefined,
        category: kind === 'dispute' ? (category || null) : null,
        /* On a link, only where the ticket has nobody on it -- see the picker's own note. */
        ownerId: linkedTo && linkedTo.ownerId ? null : ownerId,
        chaseOn: linkedTo ? null : (chaseOn || null),
      })
      setBusy(false)
      if (!result.ok) { setError(result.problem); return }
      /* WHAT CAME ACROSS AND WHAT DID NOT. The ticket IS raised, so a file the mailbox no longer
         holds is a line to read and act on rather than a failure to report -- and it is reported
         after the reload, not instead of it. */
      if (result.failed.length > 0) setError(`Could not file: ${result.failed.join('; ')}`)
      await onDone()
      if (result.failed.length === 0) onClose()
      return
    }

    try {
      const { charge: raised } = await raiseQuery({
        accountId,
        description,
        kind,
        category,
        ownerId: ownerId,
        stage: stageForAssignee(users.find((u) => u.id === ownerId)?.role, !!ownerId && ownerId === clientLiaison?.id),
        chaseOn: chaseOn || null,
        raisedBy: actor.id,
        raisedByName: actor.name,
        charge: chargeDebtor,
        /* Only a dispute has a stage. raiseQuery ignores it on the other two and the database
           refuses the dates there anyway -- nobody alleges an agent asking for help. */
        reached: kind === 'dispute' ? reached : undefined,
        /* Only a request carries one; raiseQuery drops it on the others and the database refuses
           it there anyway. */
        requestFor: kind === 'request' ? requestFor : undefined,
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
    <Modal
      title={fromEmail ? 'What is this email?' : 'Escalate this account'}
      onClose={onClose}
      width={520}
    >
      <div className="space-y-3">
        {/*
          ADD IT TO SOMETHING OPEN, OR START SOMETHING NEW — the first question on an email, and
          the one the two buttons on the message could not ask.

          THE FIRM: "if the debtor disputes something and says he's going to email it, then the
          moment that the email comes, you can say, link it to a current dispute and then you can
          choose the dispute that is there available."

          The open ones come FIRST because on a dispute that is nearly always the right answer:
          one_open_dispute_per_account refuses a second, so "this is a dispute" on an account that
          already has one can only mean the writing has arrived.
        */}
        {fromEmail && linkable.length > 0 && (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-slate-700 mb-1.5">Is this about the open dispute?</legend>
            {linkable.map((q) => {
              const willBeInWriting = q.kind === 'dispute' && !q.inWriting && !q.receivedOn
              return (
                <label key={q.id}
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                    target === `link:${q.id}` ? 'border-brand-500 bg-brand-50/50' : 'border-slate-200 hover:bg-slate-50'
                  }`}>
                  <input type="radio" name="escalation-target" checked={target === `link:${q.id}`}
                    onChange={() => setTarget(`link:${q.id}`)} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-sm text-slate-800">Add it to the open dispute</span>
                    <span className="block text-[11px] text-slate-500 line-clamp-2 wrap-anywhere">{q.description}</span>
                    {/* WHAT LINKING ACTUALLY DOES, said before it is pressed, because on a verbal
                        dispute it is the thing that stops every collection sequence on the
                        account. That is not a consequence to discover afterwards. */}
                    {willBeInWriting && (
                      <span className="block text-[11px] text-gold-600 mt-1">
                        We have it in writing from today. The letter asking for it in writing is
                        cancelled, the real dispute sequence starts, and collection stops until it
                        is answered.
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
            <label className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
              target === 'new' ? 'border-brand-500 bg-brand-50/50' : 'border-slate-200 hover:bg-slate-50'
            }`}>
              <input type="radio" name="escalation-target" checked={target === 'new'}
                onChange={() => setTarget('new')} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm text-slate-800">No — raise a new one</span>
                <span className="block text-[11px] text-slate-500">
                  {alreadyDisputed
                    ? 'A second dispute cannot be opened while one is. A request can.'
                    : 'No dispute is open on this account — this will raise one.'}
                </span>
              </span>
            </label>
          </fieldset>
        )}

        {/*
          WHY it is being escalated, before who it goes to — because the reason decides everything
          underneath it: whether there is a classification to pick, who it would normally go to,
          and whether the debtor pays.

          HIDDEN WHERE THE EMAIL IS BEING LINKED: the ticket already exists and already knows what
          kind it is. Offering the ladder there would be offering to change it.
        */}
        <fieldset className={`space-y-1.5 ${linkedTo ? 'hidden' : ''}`}>
          <legend className="text-sm font-medium text-slate-700 mb-1.5">Why are you escalating it?</legend>
          {/* OFF AN EMAIL, ONLY THE TWO THINGS THAT CAN ARRIVE IN ONE. A decision and a
              litigation recommendation are things somebody DECIDES, not things that come in the
              post -- /api/email/ticket refuses them for the same reason, so offering them here
              would be a button that is refused after the words have been typed. */}
          {(fromEmail ? ESCALATION_KIND_ORDER.filter((k) => k === 'dispute' || k === 'request') : ESCALATION_KIND_ORDER).map((k) => {
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
        {/* NOT ASKED ON AN EMAIL. An email IS the writing -- that is what makes it the event
            the firm wanted the real sequence started from -- so a box asking whether we have it
            in writing would be asking somebody to confirm what they are looking at. The endpoint
            sets received_on and in_writing itself. */}
        {kind === 'dispute' && !fromEmail && (
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

        {/*
          WHO THE THING IS BEING ASKED OF, which is the request's equivalent of the dispute's "how
          did it reach us": one closed question that decides what the ticket means. It is NOT the
          same as who is doing it -- a colleague chases the client -- and it is the answer that
          says whether the debtor caused the work at all.
        */}
        {/*
          WHAT IS BEING ASKED FOR, which is the request's equivalent of the dispute's category --
          the one closed answer that lets the board be sorted by something other than free text.
          
          IT REPLACED "WHO ARE WE ASKING", at the firm's asking and for a better reason than order:
          who is being asked is already on the ticket, because it is whoever it is given to. See
          REQUEST_KINDS.
        */}
        {kind === 'request' && !linkedTo && (
          <label className="block">
            <span className="text-sm font-medium text-slate-700">What are we asking for?</span>
            <select value={requestFor} onChange={(e) => setRequestFor(e.target.value)}
              className="w-full mt-1 text-sm rounded-lg border border-slate-200 px-2.5 py-2 bg-white">
              {REQUEST_KINDS.map((r) => <option key={r.value} value={r.value}>{r.value}</option>)}
            </select>
            {/* The examples under it rather than in the option text: a select that reads
                "Invoices — the invoices the debt is made up of" is unreadable at this width. */}
            <span className="block text-[11px] text-slate-500 mt-1">
              {REQUEST_KINDS.find((r) => r.value === requestFor)?.examples}
            </span>
          </label>
        )}

        {/*
          ESCALATE IT, OR KEEP IT AND DEAL WITH IT YOURSELF.

          THE FIRM, of a dispute that has arrived in writing: "you should be able to decide what
          to do with it as well. Maybe you don't want to escalate it. Maybe you can resolve it
          yourself."

          IT IS NOT A QUESTION ABOUT WHETHER COLLECTION STOPS -- it has stopped, that is what a
          written dispute does, and the line under it says so rather than leaving somebody to
          think keeping it is the quiet option. It is a question about whose desk it sits on.
        */}
        {askKeepOrEscalate && (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-slate-700 mb-1.5">What happens to it now?</legend>
            {([
              [false, 'Escalate it', 'Somebody else answers the debtor. Pick them below.'],
              [true, 'Keep it — I will deal with it myself',
                'It stays on your desk, on your list, and nobody else is waiting on it.'],
            ] as const).map(([value, label, what]) => (
              <label key={String(value)}
                className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  keepIt === value ? 'border-brand-500 bg-brand-50/50' : 'border-slate-200 hover:bg-slate-50'
                }`}>
                <input type="radio" name="escalation-keep" checked={keepIt === value}
                  onChange={() => setKeepIt(value)} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm text-slate-800">{label}</span>
                  <span className="block text-[11px] text-slate-500">{what}</span>
                </span>
              </label>
            ))}
            <p className="text-[11px] text-slate-500">
              Either way the collection sequences stop until the dispute is answered. This only
              decides who answers it.
            </p>
          </fieldset>
        )}

        {/* WHOSE IT ALREADY IS. A ticket somebody is holding does not change hands because an
            email arrived on it -- that is a decision made on the ticket, by whoever is on it. */}
        {linkedTo?.ownerId && (
          <p className="text-[11px] text-slate-500">
            It is with {users.find((u) => u.id === linkedTo.ownerId)?.name ?? 'somebody'}. The email
            and its attachments are filed against it; who answers it is unchanged.
          </p>
        )}

        <label className={`block ${keepIt || linkedTo?.ownerId ? 'hidden' : ''}`}>
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
            {/*
              A REQUEST MAY GO TO ANYBODY, at the firm's choosing, and a dispute may not.
              The short list exists because a FINDING needs somebody with standing over the person
              who raised it. Nothing about "please send me the March statement" needs standing, and
              the person who can answer it is often neither a team leader nor a liaison -- whoever
              did the import, whoever took the call. Narrowing it there would send somebody hunting
              for a name and then logging it as a dispute to reach them, which is the whole fault
              this kind exists to remove.

              THE THREE ABOVE STAY AT THE TOP even on a request: they are still the likeliest
              answer, and a list that reorders itself by kind is a list nobody learns.
            */}
            {kind === 'request' && everybodyElse.length > 0 && (
              <optgroup label="Anybody else">
                {everybodyElse.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </optgroup>
            )}
          </select>
          {/* THE LIST IS SHORT ON PURPOSE and says so, or somebody hunts for a name that is not
              there and concludes the screen is broken. */}
          <span className="block text-[11px] text-slate-500 mt-1">
            {kind === 'request'
              ? 'Anybody in the firm — a request needs somebody who can answer it, not somebody senior.'
              : 'Your team leader, the liaison who looks after this client, or the liaison manager.'}
          </span>
          {!clientLiaison && (
            <span className="block text-[11px] text-gold-600 mt-1">
              This client has no liaison set. Set one on the client record and it will be offered here.
            </span>
          )}
          {/*
            UNASSIGNED MEANS NOBODY IS TOLD, and it is worth saying because the screen does not
            look like that -- the ticket appears on the board, which reads as having been sent
            somewhere. It has not. `nav_counts` counts open tickets by `owner_id`, so one with
            nobody on it is on nobody's badge; the firm noticed the effect before the cause ("I
            see that requests don't show up at the liaison"), and the commonest way in was a
            request raised off an email, which used to send no owner at all.

            A WARNING THAT FIRES WHEN SOMETHING IS ACTUALLY WRONG. It is shown only when nobody is
            picked, not as a standing note under the picker -- see CLAUDE.md on warnings people
            stop reading.
          */}
          {!ownerId && (
            <span className="block text-[11px] text-gold-600 mt-1">
              Nobody is on it, so it will sit on the board and be counted on nobody&rsquo;s list.
              Put your own name on it if you are keeping it.
            </span>
          )}
        </label>

        {/*
          NOT SHOWN WHERE THE EMAIL IS BEING LINKED. The ticket already carries the words somebody
          dictated when the debtor first said it, and a box here would either overwrite them or
          quietly do nothing. What arrived is the EMAIL, and the email is what gets filed against
          the ticket -- with its attachments -- where anybody answering it can read it whole.
        */}
        <label className={`block ${linkedTo ? 'hidden' : ''}`}>
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-slate-700">
              {/* The third copy of the fallback chain, found by the check that guards the other
                  two -- a request was asking "why has collecting run out of road?". */}
              {fromEmail ? 'What is the issue?' : ESCALATION_KINDS[kind].prompt}
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

        <div className={linkedTo ? 'hidden' : (ESCALATION_KINDS[kind].needsCategory ? 'grid grid-cols-2 gap-3' : '')}>
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
        {/* AND NOTHING IS CHARGED ON A LINK. Item 3 was raised when the dispute was raised; the
            debtor does not pay twice because their objection arrived on the telephone first and
            in writing afterwards. The endpoint enforces it -- this only stops the screen offering
            a box that would be ignored. */}
        {ESCALATION_KINDS[kind].chargeable && !linkedTo ? (
        <label className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-100">
          <input
            type="checkbox"
            checked={chargeDebtor}
            onChange={(e) => { setChargeTouched(true); setCharge(e.target.checked) }}
            className="mt-0.5"
          />
          <span className="text-sm text-slate-700">
            Charge the debtor R25 plus VAT
            {/*
              WHAT IT ACTUALLY COSTS, WHICH THIS SAID WRONGLY FOR A YEAR. It read "it is a total for
              the account, so it charges nothing if this account has already had it" -- the gazette's
              own words for item 3, and not what the firm does: they instructed on 9 September that
              it is charged PER OCCURRENCE (ENFORCE_ITEM_TOTALS is off for exactly that reason).
              What stops a second one is the firm's own limit of one a day per account, which is a
              different rule with a different answer, and a collector reading the old sentence would
              have expected a free second escalation and charged the debtor R25.
              check-dispute-stage holds this sentence against DAILY_LIMIT, so raising the limit
              fails there rather than leaving the screen quietly wrong again.
            */}
            <span className="block text-[11px] text-slate-500 mt-0.5">
              Annexure B item 3, &ldquo;other necessary expenses not specifically provided for&rdquo;.
              R25 excluding VAT each time the work is done, but only once a day on an account &mdash;
              so if something has already been perused here today, this charges nothing.
              {assigned
                ? ' Ticked because somebody is being put to work on this dispute.'
                : ' Unticked because it is unassigned — nobody is spending time on it yet.'}
            </span>
          </span>
        </label>
        ) : (
          <p className="text-sm text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2.5">
            <span className="font-medium text-slate-700">Nothing is charged.</span>{' '}
            {/* OFF THE KIND, NOT OUT OF A CHAIN. This was
                `kind === 'help' ? … : <litigation>`, so a request -- being neither -- was told the
                attorneys' costs were a separate matter. The firm read it back: "it says like
                recommend for litigation. Why is that?" */}
            {ESCALATION_KINDS[kind].freeNote}
          </p>
        )}

        {/* WHAT PRESSING IT WILL DO, on the one path where it is not obvious from the words
            above: an email carrying the attachments is about to become documents on the account,
            and on a verbal dispute this is the press that stops collecting. */}
        {linkedTo && (
          <p className="text-sm text-slate-500">
            The email{fromEmail && fromEmail.attachmentNames.length > 0
              ? ` and its ${fromEmail.attachmentNames.length} attachment${fromEmail.attachmentNames.length === 1 ? '' : 's'}`
              : ''} will be filed against this dispute.
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
            disabled={busy || (!linkedTo && !description.trim()) || (!linkedTo && needsExplanation)}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-brand-600 text-white disabled:opacity-40"
          >
            <ShieldAlert size={15} />
            {/* The same fault as the fee line above, on the button a person actually presses. */}
            {busy
              ? (linkedTo ? 'Filing…' : 'Escalating…')
              : linkedTo
                ? 'Add it to this dispute'
                : ESCALATION_KINDS[kind].submitLabel}
          </button>
          <button onClick={onClose} className="text-sm text-slate-600 hover:text-slate-800 px-2">Cancel</button>
        </div>
      </div>
    </Modal>
  )
}
