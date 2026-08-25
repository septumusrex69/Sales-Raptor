import { Link } from 'react-router-dom'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { Card, CardHeader } from '../ui/Card'
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

export function WinRateCard({ deals, won, lost, winRate, newLeads, qualified, converted, periodLabel, periodParam }: WinRateCardProps) {
  const open = deals.filter((d) => d.stage !== 'Won' && d.stage !== 'Lost').length
  const donutData = [
    { name: 'Won', value: won, color: POSITIVE_HEX },
    { name: 'Open', value: open, color: OPEN_HEX },
    { name: 'Lost', value: lost, color: NEGATIVE_HEX },
  ].filter((d) => d.value > 0)

  const pipeline = [
    { label: 'New Leads', value: newLeads, color: '#6086a9', bg: '#edf1f5', to: buildDrilldownUrl('/leads', { [SALES_MONTH_PARAM]: periodParam }) },
    { label: 'Qualified', value: qualified, color: '#406d58', bg: '#eef4f1', to: buildDrilldownUrl('/leads', { status: 'Qualified', [SALES_MONTH_PARAM]: periodParam }) },
    { label: 'Converted to Deal', value: converted, color: '#957323', bg: '#f7f3eb', to: buildDrilldownUrl('/leads', { status: 'Converted', [SALES_MONTH_PARAM]: periodParam }) },
  ]

  return (
    <Card>
      <div className="flex items-start justify-between mb-4 gap-3">
        <CardHeader title="Win Rate" subtitle="Closed deals in the selected period — plus where the rest of your pipeline stands" />
        <span className="text-xs font-medium text-brand-600 bg-brand-50 px-2.5 py-1 rounded-full whitespace-nowrap shrink-0">{periodLabel}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-7 items-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-44 w-44 relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={56} outerRadius={80} paddingAngle={2} isAnimationActive={false}>
                  {donutData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} stroke="none" />
                  ))}
                </Pie>
                <Tooltip formatter={(value, name) => [value, name]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-3xl font-extrabold" style={{ color: POSITIVE_HEX }}>
                {winRate}%
              </span>
              <span className="text-[11px] font-semibold text-slate-400 mt-1 tracking-wide">WIN RATE</span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap justify-center">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: POSITIVE_HEX }} />
              Won <b className="text-slate-700 font-bold">{won}</b>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: OPEN_HEX }} />
              Open <b className="text-slate-700 font-bold">{open}</b>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: NEGATIVE_HEX }} />
              Lost <b className="text-slate-700 font-bold">{lost}</b>
            </span>
          </div>
        </div>

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
        <span>Win Rate = Won ÷ (Won + Lost) among closed deals in scope</span>
        <Link to={buildDrilldownUrl('/deals', { view: 'table', [SALES_MONTH_PARAM]: periodParam })} className="font-semibold text-brand-600 hover:underline">
          View all deals →
        </Link>
      </div>
    </Card>
  )
}
