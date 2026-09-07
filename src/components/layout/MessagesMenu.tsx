import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail, MailOpen } from 'lucide-react'
import { timeAgo } from '../../data/mockData'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { parseEmailActivity } from '../../lib/emailActivity'
import type { Activity } from '../../types'

/**
 * Where an email lives, in the order that answers "what is this about" fastest.
 *
 * The deal first: it is the most specific thing the message can belong to, and the one someone
 * reading a reply usually needs. Falling back through client, lead, then the bare contact.
 */
function destinationFor(a: Activity): string | undefined {
  if (a.dealId) return `/deals/${a.dealId}`
  if (a.companyId) return `/companies/${a.companyId}`
  if (a.leadId) return `/leads/${a.leadId}`
  if (a.contactId) return `/contacts/${a.contactId}`
  return undefined
}

/**
 * Unread mail, counted where people already look for a count.
 *
 * Separate from the bell on purpose. A notification is something the system decided to tell
 * you; an unread email is a person waiting on a reply, and the two want different responses.
 * Mixing them means the number beside the bell stops meaning anything in particular, and the
 * mail that actually needs answering is buried among download receipts and status changes.
 */
export function MessagesMenu() {
  const { activities, updateActivity } = useAppStore()
  const { currentUser } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  /*
   * Your unread mail, not the floor's.
   *
   * Everyone can see everyone's activity in Raptor, so counting every unread message in the
   * store would put a number on this badge that no action of yours could ever clear — it would
   * climb with other people's inboxes and be ignored inside a week. A synced email carries the
   * id of the mailbox owner it arrived for, which is the person actually being waited on.
   */
  const unread = useMemo(() => {
    if (!currentUser) return []
    return activities
      .filter(
        (a) =>
          a.type === 'Email' &&
          a.isRead === false &&
          a.userId === currentUser.id &&
          parseEmailActivity(a.subject)?.direction === 'received',
      )
      .sort((a, b) => new Date(b.activityDate).getTime() - new Date(a.activityDate).getTime())
  }, [activities, currentUser])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function handleSelect(a: Activity) {
    setOpen(false)
    const to = destinationFor(a)
    // Left unread deliberately: opening the record is not the same as having read the message,
    // and the row it lands on marks itself read when it is actually expanded.
    if (to) navigate(to)
  }

  function markAllRead() {
    for (const a of unread) updateActivity(a.id, { isRead: true })
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg hover:bg-slate-100 text-slate-500"
        aria-label={unread.length > 0 ? `${unread.length} unread messages` : 'Messages'}
      >
        <Mail size={18} />
        {unread.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-brand-600 text-white text-[10px] flex items-center justify-center font-semibold">
            {unread.length > 99 ? '99+' : unread.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[22rem] bg-white rounded-xl shadow-lg border border-slate-100 py-2 z-50 max-h-96 overflow-y-auto">
          <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700">
              Unread messages{unread.length > 0 && <span className="text-slate-400 font-normal"> · {unread.length}</span>}
            </h3>
            {unread.length > 0 && (
              <button onClick={markAllRead} className="text-xs font-medium text-brand-600 hover:underline shrink-0">
                Mark all read
              </button>
            )}
          </div>

          {unread.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400 text-center flex flex-col items-center gap-2">
              <MailOpen size={20} className="text-slate-300" />
              Nothing unread. Every message has been opened.
            </p>
          ) : (
            unread.map((a) => {
              const subject = parseEmailActivity(a.subject)?.subject ?? a.subject
              const preview = (a.notes ?? '').replace(/\s+/g, ' ').trim()
              return (
                <button key={a.id} onClick={() => handleSelect(a)} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex gap-2 items-start">
                  <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 bg-brand-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-slate-800 leading-snug truncate">{subject}</span>
                    {preview && <span className="block text-[12px] text-slate-400 leading-snug truncate">{preview}</span>}
                    <span className="block text-[11px] text-slate-400 mt-0.5">{timeAgo(a.activityDate)}</span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
