import { useMemo, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { raiseQuery, QUERY_CATEGORIES } from '../../lib/accountQueries'
import { chargeMessage } from '../../lib/accountCharges'
import type { User } from '../../types'

const TODAY = new Date().toISOString().slice(0, 10)

/** Who a manager is, in the absence of a team-leader field: it is a role, not a relationship. */
const MANAGER_ROLES = ['Administrator', 'Sales Manager', 'Liaison Manager']

/**
 * Escalating an account.
 *
 * The front door to the query system. Raising a dispute used to mean finding a panel three cards
 * down the right-hand column, which is a fine place to WORK a query and a poor place to discover
 * that you can start one — the action bar is where a collector looks for something to do.
 *
 * An escalation and a debtor's query are the same object deliberately. Both are "this account
 * needs somebody else's attention", both need an owner, a chase date and an answer, and building
 * two of them would mean two queues and two places to look.
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

  // Internal supervision is not a "necessary expense" recoverable from a debtor, so escalating to
  // a manager starts unticked and escalating to the client's liaison starts ticked. Shown as a
  // checkbox rather than decided silently: the person doing it knows which this really is.
  const goesToClient = !!toId && toId === clientLiaison?.id
  const [chargeTouched, setChargeTouched] = useState(false)
  const [charge, setCharge] = useState(goesToClient)
  const chargeDebtor = chargeTouched ? charge : goesToClient

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
    <Modal title="Escalate this account" onClose={onClose} width={520}>
      <div className="space-y-3">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Escalate to</span>
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
            placeholder="What did the debtor say, or what do you need decided? In their words if you can."
            className="w-full mt-1 text-sm rounded-lg border border-slate-200 px-2.5 py-2 resize-none"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full mt-1 text-sm rounded-lg border border-slate-200 px-2.5 py-2 bg-white">
              <option value="">None</option>
              {QUERY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
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
              {goesToClient
                ? ' Ticked because this is going to the client liaison and will be taken up with the client.'
                : ' Unticked because an internal escalation is supervision, not an expense of collecting.'}
            </span>
          </span>
        </label>

        {error && <p className="text-sm text-negative-700">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={submit}
            disabled={busy || !description.trim()}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-brand-600 text-white disabled:opacity-40"
          >
            <ShieldAlert size={15} />
            {busy ? 'Escalating...' : 'Escalate'}
          </button>
          <button onClick={onClose} className="text-sm text-slate-600 hover:text-slate-800 px-2">Cancel</button>
        </div>
      </div>
    </Modal>
  )
}
