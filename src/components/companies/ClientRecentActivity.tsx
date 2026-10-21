import { Clock, Mail, Phone, StickyNote, Upload, type LucideIcon } from 'lucide-react'
import { Card } from '../ui/Card'
import { formatDate } from '../../data/mockData'
import type { Activity, User } from '../../types'

/**
 * THE LAST THREE THINGS THAT HAPPENED WITH THIS CLIENT (S9, 19 Oct, after the firm's mock). The firm,
 * on what the page should rank: "the notes are more important to see". The whole timeline is the
 * Notes tab and the notes panel lower down; this is the glance -- who last spoke to them, and when --
 * without scrolling past the figures to find it.
 */
const ICON: Partial<Record<string, LucideIcon>> = { Call: Phone, Email: Mail, Note: StickyNote, Handover: Upload }

export function ClientRecentActivity({ activities, users, onViewAll }: {
  /** Newest first, as the page already sorts them. */
  activities: Activity[]
  users: User[]
  onViewAll: () => void
}) {
  const recent = activities.slice(0, 3)
  return (
    <Card>
      <div data-testid="client-recent-activity">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-2 font-semibold text-[15px] text-slate-800">
            <Clock size={16} className="text-slate-400" /> Recent activity
          </h3>
          {activities.length > 3 && (
            <button type="button" onClick={onViewAll}
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-[12px] font-medium text-slate-600 hover:bg-slate-50">View all</button>
          )}
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing recorded with this client yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((a) => {
              const Icon = ICON[a.type] ?? StickyNote
              const who = users.find((u) => u.id === a.userId)?.name
              return (
                <li key={a.id} className="flex gap-3 py-2">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold-50 text-gold-600">
                    <Icon size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-slate-800">{a.subject || a.type}</p>
                    <p className="text-[11.5px] text-slate-500">{[formatDate(a.activityDate), who].filter(Boolean).join(' · ')}</p>
                    {a.notes && <p className="truncate text-[11.5px] text-slate-500">{a.notes}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Card>
  )
}
