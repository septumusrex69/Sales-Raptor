import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Bar, CartesianGrid, ComposedChart, LabelList, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardHeader } from '../ui/Card'
import { fetchClientIntakeByDay, isoDay } from '../../lib/companySnapshotData'
import { intakeMonthBars, type IntakeBar } from '../../lib/companySnapshot'
import { getCurrentSalesMonth, getPreviousSalesMonth, getSalesMonthForDate } from '../../lib/salesMonth'
import { clockNow } from '../../lib/clock'

const rand0 = (v: number): string => `R ${Math.round(v).toLocaleString('en-ZA')}`
const shortRand = (v: number): string => v >= 1_000_000 ? `R${(v / 1_000_000).toFixed(1)}m` : v >= 1000 ? `R${Math.round(v / 1000)}k` : `R${Math.round(v)}`

/**
 * THIS CLIENT'S HANDOVERS, MONTH BY MONTH (the firm, 18 Oct, on the client page: "graphs showing their
 * handovers ... every month ... what is the amount ... the number ... the line graph and the stack
 * graph"). One bar a sales month over the last 6 or 12, accounts or rand, bars, a line, or both --
 * the same switches as the dashboards, so a liaison reads a client's rhythm the way the firm's is read.
 * A month with nothing is drawn as nought on purpose: a gap in a client's handovers is the thing to see.
 */
