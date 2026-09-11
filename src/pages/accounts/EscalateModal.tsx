import { useMemo, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { raiseQuery } from '../../lib/accountQueries'
import {
  categoryExamples, explanationMissing,
  CATEGORY_NEEDING_EXPLANATION, EXPLANATION_MIN_LENGTH, QUERY_CATEGORIES,
} from '../../lib/disputeCategories'
import { chargeMessage } from '../../lib/accountCharges'
import type { User } from '../../types'

const TODAY = new Date().toISOString().slice(0, 10)

/** Who a manager is, in the absence of a team-leader field: it is a role, not a relationship. */
const MANAGER_ROLES = ['Administrator', 'Sales Manager', 'Liaison Manager']

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
 * An internal escalation and a debtor's dispute are the same object deliberately. Both are "this
 * account needs somebody else's attention", both need an owner, a chase date and an answer, and
 * building two of them would mean two queues and two places to look.
 */
export function EscalateModal({ accountId, users, clientLiaison, actor, onClose, onDone }: {
  accountId: string
  users: User[]
  /** The liaison on this debtor's client, which is who a client query goes to by default. */
  clientLiaison: User | undefined
  actor: { id: string | null; name: string | null }
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [toId, setToId] = useState(clientLiaison?.id ?? '')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [chaseOn, setChaseOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const managers = useMemo(() => users.filter((u) => MANAGER_ROLES.includes(u.role)), [users])
  const others = useMemo(
    () => users.filter((u) => u.id !== clientLiaison?.id && !MANAGER_ROLES.includes(u.role)),
    [users, clientLiaison?.id],
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
  const needsExplanation = explanationMissing(category, description)

  const givenAway = !!toId && toId !== actor.id
  const [chargeTouched, setChargeTouched] = useState(false)
  const [charge, setCharge] = useState(givenAway)
  const chargeDebtor = chargeTouched ? charge : givenAway

  async function submit() {
    if (!description.trim()) return
    setBusy(true); setError(null)
    try {
      const { charge: raised } = await raiseQuery({
        accountId,
        description,
        category,
        ownerId: toId || null,
        chaseOn: chaseOn || null,
        raisedBy: actor.id,
        raisedByName: actor.name,
        charge: chargeDebtor,
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
    <Modal title="Raise a dispute" onClose={onClose} width={520}>
      <div className="space-y-3">
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
            {managers.length > 0 && (
              <optgroup label="Managers">
                {managers.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.role}</option>)}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="Everyone else">
                {others.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </optgroup>
            )}
          </select>
          {!clientLiaison && (
            <span className="block text-[11px] text-gold-600 mt-1">
              This client has no liaison set. Set one on the client record and it will be offered here.
            </span>
          )}
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">What is the issue?</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            autoFocus
            placeholder={category === CATEGORY_NEEDING_EXPLANATION
              ? 'Required for "Other" — say what the debtor is actually disputing.'
              : 'What did the debtor say, or what do you need decided? In their words if you can.'}
            className="w-full mt-1 text-sm rounded-lg border border-slate-200 px-2.5 py-2 resize-none"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
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
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Chase on</span>
            <input type="date" value={chaseOn} min={TODAY} onChange={(e) => setChaseOn(e.target.value)}
              className="w-full mt-1 text-sm rounded-lg border border-slate-200 px-2.5 py-2" />
          </label>
        </div>

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
              {givenAway
                ? ' Ticked because you are giving this dispute to someone else to deal with.'
                : ' Unticked because you are keeping this one — answering your own dispute is the job, not an expense.'}
            </span>
          </span>
        </label>

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
            {busy ? 'Raising...' : 'Raise dispute'}
          </button>
          <button onClick={onClose} className="text-sm text-slate-600 hover:text-slate-800 px-2">Cancel</button>
        </div>
      </div>
    </Modal>
  )
}
