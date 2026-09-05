import { useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Paperclip, Mail } from 'lucide-react'
import { emailDayLabel, emailTimeLabel, parseEmailActivity } from '../lib/emailActivity'
import { useAppStore } from '../store/AppStore'
import { useAuth } from '../store/AuthContext'
import type { Activity } from '../types'

type Direction = 'sent' | 'received'

/**
 * What each colour means, in one place — the row badge, the tooltip and the legend under the
 * card header all read from this, so they can't disagree with each other.
 *
 * Deliberately only two: whether the mail server had misfiled a message as spam is a fact
 * about the mail server, not about the client relationship. The CRM rescues those messages
 * either way, so surfacing a third colour for them just made the list harder to read.
 */
export const EMAIL_KINDS: Record<Direction, { label: string; color: string; tint: string; hint: string }> = {
  sent: { label: 'Sent', color: '#4a7ba7', tint: '#eaf1f8', hint: 'Sent from the CRM by one of your team' },
  received: { label: 'Received', color: '#3a7a5c', tint: '#e9f4ee', hint: "Arrived in your team's inbox from this client" },
}

function directionOf(parsed: ReturnType<typeof parseEmailActivity>): Direction {
  return parsed?.direction === 'sent' ? 'sent' : 'received'
}

function DirectionBadge({ kind }: { kind: Direction }) {
  const { color, tint, label, hint } = EMAIL_KINDS[kind]
  const Icon = kind === 'sent' ? ArrowUpRight : ArrowDownLeft
  return (
    <span
      title={`${label} — ${hint}`}
      style={{ backgroundColor: tint, color }}
      className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
    >
      <Icon size={14} strokeWidth={2.4} />
    </span>
  )
}

/** A key to the row colours, so nobody has to work out which direction blue vs green means. */
export function EmailLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3 pb-3 border-b border-slate-100">
      {(Object.keys(EMAIL_KINDS) as Direction[]).map((kind) => (
        <span key={kind} className="inline-flex items-center gap-1.5" title={EMAIL_KINDS[kind].hint}>
          <span style={{ backgroundColor: EMAIL_KINDS[kind].color }} className="w-2.5 h-2.5 rounded-sm" />
          <span className="text-[11px] text-slate-500">{EMAIL_KINDS[kind].label}</span>
        </span>
      ))}
    </div>
  )
}

/**
 * One email in an Emails card, collapsed to a single line until it's opened.
 *
 * At rest a row is a direction badge, subject, one line of preview and a time: enough to
 * find the message you want among twenty. The full body, attachments, Reply and who sent or
 * received it belong to the message you've actually chosen, so they appear on open.
 * Shared by the Client and Lead pages so the two can't drift apart.
 */
