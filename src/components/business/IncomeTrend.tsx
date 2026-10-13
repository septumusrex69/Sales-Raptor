import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Loader2 } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardHeader } from '../ui/Card'
import { rand } from '../../lib/money'
import { fetchIncomeMonths } from '../../lib/businessApi'
import { trendSeries, trendTotals, type TrendPoint } from '../../lib/incomeTrend'
import { clockNow } from '../../lib/clock.ts'

/**
 * WHAT THE FIRM EARNED, MONTH BY MONTH, AND WHAT SHARE OF ITS COLLECTIONS THAT WAS (S7).
 *
 * The firm, 13 Oct: line graphs of "profit made from interest, profit made from fees, profit made
 * from commission, and then obviously total profit", and "the correlation between how much have we
 * collected and what is our profit". incomeTrend.ts says what each line is.
 *
 * SMALL MULTIPLES, ONE SCALE EACH, as SalesTrendCard argues: interest runs at a few thousand and the
 * total at five times that, and on one axis the parts flatten into the floor. The months line up
 * across every panel, so the shapes still compare. And the ratio is its own chart, never a second
 * axis on the money one -- where two scales cross is decided by their ranges, not by the business.
 *
 * ON THE INCOME PAGE, BEHIND business.income, because it is the firm's earnings by another name and
 * the company dashboard must never show them ("not even for an administrator").
 */

const INK = 'var(--c-navy)'
const DEEP = 'var(--c-navy-deep)'
const GOLD = 'var(--c-gold-deep)'
const STEEL = 'var(--c-steel-light)'
const AXIS_TICK = { fontSize: 10, fill: 'var(--c-grey-light)' }

type Range = '12' | '24' | 'all'
const RANGES: { key: Range; label: string }[] = [
  { key: '12', label: '12 months' },
  { key: '24', label: '24 months' },
  { key: 'all', label: 'Since the start' },
]

/** "Since the start" asks from here; trendSeries drops the empty months before the first real one. */
const EARLIEST = '2015-01-01'

function bounds(range: Range, today: Date): { from: string; to: string } {
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const to = iso(new Date(Date.UTC(y, m + 1, 0)))
  if (range === 'all') return { from: EARLIEST, to }
  return { from: iso(new Date(Date.UTC(y, m - (Number(range) - 1), 1))), to }
}

/* R1.5k, not R2k: rounded to whole thousands a 1 500-step axis labels two ticks alike. */
const kRand = (v: number) => {
  const a = Math.abs(v)
  if (a < 1000) return `R${Math.round(v)}`
  if (a < 100000 && Math.round(a) % 1000 !== 0) return `R${(v / 1000).toFixed(1)}k`
  return `R${Math.round(v / 1000)}k`
}
const pct = (v: number) => `${Math.round(v)}%`

function Tip({ active, payload, format, unit }: {
  active?: boolean; payload?: { payload: TrendPoint; value: number | null }[]; format: (v: number) => string; unit: string
}) {
  if (!active || !payload?.length) return null
  const { payload: p, value } = payload[0]
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-3 py-2 text-xs">
      <p className="font-semibold text-slate-700">{p.fullLabel}</p>
      <p className="text-slate-500">{unit}: <span className="font-medium text-slate-700">{value == null ? '—' : format(value)}</span></p>
    </div>
  )
}

