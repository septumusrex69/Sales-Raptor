import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { Link } from 'react-router-dom'
import { Card, CardHeader } from '../ui/Card'
import { ACTIVITY_TYPE_COLORS } from '../../lib/colors'
import { isMeaningfulActivity, MEANINGFUL_ACTIVITY_TYPES } from '../../lib/meaningfulActivity'
import { buildDrilldownUrl } from '../../lib/drilldown'
import type { Activity, ActivityType } from '../../types'

export function ActivityBreakdownChart({ activities }: { activities: Activity[] }) {
  const meaningful = activities.filter(isMeaningfulActivity)
  const byType = MEANINGFUL_ACTIVITY_TYPES.map((type) => ({ name: type, value: meaningful.filter((a) => a.type === type).length })).filter((d) => d.value > 0)
  const total = meaningful.length

  return (
    <Card>
      <CardHeader title="Activity Breakdown" subtitle={`${total} meaningful activities`} />
      <div className="h-44 relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={byType} dataKey="value" nameKey="name" innerRadius={48} outerRadius={70} paddingAngle={2} isAnimationActive={false}>
              {byType.map((entry) => (
                <Cell key={entry.name} fill={ACTIVITY_TYPE_COLORS[entry.name as ActivityType]} stroke="none" />
              ))}
            </Pie>
            <Tooltip formatter={(value, name) => [`${value} (${total > 0 ? Math.round((Number(value) / total) * 100) : 0}%)`, name]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xl font-bold text-slate-800">{total}</span>
          <span className="text-[11px] text-slate-400">Total</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2">
        {byType.map((d) => (
          <Link
            key={d.name}
            to={buildDrilldownUrl('/activities', { type: d.name })}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700"
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ACTIVITY_TYPE_COLORS[d.name as ActivityType] }} />
            <span className="truncate">{d.name}</span>
            <span className="ml-auto text-slate-400 shrink-0">{total > 0 ? Math.round((d.value / total) * 100) : 0}%</span>
          </Link>
        ))}
      </div>
    </Card>
  )
}
