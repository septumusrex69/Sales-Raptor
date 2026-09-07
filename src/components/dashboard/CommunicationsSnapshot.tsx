import { useMemo } from 'react'
import { ArrowRight } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { StatTile } from '../ui/StatTile'
import { useAppStore } from '../../store/AppStore'
import { isWithinPeriod, type SalesMonthPeriod } from '../../lib/salesMonth'
import { buildDrilldownUrl } from '../../lib/drilldown'

/**
 * The Communications figures that belong on a combined view — how much servicing actually
 * happened this period, not the department's full dashboard.
 *
 * It takes the period from the page it sits on rather than keeping its own. Two halves of one
 * overview reporting different months would be worse than showing nothing at all.
 */
export function CommunicationsSnapshot({ period, onOpenFull }: { period: SalesMonthPeriod; onOpenFull?: () => void }) {
  const { activities, tasks } = useAppStore()

  const stats = useMemo(() => {
    const inPeriod = activities.filter((a) => isWithinPeriod(a.activityDate, period))
    return {
      courtesyCalls: inPeriod.filter((a) => a.type === 'Courtesy Call').length,
      handovers: inPeriod.filter((a) => a.type === 'Handover Received').length,
      // Meetings are read from scheduled Meeting tasks due in the period, matching how the
      // Communications dashboard counts them — the app doesn't yet distinguish a meeting
      // that happened from one that was booked.
      meetings: tasks.filter((t) => t.type === 'Meeting' && isWithinPeriod(t.dueDate, period)).length,
      clientsTouched: new Set(inPeriod.map((a) => a.companyId).filter(Boolean)).size,
    }
  }, [activities, tasks, period])

  return (
    <Card>
      <CardHeader
        title="Communications"
        subtitle="Client servicing over the same period"
        action={
          onOpenFull ? (
            <button
              onClick={onOpenFull}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              Full dashboard <ArrowRight size={13} />
            </button>
          ) : undefined
        }
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile label="Courtesy Calls" value={String(stats.courtesyCalls)} to={buildDrilldownUrl('/activities', { type: 'Courtesy Call' })} />
        <StatTile label="Handovers Received" value={String(stats.handovers)} to={buildDrilldownUrl('/activities', { type: 'Handover Received' })} />
        <StatTile label="Meetings Held" value={String(stats.meetings)} to={buildDrilldownUrl('/tasks', { view: 'All' })} />
        <StatTile label="Clients Touched" value={String(stats.clientsTouched)} to={buildDrilldownUrl('/companies', {})} />
      </div>
    </Card>
  )
}
