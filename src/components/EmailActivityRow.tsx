import { useState } from 'react'
import { Paperclip } from 'lucide-react'
import { emailDayLabel, emailTimeLabel, parseEmailActivity } from '../lib/emailActivity'
import { useAppStore } from '../store/AppStore'
import { useAuth } from '../store/AuthContext'
import type { Activity } from '../types'

const DIRECTION_COLORS = { sent: '#6086a9', received: '#406d58', spam: '#c9962c' } as const

function railColor(parsed: ReturnType<typeof parseEmailActivity>): string {
  if (parsed?.direction === 'sent') return DIRECTION_COLORS.sent
  if (parsed?.isSpam) return DIRECTION_COLORS.spam
  return DIRECTION_COLORS.received
}

/** The words the coloured rail already implies — shown only once a row is open. */
function directionLabel(parsed: ReturnType<typeof parseEmailActivity>): string {
  if (parsed?.direction === 'sent') return 'Sent'
  if (parsed?.isSpam) return 'Received (Spam/Junk)'
  return 'Received'
}

/**
 * One email in an Emails card, collapsed to a single line until it's opened.
 *
 * At rest a row is subject + one line of preview + a time: enough to find the message you
 * want among twenty. Everything else — the full body, attachments, Reply, and who sent or
 * received it — belongs to the message you've actually chosen, so it appears on open.
 * Shared by the Client and Lead pages so the two can't drift apart.
 */
export function EmailActivityRow({ activity, onReply }: { activity: Activity; onReply?: () => void }) {
  const [open, setOpen] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const { userById, updateActivity, refreshSyncedData } = useAppStore()
  const { session } = useAuth()

  const parsed = parseEmailActivity(activity.subject)
  const subject = parsed?.subject ?? activity.subject
  const body = activity.notes ?? ''
  const attachments = activity.attachmentNames ?? []
  const isUnread = parsed?.direction === 'received' && activity.isRead === false
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
    <div style={{ borderLeftColor: railColor(parsed) }} className={`border-l-[3px] ${open ? 'bg-slate-50/70' : ''}`}>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-2 pl-2.5 pr-3 py-1.5 text-left hover:bg-slate-50"
        aria-expanded={open}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isUnread ? 'bg-brand-500' : 'bg-transparent'}`} />
        <span className="flex-1 min-w-0 flex items-baseline gap-2">
          <span className={`text-[13px] shrink-0 max-w-[55%] truncate ${isUnread ? 'font-semibold text-slate-800' : 'text-slate-700'}`}>{subject}</span>
          {!open && body && <span className="text-xs text-slate-400 truncate min-w-0">{body}</span>}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {attachments.length > 0 && <Paperclip size={11} className="text-slate-400" />}
          <span className="text-[11px] text-slate-400 tabular-nums">{emailTimeLabel(activity.activityDate)}</span>
        </span>
      </button>

      {open && (
        <div className="pl-[22px] pr-3 pb-3 -mt-0.5">
          <p className="text-[11px] text-slate-400 mb-1.5">
            {directionLabel(parsed)}
            {actorName && ` · ${parsed?.direction === 'sent' ? 'sent by' : 'received by'} ${actorName}`}
            {` · ${emailDayLabel(activity.activityDate)} at ${emailTimeLabel(activity.activityDate)}`}
          </p>
          {body && <p className="text-[13px] text-slate-600 whitespace-pre-wrap max-w-[70ch]">{body}</p>}
          {(attachments.length > 0 || onReply) && (
            <div className="flex flex-wrap items-center gap-2 mt-2.5">
              {attachments.map((name, i) => (
                <button
                  key={`${name}-${i}`}
                  onClick={() => void download(name)}
                  disabled={downloading === name}
                  title="Download from the mailbox"
                  className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 bg-white border border-slate-200 rounded-md px-2 py-1 max-w-[280px] hover:border-brand-300 hover:text-brand-700 disabled:opacity-50"
                >
                  <Paperclip size={11} className="shrink-0" />
                  <span className="truncate">{name}</span>
                  {downloading === name && <span className="text-slate-400">…</span>}
                </button>
              ))}
              {onReply && (
                <button
                  onClick={onReply}
                  className="text-[11px] font-medium text-brand-600 border border-slate-200 rounded-md px-2.5 py-1 bg-white hover:bg-slate-50"
                >
                  Reply
                </button>
              )}
            </div>
          )}
          {downloadError && <p className="text-[11px] text-red-600 mt-1.5">{downloadError}</p>}
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
    <div className="-mx-1 divide-y divide-slate-50">
      {activities.map((a) => {
        const day = emailDayLabel(a.activityDate)
        const showDay = day !== lastDay
        lastDay = day
        return (
          <div key={a.id}>
            {showDay && (
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-50 px-3 py-1">{day}</p>
            )}
            <EmailActivityRow activity={a} onReply={onReply ? () => onReply(a) : undefined} />
          </div>
        )
      })}
    </div>
  )
}
