import { useState } from 'react'
import { ArrowUpRight, Check, MessageCircleQuestion, Plus, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card } from '../../components/ui/Card'
import { formatMoney, formatDate } from '../../data/mockData'
import { chargeMessage } from '../../lib/accountCharges'
import {
  ageInDays, canSendToClient, closeQuery, isStale, markOutcomeDone, raiseQuery, updateQuery,
  NEXT_STAGE, QUERY_OUTCOME_LABEL, QUERY_STAGE_LABEL,
  type AccountQuery, type QueryOutcome, type QueryStage,
} from '../../lib/accountQueries'
import type { User } from '../../types'
import { canViewClients } from '../../lib/permissions'
import { QUERY_CATEGORIES } from '../../lib/disputeCategories'

const TODAY = new Date().toISOString().slice(0, 10)

/** The card's left edge. Same colours as the disputes board, so a stage reads the same anywhere. */
const STAGE_SPINE: Record<QueryStage, string> = {
  agent: '#c9a052',
  liaison: '#3b82f6',
  client: '#0f2b46',
}

const STAGE_CHIP: Record<QueryStage, string> = {
  agent: 'bg-slate-100 text-slate-600',
  liaison: 'bg-brand-100 text-brand-600',
  client: 'bg-gold-100 text-gold-600',
}

const OUTCOME_CHIP: Record<QueryOutcome, string> = {
  valid: 'bg-negative-100 text-negative-700',
  partly_valid: 'bg-gold-100 text-gold-600',
  not_valid: 'bg-positive-100 text-positive-700',
  withdrawn: 'bg-slate-100 text-slate-500',
}

/**
 * Disputes on this account.
 *
 * A DEBTOR who says something is wrong has a dispute; a CLIENT who asks us something has a query.
 * The firm draws that line so "there's a query on this account" stops being ambiguous about who
 * is unhappy, and everything this panel shows is the debtor's side.
 *
 * Shown, never enforced: an open dispute does not stop the collector doing anything, it just
 * means they should know about it before they phone. What the business does about a dispute is
 * the business's decision, and a system that quietly halted work on an account would be taking
 * that decision away.
 */
export function QueryPanel({ accountId, queries, users, actor, onChange, busy, run, clientId, clientName }: {
  accountId: string
  queries: AccountQuery[]
  /** Who a query can be given to. */
  users: User[]
  actor: { id: string | null; name: string | null; role: string | undefined }
  onChange: () => Promise<void>
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  clientId: string | undefined
  clientName: string | undefined
}) {
  const [adding, setAdding] = useState(false)
  const open = queries.filter((q) => q.status !== 'closed')
  const closed = queries.filter((q) => q.status === 'closed')

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-[11px] uppercase tracking-wide text-slate-400">Disputes</h3>
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
            busy={busy} run={run} onChange={onChange} clientId={clientId} clientName={clientName} />
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
                <p className="text-slate-600 mt-0.5 wrap-anywhere">{q.description}</p>
                {q.outcomeAction && <p className="text-slate-400 mt-0.5">{q.outcomeAction}</p>}
              </div>
            ))}
          </div>
        </details>
      )}
    </Card>
  )
}

