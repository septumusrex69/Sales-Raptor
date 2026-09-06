import { Link } from 'react-router-dom'
import { Card, CardHeader } from '../ui/Card'
import { ACTIVITY_TYPE_COLORS } from '../../lib/colors'
import { isMeaningfulActivity, MEANINGFUL_ACTIVITY_TYPES } from '../../lib/meaningfulActivity'
import { buildDrilldownUrl } from '../../lib/drilldown'
import type { Activity, ActivityType } from '../../types'

/** Same rounded-stroke ring technique as the Win Rate donuts, for a consistent look across the dashboard's charts. */
const DONUT_SIZE = 176
const DONUT_STROKE = 22
const DONUT_R = (DONUT_SIZE - DONUT_STROKE) / 2
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_R

export function ActivityBreakdownChart({ activities }: { activities: Activity[] }) {
  const meaningful = activities.filter(isMeaningfulActivity)
  const byType = MEANINGFUL_ACTIVITY_TYPES.map((type) => ({ name: type, value: meaningful.filter((a) => a.type === type).length })).filter((d) => d.value > 0)
  const total = meaningful.length

  const gap = byType.length > 1 ? 3 : 0
  let cumulative = 0
  const arcs = byType.map((d) => {
    const raw = total > 0 ? (d.value / total) * DONUT_CIRCUMFERENCE : 0
    const length = Math.max(raw - gap, 0)
    const offset = -cumulative
    cumulative += raw
    return { color: ACTIVITY_TYPE_COLORS[d.name as ActivityType], length, offset, key: d.name }
  })

  return (
    <Card>
      <CardHeader title="Activity Breakdown" subtitle={`${total} meaningful activities`} />
      <div className="h-44 relative flex items-center justify-center">
        <svg viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} className="h-44 w-44 -rotate-90">
          <circle cx={DONUT_SIZE / 2} cy={DONUT_SIZE / 2} r={DONUT_R} fill="none" stroke="var(--tint-steel-alt)" strokeWidth={DONUT_STROKE} />
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx={DONUT_SIZE / 2}
              cy={DONUT_SIZE / 2}
              r={DONUT_R}
              fill="none"
              stroke={a.color}
              strokeWidth={DONUT_STROKE}
              strokeLinecap="round"
              strokeDasharray={`${a.length} ${DONUT_CIRCUMFERENCE - a.length}`}
              strokeDashoffset={a.offset}
            />
          ))}
        </svg>
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
