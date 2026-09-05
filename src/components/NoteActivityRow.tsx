import { formatDateTime } from '../data/mockData'
import { ACTIVITY_TYPE_COLORS } from '../lib/colors'
import { useAppStore } from '../store/AppStore'
import type { Activity } from '../types'

/**
 * One row in a Notes card — every non-email Activity (notes, calls, meetings, status
 * changes, deal updates). Shared by the Client and Lead pages. Always names the person
 * who logged it: an entry on a debt-collection client's file needs to be attributable.
 */
export function NoteActivityRow({ activity }: { activity: Activity }) {
  const { userById } = useAppStore()
  const actorName = userById(activity.userId)?.name

  if (activity.type === 'Note') {
    return (
      <div className="bg-[#f7f4eb] border border-[#e7dbb2] rounded-lg p-3">
        <p className="text-sm text-slate-700 whitespace-pre-wrap">{activity.notes || activity.subject}</p>
        <p className="text-[11px] text-slate-400 mt-1">
          {formatDateTime(activity.activityDate)}
          {actorName && ` · ${actorName}`}
        </p>
      </div>
    )
  }

  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-50 pb-2.5 last:border-0 last:pb-0">
      <div className="flex items-start gap-2 min-w-0">
        <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: ACTIVITY_TYPE_COLORS[activity.type] }} />
        <div className="min-w-0">
          <p className="text-sm text-slate-700">{activity.subject}</p>
          {activity.notes && <p className="text-xs text-slate-500 mt-0.5 whitespace-pre-wrap">{activity.notes}</p>}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span className="text-[11px] text-slate-400">{formatDateTime(activity.activityDate)}</span>
        {actorName && <span className="text-[11px] text-slate-400">{actorName}</span>}
      </div>
    </div>
  )
}
