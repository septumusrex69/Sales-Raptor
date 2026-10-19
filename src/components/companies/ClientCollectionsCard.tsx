import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarChart3 } from 'lucide-react'
import { Card } from '../ui/Card'
import { supabase } from '../../lib/supabase'
import { clockToday } from '../../lib/clock'
import { collectionMonths, type MoneyDay } from '../../lib/clientCollections'
import { outcomeRing, type OutcomeRow } from '../../lib/clientOutcomes'

const rand0 = (v: number): string => `R ${Math.round(v).toLocaleString('en-ZA')}`
const shortRand = (v: number): string => v >= 1_000_000 ? `R${(v / 1_000_000).toFixed(1)}m` : v >= 1000 ? `R${Math.round(v / 1000)}k` : `R${Math.round(v)}`
const OUTCOME_COLOUR = { recovered: '#047857', active: '#c9a24a', closed: '#94a3b8' } as const

/**
 * COLLECTIONS PERFORMANCE, the first card on a client's overview (S9, 19 Oct, after the firm's mock:
 * "take from it what you think could be helpful").
 *
 * The question a liaison opens a client for, answered first: how much of their book have we brought
 * in, and is it moving. Four figures -- handed over, collected, the rate, and what became of the
 * accounts -- over a chart of what was collected each month with the recovery rate as a line.
 *
 * ONE ARITHMETIC WITH THE RING. The figures come from client_money_by_day and the outcomes from
 * client_account_outcomes, both leaving withdrawn accounts out; the rate here is collected over
 * handed over across the same accounts, so it is the ring's figure and the tile's, not a fourth.
 *
 * No commission, no Annexure B income: those are the firm's, and this card is about the client's
 * money (the condition the firm attached to the company dashboard, held here too).
 */
