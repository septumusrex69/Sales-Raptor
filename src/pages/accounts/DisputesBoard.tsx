import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LayoutGrid, List, Loader2, Search } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { formatDate } from '../../data/mockData'
import {
  ageInDays, canSendToClient, fetchAllQueries, isStale, updateQuery,
  QUERY_OUTCOME_LABEL, QUERY_STAGE_LABEL, type QueryStage, type QueueRow,
} from '../../lib/accountQueries'

const TODAY = new Date().toISOString().slice(0, 10)

/**
 * The columns, in the order a dispute travels.
 *
 * `resolved` is not a stage in the database — it is `status: 'closed'` — but it is a column here,
 * because a board whose last column is missing reads as a board that loses things. See
 * {@link columnOf}.
 */
type Column = QueryStage | 'resolved'
const COLUMNS: Column[] = ['agent', 'liaison', 'client', 'resolved']

const COLUMN_LABEL: Record<Column, string> = { ...QUERY_STAGE_LABEL, resolved: 'Resolved' }
/*
 * The app's own palette, not a generic one.
 *
 * Read as a scale: grey while the dispute is ours to answer, navy once it has gone up the firm,
 * gold when it is outside the building and somebody else is holding it, green when it is done.
 * Gold is the one meant to catch an eye from across a desk, which is right — a dispute sitting
 * with a client is the one nobody here can move.
 *
 * Same three colours the card on the account uses, so a stage means the same thing everywhere.
 */
const COLUMN_DOT: Record<Column, string> = {
  agent: 'var(--c-grey-light)',
  liaison: 'var(--c-navy)',
  client: 'var(--c-gold)',
  resolved: 'var(--c-green)',
}

const columnOf = (q: QueueRow): Column => (q.status === 'closed' ? 'resolved' : q.stage)

/**
 * Every dispute in the book, as a board.
 *
 * Deliberately the same shape as the Deals board — a counter strip, a search and two filters, a
 * grid/list switch, then columns of cards you can drag between. The firm asked for it in those
 * words, and the reason holds up: this is the same job. Something arrives, it sits with someone,
 * it moves along, it ends. Learning one screen should teach you the other.
 *
 * What it does NOT copy is dropping onto the last column. A deal is won by dragging it; a dispute
 * is closed with an OUTCOME — valid, partly valid, not valid, withdrawn — and what that outcome
 * requires to be carried out. That belongs on the account, where the ledger is, so Resolved
 * accepts nothing and the card takes you there instead.
 */
