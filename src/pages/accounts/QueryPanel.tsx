import { useState } from 'react'
import { Check, MessageCircleQuestion, Plus, X } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { formatCurrency, formatDate } from '../../data/mockData'
import { chargeMessage } from '../../lib/accountCharges'
import {
  ageInDays, closeQuery, isStale, markOutcomeDone, raiseQuery, updateQuery,
  QUERY_CATEGORIES, QUERY_OUTCOME_LABEL, QUERY_STATUS_LABEL,
  type AccountQuery, type QueryOutcome, type QueryStatus,
} from '../../lib/accountQueries'
import type { User } from '../../types'

const TODAY = new Date().toISOString().slice(0, 10)

const STATUS_CHIP: Record<QueryStatus, string> = {
  open: 'bg-gold-100 text-gold-600',
  with_client: 'bg-brand-100 text-brand-600',
  answered: 'bg-positive-100 text-positive-700',
  closed: 'bg-slate-100 text-slate-500',
}

const OUTCOME_CHIP: Record<QueryOutcome, string> = {
  valid: 'bg-negative-100 text-negative-700',
  partly_valid: 'bg-gold-100 text-gold-600',
  not_valid: 'bg-positive-100 text-positive-700',
  withdrawn: 'bg-slate-100 text-slate-500',
}

/**
 * Queries and disputes on this account.
 *
 * Shown, never enforced: an open dispute does not stop the collector doing anything, it just
 * means they should know about it before they phone. What the business does about a dispute is
 * the business's decision, and a system that quietly halted work on an account would be taking
 * that decision away.
 */