export function ClientCollectionsCard({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<MoneyDay[] | null>(null)
  const [outcomes, setOutcomes] = useState<OutcomeRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [months, setMonths] = useState<6 | 12 | 'all'>(6)

  useEffect(() => {
    let live = true
    setRows(null); setError(null)
    supabase.rpc('client_money_by_day', { p_client: clientId }).then(({ data, error: e }) => {
      if (!live) return
      if (e) { setError(e.message); return }
      setRows(((data ?? []) as { day: string; capital: number | string; collected: number | string }[])
        .map((r) => ({ day: String(r.day).slice(0, 10), capital: Number(r.capital ?? 0), collected: Number(r.collected ?? 0) })))
    })
    supabase.rpc('client_account_outcomes', { p_client: clientId }).then(({ data }) => {
      if (live) setOutcomes(((data ?? []) as Record<string, unknown>[]).map((r) => ({ outcome: String(r.outcome), accounts: Number(r.accounts), capital: Number(r.capital), collected: Number(r.collected) })))
    })
    return () => { live = false }
  }, [clientId])

  const today = clockToday()
  const data = useMemo(() => (rows ? collectionMonths(rows, today, months) : []), [rows, today, months])
  const ring = outcomes ? outcomeRing(outcomes) : null
  const totals = useMemo(() => {
    const past = (rows ?? []).filter((r) => r.day <= today)
    const capital = past.reduce((t, r) => t + r.capital, 0)
    const collected = past.reduce((t, r) => t + r.collected, 0)
    return { capital, collected, rate: capital > 0 ? Math.round((collected / capital) * 100) : null }
  }, [rows, today])

  /* FOUR EQUAL STEPS TO A ROUND TOP, as on the handover chart: a scale that climbs evenly. */
  const { top, ticks } = useMemo(() => {
    const max = Math.max(0, ...data.map((d) => d.collected))
    const raw = max <= 0 ? 1000 : (max * 1.1) / 4
    const pow = 10 ** Math.floor(Math.log10(raw))
    const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow
    return { top: step * 4, ticks: [0, step, step * 2, step * 3, step * 4] }
  }, [data])
  /* Six and twelve months fit the card; All time slides, opened on the newest (the handover chart's rule). */
  const slides = months === 'all' && data.length > 12
  const scroller = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { const el = scroller.current; if (el) el.scrollLeft = el.scrollWidth }, [data.length])

  if (rows && rows.length === 0) return null

  return (
    <Card>
      <div data-testid="client-collections">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-2 font-semibold text-[15px] text-slate-800">
            <BarChart3 size={16} className="text-slate-400" /> Collections performance
          </h3>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-[11px]" role="radiogroup" aria-label="Months">
            {([[6, '6 months'], [12, '12 months'], ['all', 'All time']] as const).map(([v, l]) => (
              <button key={String(v)} type="button" role="radio" aria-checked={months === v} data-testid={`client-collections-months-${v}`}
                onClick={() => setMonths(v)}
                className={clsx('rounded-md px-2 py-0.5', months === v ? 'bg-navy-900 text-white' : 'text-slate-500 hover:text-slate-700')}>{l}</button>
            ))}
          </div>
        </div>

        {/* THE FIGURES, then the chart they are the sum of. */}
        <div className="grid grid-cols-3 gap-2" data-testid="client-collections-figures">
          {[
            ['Capital handed over', rows ? rand0(totals.capital) : '…'],
            ['Collected', rows ? rand0(totals.collected) : '…'],
            ['Recovery rate', rows ? (totals.rate === null ? '—' : `${totals.rate}%`) : '…'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-slate-50 px-3 py-2 text-center">
              <p className="text-lg font-bold tabular-nums text-navy-950">{value}</p>
              <p className="text-[11px] text-slate-500">{label}</p>
            </div>
          ))}
        </div>
        {error && <p className="mt-3 text-sm text-negative-700">Could not be read just now: {error}</p>}

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_230px]">
          <div ref={scroller} className="min-w-0 overflow-x-auto overscroll-x-contain" data-testid="client-collections-scroll">
            <div className="h-52 [&_*:focus]:outline-none" style={slides ? { minWidth: `${data.length * 64 + 100}px` } : undefined}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} accessibilityLayer={false} margin={{ top: 12, right: 4, bottom: 0, left: 0 }} barCategoryGap="30%">
                  <CartesianGrid vertical={false} stroke="var(--color-slate-100)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 10, fill: 'var(--color-slate-400)' }} />
                  <YAxis yAxisId="r" domain={[0, top]} ticks={ticks} interval={0} tickLine={false} axisLine={false} width={48}
                    tickFormatter={shortRand} tick={{ fontSize: 10, fill: 'var(--color-slate-400)' }} />
                  <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} interval={0} tickLine={false} axisLine={false} width={34}
                    tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 10, fill: 'var(--color-slate-400)' }} />
                  <Tooltip cursor={{ fill: 'var(--color-slate-50)' }}
                    content={({ active, payload }) => {
                      const m = payload?.[0]?.payload as (typeof data)[number] | undefined
                      if (!active || !m) return null
                      return (
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                          <div className="font-semibold text-slate-800">{m.label}{m.current ? ' (so far)' : ''}</div>
                          <div className="text-slate-600">{rand0(m.collected)} collected</div>
                          {m.rate !== null && <div className="text-slate-600">{m.rate}% of the book recovered by then</div>}
                        </div>
                      )
                    }} />
                  <Bar yAxisId="r" dataKey="collected" fill="var(--color-navy-900)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  <Line yAxisId="pct" dataKey="rate" stroke="var(--color-gold-500)" strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 flex items-center gap-4 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-navy-900" /> Collected (R)</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 bg-gold-500" /> Recovery rate, the whole book to that month</span>
            </p>
          </div>

          {/* WHAT BECAME OF THE ACCOUNTS, each a way into the book. Withdrawn left out, as in the rate. */}
          <ul className="space-y-2 self-start rounded-lg bg-slate-50 p-3 text-sm" data-testid="client-collections-outcomes">
            {(ring?.slices ?? []).map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: OUTCOME_COLOUR[s.key] }} />
                <Link to={`/accounts?client=${clientId}&book=${s.key === 'active' ? 'active' : s.key === 'closed' ? 'closed' : 'whole'}`}
                  className="flex-1 text-slate-700 hover:underline">{s.key === 'active' ? 'Active accounts' : s.label}</Link>
                <span className="tabular-nums font-semibold text-slate-800">{s.accounts}</span>
                <span className="w-11 text-right tabular-nums text-slate-500">({s.pct}%)</span>
              </li>
            ))}
            <li className="pt-1 text-[11px] leading-snug text-slate-400">Withdrawn accounts are left out of the counts and the rate.</li>
          </ul>
        </div>
      </div>
    </Card>
  )
}