export function DisputesBoard() {
  const { users, userById } = useAppStore()
  const { currentUser } = useAuth()
  const navigate = useNavigate()

  const [rows, setRows] = useState<QueueRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'kanban' | 'table'>('kanban')
  const [search, setSearch] = useState('')
  const [owner, setOwner] = useState('All')
  const [stage, setStage] = useState<'' | Column>('')
  const [dragging, setDragging] = useState<string | null>(null)
  const [moving, setMoving] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await fetchAllQueries())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    if (!rows) return []
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (owner !== 'All' && r.ownerId !== owner) return false
      if (stage && columnOf(r) !== stage) return false
      if (q) {
        const haystack = `${r.debtorName} ${r.accountNumber ?? ''} ${r.description} ${r.category ?? ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [rows, owner, stage, search])

  /*
   * Three numbers, and none of them is money.
   *
   * A dispute has no value to total — what a manager needs at a glance is how much is open, how
   * much has gone quiet, and how old the oldest one is, because the oldest open dispute is the
   * one about to become a complaint.
   */
  const totals = useMemo(() => {
    const all = rows ?? []
    const open = all.filter((r) => r.status !== 'closed')
    return {
      count: all.length,
      open: open.length,
      stale: open.filter((r) => isStale(r, TODAY)).length,
      oldest: open.reduce((m, r) => Math.max(m, ageInDays(r)), 0),
    }
  }, [rows])

  async function moveTo(id: string, to: Column) {
    const row = rows?.find((r) => r.id === id)
    if (!row || to === 'resolved' || row.status === 'closed' || columnOf(row) === to) return
    if (to === 'client' && !canSendToClient(currentUser?.role)) return
    setMoving(id)
    try {
      await updateQuery(id, { stage: to }, {
        accountId: row.accountId,
        actorId: currentUser?.id ?? null,
        actorName: currentUser?.name ?? null,
        note: `Dispute moved to ${COLUMN_LABEL[to].toLowerCase()}.`,
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setMoving(null)
    }
  }

  if (error) return <Card><p className="text-sm text-negative-700">{error}</p></Card>
  if (!rows) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400 py-10 justify-center">
        <Loader2 size={15} className="animate-spin" /> Loading disputes…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
          <Total label="Total Disputes" value={totals.count} />
          <Total label="Open" value={totals.open} />
          <Total label="Chase overdue" value={totals.stale} tone={totals.stale > 0 ? 'warn' : undefined} />
          <Total label="Oldest open" value={totals.open ? `${totals.oldest}d` : '—'} />
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 w-64">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search disputes..." className="text-sm outline-none flex-1 min-w-0" />
        </div>
        <select value={stage} onChange={(e) => setStage(e.target.value as '' | Column)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-600 outline-none">
          <option value="">All Stages</option>
          {COLUMNS.map((c) => <option key={c} value={c}>{COLUMN_LABEL[c]}</option>)}
        </select>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-600 outline-none">
          <option value="All">All Owners</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <div className="flex items-center bg-slate-100 rounded-lg p-1">
          <button onClick={() => setView('kanban')} title="Board" className={`p-1.5 rounded-md ${view === 'kanban' ? 'bg-white shadow-sm text-slate-700' : 'text-slate-400'}`}>
            <LayoutGrid size={15} />
          </button>
          <button onClick={() => setView('table')} title="List" className={`p-1.5 rounded-md ${view === 'table' ? 'bg-white shadow-sm text-slate-700' : 'text-slate-400'}`}>
            <List size={15} />
          </button>
        </div>
        {/* No "Add" button on purpose: a dispute starts on the account it is about, where the
            debtor's details and the ledger are. There is nothing to raise one against from here. */}
      </div>

      {view === 'kanban' ? (
        <div className="flex gap-4 overflow-x-auto pb-3">
          {COLUMNS.map((col) => {
            const cards = filtered.filter((r) => columnOf(r) === col)
            const canDrop = col !== 'resolved' && (col !== 'client' || canSendToClient(currentUser?.role))
            return (
              <div
                key={col}
                onDragOver={(e) => { if (canDrop) e.preventDefault() }}
                onDrop={() => { if (canDrop && dragging) void moveTo(dragging, col); setDragging(null) }}
                className="w-72 shrink-0 bg-slate-50 rounded-xl flex flex-col max-h-[calc(100vh-320px)]"
              >
                <div className="px-3.5 py-3 flex items-center gap-2 sticky top-0">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLUMN_DOT[col] }} />
                  <span className="text-sm font-semibold text-slate-700">{COLUMN_LABEL[col]}</span>
                  <span className="text-xs text-slate-400">({cards.length})</span>
                </div>
                <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2.5">
                  {cards.map((q) => (
                    <DisputeCard
                      key={q.id}
                      dispute={q}
                      ownerName={q.ownerId ? userById(q.ownerId)?.name ?? null : null}
                      busy={moving === q.id}
                      onDragStart={() => setDragging(q.id)}
                      onOpen={() => navigate(`/accounts/${q.accountId}`)}
                    />
                  ))}
                  {cards.length === 0 && (
                    <div className="text-xs text-slate-300 text-center py-6 border border-dashed border-slate-200 rounded-lg">
                      {col === 'resolved' ? 'Nothing resolved yet' : 'Drop disputes here'}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="font-medium px-5 py-2.5">Debtor</th>
                  <th className="font-medium px-3 py-2.5">Dispute</th>
                  <th className="font-medium px-3 py-2.5">Owner</th>
                  <th className="font-medium px-3 py-2.5">Sitting with</th>
                  <th className="font-medium px-3 py-2.5">Chase</th>
                  <th className="font-medium px-3 py-2.5 text-right">Age</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((q) => (
                  <tr key={q.id} onClick={() => navigate(`/accounts/${q.accountId}`)} className="border-t border-slate-50 hover:bg-slate-50/60 cursor-pointer">
                    <td className="px-5 py-2">
                      <Link to={`/accounts/${q.accountId}`} onClick={(e) => e.stopPropagation()} className="font-medium text-slate-700 hover:text-brand-600">
                        {q.debtorName}
                      </Link>
                      <span className="block text-xs text-slate-400">{q.accountNumber}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600 max-w-[26rem]">
                      <span className="line-clamp-2 wrap-anywhere">{q.description}</span>
                      {q.category && <span className="block text-xs text-slate-400">{q.category}</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{q.ownerId ? userById(q.ownerId)?.name ?? '—' : '—'}</td>
                    <td className="px-3 py-2"><StageChip column={columnOf(q)} /></td>
                    <td className={`px-3 py-2 ${isStale(q, TODAY) ? 'text-negative-700 font-medium' : 'text-slate-500'}`}>
                      {q.chaseOn ? formatDate(q.chaseOn) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500 tabular-nums">{ageInDays(q)}d</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">No disputes match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

function Total({ label, value, tone }: { label: string; value: number | string; tone?: 'warn' }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-xs text-slate-400">{label}</span>
      <span className={`text-lg font-bold tabular-nums ${tone === 'warn' ? 'text-negative-700' : 'text-slate-800'}`}>{value}</span>
    </span>
  )
}

function StageChip({ column }: { column: Column }) {
  const chip: Record<Column, string> = {
    agent: 'bg-slate-100 text-slate-600',
    liaison: 'bg-navy-700/10 text-navy-700',
    client: 'bg-gold-100 text-[var(--c-gold-deep)]',
    resolved: 'bg-positive-100 text-positive-700',
  }
  return <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${chip[column]}`}>{COLUMN_LABEL[column]}</span>
}

