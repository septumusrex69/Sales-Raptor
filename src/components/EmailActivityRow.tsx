import { useState } from 'react'
import { Paperclip } from 'lucide-react'
import { formatDateTime } from '../data/mockData'
import { parseEmailActivity } from '../lib/emailActivity'
import { useAppStore } from '../store/AppStore'
import { useAuth } from '../store/AuthContext'
import type { Activity } from '../types'

/**
 * Longer than this and the body is clamped to a couple of lines behind a
 * "Show more" toggle. A real email can run many hundreds of words, and
 * rendering that in full made a single message fill the entire Emails card
 * and push every other message off the screen.
 */
const PREVIEW_THRESHOLD = 180

/**
 * One row in an Emails card. Shared by the Client and Lead pages so the two
 * can't drift apart — they render incoming/outgoing mail identically.
 */
export function EmailActivityRow({ activity, onMarkRead, onReply }: { activity: Activity; onMarkRead: () => void; onReply?: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const { userById, refreshSyncedData } = useAppStore()
  const { session } = useAuth()

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
        const body = await res.json().catch(() => ({}))
        setDownloadError(body.error ?? 'Could not download that attachment.')
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

  const parsed = parseEmailActivity(activity.subject)
  // Who sent it, or whose connected mailbox it arrived in. Debt-collection correspondence
  // needs to be attributable to a person, not just to the company.
  const actorName = userById(activity.userId)?.name
  const isUnread = parsed?.direction === 'received' && activity.isRead === false
  const borderColor = parsed?.direction === 'sent' ? '#6086a9' : parsed?.isSpam ? '#c9962c' : '#406d58'
  const body = activity.notes ?? ''
  const isLong = body.length > PREVIEW_THRESHOLD
  const attachments = activity.attachmentNames ?? []

  return (
    <div
      onClick={() => isUnread && onMarkRead()}
      style={{ borderLeftColor: borderColor }}
      className={`flex items-start justify-between gap-3 rounded-lg border-l-[3px] pl-2.5 pr-2 py-2 ${isUnread ? 'bg-brand-50/60 cursor-pointer' : ''}`}
    >
      <div className="flex items-start gap-2 min-w-0">
        {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 shrink-0" />}
        <div className="min-w-0">
          <p className={`text-sm ${isUnread ? 'font-semibold text-slate-800' : 'text-slate-700'}`}>
            <span className="text-xs font-medium text-slate-400 mr-1.5">
              {parsed?.direction === 'sent' ? 'Sent' : parsed?.isSpam ? 'Received (Spam/Junk)' : parsed ? 'Received' : ''}
            </span>
            {parsed?.subject ?? activity.subject}
          </p>
          {body && (
            <>
              <p className={`text-xs text-slate-500 mt-0.5 whitespace-pre-wrap ${isLong && !expanded ? 'line-clamp-2' : ''}`}>{body}</p>
              {isLong && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setExpanded((v) => !v)
                  }}
                  className="text-[11px] font-medium text-brand-600 hover:underline mt-0.5"
                >
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </>
          )}
          {attachments.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {attachments.map((name, i) => (
                <button
                  key={`${name}-${i}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    void download(name)
                  }}
                  disabled={downloading === name}
                  title="Download from the mailbox"
                  className="inline-flex items-center gap-1 text-[11px] text-slate-600 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 max-w-[220px] hover:bg-slate-200 hover:text-brand-700 disabled:opacity-50"
                >
                  <Paperclip size={10} className="shrink-0" />
                  <span className="truncate">{name}</span>
                  {downloading === name && <span className="text-slate-400">…</span>}
                </button>
              ))}
            </div>
          )}
          {downloadError && <p className="text-[11px] text-red-600 mt-1">{downloadError}</p>}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-[11px] text-slate-400">{formatDateTime(activity.activityDate)}</span>
        {actorName && (
          <span className="text-[11px] text-slate-400">
            {parsed?.direction === 'sent' ? 'Sent by' : 'Received by'} {actorName}
          </span>
        )}
        {onReply && parsed?.direction === 'received' && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onReply()
            }}
            className="text-[11px] font-medium text-brand-600 hover:underline"
          >
            Reply
          </button>
        )}
      </div>
    </div>
  )
}