function Panel({ title, caption, latest, data, dataKey, color, kind = 'line', format, tickFormat, testId, strong }: {
  title: string
  caption: string
  latest: string
  data: TrendPoint[]
  dataKey: keyof TrendPoint
  color: string
  kind?: 'line' | 'bar'
  format: (v: number) => string
  tickFormat: (v: number) => string
  testId: string
  strong?: boolean
}) {
  /* Labels thin themselves (preserveStartEnd + a gap) rather than overlap: a quarter-width panel at a
     laptop's width cannot fit five, let alone twenty-four. */
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        <p className={clsx('text-xs font-semibold', strong ? 'text-slate-800' : 'text-slate-600')}>{title}</p>
        {/* This month's figure, the panel's one direct label: labelling every point turns a trend into a table. */}
        <p className="text-sm font-bold text-slate-800 tabular-nums">{latest}</p>
      </div>
      <p className="text-[11px] text-slate-400 mb-1.5">{caption}</p>
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          {kind === 'bar' ? (
            <BarChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--tint-neutral)" />
              <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={46} tickFormatter={tickFormat} />
              <Tooltip cursor={{ fill: 'var(--tint-neutral)' }} content={<Tip format={format} unit={title} />} />
              <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 4, right: 22, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--tint-neutral)" />
              <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={46} tickFormatter={tickFormat} />
              <Tooltip cursor={{ stroke: 'var(--c-grey-pale)' }} content={<Tip format={format} unit={title} />} />
              <Line
                dataKey={dataKey}
                type="monotone"
                stroke={color}
                strokeWidth={strong ? 2.5 : 2}
                dot={data.length > 24 ? false : { r: 3.5, fill: color, stroke: 'var(--c-surface, #fff)', strokeWidth: 2 }}
                activeDot={{ r: 5 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function IncomeTrend() {
  const [range, setRange] = useState<Range>('12')
  const [points, setPoints] = useState<TrendPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { from, to } = useMemo(() => bounds(range, clockNow()), [range])

  useEffect(() => {
    let live = true
    setLoading(true); setError(null)
    fetchIncomeMonths(from, to)
      .then((rows) => { if (live) setPoints(trendSeries(rows)) })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not read the months.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [from, to])

  const last = points[points.length - 1]
  const totals = useMemo(() => trendTotals(points), [points])

  return (
    <div className="space-y-5" data-testid="income-trend">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-lg font-semibold tracking-tight text-slate-800">Month by month</h2>
          <span className="text-xs text-slate-400">What came in, before the firm&rsquo;s own expenses</span>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-[12.5px]" role="group" aria-label="How far back">
          {RANGES.map((r) => (
            <button key={r.key} type="button" onClick={() => setRange(r.key)} aria-pressed={range === r.key}
              className={clsx('px-3 py-1 rounded-md', range === r.key ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50')}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && <Card className="p-4 text-sm text-negative-700 bg-negative-50 border-negative-100">{error}</Card>}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-8"><Loader2 size={16} className="animate-spin" /> Reading the months…</div>
      ) : points.length === 0 ? (
        <Card className="p-6 text-sm text-slate-500 text-center">Nothing earned or collected in these months yet.</Card>
      ) : (
        <>
          <Card>
            <CardHeader title="What the firm earned" subtitle="Each line on its own scale. The months line up across all four" />
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-5">
              <Panel testId="trend-interest" title="Interest" caption="On debtors’ accounts, and the bank’s on the trust account"
                latest={rand(last?.interest ?? 0)} data={points} dataKey="interest" color={INK} format={rand} tickFormat={kRand} />
              <Panel testId="trend-fees" title="Fees" caption="Annexure B fees and costs, and charges to clients, with their VAT"
                latest={rand(last?.fees ?? 0)} data={points} dataKey="fees" color={INK} format={rand} tickFormat={kRand} />
              <Panel testId="trend-commission" title="Commission" caption="Without its VAT, which is SARS’s"
                latest={rand(last?.commission ?? 0)} data={points} dataKey="commission" color={INK} format={rand} tickFormat={kRand} />
              <Panel testId="trend-earned" title="Total earned" caption="All three, and unclaimed credit and other entries"
                latest={rand(last?.earned ?? 0)} data={points} dataKey="earned" color={DEEP} format={rand} tickFormat={kRand} strong />
            </div>
          </Card>

          <Card>
            <CardHeader title="Earned against collected"
              subtitle={totals.ratio == null ? 'Nothing collected in these months'
                : `Over these months the firm earned ${rand(totals.earned)} on ${rand(totals.collected)} collected: ${totals.ratio.toFixed(1)}%`} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
              <Panel testId="trend-collected" title="Collected" caption="Every debtor receipt approved that month, to the trust or straight to the client"
                latest={rand(last?.collected ?? 0)} data={points} dataKey="collected" color={STEEL} kind="bar" format={rand} tickFormat={kRand} />
              <Panel testId="trend-ratio" title="Earned as a share of collected" caption="Total earned ÷ collected, each month"
                latest={last?.ratio == null ? '—' : `${last.ratio.toFixed(1)}%`} data={points} dataKey="ratio" color={GOLD}
                format={(v) => `${v.toFixed(1)}%`} tickFormat={pct} />
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
