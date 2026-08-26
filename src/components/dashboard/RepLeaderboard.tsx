import { useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Card, CardHeader } from '../ui/Card'
import { UserAvatar } from '../ui/Avatar'
import { formatCurrency } from '../../data/mockData'
import type { ID } from '../../types'

export interface LeaderboardRow {
  repId: ID
  name: string
  leadsAssigned: number
  leadsTouched: number
  totalActivities: number
  dealsWon: number
  revenueWon: number
  winRate: number
  overallScore: number
}

type SortableKey = Exclude<keyof LeaderboardRow, 'repId' | 'name'>

const COLUMNS: { key: SortableKey; label: string; format?: (v: number) => string }[] = [
  { key: 'leadsAssigned', label: 'Leads' },
  { key: 'leadsTouched', label: 'Touched' },
  { key: 'totalActivities', label: 'Activities' },
  { key: 'dealsWon', label: 'Won' },
  { key: 'revenueWon', label: 'Revenue', format: formatCurrency },
  { key: 'winRate', label: 'Win Rate', format: (v) => `${v}%` },
  { key: 'overallScore', label: 'Score' },
]

export function RepLeaderboard({ rows }: { rows: LeaderboardRow[] }) {
  const [sortKey, setSortKey] = useState<SortableKey>('overallScore')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sorted = [...rows].sort((a, b) => {
    const cmp = a[sortKey] - b[sortKey]
    return sortDir === 'asc' ? cmp : -cmp
  })

  function toggleSort(key: SortableKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  return (
    <Card padded={false}>
      <div className="p-5 pb-0">
        <CardHeader title="Top Performing Reps" subtitle="Click a column to sort · click a rep for their full performance report" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-t border-slate-100">
              <th className="font-medium px-5 py-2.5">Rep</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className="font-medium px-3 py-2.5 text-right cursor-pointer select-none hover:text-slate-600 whitespace-nowrap"
                >
                  {c.label}
                  {sortKey === c.key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.repId} className={i === 0 ? 'border-t border-slate-50 bg-gold-300/25 hover:bg-gold-300/35' : 'border-t border-slate-50 hover:bg-slate-50/60'}>
                <td className="px-5 py-2.5">
                  <Link to={`/reps/${r.repId}`} className="flex items-center gap-2 font-medium text-slate-700 hover:text-brand-600">
                    <span
                      className={clsx(
                        'inline-flex items-center justify-center w-5 h-5 rounded-md text-[10.5px] font-extrabold shrink-0',
                        i === 0 ? 'text-white' : 'bg-slate-100 text-slate-400',
                      )}
                      style={i === 0 ? { background: 'linear-gradient(135deg, #c69f54, #a9822f)' } : undefined}
                    >
                      {i + 1}
                    </span>
                    <UserAvatar userId={r.repId} size={24} />
                    {r.name}
                  </Link>
                </td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className="px-3 py-2.5 text-right text-slate-600 whitespace-nowrap">
                    {c.format ? c.format(r[c.key]) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
