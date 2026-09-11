import { useState } from 'react'
import { Check, MessageCircleQuestion, Plus, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card } from '../../components/ui/Card'
import { formatMoney, formatDate } from '../../data/mockData'
import { chargeMessage } from '../../lib/accountCharges'
import {
  closeQuery, isStale, markOutcomeDone, raiseQuery, updateQuery,
  stageForAssignee, QUERY_OUTCOME_LABEL, QUERY_STAGE_LABEL,
  type AccountQuery, type QueryOutcome, type QueryStage,
} from '../../lib/accountQueries'
import type { User } from '../../types'
import { canViewClients } from '../../lib/permissions'
import { QUERY_CATEGORIES } from '../../lib/disputeCategories'

const TODAY = new Date().toISOString().slice(0, 10)

/**
 * Where a dispute sits, as a dot, in the app's own palette.
 *
 * The first attempt reached for a generic blue, which is nobody's brand and this app's least of
 * all — Raptor is navy and gold. Read as a scale rather than three labels: grey while it is ours
 * to answer, navy once it has gone up the firm, gold when it is outside the building and somebody
 * else is holding it. Gold is the one that should catch an eye across a desk.
 */
const STAGE_DOT: Record<QueryStage, string> = {
  agent: 'var(--c-grey-light)',
  team_leader: 'var(--c-steel)',
  liaison: 'var(--c-navy)',
  client: 'var(--c-gold)',
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
export function QueryPanel({ accountId, accountLabel, queries, users, actor, onChange, busy, run, clientId, clientLiaisonId }: {
  accountId: string
  /** The account number, used to find this debtor again on the dispute board. */
  accountLabel: string | null
  queries: AccountQuery[]
  /** Who a query can be given to. */
  users: User[]
  actor: { id: string | null; name: string | null; role: string | undefined }
  onChange: () => Promise<void>
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  clientId: string | undefined
  /** Who looks after this debtor's client — giving a dispute to them is what "with the liaison" means. */
  clientLiaisonId: string | undefined
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
          <QueryCard key={q.id} query={q} accountId={accountId} accountLabel={accountLabel} users={users} actor={actor}
            clientLiaisonId={clientLiaisonId} busy={busy} run={run} onChange={onChange} clientId={clientId} />
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

function QueryCard({ query: q, accountId, accountLabel, users, actor, busy, run, onChange, clientId, clientLiaisonId }: {
  query: AccountQuery
  accountId: string
  accountLabel: string | null
  users: User[]
  actor: { id: string | null; name: string | null; role: string | undefined }
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  onChange: () => Promise<void>
  clientId: string | undefined
  clientLiaisonId: string | undefined
}) {
  const [closing, setClosing] = useState(false)
  const stale = isStale(q, TODAY)
  const owner = users.find((u) => u.id === q.ownerId)
  const ctx = { accountId, actorId: actor.id, actorName: actor.name }

  return (
    /*
      Built on the Promise to Pay card, at the firm's request and for a good reason: the two are
      the same kind of object. Something is outstanding, somebody owes an answer, and there are
      two or three things you can do about it. PTP had already found the shape — a tinted panel,
      the important line in bold, one line of facts under it, and a row of equal buttons — so a
      second invented layout beside it was noise pretending to be design.

      The tint carries the state, the way PTP goes red when a promise is late: quiet while the
      dispute is ours, gold once it is with the client and nobody here can move it, red when the
      follow-up date has gone by.

      The quiet tint is `brand`, not Tailwind's `slate`. Both are grey at a glance, but brand-50 is
      mixed off this app's navy, so a resting dispute sits in the same family as the gold promise
      beside it instead of looking like a panel borrowed from somewhere else.
    */
    <div className={`p-3 rounded-lg border ${
      stale ? 'border-negative-100 bg-negative-50'
        : q.stage === 'client' ? 'border-gold-100 bg-gold-50'
          : 'border-brand-100 bg-brand-50'}`}
    >
      {/*
        The complaint gets the full width.

        PTP can put its meta on the same row because the bold thing there is "R1 250.00". A
        complaint is a sentence, and a stage chip beside it at this column's real width (19rem)
        squeezed it into a four-line ribbon down the left of the card.
      */}
      <QueryDescription text={q.description} />

      {/*
        Facts in two short rows instead of one that wraps.

        One long line looked tidier written down and was not: at 19rem it broke wherever it ran
        out of room, which left a middle dot alone at the start or the end of a line. Two rows
        that each fit are honest about the width the panel actually has.

        Who raised it is deliberately not here. It was the piece that would not fit, it is the
        least useful of them at a glance, and the timeline records it on the "Dispute raised" note.
      */}
      <p className="text-[11px] text-slate-500 mt-1 flex flex-wrap items-center gap-x-1.5">
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: STAGE_DOT[q.stage] }} />
          {QUERY_STAGE_LABEL[q.stage]}
        </span>
        {q.category && (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-slate-300">&middot;</span>{q.category}
          </span>
        )}
      </p>

      {/*
        Who has it and when to chase stay controls rather than text: they change far more often
        than they are read, and sending somebody to another screen to move a chase date is how
        chase dates go stale.
      */}
      <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-x-1.5">
        {/* "With", not "Given to": four characters of label is the difference between reading
            somebody's name and reading "Thab...". */}
        <span className="shrink-0">With</span>
        <select
          value={q.ownerId ?? ''}
          disabled={busy}
          onChange={(e) => {
            /*
             * Handing a dispute over IS escalating it, so the stage moves with the name. This is
             * also the only way to escalate from here now: the step buttons are gone, because a
             * dispute is worked on its own board and not in the corner of an account page.
             */
            const to = users.find((u) => u.id === e.target.value)
            return run(() => updateQuery(q.id, {
              ownerId: e.target.value || null,
              stage: stageForAssignee(to?.role, !!to && to.id === clientLiaisonId),
            }, { ...ctx, note: `Dispute given to ${to?.name ?? 'nobody'}.` }))
          }}
          className="min-w-0 flex-1 truncate text-[11px] text-slate-600 bg-transparent outline-none cursor-pointer hover:text-[var(--c-gold-deep)]"
        >
          <option value="">nobody yet</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        {/*
          The row does not wrap; the name gives way instead.

          A name and a date wrapping past each other left a middle dot alone at the start of a
          line. The select shrinks and ellipsizes so one readable line survives -- and the date
          next to it is a written date, not a date input, which is what makes the name fit at all.
          A native date field costs about 170px of a 272px row once its picker icon is counted;
          "19 Sep 2026" costs 75. PTP writes its date out for the same reason, so the two cards
          now read alike.

          An overdue chase date said so three times over -- the card turns red, the date turns red,
          and it used to add the word "overdue" as well. Two signals are plenty.
        */}
        <span className="inline-flex items-center gap-1.5 shrink-0">
          <span className="text-slate-300">&middot;</span>
          <ChaseDate
            value={q.chaseOn}
            stale={stale}
            busy={busy}
            onChange={(v) => run(() => updateQuery(q.id, { chaseOn: v || null }, ctx))}
          />
        </span>
      </p>
      {owner && actor.id && owner.id !== actor.id && (
        <p className="text-[10px] text-slate-400 mt-0.5">
          Covering for {owner.name.split(' ')[0]} — recorded under your name.
        </p>
      )}

      {/*
        Three buttons, equal width, exactly as PTP does it.

        Two of the three only navigate, so both are quiet and navy; green is kept for the one that
        changes something. Three different colours in a row of three read as three equal choices.

        No "send to liaison" or "send to client" here. A dispute is moved on the dispute board,
        where you can see the others it is queued behind; from an account you look at it, or you
        answer it. Giving it to somebody in the line above still escalates it, which is the one
        move that genuinely belongs on this page.
      */}
      {!closing && (
        <div className="flex gap-1.5 mt-2">
          {clientId && canViewClients(actor.role as User['role'] | undefined) && (
            <Link to={`/companies/${clientId}`}
              className="flex-1 text-[11px] font-medium py-1 rounded border border-brand-100 text-brand-500 hover:bg-white inline-flex items-center justify-center gap-1">
              View client
            </Link>
          )}
          <Link to={accountLabel ? `/queries?q=${encodeURIComponent(accountLabel)}` : '/queries'}
            className="flex-1 text-[11px] font-medium py-1 rounded border border-brand-100 text-brand-500 hover:bg-white inline-flex items-center justify-center gap-1">
            View dispute
          </Link>
          <button disabled={busy} onClick={() => setClosing(true)}
            className="flex-1 text-[11px] font-medium py-1 rounded border border-positive-100 text-positive-700 hover:bg-positive-50 disabled:opacity-50 inline-flex items-center justify-center gap-1">
            <Check size={11} /> Resolve
          </button>
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

/**
 * The follow-up date: written out, editable on a click.
 *
 * A bare `<input type="date">` is the honest control and the wrong one here. It is a third of
 * this panel's width before anything is typed in it, it shows the browser's locale rather than
 * the firm's, and it put "19 Sep 2026" on the card as "09/19/2026" next to a name truncated to
 * "Thab...". Written text costs a third of that and matches the promise card beside it; the
 * input is one click away for the rare occasion somebody moves the date.
 */
function ChaseDate({ value, stale, busy, onChange }: {
  value: string | null
  stale: boolean
  busy: boolean
  onChange: (value: string) => void
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <input
        type="date"
        autoFocus
        defaultValue={value ?? ''}
        disabled={busy}
        onBlur={() => setEditing(false)}
        onChange={(e) => onChange(e.target.value)}
        className="text-[11px] bg-transparent outline-none"
      />
    )
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => setEditing(true)}
      title={value ? `Following up on ${formatDate(value)} — click to change` : 'Set a follow-up date'}
      className={`text-[11px] disabled:opacity-50 ${
        stale ? 'text-negative-700 font-medium' : 'text-slate-600 hover:text-[var(--c-gold-deep)]'}`}
    >
      {value ? formatDate(value) : 'no date'}
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
      className={`text-[13.5px] font-semibold leading-snug text-navy-950 wrap-anywhere ${long ? 'cursor-pointer' : ''} ${
        long && !open ? 'line-clamp-3' : ''}`}
    >
      {text}
    </p>
  )
}