export function QueryPanel({ accountId, queries, users, actor, onChange, busy, run }: {
  accountId: string
  queries: AccountQuery[]
  /** Who a query can be given to. */
  users: User[]
  actor: { id: string | null; name: string | null }
  onChange: () => Promise<void>
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<boolean>
}) {
  const [adding, setAdding] = useState(false)
  const open = queries.filter((q) => q.status !== 'closed')
  const closed = queries.filter((q) => q.status === 'closed')

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-[11px] uppercase tracking-wide text-slate-400">Queries &amp; disputes</h3>
        <button onClick={() => setAdding((v) => !v)} className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1">
          {adding ? <><X size={12} /> Cancel</> : <><Plus size={12} /> Raise one</>}
        </button>
      </div>

      {adding && (
        <RaiseForm
          accountId={accountId}
          users={users}
          actor={actor}
          busy={busy}
          run={run}
          onDone={() => setAdding(false)}
        />
      )}

      {open.length === 0 && closed.length === 0 && !adding && (
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Nothing disputed. Raise one when the debtor says something only the client can answer.
        </p>
      )}

      <div className="space-y-2.5">
        {open.map((q) => (
          <QueryCard key={q.id} query={q} accountId={accountId} users={users} actor={actor}
            busy={busy} run={run} onChange={onChange} />
        ))}
      </div>

      {closed.length > 0 && (
        <details className="mt-3 pt-3 border-t border-slate-100">
          <summary className="text-[11px] text-slate-400 cursor-pointer hover:text-slate-600">
            {closed.length} closed
          </summary>
          <div className="space-y-2 mt-2">
            {closed.map((q) => (
              <div key={q.id} className="text-xs">
                <div className="flex items-baseline gap-2">
                  <span className="text-slate-400 tabular-nums shrink-0">{formatDate(q.closedAt ?? q.raisedAt)}</span>
                  {q.outcome && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${OUTCOME_CHIP[q.outcome]}`}>
                      {QUERY_OUTCOME_LABEL[q.outcome]}
                    </span>
                  )}
                </div>
                <p className="text-slate-600 mt-0.5">{q.description}</p>
                {q.outcomeAction && <p className="text-slate-400 mt-0.5">{q.outcomeAction}</p>}
              </div>
            ))}
          </div>
        </details>
      )}
    </Card>
  )
}

function QueryCard({ query: q, accountId, users, actor, busy, run, onChange }: {
  query: AccountQuery
  accountId: string
  users: User[]
  actor: { id: string | null; name: string | null }
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  onChange: () => Promise<void>
}) {
  const [closing, setClosing] = useState(false)
  const stale = isStale(q, TODAY)
  const owner = users.find((u) => u.id === q.ownerId)
  const ctx = { accountId, actorId: actor.id, actorName: actor.name }

  return (
    <div className={`p-3 rounded-lg border ${stale ? 'border-negative-100 bg-negative-50' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${STATUS_CHIP[q.status]}`}>
          {QUERY_STATUS_LABEL[q.status]}
        </span>
        <span className={`text-[11px] shrink-0 ${stale ? 'text-negative' : 'text-slate-400'}`}>
          {stale ? `chase — ${formatDate(q.chaseOn!)}` : `${ageInDays(q)} days old`}
        </span>
      </div>

      <p className="text-sm text-slate-800 mt-1.5">{q.description}</p>
      <p className="text-[11px] text-slate-400 mt-0.5">
        {[q.category, q.raisedByName ? `raised by ${q.raisedByName}` : null].filter(Boolean).join(' · ')}
      </p>

      {/*
        Whose query it is, chosen inline. The team covers for each other — anyone may act on this
        and every action records who really did — but one person carries it.
      */}
      <label className="flex items-center gap-2 mt-2 text-[11px] text-slate-500">
        Owner
        <select
          value={q.ownerId ?? ''}
          disabled={busy}
          onChange={(e) => run(() => updateQuery(q.id, { ownerId: e.target.value || null }, {
            ...ctx,
            note: `Query given to ${users.find((u) => u.id === e.target.value)?.name ?? 'nobody'}.`,
          }))}
          className="flex-1 min-w-0 text-[11px] rounded border border-slate-200 px-1.5 py-1 bg-white"
        >
          <option value="">Nobody yet</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
      {owner && actor.id && owner.id !== actor.id && (
        <p className="text-[10px] text-slate-400 mt-1">
          You are covering for {owner.name.split(' ')[0]} — anything you do here is recorded under your name.
        </p>
      )}

      {!closing && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {q.status === 'open' && (
            <Step label="Sent to client" disabled={busy}
              onClick={() => run(() => updateQuery(q.id, { status: 'with_client' }, { ...ctx, note: 'Query sent to the client.' }))} />
          )}
          {q.status === 'with_client' && (
            <Step label="Client answered" disabled={busy}
              onClick={() => run(() => updateQuery(q.id, { status: 'answered' }, { ...ctx, note: 'The client has answered.' }))} />
          )}
          <Step label="Close" disabled={busy} onClick={() => setClosing(true)} />
          <label className="text-[11px] text-slate-400 inline-flex items-center gap-1 ml-auto">
            chase
            <input type="date" value={q.chaseOn ?? ''} disabled={busy}
              onChange={(e) => run(() => updateQuery(q.id, { chaseOn: e.target.value }, ctx))}
              className="text-[11px] rounded border border-slate-200 px-1 py-0.5" />
          </label>
        </div>
      )}

      {closing && (
        <CloseForm
          onCancel={() => setClosing(false)}
          busy={busy}
          onClose={async (outcome, action, amount) => {
            const ok = await run(() => closeQuery(q.id, { outcome, action, amount }, ctx))
            if (ok) setClosing(false)
            await onChange()
          }}
        />
      )}
    </div>
  )
}

/**
 * A closed query whose outcome nobody has acted on yet.
 *
 * "Reduce to R4,200" recorded is not R4,200 reduced. The distinction is the whole reason the
 * outcome is a decision here rather than an edit to the ledger, so the page has to be able to
 * say which of the two has happened.
 */
export function OutcomeOutstanding({ queries, accountId, actor, busy, run }: {
  queries: AccountQuery[]
  accountId: string
  actor: { id: string | null; name: string | null }
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<boolean>
}) {
  const pending = queries.filter((q) => q.status === 'closed' && q.outcome && !q.outcomeDone
    && q.outcome !== 'not_valid' && (q.outcomeAction || q.outcomeAmount !== null))
  if (pending.length === 0) return null
  return (
    <>
      {pending.map((q) => (
        <Card key={q.id} className="border-gold-100 bg-gold-50">
          <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-navy-950">
                A dispute was upheld and the outcome is still to be carried out
              </p>
              <p className="text-navy-800 mt-1">
                {q.outcomeAction}
                {q.outcomeAmount !== null && <> &mdash; {formatCurrency(q.outcomeAmount)}</>}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Closed {q.closedAt ? formatDate(q.closedAt) : ''} by {q.closedByName ?? 'someone'}.
                Adjusting a balance is a ledger change and is not done from here.
              </p>
            </div>
            <button
              disabled={busy}
              onClick={() => run(() => markOutcomeDone(q.id, { accountId, actorId: actor.id, actorName: actor.name }))}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 disabled:opacity-50 shrink-0 inline-flex items-center gap-1.5"
            >
              <Check size={13} /> Mark as done
            </button>
          </div>
        </Card>
      ))}
    </>
  )
}

function Step({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="text-[11px] font-medium px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
      {label}
    </button>
  )
}

function RaiseForm({ accountId, users, actor, busy, run, onDone }: {
  accountId: string
  users: User[]
  actor: { id: string | null; name: string | null }
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  onDone: () => void
}) {
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [chaseOn, setChaseOn] = useState('')
  const [charged, setCharged] = useState<string | null>(null)

  return (
    <form
      className="space-y-2 p-3 rounded-lg bg-slate-50 border border-slate-100 mb-3"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!description.trim()) return
        let message: string | null = null
        const ok = await run(async () => {
          const { charge } = await raiseQuery({
            accountId, description, category, ownerId: ownerId || null, chaseOn: chaseOn || null,
            raisedBy: actor.id, raisedByName: actor.name,
          })
          message = chargeMessage(charge)
        })
        // Said after the fact rather than promised beforehand: whether item 3 has anything left
        // on this account depends on the ledger, and the ledger is read when the charge is made.
        if (ok) { setCharged(message); onDone() }
      }}
    >
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} autoFocus rows={3}
        placeholder="What did the debtor say? In their words if you can."
        className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5 resize-none" />
      {/* Optional. The kinds are too various to make anyone pick one before they can save. */}
      <select value={category} onChange={(e) => setCategory(e.target.value)}
        className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5 bg-white">
        <option value="">No category</option>
        {QUERY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}
        className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5 bg-white">
        <option value="">Nobody yet</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <label className="block text-[11px] text-slate-500">
        Chase the client on
        <input type="date" value={chaseOn} onChange={(e) => setChaseOn(e.target.value)} min={TODAY}
          className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5 mt-0.5" />
      </label>
      <p className="text-[10px] text-slate-500 leading-snug">
        Raising a query charges the debtor under Annexure B item 3, &ldquo;other necessary expenses
        not specifically provided for&rdquo; &mdash; R25 excluding VAT. The gazette makes that a
        total for the account, so a second query on the same account charges nothing.
      </p>
      {charged && <p className="text-[11px] text-gold-600">{charged}</p>}
      <button type="submit" disabled={busy || !description.trim()}
        className="w-full text-sm font-medium py-1.5 rounded-lg bg-brand-600 text-white disabled:opacity-50">
        {busy ? 'Saving...' : 'Raise query'}
      </button>
    </form>
  )
}

function CloseForm({ onClose, onCancel, busy }: {
  onClose: (outcome: QueryOutcome, action: string, amount: number | null) => void
  onCancel: () => void
  busy: boolean
}) {
  const [outcome, setOutcome] = useState<QueryOutcome>('valid')
  const [action, setAction] = useState('')
  const [amount, setAmount] = useState('')
  const needsAction = outcome === 'valid' || outcome === 'partly_valid'

  return (
    <div className="mt-2.5 p-2.5 rounded-lg bg-slate-50 border border-slate-100 space-y-2">
      <select value={outcome} onChange={(e) => setOutcome(e.target.value as QueryOutcome)}
        className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5 bg-white">
        {(Object.keys(QUERY_OUTCOME_LABEL) as QueryOutcome[]).map((o) => (
          <option key={o} value={o}>{QUERY_OUTCOME_LABEL[o]}</option>
        ))}
      </select>
      {needsAction && (
        <>
          <input value={action} onChange={(e) => setAction(e.target.value)}
            placeholder="What must happen now? e.g. reduce to R4,200, withdraw the account"
            className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5" />
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"
            placeholder="Amount, if it is a reduction (optional)"
            className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5" />
          <p className="text-[10px] text-slate-500 leading-snug">
            Recorded, not applied. Changing what is owed is a ledger entry and stays a separate,
            deliberate act &mdash; this account will show the outcome as outstanding until someone does it.
          </p>
        </>
      )}
      <div className="flex items-center gap-2">
        <button
          disabled={busy}
          onClick={() => onClose(outcome, action, amount.trim() ? Number(amount) : null)}
          className="text-[11px] font-medium px-2.5 py-1 rounded bg-brand-600 text-white disabled:opacity-50 inline-flex items-center gap-1"
        >
          <MessageCircleQuestion size={12} /> Close query
        </button>
        <button onClick={onCancel} className="text-[11px] text-slate-500 hover:text-slate-700">Cancel</button>
      </div>
    </div>
  )
}
