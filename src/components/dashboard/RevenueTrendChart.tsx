import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Card, CardHeader } from '../ui/Card'
import { listRecentSalesMonths, isWithinPeriod } from '../../lib/salesMonth'
import { formatCurrency } from '../../data/mockData'
import type { Deal } from '../../types'

interface TooltipPayload {
  fullLabel: string
  revenue: number
  dealsWon: number
  avgDealValue: number
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: TooltipPayload }[] }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-3 py-2 text-xs space-y-0.5">
      <p className="font-semibold text-slate-700">{d.fullLabel}</p>
      <p className="text-slate-500">
        Revenue: <span className="font-medium text-slate-700">{formatCurrency(d.revenue)}</span>
      </p>
      <p className="text-slate-500">
        Deals won: <span className="font-medium text-slate-700">{d.dealsWon}</span>
      </p>
      <p className="text-slate-500">
        Avg deal value: <span className="font-medium text-slate-700">{formatCurrency(d.avgDealValue)}</span>
      </p>
    </div>
  )
}

export function RevenueTrendChart({ deals, referenceDate }: { deals: Deal[]; referenceDate: Date }) {
  const months = listRecentSalesMonths(referenceDate, 6)
  const data = months.map((period) => {
    const won = deals.filter((d) => d.wonAt && isWithinPeriod(d.wonAt, period))
    const revenue = won.reduce((s, d) => s + d.value, 0)
    return {
      name: `${period.label.slice(0, 3)} '${period.label.slice(-2)}`,
      fullLabel: period.rangeLabel,
      revenue,
      dealsWon: won.length,
      avgDealValue: won.length ? Math.round(revenue / won.length) : 0,
    }
  })

  return (
    <Card>
      <CardHeader title="Revenue Trend" subtitle="Bars = revenue won · Line = deals won, last 6 Sales Months" />
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => `R${Math.round(v / 1000)}k`} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
            <Tooltip content={<TrendTooltip />} />
            <Bar yAxisId="left" dataKey="revenue" fill="#355069" radius={[4, 4, 0, 0]} barSize={28} />
            <Line yAxisId="right" type="monotone" dataKey="dealsWon" stroke="#957323" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}
