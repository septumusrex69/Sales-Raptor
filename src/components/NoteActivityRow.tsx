import { useMemo, useState } from 'react'
import {
  CalendarCheck,
  CheckCircle2,
  Download,
  FileText,
  MessageCircle,
  Phone,
  StickyNote,
  Trophy,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { emailDayLabel, emailTimeLabel } from '../lib/emailActivity'
import { ACTIVITY_TYPE_COLORS } from '../lib/colors'
import { collapseRepeats, downloadedFilename, isAutomaticActivity, type GroupedActivity } from '../lib/activityKind'
import { applyRowLimit, type RowLimit } from './ui/RowLimitSelect'
import { useAppStore } from '../store/AppStore'
import type { Activity, ActivityType } from '../types'

const TYPE_ICONS: Partial<Record<ActivityType, LucideIcon>> = {
  Note: StickyNote,
  Call: Phone,
  'Courtesy Call': Phone,
  WhatsApp: MessageCircle,
  Meeting: CalendarCheck,
  Proposal: FileText,
  Task: CheckCircle2,
  'Deal Won': Trophy,
  'Deal Rejected': XCircle,
  'Handover Received': Download,
}

/** A tint of the type's own colour, so every badge is coloured without hard-coding a pair per type. */
function tintOf(hex: string): string {
  return `${hex}1f`
}

function TypeBadge({ activity, size }: { activity: Activity; size: 'full' | 'quiet' }) {
  const isDownload = downloadedFilename(activity) !== null
  const color = isDownload ? 'var(--c-grey-blue)' : ACTIVITY_TYPE_COLORS[activity.type]
  const Icon = isDownload ? Download : TYPE_ICONS[activity.type] ?? StickyNote
  const box = size === 'full' ? 'w-[26px] h-[26px]' : 'w-[22px] h-[22px]'
  return (
    <span
      title={isDownload ? 'Attachment downloaded' : activity.type}
      style={{ backgroundColor: tintOf(color), color }}
      className={`${box} rounded-md flex items-center justify-center shrink-0`}
    >
      <Icon size={size === 'full' ? 14 : 12} strokeWidth={2.2} />
    </span>
  )
}

/**
 * One entry in a Notes card, using the same skeleton as an email row — badge, content, meta —
 * so the two cards on a client read as one system rather than two.
 *
 * Something a person typed is rendered at full size; something the app recorded on its own
 * (a stage change, a task, an attachment download) sits a size down in a lighter weight. Both
 * are still colour-coded by type, so a won deal or a booked meeting is findable at a glance.
 */
export function NoteActivityRow({ group }: { group: GroupedActivity }) {
  const { activity, count } = group
  const { userById } = useAppStore()
  const actorName = userById(activity.userId)?.name
  const automatic = isAutomaticActivity(activity)
  const filename = downloadedFilename(activity)

  const meta = [
    emailTimeLabel(activity.activityDate),
    actorName,
    count > 1 ? (count === 2 ? 'twice' : `${count} times`) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={`flex items-start gap-3 px-3 ${automatic ? 'py-2' : 'py-2.5'}`}>
      <TypeBadge activity={activity} size={automatic ? 'quiet' : 'full'} />
      <div className="min-w-0 flex-1">
        {filename ? (
          <p className="flex items-baseline gap-2 min-w-0">
            <span className="text-[13px] text-slate-500 shrink-0">Downloaded</span>
            <span className="text-[13px] text-slate-400 truncate">{filename}</span>
          </p>
        ) : automatic ? (
          <p className="text-[13px] text-slate-500">{activity.subject}</p>
        ) : (
          <>
            <p className="text-[14.5px] leading-snug text-slate-700 whitespace-pre-wrap">{activity.notes || activity.subject}</p>
            {activity.notes && activity.subject && activity.subject !== 'Note added' && (
              <p className="text-xs text-slate-400 mt-0.5">{activity.subject}</p>
            )}
          </>
        )}
        <p className="text-[11.5px] text-slate-400 mt-0.5">{meta}</p>
      </div>
    </div>
  )
}

/**
 * A card's worth of activity, grouped by day, with the automatically-recorded entries
 * separable from what people actually wrote.
 *
 * The toggle exists because audit records — every attachment download, every task created —
 * accumulate far faster than notes do, and on a busy client they otherwise bury the handful
 * of lines someone deliberately left for the next person. It defaults to showing everything,
 * so nothing disappears unless it's asked to.
 */
export function NoteActivityList({ activities, limit }: { activities: Activity[]; limit: RowLimit }) {
  const [showAutomatic, setShowAutomatic] = useState(true)
  const automaticCount = useMemo(() => activities.filter(isAutomaticActivity).length, [activities])

  const rows = useMemo(() => {
    const visible = showAutomatic ? activities : activities.filter((a) => !isAutomaticActivity(a))
    return applyRowLimit(collapseRepeats(visible), limit)
  }, [activities, showAutomatic, limit])

  let lastDay: string | null = null

  return (
    <div className="-mx-1">
      {automaticCount > 0 && (
        <div className="flex items-center gap-3 mb-2.5 pb-2.5 border-b border-slate-100">
          <button
            onClick={() => setShowAutomatic((v) => !v)}
            className={`text-[11px] font-medium rounded-md px-2 py-1 border ${
              showAutomatic ? 'border-slate-200 text-slate-500 bg-white hover:bg-slate-50' : 'border-brand-200 text-brand-700 bg-brand-50'
            }`}
          >
            {showAutomatic ? `Hide ${automaticCount} recorded automatically` : `Show ${automaticCount} recorded automatically`}
          </button>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 px-3 py-2">Nothing written here yet.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map((group) => {
            const day = emailDayLabel(group.activity.activityDate)
            const showDay = day !== lastDay
            lastDay = day
            return (
              <div key={group.activity.id}>
                {showDay && <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-50 px-3 py-1.5">{day}</p>}
                <NoteActivityRow group={group} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
