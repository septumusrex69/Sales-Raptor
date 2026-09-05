import { useState } from 'react'
import { formatDateTime } from '../data/mockData'
import { parseEmailActivity } from '../lib/emailActivity'
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
  const parsed = parseEmailActivity(activity.subject)
  const isUnread = parsed?.direction === 'received' && activity.isRead === false
  const borderColor = parsed?.direction === 'sent' ? '#6086a9' : parsed?.isSpam ? '#c9962c' : '#406d58'
  const body = activity.notes ?? ''
  const isLong = body.length > PREVIEW_THRESHOLD

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
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-[11px] text-slate-400">{formatDateTime(activity.activityDate)}</span>
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
