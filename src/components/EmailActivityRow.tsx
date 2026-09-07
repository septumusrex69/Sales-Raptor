import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Paperclip, Mail, Handshake } from 'lucide-react'
import { emailDayLabel, emailTimeLabel, parseEmailActivity } from '../lib/emailActivity'
import { DateGroupHeading } from './ui/DateGroupHeading'
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
  sent: { label: 'Sent', color: 'var(--c-steel-bright)', tint: 'var(--tint-steel-soft)', hint: 'Sent from the CRM by one of your team' },
  received: { label: 'Received', color: 'var(--c-green-bright)', tint: 'var(--tint-green-bright)', hint: "Arrived in your team's inbox from this client" },
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
export function EmailActivityRow({
  activity,
  onReply,
  showDeal,
  open: openProp,
  onToggleOpen,
}: {
  activity: Activity
  onReply?: () => void
  /**
   * Name the deal a message came from. On for the client and lead timelines, where an email
   * arrives from somewhere and the reader has no way to tell which piece of business it was
   * about — a client with a litigation matter and a collection mandate running at once has two
   * conversations, and merging them without a label reads as one confusing one. Off on the deal
   * page itself, where the answer is the page you are looking at.
   */
  showDeal?: boolean
  /**
   * Which row is open is owned by the list, not by each row.
   *
   * With every row keeping its own state, reading five emails left five expanded at once and a
   * page metres long — you lose your place, and the list stops being a list. One at a time
   * keeps the thread scannable and means opening the next message needs no tidying up first.
   */
  open?: boolean
  onToggleOpen?: (next: boolean) => void
}) {
  const [selfOpen, setSelfOpen] = useState(false)
  const open = openProp ?? selfOpen
  const setOpen = (next: boolean) => (onToggleOpen ? onToggleOpen(next) : setSelfOpen(next))
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const { userById, updateActivity, refreshSyncedData, deals } = useAppStore()
  const { session } = useAuth()

  const dealLabel = showDeal && activity.dealId ? (deals.find((d) => d.id === activity.dealId)?.name ?? undefined) : undefined

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
    setOpen(!open)
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
          <span className={`text-[14.5px] shrink-0 max-w-[55%] truncate ${isUnread ? 'font-semibold text-slate-800' : 'text-slate-700'}`}>{subject}</span>
          {!open && body && <span className="text-[13.5px] text-slate-400 truncate min-w-0">{body}</span>}
        </span>
        <span className="flex items-center gap-2.5 shrink-0">
          {dealLabel && (
            <span
              className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md max-w-[14rem] truncate"
              style={{ backgroundColor: 'var(--tint-gold)', color: 'var(--c-gold-deep)' }}
              title={`Sent from the deal: ${dealLabel}`}
            >
              <Handshake size={10} className="shrink-0" />
              {dealLabel}
            </span>
          )}
          {attachments.length > 0 && <Paperclip size={13} className="text-slate-400" />}
          {isUnread && <span className="w-2 h-2 rounded-full bg-brand-500" title="Unread" />}
          <span className="text-[12px] text-slate-400 tabular-nums">{emailTimeLabel(activity.activityDate)}</span>
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
          {dealLabel && activity.dealId && (
            <p className="text-[11px] mb-2">
              <Link to={`/deals/${activity.dealId}`} className="font-medium text-brand-600 hover:underline">
                Open the {dealLabel} deal &rarr;
              </Link>
            </p>
          )}
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
export function EmailActivityList({
  activities,
  onReply,
  showDeal,
  focusId,
}: {
  activities: Activity[]
  onReply?: (activity: Activity) => void
  showDeal?: boolean
  /**
   * A specific message to open and scroll to, named in the URL by whatever linked here.
   *
   * Sending someone to the record a message belongs to is not the same as showing them the
   * message: these pages are long, the email card sits well down them, and the reader arrives
   * at the top with no idea which of thirty rows they were meant to read. Opening it and
   * bringing it into view is the difference between a link that works and one that appears
   * to do nothing.
   */
  focusId?: string | null
}) {
  // One at a time. Opening a message closes whatever was open before it.
  const [openId, setOpenId] = useState<string | null>(null)
  const focusRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!focusId || !activities.some((a) => a.id === focusId)) return
    setOpenId(focusId)
    // After paint, so the row has expanded to its full height before it is scrolled to.
    const timer = window.setTimeout(() => {
      focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 60)
    return () => window.clearTimeout(timer)
  }, [focusId, activities])

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
            <div key={a.id} ref={a.id === focusId ? focusRef : undefined} className={a.id === focusId ? 'rounded-lg ring-2 ring-brand-500/40' : undefined}>
              {showDay && (
                <DateGroupHeading label={day} />
              )}
              <EmailActivityRow
                activity={a}
                onReply={onReply ? () => onReply(a) : undefined}
                showDeal={showDeal}
                open={openId === a.id}
                onToggleOpen={(next) => setOpenId(next ? a.id : null)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
