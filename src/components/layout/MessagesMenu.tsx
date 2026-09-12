import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Mail, MailOpen } from 'lucide-react'
import { timeAgo } from '../../data/mockData'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { parseEmailActivity } from '../../lib/emailActivity'
import { fetchUnreadReplies, markRepliesRead, type DebtorReply } from '../../lib/accountEmails'
import type { Activity } from '../../types'

/**
 * Where an email lives, in the order that answers "what is this about" fastest.
 *
 * The deal first: it is the most specific thing the message can belong to, and the one someone
 * reading a reply usually needs. Falling back through client, lead, then the bare contact.
 */
function destinationFor(a: Activity): string | undefined {
  // The message id rides along so the page can open that exact row and scroll to it. Landing on
  // the right client with the message thirty rows down and closed reads as a broken link.
  const focus = `?email=${encodeURIComponent(a.id)}`
  if (a.dealId) return `/deals/${a.dealId}${focus}`
  if (a.companyId) return `/companies/${a.companyId}${focus}`
  if (a.leadId) return `/leads/${a.leadId}${focus}`
  if (a.contactId) return `/contacts/${a.contactId}${focus}`
  return undefined
}

/**
 * One shape for both kinds of unread mail, so the list can be one list.
 *
 * A CRM email hangs off a contact, lead, deal or company; a debtor's reply hangs off an account.
 * They are different records in different tables and they are the same thing to the person
 * reading this menu: somebody wrote to us and nobody has answered.
 */
interface InboxItem {
  id: string
  subject: string
  preview: string
  at: string
  /** Which debtor or client it is about, where we can say it in a few words. */
  about: string | null
  /** Where clicking goes. Null for a CRM email with nothing linked to it. */
  to: string | null
  markRead: () => void
  /**
   * Whether following the link counts as having read it.
   *
   * True for CRM mail, whose destination pages open the message on arrival. False for a debtor's
   * reply, which lands unread on the account for somebody to open — see the note where it is set.
   */
  readOnFollow: boolean
}

/**
 * Unread mail, counted where people already look for a count.
 *
 * Separate from the bell on purpose. A notification is something the system decided to tell
 * you; an unread email is a person waiting on a reply, and the two want different responses.
 * Mixing them means the number beside the bell stops meaning anything in particular, and the
 * mail that actually needs answering is buried among download receipts and status changes.
 *
 * Debtor replies count here too, and they have to. There are 100 000 accounts: a reply that
 * only appears on the account it belongs to is a reply nobody will ever find, and the firm said
 * so — "how will we know someone sent a message? It's crucial."
 */