function DisputeCard({ dispute: q, ownerName, busy, onDragStart, onOpen }: {
  dispute: QueueRow
  ownerName: string | null
  busy: boolean
  onDragStart: () => void
  onOpen: () => void
}) {
  const closed = q.status === 'closed'
  return (
    <div
      draggable={!closed && !busy}
      onDragStart={onDragStart}
      onClick={onOpen}
      className={`bg-white rounded-lg border border-slate-200 p-3 cursor-pointer hover:border-slate-300 hover:shadow-sm transition ${busy ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] text-slate-500 truncate">{q.debtorName}</span>
        <span className="text-xs text-slate-400 shrink-0 tabular-nums">{ageInDays(q)}d</span>
      </div>
      <p className="text-[11px] text-slate-300">{q.accountNumber}</p>
      <p className="text-[13px] font-semibold leading-snug text-navy-950 mt-1.5 line-clamp-2 wrap-anywhere">{q.description}</p>
      {q.category && <p className="text-xs text-slate-400 mt-1">{q.category}</p>}
      <div className="flex items-center justify-between gap-2 mt-2.5 text-xs">
        <span className="text-slate-500 truncate">{ownerName ?? 'Unassigned'}</span>
        {closed
          ? <span className="text-[var(--c-green)] shrink-0">{q.outcome ? QUERY_OUTCOME_LABEL[q.outcome] : 'Closed'}</span>
          : q.chaseOn
            ? <span className={`shrink-0 ${isStale(q, TODAY) ? 'text-negative-700 font-medium' : 'text-slate-400'}`}>Chase {formatDate(q.chaseOn)}</span>
            : <span className="text-slate-300 shrink-0">No chase date</span>}
      </div>
    </div>
  )
}
