import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardHeader } from '../ui/Card'
import { supabase } from '../../lib/supabase'
import { rhythm, rhythmWords, typicalMonth, type HandoverDay } from '../../lib/clientRhythm'
import type { IntakeRow } from '../../lib/companySnapshot'

type DayRow = { company_id: string; name: string; account_owner_id: string | null; day: string; accounts: number }

const shortDay = (iso: string | null) => (iso ? iso.split('-').reverse().slice(0, 2).join('/') : '—')

/**
 * LATE AGAINST THEIR OWN PATTERN (S8, 18 Oct; the firm's first choice of the pattern views). Each
 * existing client's rhythm over the last year, and the ones now past it -- the early warning Gone
 * quiet gives sixty days too late. Latest first relative to their own rhythm. Scoped like the rest
 * of the page: a liaison sees her clients.
 */
export function LatePatternCard({ todayIso, owners, testId = 'late-pattern' }: { todayIso: string; owners: Set<string> | null; testId?: string }) {
  const [rows, setRows] = useState<DayRow[] | null>(null)
  useEffect(() => {
    let live = true
    const from = new Date(`${todayIso}T12:00:00Z`); from.setUTCFullYear(from.getUTCFullYear() - 1)
    supabase.rpc('client_handover_days', { p_from: from.toISOString().slice(0, 10) })
      .then(({ data }) => { if (live) setRows((data ?? []) as DayRow[]) })
    return () => { live = false }
  }, [todayIso])
  const clients = useMemo(() => {
    const by = new Map<string, { name: string; owner: string | null; days: HandoverDay[] }>()
    for (const r of rows ?? []) {
      if (owners && !(r.account_owner_id && owners.has(r.account_owner_id))) continue
      const c = by.get(r.company_id) ?? { name: r.name, owner: r.account_owner_id, days: [] }
      c.days.push({ day: String(r.day).slice(0, 10), accounts: Number(r.accounts) })
      by.set(r.company_id, c)
    }
    return [...by].map(([id, c]) => ({ id, name: c.name, r: rhythm(c.days, todayIso) }))
  }, [rows, owners, todayIso])
  const late = clients.filter((c) => c.r.state === 'late').sort((a, b) => b.r.daysLate / (b.r.everyDays ?? 1) - a.r.daysLate / (a.r.everyDays ?? 1))
  const keeping = clients.filter((c) => c.r.state === 'on_pattern').length
  return (
    <Card padded={false} className={late.length ? 'border-amber-200' : undefined}>
      <div data-testid={testId}>
        <div className="p-5 pb-3">
          <CardHeader title={`Late against their pattern · ${late.length}`}
            subtitle={rows === null ? 'Reading the last year of handovers…' : `Clients past their own usual rhythm. ${keeping} more are keeping to theirs.`} />
        </div>
        {rows !== null && late.length === 0 ? <p className="px-5 pb-5 text-sm text-slate-400">Nobody is late against their own pattern.</p> : (
          <ul className="divide-y divide-slate-50 px-5 pb-4">
            {late.slice(0, 12).map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-1.5 text-[12.5px]">
                <span className="min-w-0 flex-1">
                  <Link to={`/companies/${c.id}`} className="block truncate font-medium text-slate-800 hover:underline">{c.name}</Link>
                  <span className="block truncate text-[11px] text-slate-400">{rhythmWords(c.r)} · last {shortDay(c.r.lastDay)}</span>
                </span>
                <span className="shrink-0 text-slate-400">due {shortDay(c.r.expected)}</span>
                <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 font-semibold tabular-nums text-amber-700">{c.r.daysLate} days late</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

/**
 * A TYPICAL MONTH (the firm's second choice): on average, how many accounts existing clients hand
 * over on each day of the month, over the last twelve months -- so a month-end or payday peak shows,
 * and the floor knows which days to have hands free for loading.
 */
export function TypicalMonthCard({ intake, fromIso, toIso, testId = 'typical-month' }: { intake: IntakeRow[] | null; fromIso: string; toIso: string; testId?: string }) {
  const data = useMemo(() => (intake ? typicalMonth(intake, fromIso, toIso, 'existing') : []), [intake, fromIso, toIso])
  const peak = data.reduce((p, d) => (d.average > p.average ? d : p), { dom: 0, average: 0 })
  return (
    <Card>
      <div data-testid={testId}>
        <CardHeader title="A typical month"
          subtitle={peak.average > 0 ? `Accounts existing clients hand over on each day of the month, on average over twelve months. Busiest: the ${peak.dom}${peak.dom % 10 === 1 && peak.dom !== 11 ? 'st' : peak.dom % 10 === 2 && peak.dom !== 12 ? 'nd' : peak.dom % 10 === 3 && peak.dom !== 13 ? 'rd' : 'th'}.` : 'Accounts existing clients hand over on each day of the month, on average.'} />
        <div className="h-40 [&_*:focus]:outline-none">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} accessibilityLayer={false} margin={{ top: 4, right: 0, bottom: 0, left: -24 }} barCategoryGap="15%">
              <CartesianGrid vertical={false} stroke="var(--color-slate-100)" />
              <XAxis dataKey="dom" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 9, fill: 'var(--color-slate-400)' }} />
              <YAxis tickLine={false} axisLine={false} width={40} tick={{ fontSize: 10, fill: 'var(--color-slate-400)' }} />
              <Tooltip cursor={{ fill: 'var(--color-slate-50)' }} formatter={(v) => [`${v} accounts on average`, '']} labelFormatter={(l) => `Day ${l} of the month`} />
              <Bar dataKey="average" fill="var(--color-gold-400)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  )
}