export function EmailActivityRow({ activity, onReply }: { activity: Activity; onReply?: () => void }) {
  const [open, setOpen] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const { userById, updateActivity, refreshSyncedData } = useAppStore()
  const { session } = useAuth()

  const parsed = parseEmailActivity(activity.subject)
  const kind = directionOf(parsed)
  const subject = parsed?.subject ?? activity.subject
  const body = activity.notes ?? ''
  const attachments = activity.attachmentNames ?? []
  const isIncoming = parsed?.direction === 'received'
  const isUnread = isIncoming && activity.isRead === false
  const actorName = userById(activity.userId)?.name

  function toggle() {
    if (isUnread) updateActivity(activity.id, { isRead: true })
    setOpen((v) => !v)
  }

  /**
   * Pulls the file from the mailbox through the server rather than storing it in the CRM.
   * Needs the auth header, so it can't be a plain link — fetch, then hand the browser a
   * blob to save.
   */
  async function download(name: string) {
    if (!session?.access_token) return
    setDownloading(name)
    setDownloadError(null)
    try {
      const res = await fetch('/api/email/attachment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ activityId: activity.id, filename: name }),
      })
      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}))
        setDownloadError(errorBody.error ?? 'Could not download that attachment.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      URL.revokeObjectURL(url)
      // The download is logged as an Activity server-side; pull it in so it shows straight away.
      void refreshSyncedData()
    } catch {
      setDownloadError('Could not reach the server.')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className={open ? 'bg-slate-50/80' : ''}>
      <button onClick={toggle} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50" aria-expanded={open}>
        <DirectionBadge kind={kind} />
        <span className="flex-1 min-w-0 flex items-baseline gap-2">
          <span className={`text-sm shrink-0 max-w-[55%] truncate ${isUnread ? 'font-semibold text-slate-800' : 'text-slate-700'}`}>{subject}</span>
          {!open && body && <span className="text-[13px] text-slate-400 truncate min-w-0">{body}</span>}
        </span>
        <span className="flex items-center gap-2.5 shrink-0">
          {attachments.length > 0 && <Paperclip size={13} className="text-slate-400" />}
          {isUnread && <span className="w-2 h-2 rounded-full bg-brand-500" title="Unread" />}
          <span className="text-xs text-slate-400 tabular-nums">{emailTimeLabel(activity.activityDate)}</span>
        </span>
      </button>

      {open && (
        <div className="pl-[46px] pr-3 pb-3.5">
          <p className="text-[11px] text-slate-400 mb-2">
            <span style={{ color: EMAIL_KINDS[kind].color }} className="font-medium">
              {EMAIL_KINDS[kind].label}
            </span>
            {actorName && ` · ${parsed?.direction === 'sent' ? 'sent by' : 'received by'} ${actorName}`}
            {` · ${emailDayLabel(activity.activityDate)} at ${emailTimeLabel(activity.activityDate)}`}
          </p>
          {body && <p className="text-[13.5px] leading-relaxed text-slate-600 whitespace-pre-wrap max-w-[70ch]">{body}</p>}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {attachments.map((name, i) => (
              <button
                key={`${name}-${i}`}
                onClick={() => void download(name)}
                disabled={downloading === name}
                title="Download from the mailbox"
                className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-white border border-slate-200 rounded-md px-2.5 py-1.5 max-w-[280px] hover:border-brand-300 hover:text-brand-700 disabled:opacity-50"
              >
                <Paperclip size={12} className="shrink-0" />
                <span className="truncate">{name}</span>
                {downloading === name && <span className="text-slate-400">…</span>}
              </button>
            ))}
            {onReply && (
              <button
                onClick={onReply}
                className="text-xs font-medium text-brand-600 border border-slate-200 rounded-md px-3 py-1.5 bg-white hover:bg-slate-50"
              >
                Reply
              </button>
            )}
            {isIncoming && !isUnread && (
              <button
                onClick={() => {
                  updateActivity(activity.id, { isRead: false })
                  setOpen(false)
                }}
                title="Put this back on the unread list to follow up later"
                className="inline-flex items-center gap-1.5 text-xs text-slate-500 border border-slate-200 rounded-md px-3 py-1.5 bg-white hover:bg-slate-50"
              >
                <Mail size={12} /> Mark unread
              </button>
            )}
          </div>
          {downloadError && <p className="text-xs text-red-600 mt-2">{downloadError}</p>}
        </div>
      )}
    </div>
  )
}

/**
 * A card's worth of emails, grouped under day headings. The heading carries the date so
 * each row only needs a time — "05 Sep 2026 at 21:55" repeated down every row was a large
 * share of what made the list feel bulky.
 */
export function EmailActivityList({ activities, onReply }: { activities: Activity[]; onReply?: (activity: Activity) => void }) {
  let lastDay: string | null = null
  return (
    <div className="-mx-1">
      <EmailLegend />
      <div className="divide-y divide-slate-100">
        {activities.map((a) => {
          const day = emailDayLabel(a.activityDate)
          const showDay = day !== lastDay
          lastDay = day
          return (
            <div key={a.id}>
              {showDay && (
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-50 px-3 py-1.5">{day}</p>
              )}
              <EmailActivityRow activity={a} onReply={onReply ? () => onReply(a) : undefined} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
