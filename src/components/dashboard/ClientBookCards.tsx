import { useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Card, CardHeader } from '../ui/Card'
import { goneQuiet, recoveryRate, topClients, type ClientBook, type ClientSort } from '../../lib/clientBook'

const rand0 = (v: number): string => `R ${Math.round(v).toLocaleString('en-ZA')}`

/**
 * A CLIENT'S VALUE, AS A WORD (the firm, 18 Oct: "I like the high, medium, or low for the
 * profitability"). Decided in client_book_summary on commission per month while active, so a client
 * of ten years and one of a month are compared fairly; the rand never reaches this screen.
 */
export function ValueBand({ band }: { band: ClientBook['valueBand'] }) {
  if (!band) return <span className="text-[11px] text-slate-300" title="Nothing collected in the last twelve months">—</span>
  return (
    <span title="Commission per month while active, over the last twelve months, against every other client"
      className={clsx('rounded-full px-2 py-0.5 text-[11px] font-semibold',
        band === 'High' ? 'bg-emerald-50 text-emerald-700' : band === 'Medium' ? 'bg-gold-100 text-gold-800' : 'bg-slate-100 text-slate-500')}>
      {band}
    </span>
  )
}

/** The top clients, ranked three ways. */
export function TopClientsCard({ books, periodLabel, testId = 'top-clients' }: { books: ClientBook[]; periodLabel: string; testId?: string }) {
  const [by, setBy] = useState<ClientSort>('period')
  const rows = topClients(books, by, 10)
  return (
    <Card padded={false}>
      <div data-testid={testId}>
        <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
          <CardHeader title="Top clients" subtitle={by === 'period' ? `By capital handed over in ${periodLabel}` : by === 'capital' ? 'By capital handed over, all time' : 'By recovery rate, books of five accounts or more'} />
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-[11px]" role="radiogroup" aria-label="Rank by">
            {([['period', 'This month'], ['capital', 'Book size'], ['recovery', 'Recovery']] as const).map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={by === v} data-testid={`${testId}-${v}`} onClick={() => setBy(v)}
                className={clsx('rounded-md px-2 py-0.5', by === v ? 'bg-navy-900 text-white' : 'text-slate-500 hover:text-slate-700')}>{label}</button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-slate-400">{by === 'period' ? 'No client has handed over this month yet.' : 'Nothing to rank yet.'}</p>
        ) : (
          <div className="overflow-x-auto px-5 pb-4">
            <table className="list-table w-full">
              <thead>
                <tr className="text-left text-[11px] text-slate-400">
                  <th className="py-1.5 pr-2 font-medium">#</th>
                  <th className="py-1.5 pr-2 font-medium">Client</th>
                  <th className="py-1.5 px-2 font-medium">Value</th>
                  <th className="py-1.5 px-2 text-right font-medium">This month</th>
                  <th className="py-1.5 px-2 text-right font-medium">Book</th>
                  <th className="py-1.5 pl-2 text-right font-medium">Recovered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((c, i) => (
                  <tr key={c.companyId} className="whitespace-nowrap">
                    <td className="py-1.5 pr-2 tabular-nums text-slate-400">{i + 1}</td>
                    <td className="max-w-[16rem] truncate py-1.5 pr-2"><Link to={`/companies/${c.companyId}`} className="font-medium text-slate-800 hover:underline">{c.name}</Link></td>
                    <td className="py-1.5 px-2"><ValueBand band={c.valueBand} /></td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">{c.periodAccounts ? `${c.periodAccounts} · ${rand0(c.periodCapital)}` : '—'}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">{c.accounts} · {rand0(c.capital)}</td>
                    <td className="py-1.5 pl-2 text-right tabular-nums font-semibold text-slate-800">{recoveryRate(c) === null ? '—' : `${recoveryRate(c)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}

/**
 * GONE QUIET (the firm: "who hasn't handed over in 60 or 90 days"): the early warning that a client is
 * drifting. Longest silent first; the value band beside it says which ones to ring first.
 */
export function GoneQuietCard({ books, todayIso, testId = 'gone-quiet' }: { books: ClientBook[]; todayIso: string; testId?: string }) {
  const [days, setDays] = useState<60 | 90>(60)
  const rows = goneQuiet(books, todayIso, days)
  return (
    <Card padded={false} className={rows.length ? 'border-rose-200' : undefined}>
      <div data-testid={testId}>
        <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
          <CardHeader title={`Gone quiet · ${rows.length}`} subtitle={`Clients who have handed over before, and nothing in the last ${days} days`} />
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-[11px]" role="radiogroup" aria-label="Silent for">
            {([60, 90] as const).map((d) => (
              <button key={d} type="button" role="radio" aria-checked={days === d} data-testid={`${testId}-${d}`} onClick={() => setDays(d)}
                className={clsx('rounded-md px-2 py-0.5', days === d ? 'bg-navy-900 text-white' : 'text-slate-500 hover:text-slate-700')}>{d} days</button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? <p className="px-5 pb-5 text-sm text-slate-400">Every client has handed over in the last {days} days.</p> : (
          <ul className="divide-y divide-slate-50 px-5 pb-4">
            {rows.slice(0, 12).map((c) => (
              <li key={c.companyId} className="flex items-center gap-3 py-1.5 text-[12.5px]">
                <Link to={`/companies/${c.companyId}`} className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline">{c.name}</Link>
                <ValueBand band={c.valueBand} />
                <span className="shrink-0 text-slate-400">last {c.lastHandover?.split('-').reverse().join('/')}</span>
                <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 font-semibold tabular-nums text-rose-700">{c.silentDays} days</span>
              </li>
            ))}
            {rows.length > 12 && <li className="pt-2 text-xs text-slate-400">and {rows.length - 12} more</li>}
          </ul>
        )}
      </div>
    </Card>
  )
}