export function MessagesMenu() {
  const { activities, updateActivity } = useAppStore()
  const { currentUser, session } = useAuth()
  const [open, setOpen] = useState(false)
  const [stranded, setStranded] = useState<string | null>(null)
  const [replies, setReplies] = useState<DebtorReply[]>([])
  const [syncing, setSyncing] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const loadReplies = useCallback(async () => {
    if (!currentUser) return
    try {
      setReplies(await fetchUnreadReplies(currentUser.id))
    } catch {
      // A count we could not read is not worth an error on the chrome of every page.
    }
  }, [currentUser])

  /*
   * Read the mailbox when someone is actually here.
   *
   * The Vercel cron syncs every mailbox once a day (05:00 UTC) — that is the ceiling on the
   * Hobby plan — so on the cron alone a debtor's reply could sit unseen for the better part of
   * a day. Nothing about a notification fixes that: the mail has to be FETCHED before it can be
   * counted.
   *
   * So the app pulls the signed-in agent's own mailbox when it loads and again when they open
   * this menu, which is exactly the moment they are asking "has anyone written to me". It is
   * one IMAP connection for one mailbox, and it means the count is current for whoever is
   * working rather than current as of last night.
   */
  const syncMine = useCallback(async () => {
    const token = session?.access_token
    if (!token) return
    setSyncing(true)
    try {
      await fetch('/api/email/sync', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    } catch {
      // Offline, or no mailbox connected. The list still shows whatever was already synced.
    } finally {
      setSyncing(false)
      await loadReplies()
    }
  }, [session, loadReplies])

  useEffect(() => { void syncMine() }, [syncMine])
  useEffect(() => { if (open) void syncMine() }, [open, syncMine])

  /*
   * Your unread mail, not the floor's.
   *
   * Everyone can see everyone's activity in Raptor, so counting every unread message in the
   * store would put a number on this badge that no action of yours could ever clear — it would
   * climb with other people's inboxes and be ignored inside a week. A synced email carries the
   * id of the mailbox owner it arrived for, which is the person actually being waited on.
   */
  const unread = useMemo<InboxItem[]>(() => {
    if (!currentUser) return []

    const crm: InboxItem[] = activities
      .filter(
        (a) =>
          a.type === 'Email' &&
          a.isRead === false &&
          a.userId === currentUser.id &&
          parseEmailActivity(a.subject)?.direction === 'received',
      )
      .map((a) => ({
        id: a.id,
        subject: parseEmailActivity(a.subject)?.subject ?? a.subject,
        preview: (a.notes ?? '').replace(/\s+/g, ' ').trim(),
        at: a.activityDate,
        about: null,
        to: destinationFor(a) ?? null,
        markRead: () => updateActivity(a.id, { isRead: true }),
        // The client, lead and deal pages open the linked message on arrival, so following the
        // link really is reading it. Unchanged behaviour on the CRM side.
        readOnFollow: true,
      }))

    const debtor: InboxItem[] = replies.map((r) => ({
      id: r.id,
      subject: r.subject || '(no subject)',
      preview: (r.body ?? '').replace(/\s+/g, ' ').trim(),
      at: r.occurredAt,
      // Says which debtor before you click, which is the whole difference between a useful
      // count and a list of twenty identical "Re: Account ..." lines.
      about: [r.debtorName, r.accountNumber].filter(Boolean).join(' · ') || r.from,
      // Straight to the Emails tab with this message open — see AccountDetail's `email` param.
      to: `/accounts/${r.accountId}?email=${encodeURIComponent(r.id)}`,
      // Reading it is opening it on the account, not clicking it here. See handleSelect.
      markRead: () => {
        setReplies((list) => list.filter((x) => x.id !== r.id))
        void markRepliesRead([r.id])
      },
      /*
       * A debtor's reply is NOT marked read by following the link.
       *
       * The firm's instruction: "just take it to the account and show the email as unread on the
       * account." Clicking a notification is not reading a message — it is deciding to go and
       * read one — so the count holds until somebody actually opens it on the account, and the
       * reply is visibly unread when they land. "Mark all read" is still there for a deliberate
       * clear-down.
       */
      readOnFollow: false,
    }))

    return [...crm, ...debtor].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  }, [activities, currentUser, replies, updateActivity])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function handleSelect(item: InboxItem) {
    if (!item.to) {
      // No client, lead, deal or contact on the record — nowhere to send anyone. Say so rather
      // than closing the menu and appearing to have done nothing.
      setStranded(item.id)
      return
    }
    setOpen(false)
    if (item.readOnFollow) item.markRead()
    navigate(item.to)
  }

  function markAllRead() {
    for (const item of unread) item.markRead()
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
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              Unread messages{unread.length > 0 && <span className="text-slate-400 font-normal">· {unread.length}</span>}
              {/* Shown while the mailbox is being read, so an empty list reads as "still
                  looking" rather than "nothing came". */}
              {syncing && <Loader2 size={12} className="animate-spin text-slate-300" />}
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
              {syncing ? 'Checking your mailbox…' : 'Nothing unread. Every message has been opened.'}
            </p>
          ) : (
            unread.map((item) => (
              <button key={item.id} onClick={() => handleSelect(item)} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex gap-2 items-start">
                <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 bg-brand-500" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-slate-800 leading-snug truncate">{item.subject}</span>
                  {/* Who it is about, before the preview. On a debtor's reply the subject line is
                      often our own "Re: Account ..." coming back, so the name is what tells the
                      agent which of a hundred thousand accounts this is. */}
                  {item.about && (
                    <span className="block text-[12px] text-brand-600 leading-snug truncate">{item.about}</span>
                  )}
                  {item.preview && <span className="block text-[12px] text-slate-400 leading-snug truncate">{item.preview}</span>}
                  <span className="block text-[11px] text-slate-400 mt-0.5">{timeAgo(item.at)}</span>
                  {stranded === item.id && (
                    <span className="block text-[11px] text-[var(--c-rust-deep)] mt-1">
                      Not linked to a client, lead or deal yet — find it under Activities.
                    </span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
