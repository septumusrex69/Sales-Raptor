import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardHeader } from '../ui/Card'
import { listRecentSalesMonths, isWithinPeriod } from '../../lib/salesMonth'
import { formatCurrency } from '../../data/mockData'
import { dealKind } from '../../lib/dealKind'
import type { Deal, Lead } from '../../types'

/**
 * Six months of history, four measures, four scales.
 *
 * This replaced a single chart carrying revenue on a left axis and a deal count on a right one.
 * Two y-scales in one frame is the most reliable way to make a chart lie: the crossing point of
 * the two series is set by whatever ranges the axes happen to have, so "revenue overtook deals
 * in July" can be manufactured or erased by changing a tick. Adding leads and a conversion rate
 * to that frame would have made it worse — rand, counts and a percentage share no axis at all.
 *
 * Small multiples instead. Each measure keeps its own scale, the months line up across all four
 * so the eye can still compare shapes month by month, and nothing implies a relationship that
 * the axes invented.
 */

/** Navy for money and volume, gold for the debt collection side and for rates. Both clear the
 *  CVD and normal-vision separation checks against each other and against the card surface. */
const INK = 'var(--c-navy)'
const GOLD = 'var(--c-gold-deep)'

interface Point {
  name: string
  fullLabel: string
  revenue: number
  mandates: number
  leads: number
  conversion: number | null
}

function PanelTooltip({
  active,
  payload,
  format,
  unit,
}: {
  active?: boolean
  payload?: { payload: Point; value: number }[]
  format: (v: number) => string
  unit: string
}) {
  if (!active || !payload?.length) return null
  const { payload: point, value } = payload[0]
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-3 py-2 text-xs">
      <p className="font-semibold text-slate-700">{point.fullLabel}</p>
      <p className="text-slate-500">
        {unit}: <span className="font-medium text-slate-700">{value == null ? '—' : format(value)}</span>
      </p>
    </div>
  )
}

const AXIS_TICK = { fontSize: 10, fill: 'var(--c-grey-light)' }

function Panel({
  title,
  caption,
  latest,
  data,
  dataKey,
  color,
  kind,
  format,
  tickFormat,
}: {
  title: string
  caption: string
  latest: string
  data: Point[]
  dataKey: keyof Point
  color: string
  kind: 'bar' | 'line'
  format: (v: number) => string
  tickFormat: (v: number) => string
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-slate-600">{title}</p>
        {/* The one direct label the panel gets: this month's figure. Labelling every point turns
            a trend into a table. */}
        <p className="text-sm font-bold text-slate-800 tabular-nums">{latest}</p>
      </div>
      <p className="text-[11px] text-slate-400 mb-1.5">{caption}</p>
      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          {kind === 'bar' ? (
            <BarChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--tint-neutral)" />
              <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={46} tickFormatter={tickFormat} allowDecimals={false} />
              <Tooltip cursor={{ fill: 'var(--tint-neutral)' }} content={<PanelTooltip format={format} unit={title} />} />
              {/* 4px rounded data-ends, anchored to the baseline. */}
              <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 4, right: 22, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--tint-neutral)" />
              <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={46} tickFormatter={tickFormat} domain={[0, 100]} />
              <Tooltip cursor={{ stroke: 'var(--c-grey-pale)' }} content={<PanelTooltip format={format} unit={title} />} />
              <Line
                dataKey={dataKey}
                type="monotone"
                stroke={color}
                strokeWidth={2}
                dot={{ r: 4, fill: color, stroke: 'var(--c-surface, #fff)', strokeWidth: 2 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function SalesTrendCard({ deals, leads, referenceDate }: { deals: Deal[]; leads: Lead[]; referenceDate: Date }) {
  const months = listRecentSalesMonths(referenceDate, 6)
  const data: Point[] = months.map((period) => {
    const won = deals.filter((d) => d.wonAt && isWithinPeriod(d.wonAt, period))
    const monthLeads = leads.filter((l) => isWithinPeriod(l.createdAt, period))
    const converted = monthLeads.filter((l) => l.status === 'Converted').length
    return {
      name: `${period.label.slice(0, 3)} '${period.label.slice(-2)}`,
      fullLabel: period.rangeLabel,
      revenue: won.filter((d) => dealKind(d) !== 'Handover').reduce((s, d) => s + d.value, 0),
      mandates: won.filter((d) => dealKind(d) === 'Handover').length,
      leads: monthLeads.length,
      // Null rather than zero in a month with no leads: a rate over nothing is undefined, and
      // plotting it as 0% draws a collapse that never happened.
      conversion: monthLeads.length > 0 ? Math.round((converted / monthLeads.length) * 100) : null,
    }
  })

  const last = data[data.length - 1]
  const count = (v: number) => Math.round(v).toLocaleString('en-ZA')
  const money = (v: number) => formatCurrency(v)
  const pct = (v: number) => `${Math.round(v)}%`

  return (
    <Card>
      <CardHeader title="Last Six Sales Months" subtitle="Each measure on its own scale — the months line up, the numbers are not mixed" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-5">
        <Panel
          title="Revenue Won"
          caption="Fees on won service deals"
          latest={money(last?.revenue ?? 0)}
          data={data}
          dataKey="revenue"
          color={INK}
          kind="bar"
          format={money}
          tickFormat={(v) => `R${Math.round(v / 1000)}k`}
        />
        <Panel
          title="Mandates Signed"
          caption="Debt collection deals won"
          latest={count(last?.mandates ?? 0)}
          data={data}
          dataKey="mandates"
          color={GOLD}
          kind="bar"
          format={count}
          tickFormat={count}
        />
        <Panel
          title="New Leads"
          caption="Leads created in the month"
          latest={count(last?.leads ?? 0)}
          data={data}
          dataKey="leads"
          color={INK}
          kind="bar"
          format={count}
          tickFormat={count}
        />
        <Panel
          title="Lead Conversion"
          caption="Share of that month's leads that became deals"
          latest={last?.conversion == null ? '—' : pct(last.conversion)}
          data={data}
          dataKey="conversion"
          color={GOLD}
          kind="line"
          format={pct}
          tickFormat={pct}
        />
      </div>
    </Card>
  )
}
