import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { formatDate } from '../../data/mockData'
import {
  ageInDays, fetchOpenQueries, isStale, QUERY_STAGE_LABEL, type QueueRow, type QueryStage,
} from '../../lib/accountQueries'

const TODAY = new Date().toISOString().slice(0, 10)

const STAGE_CHIP: Record<QueryStage, string> = {
  agent: 'bg-slate-100 text-slate-600',
  liaison: 'bg-brand-100 text-brand-600',
  client: 'bg-gold-100 text-gold-600',
}

type Scope = 'Mine' | 'Everyone' | 'Nobody'

/**
 * Every open query, across the book.
 *
 * The queue is the point of the whole feature. A dispute that nobody is looking at is
 * indistinguishable from one that has been dealt with, and the only way to tell them apart is a
 * list somebody opens every morning — sorted oldest first, because the oldest is the one about to
 * become a complaint.
 *
 * "Everyone" is the default rather than "Mine". Communications cover for each other: a query sits
 * with one person but is answered by whoever is at their desk, so a page that opened on one
 * person's own work would hide exactly the queries that need picking up.
 */
export function QueriesQueue() {
  const { users } = useAppStore()
  const { currentUser } = useAuth()
  const [rows, setRows] = useState<QueueRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>('Everyone')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetchOpenQueries()
        if (!cancelled) setRows(r)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { cancelled = true }
  }, [])

  const shown = useMemo(() => {
    if (!rows) return []
    if (scope === 'Mine') return rows.filter((r) => r.ownerId && r.ownerId === currentUser?.id)
    if (scope === 'Nobody') return rows.filter((r) => !r.ownerId)
    return rows
  }, [rows, scope, currentUser?.id])

  const counts = useMemo(() => ({
    Everyone: rows?.length ?? 0,
    Mine: rows?.filter((r) => r.ownerId && r.ownerId === currentUser?.id).length ?? 0,
    Nobody: rows?.filter((r) => !r.ownerId).length ?? 0,
  }), [rows, currentUser?.id])

  const overdue = shown.filter((r) => isStale(r, TODAY)).length

  if (error) return <Card className="border-negative-100 bg-negative-50"><p className="text-sm text-negative-700">{error}</p></Card>
  if (!rows) return <div className="p-10 grid place-items-center text-slate-400"><Loader2 size={20} className="animate-spin" /></div>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {(['Everyone', 'Mine', 'Nobody'] as Scope[]).map((s) => (
            <button key={s} onClick={() => setScope(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                scope === s ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100'}`}>
              {s === 'Nobody' ? 'Unassigned' : s}
              <span className="ml-1.5 text-[11px] text-slate-400 tabular-nums">{counts[s]}</span>
            </button>
          ))}
        </div>
        {overdue > 0 && (
          <span className="text-sm text-negative-700 ml-auto">
            {overdue} past its chase date
          </span>
        )}
      </div>

      <Card padded={false}>
        {shown.length === 0 ? (
          <p className="text-sm text-slate-400 py-12 text-center">
            {scope === 'Mine' ? 'Nothing is with you.' : 'No open queries.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-200">
                  <th className="text-left px-4 py-2.5 font-medium">Debtor</th>
                  <th className="text-left px-4 py-2.5 font-medium">Query</th>
                  <th className="text-left px-4 py-2.5 font-medium">Owner</th>
                  <th className="text-left px-4 py-2.5 font-medium">Sitting with</th>
                  <th className="text-right px-4 py-2.5 font-medium">Chase</th>
                  <th className="text-right px-4 py-2.5 font-medium">Age</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((q) => {
                  const stale = isStale(q, TODAY)
                  const owner = users.find((u) => u.id === q.ownerId)
                  return (
                    <tr key={q.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 align-top">
                        <Link to={`/accounts/${q.accountId}`} className="text-brand-700 hover:underline font-medium">
                          {q.debtorName}
                        </Link>
                        <span className="block text-[11px] text-slate-400 tabular-nums">{q.accountNumber}</span>
                        {q.companyId && (
                          <Link to={`/companies/${q.companyId}`} className="block text-[11px] text-brand-600 hover:underline">
                            Open the client
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-2.5 align-top max-w-md">
                        <span className="text-slate-700 line-clamp-2">{q.description}</span>
                        {q.category && <span className="block text-[11px] text-slate-400">{q.category}</span>}
                      </td>
                      <td className="px-4 py-2.5 align-top text-slate-600">
                        {owner?.name ?? <span className="text-gold-600">Unassigned</span>}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${STAGE_CHIP[q.stage]}`}>
                          {QUERY_STAGE_LABEL[q.stage]}
                        </span>
                      </td>
                      <td className={`px-4 py-2.5 align-top text-right whitespace-nowrap ${stale ? 'text-negative font-medium' : 'text-slate-500'}`}>
                        {q.chaseOn ? formatDate(q.chaseOn) : '—'}
                      </td>
                      <td className="px-4 py-2.5 align-top text-right tabular-nums text-slate-500">
                        {ageInDays(q)}d
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
