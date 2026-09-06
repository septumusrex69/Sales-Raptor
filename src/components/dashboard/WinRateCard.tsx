import { Link } from 'react-router-dom'
import { Card, CardHeader } from '../ui/Card'
import { RingDonut, type RingDonutSlice } from '../ui/RingDonut'
import { POSITIVE_HEX, NEGATIVE_HEX, OPEN_HEX } from '../../lib/colors'
import { buildDrilldownUrl, SALES_MONTH_PARAM } from '../../lib/drilldown'
import type { Deal } from '../../types'

interface WinRateCardProps {
  /** Scoped deals, current snapshot (unfiltered by period — matches the Sales Funnel's "as of today" reading). */
  deals: Deal[]
  won: number
  lost: number
  winRate: number
  newLeads: number
  qualified: number
  converted: number
  periodLabel: string
  periodParam: string
}

/** Neutral gray for a slice that's excluded from a given rate's own math — still shown for context, just visually de-emphasized so it doesn't read as "counted." */
const EXCLUDED_HEX = '#cbd5e1'

export function WinRateCard({ deals, won, lost, winRate, newLeads, qualified, converted, periodLabel, periodParam }: WinRateCardProps) {
  const open = deals.filter((d) => d.stage !== 'Won' && d.stage !== 'Rejected').length
  const total = won + open + lost
  const overallRate = total > 0 ? Math.round((won / total) * 100) : 0

  // Overall Conversion counts Open toward the denominator, so it's colored in full —
  // every slice here contributes to the percentage shown.
  const overallDonutData: RingDonutSlice[] = [
    { name: 'Won', value: won, color: POSITIVE_HEX },
    { name: 'Open', value: open, color: OPEN_HEX },
    { name: 'Rejected', value: lost, color: NEGATIVE_HEX },
  ].filter((d) => d.value > 0)

  // Win Rate excludes Open from its math entirely, so its wedge is grayed out here
  // rather than reusing the amber "Open" color — a visual cue that it isn't counted.
  const winRateDonutData: RingDonutSlice[] = [
    { name: 'Won', value: won, color: POSITIVE_HEX },
    { name: 'Open', value: open, color: EXCLUDED_HEX, muted: true },
    { name: 'Rejected', value: lost, color: NEGATIVE_HEX },
  ].filter((d) => d.value > 0)

  const pipeline = [
    { label: 'New Leads', value: newLeads, color: '#6086a9', bg: '#edf1f5', to: buildDrilldownUrl('/leads', { [SALES_MONTH_PARAM]: periodParam }) },
    { label: 'Hot leads', value: qualified, color: '#406d58', bg: '#eef4f1', to: buildDrilldownUrl('/leads', { status: 'Hot Lead', [SALES_MONTH_PARAM]: periodParam }) },
    { label: 'Converted to Deal', value: converted, color: '#957323', bg: '#f7f3eb', to: buildDrilldownUrl('/leads', { status: 'Converted', [SALES_MONTH_PARAM]: periodParam }) },
  ]

  return (
    <Card>
      <div className="flex items-start justify-between mb-4 gap-3">
        <CardHeader title="Win Rate" subtitle="Two ways to read your pipeline — everything in it, and just what's closed" />
        <span className="text-xs font-medium text-brand-600 bg-brand-50 px-2.5 py-1 rounded-full whitespace-nowrap shrink-0">{periodLabel}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[176px_176px_1fr] gap-6 items-start">
        <RingDonut data={overallDonutData} centerValue={`${overallRate}%`} centerColor={POSITIVE_HEX} centerLabel="OVERALL CONVERSION" caption="Of everything in the pipeline" />
        <RingDonut data={winRateDonutData} centerValue={`${winRate}%`} centerColor={POSITIVE_HEX} centerLabel="WIN RATE" caption="Of deals that closed" />

        <div className="flex flex-col gap-2.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Lead pipeline, same period</span>
          {pipeline.map((p) => (
            <Link key={p.label} to={p.to} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-slate-100 hover:bg-slate-50/60">
              <span className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-extrabold shrink-0" style={{ backgroundColor: p.bg, color: p.color }}>
                {p.value}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-lg font-extrabold text-slate-800 leading-tight">{p.value}</span>
                <span className="block text-[11.5px] text-slate-400">{p.label}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100 text-xs text-slate-400">
        <span>Overall Conversion = Won ÷ (Won + Open + Rejected) &nbsp;·&nbsp; Win Rate = Won ÷ (Won + Rejected)</span>
        <Link to={buildDrilldownUrl('/deals', { view: 'table', [SALES_MONTH_PARAM]: periodParam })} className="font-semibold text-brand-600 hover:underline shrink-0">
          View all deals →
        </Link>
      </div>
    </Card>
  )
}
