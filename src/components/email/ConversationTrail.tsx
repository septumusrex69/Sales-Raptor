import { useEffect, useMemo, useState } from 'react'
import { Loader2, MessagesSquare, Send } from 'lucide-react'
import { fetchConversationMail, type MailItem } from '../../lib/userMail'
import { conversationSubject, inConversation } from '../../lib/mailConversations'

/**
 * "IN THIS CONVERSATION", ABOVE THE OPEN MESSAGE (conversation mode, S19). Rinda: "have all the emails together that
 * is in a trail." Every message of the trail, oldest at the top as a trail is read, the open one marked -- the
 * messages on this page at once, and the rest of the mailbox (sent replies, older pages) read in behind them. A tap
 * opens one in place. Nothing is drawn for a message with no trail: a strip saying "1 message" is furniture.
 */
export function ConversationTrail({ mail, onPage, userId, mine, onOpen }: {
  mail: MailItem
  /** The trail's messages already in the list. */
  onPage: MailItem[]
  userId: string
  mine: (string | null | undefined)[]
  onOpen: (m: MailItem) => void
}) {
  const [found, setFound] = useState<MailItem[] | null>(null)
  const core = conversationSubject(mail.subject)
  useEffect(() => {
    if (!core) { setFound([]); return }
    let live = true
    setFound(null)
    void fetchConversationMail(userId, core)
      .then((rows) => { if (live) setFound(rows) })
      .catch(() => { if (live) setFound([]) })
    return () => { live = false }
  }, [userId, core])

  const trail = useMemo(() => {
    const byId = new Map<string, MailItem>()
    for (const m of [mail, ...onPage]) byId.set(m.id, m)
    /* Grown a pass at a time, so a message joins through anybody already in the trail, as the list groups. */
    let grew = true
    const pool = found ?? []
    while (grew) {
      grew = false
      for (const m of pool) {
        if (!byId.has(m.id) && inConversation(m, [...byId.values()], mine)) { byId.set(m.id, m); grew = true }
      }
    }
    return [...byId.values()].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
  }, [mail, onPage, found, mine])

  if (trail.length < 2) {
    return found === null && onPage.length > 1
      ? <p className="mb-3 flex items-center gap-1.5 text-[12px] text-slate-400"><Loader2 size={12} className="animate-spin" /> Reading the conversation…</p>
      : null
  }
  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/60" data-testid="conversation-trail">
      <p className="flex items-center gap-1.5 px-3 pt-2 text-[11.5px] font-medium uppercase tracking-wide text-slate-500">
        <MessagesSquare size={13} /> In this conversation · {trail.length}
        {found === null && <Loader2 size={11} className="ml-1 animate-spin text-slate-400" />}
      </p>
      <ol className="py-1">
        {trail.map((m) => {
          const here = m.id === mail.id
          return (
            <li key={m.id}>
              <button type="button" disabled={here} onClick={() => onOpen(m)} data-testid="conversation-message"
                aria-current={here ? 'true' : undefined}
                className={`w-full flex items-baseline gap-2 px-3 py-1 text-left text-[12.5px] ${here ? 'bg-white font-medium text-slate-900' : 'text-slate-600 hover:bg-white'}`}>
                {m.isSent && <Send size={11} className="shrink-0 self-center text-slate-400" aria-label="Sent" />}
                <span className={`shrink-0 max-w-[11rem] truncate ${!m.readAt && !here ? 'font-semibold text-slate-800' : ''}`}>
                  {m.isSent ? `You → ${m.toName || m.toAddress || ''}` : (m.fromName || m.fromAddress)}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-400">{m.snippet ?? ''}</span>
                <span className="shrink-0 tabular-nums text-[11.5px] text-slate-400">
                  {new Date(m.occurredAt).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