function QueryCard({ query: q, accountId, users, actor, busy, run, onChange, clientId, clientName }: {
  query: AccountQuery
  accountId: string
  users: User[]
  actor: { id: string | null; name: string | null; role: string | undefined }
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  onChange: () => Promise<void>
  clientId: string | undefined
  clientName: string | undefined
}) {
  const [closing, setClosing] = useState(false)
  const stale = isStale(q, TODAY)
  const owner = users.find((u) => u.id === q.ownerId)
  const ctx = { accountId, actorId: actor.id, actorName: actor.name }

  return (
    /*
      A card with a stage-coloured spine, which the firm asked for and which earns its keep: a
      collector scanning a stack of these is asking "whose is this now?" before they read a word,
      and the colour answers it from across the desk.
    */
    <div className={`rounded-lg border overflow-hidden ${stale ? 'border-negative-100 bg-negative-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex">
        <span className="w-1 shrink-0" style={{ backgroundColor: STAGE_SPINE[q.stage] }} aria-hidden="true" />
        <div className="flex-1 min-w-0 p-3">
          <div className="flex items-start justify-between gap-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${STAGE_CHIP[q.stage]}`}>
              {QUERY_STAGE_LABEL[q.stage]}
            </span>
            <span className={`text-[11px] shrink-0 ${stale ? 'text-negative' : 'text-slate-400'}`}>
              {stale ? `chase — ${formatDate(q.chaseOn!)}` : `${ageInDays(q)} days old`}
            </span>
          </div>

          <QueryDescription text={q.description} />
          {q.category && <p className="text-[11px] text-slate-400 mt-0.5">{q.category}</p>}

          {/*
            Raised by, assigned to, follow-up — the three things asked about a dispute that is not
            in front of you. Two of them are still controls rather than text: who carries it and
            when to chase are changed far more often than they are read, and making somebody open
            something else to change them is how chase dates go stale.
          */}
          <div className="flex flex-wrap gap-x-4 gap-y-2 mt-2.5 pt-2.5 border-t border-slate-100">
            <div className="min-w-[6.5rem] flex-1">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Raised by</p>
              <p className="text-[12px] text-slate-700 truncate">{q.raisedByName ?? '—'}</p>
            </div>
            <div className="min-w-[6.5rem] flex-1">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Assigned to</p>
              <select
                value={q.ownerId ?? ''}
                disabled={busy}
                onChange={(e) => run(() => updateQuery(q.id, { ownerId: e.target.value || null }, {
                  ...ctx,
                  note: `Dispute given to ${users.find((u) => u.id === e.target.value)?.name ?? 'nobody'}.`,
                }))}
                className="w-full text-[12px] text-slate-700 bg-transparent -ml-0.5 outline-none cursor-pointer hover:text-brand-600"
              >
                <option value="">Nobody yet</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className="min-w-[7.5rem] flex-1">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Follow-up</p>
              <input
                type="date"
                value={q.chaseOn ?? ''}
                disabled={busy}
                onChange={(e) => run(() => updateQuery(q.id, { chaseOn: e.target.value }, ctx))}
                className={`w-full text-[12px] bg-transparent -ml-0.5 outline-none cursor-pointer ${stale ? 'text-negative font-medium' : 'text-slate-700'}`}
              />
            </div>
          </div>
          {owner && actor.id && owner.id !== actor.id && (
            <p className="text-[10px] text-slate-400 mt-1.5">
              You are covering for {owner.name.split(' ')[0]} — anything you do here is recorded under your name.
            </p>
          )}

          {/*
            The client link is not for everyone. A pre-legal agent works the debtor; the client
            behind the account — its rates, its mandate, its deals — is the liaison's business.
          */}
          {clientId && canViewClients(actor.role as User['role'] | undefined) && (
            <Link to={`/companies/${clientId}`} className="inline-flex items-center gap-0.5 mt-2 text-[11px] text-brand-600 hover:underline">
              View client: {clientName ?? 'the client'} <ArrowUpRight size={11} />
            </Link>
          )}

      {!closing && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {/*
            One rung at a time, and only the rung this query is actually on. Sending to the client
            is gated: a collections agent should not be writing to a client about a disputed
            account on their own initiative — that is the liaison's relationship to manage.
          */}
          {(() => {
            const next = NEXT_STAGE[q.stage]
            if (!next) return null
            const gated = next.to === 'client' && !canSendToClient(actor.role)
            if (gated) {
              return (
                <span className="text-[11px] text-slate-400 px-2 py-1 border border-dashed border-slate-200 rounded"
                  title="Only a client liaison or a manager can put a query in front of a client.">
                  {next.label} &mdash; liaison only
                </span>
              )
            }
            return (
              <Step label={next.label} disabled={busy}
                onClick={() => run(() => updateQuery(q.id, { stage: next.to }, { ...ctx, note: next.note }))} />
            )
          })()}
          {/* Every tier can close what it has answered. Most queries never reach the client. */}
          {/* The chase date is set in Follow-up above; a second control for it was two places to
              change one thing, and the one you did not use looked wrong afterwards. */}
          <Step label="Resolve" disabled={busy} onClick={() => setClosing(true)} />
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
      </div>
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
                {q.outcomeAmount !== null && <> &mdash; {formatMoney(q.outcomeAmount)}</>}
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
          message = charge ? chargeMessage(charge, '3') : 'Not charged to the debtor.'
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
        {QUERY_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.value}</option>)}
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
        Raising a query charges item 3, &ldquo;other necessary expenses not specifically provided
        for&rdquo; &mdash; R25 excluding VAT, and a total for the account, so a second query
        charges nothing under it. Sending it to the client then charges item 1a (R25) and the
        client&rsquo;s reply charges item 6 (R13), both per occurrence.
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

/**
 * A query's text, three lines at a time.
 *
 * Two things go wrong with a long description and both were visible on an iPad. It ran to a wall
 * of text in a card meant to be scanned, and — where somebody had typed one unbroken run with no
 * spaces in it — there was nowhere for the line to break, so the card widened until it pushed the
 * whole right-hand column off the screen. `wrap-anywhere` lets the break happen mid-word, which
 * is what keeps the column at the width the grid gave it.
 */
function QueryDescription({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 150
  return (
    <p
      onClick={long ? () => setOpen((v) => !v) : undefined}
      title={long ? (open ? 'Show less' : 'Show all') : undefined}
      className={`text-sm text-slate-800 mt-1.5 wrap-anywhere ${long ? 'cursor-pointer' : ''} ${
        long && !open ? 'line-clamp-3' : ''}`}
    >
      {text}
    </p>
  )
}