export function ClientHandoverChart({ clientId }: { clientId: string }) {
  const [months, setMonths] = useState<6 | 12 | 'all'>(12)
  const [measure, setMeasure] = useState<'accounts' | 'capital'>('accounts')
  const [show, setShow] = useState<'bars' | 'both' | 'line'>('bars')
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchClientIntakeByDay>> | null>(null)
  const [error, setError] = useState<string | null>(null)

  /* ALL TIME (the firm, 18 Oct: "an option to view the accounts for all time"): asked from far back,
     drawn from the client's first handover. */
  const span = useMemo(() => {
    const now = getCurrentSalesMonth(clockNow())
    if (months === 'all') return { start: new Date('2000-01-11T00:00:00'), end: now.end }
    let first = now
    for (let i = 1; i < months; i++) first = getPreviousSalesMonth(first)
    return { start: first.start, end: now.end }
  }, [months])

  useEffect(() => {
    let live = true
    setRows(null); setError(null)
    fetchClientIntakeByDay(clientId, span).then((r) => { if (live) setRows(r) }).catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [clientId, span])

  const bars: IntakeBar[] = useMemo(() => {
    if (!rows) return []
    const from = months === 'all' && rows.length ? getSalesMonthForDate(new Date(`${rows[0].day}T12:00:00`)).start : span.start
    return intakeMonthBars(isoDay(from), isoDay(span.end), rows, isoDay(clockNow()))
  }, [rows, span, months])
  /* SLIDE, DON'T CRAM (the firm, 18 Oct: "make the graph ... slide from left to right. Don't try to
     cram shit in"). Every month gets the same room; past what the card can hold the chart scrolls
     sideways, opened on the most recent months. */
  const PER_MONTH = 64
  const scroller = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { const el = scroller.current; if (el) el.scrollLeft = el.scrollWidth }, [bars.length, show, measure])
  const key = measure === 'accounts' ? 'accounts' : 'capital'
  const data = bars.map((b) => ({ ...b, value: b.future ? null : b[key], label: b.label }))
  const total = bars.reduce((t, b) => t + b[key], 0)
  const past = bars.filter((b) => !b.future)
  const average = past.length ? total / past.length : 0
  const fmt = (v: number) => measure === 'accounts' ? v.toLocaleString('en-ZA') : shortRand(v)
  /* ONE SCALE FOR BOTH HALVES: the axis is drawn in its own narrow chart that does not scroll, so it
     has to be told the same top as the bars beside it. A round number a little above the tallest. */
  const top = (() => {
    const max = Math.max(0, ...data.map((d) => d.value ?? 0))
    if (max <= 0) return 4
    const step = 10 ** Math.floor(Math.log10(max))
    return Math.ceil((max * 1.15) / step) * step
  })()
  const axisWidth = measure === 'accounts' ? 36 : 52

  const Switch = <T extends string>({ value, set, options, label, testId }: { value: T; set: (v: T) => void; options: readonly (readonly [T, string])[]; label: string; testId: string }) => (
    <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-[11px]" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} data-testid={`${testId}-${v}`} onClick={() => set(v)}
          className={clsx('rounded-md px-2 py-0.5', value === v ? 'bg-navy-900 text-white' : 'text-slate-500 hover:text-slate-700')}>{l}</button>
      ))}
    </div>
  )

  return (
    <Card>
      <div data-testid="client-handovers">
        <CardHeader title="Handovers, month by month"
          subtitle={rows === null ? (error ? 'Could not be read just now.' : 'Reading…')
            : total === 0 ? (months === 'all' ? 'Nothing handed over yet.' : `Nothing handed over in the last ${months} months.`)
              : `${measure === 'accounts' ? `${total.toLocaleString('en-ZA')} accounts` : rand0(total)} over ${months === 'all' ? `${bars.length} months, all time` : `${months} months`} · about ${measure === 'accounts' ? Math.round(average).toLocaleString('en-ZA') : rand0(average)} a month`} />
        <div className="mb-2 flex flex-wrap justify-end gap-2">
          <Switch value={show} set={setShow} options={[['bars', 'Bars'], ['both', 'Both'], ['line', 'Line']] as const} label="Draw as" testId="client-handovers-show" />
          <Switch value={String(months) as '6' | '12' | 'all'} set={(v) => setMonths(v === 'all' ? 'all' : (Number(v) as 6 | 12))}
            options={[['6', '6 months'], ['12', '12 months'], ['all', 'All time']] as const} label="Months" testId="client-handovers-months" />
          <Switch value={measure} set={setMeasure} options={[['accounts', 'Accounts'], ['capital', 'Rand']] as const} label="Measure" testId="client-handovers-measure" />
        </div>
        <div className="flex">
        {/* The axis, pinned: it stays while the months slide under the fingers. */}
        <div className="h-44 shrink-0" style={{ width: axisWidth }} aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 16, right: 0, bottom: 0, left: 0 }}>
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={axisWidth} domain={[0, top]} tickFormatter={fmt}
                tick={{ fontSize: 10, fill: 'var(--color-slate-400)' }} />
              <XAxis dataKey="label" tick={false} tickLine={false} axisLine={false} height={30} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain" data-testid="client-handovers-scroll">
        <div className="h-44 [&_*:focus]:outline-none" style={{ minWidth: `${bars.length * PER_MONTH + 60}px` }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} accessibilityLayer={false} margin={{ top: 16, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke="var(--color-slate-100)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} height={30} tick={{ fontSize: 10, fill: 'var(--color-slate-400)' }} />
              <YAxis hide domain={[0, top]} />
              <Tooltip cursor={{ fill: 'var(--color-slate-50)' }}
                content={({ active, payload }) => {
                  const b = payload?.[0]?.payload as IntakeBar | undefined
                  if (!active || !b) return null
                  return (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                      <div className="font-semibold text-slate-800">{b.day.split('-').reverse().join('/')} to {b.toDay.split('-').reverse().join('/')}</div>
                      <div className="text-slate-600">{b.future ? 'Still to come' : `${b.accounts.toLocaleString('en-ZA')} ${b.accounts === 1 ? 'account' : 'accounts'} · ${rand0(b.capital)}`}</div>
                    </div>
                  )
                }} />
              {show !== 'line' && (
                <Bar dataKey="value" fill="var(--color-gold-400)" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {show === 'bars' && <LabelList dataKey="value" position="top" offset={4} formatter={(v: unknown) => (typeof v === 'number' && v > 0 ? fmt(v) : '')} style={{ fontSize: 10, fill: 'var(--color-slate-500)' }} />}
                </Bar>
              )}
              {show !== 'bars' && (
                <Line dataKey="value" stroke="var(--color-navy-900)" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        </div>
        </div>
      </div>
    </Card>
  )
}
