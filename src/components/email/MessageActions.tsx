import { Forward, Mail, Reply, ReplyAll } from 'lucide-react'

/**
 * What you can do with a message you have just opened — at the TOP of it, on every screen.
 *
 * WHY IT MOVED. Reply sat under the body, on the reasoning that you answer a message after you
 * have read it. The firm, on a debtor's account: "to put these things at the top, currently it's
 * still at the bottom, so if you want to reply, you have to go all the way down." A collector
 * working a diary already knows what the message says — they opened it to answer it — and a
 * three-screen email put the only button they wanted past three screens of scrolling. Outlook,
 * Gmail and Spark all put it above the body for the same reason.
 *
 * WHY IT IS ONE COMPONENT. Four screens carry a message somebody can answer: a debtor account's
 * correspondence, and the email cards on a lead, a deal and a client. They had two different sets
 * of actions in two different styles, and the firm asked for one — "just to make all of that
 * uniform". Written four times they drift, and the way that failure shows up is somebody learning
 * the bar on one screen and finding half of it missing on the next.
 *
 * WHAT IS OFFERED IS DECIDED BY THE CALLER, by passing null. That is deliberate: a button that is
 * present and does nothing teaches people not to trust the row of buttons. There is no
 * reply-all on a message nobody else was on, and no mark-unread on one you sent yourself.
 */
export function MessageActions({
  onReply, onReplyAll, onForward, onMarkUnread, replyNote, canSend = true, disabledNote,
}: {
  /** Null where there is nobody to answer — an outbound message. */
  onReply: (() => void) | null
  /**
   * Null unless somebody else was actually on the message.
   *
   * The firm's own condition: "reply all, if there are other people that are CC'd." Offering it
   * on a two-party message is offering a second button that does exactly what the first one does.
   */
  onReplyAll: (() => void) | null
  onForward: (() => void) | null
  /** Null where it cannot apply: an outbound message, or one already unread. */
  onMarkUnread: (() => void) | null
  /**
   * What answering costs, where it costs something.
   *
   * On a debtor account every email out raises Annexure B item 1(a), so the button says so before
   * it is pressed rather than after. On a lead, a deal or a client it raises nothing and there is
   * nothing to say — fees are charged on ACCOUNTS ONLY.
   */
  replyNote?: string
  /** False when the agent has no mailbox connected. The buttons say why rather than failing. */
  canSend?: boolean
  disabledNote?: string
}) {
  const nothingToDo = !onReply && !onReplyAll && !onForward && !onMarkUnread
  if (nothingToDo) return null

  const why = canSend ? undefined : (disabledNote ?? 'Connect your mailbox in Settings → Integrations first')

  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-3 pb-3 border-b border-slate-100">
      {/*
        REPLY IS THE ACCENT ONE. It is what a person opened the message to do; the rest are there
        for the times it is not. The same gold this app uses for the one action on a screen that
        starts something — see the Write to them button, which is its counterpart on the card.
      */}
      {onReply && (
        <button type="button" onClick={onReply} disabled={!canSend} title={why}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg
            border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500
            disabled:opacity-40 disabled:hover:bg-gold-400">
          <Reply size={13} /> Reply{replyNote ? ` · ${replyNote}` : ''}
        </button>
      )}
      {onReplyAll && (
        <ActionButton onClick={onReplyAll} disabled={!canSend} title={why} icon={<ReplyAll size={13} />}>
          Reply all{replyNote ? ` · ${replyNote}` : ''}
        </ActionButton>
      )}
      {onForward && (
        <ActionButton onClick={onForward} disabled={!canSend} title={why} icon={<Forward size={13} />}>
          Forward{replyNote ? ` · ${replyNote}` : ''}
        </ActionButton>
      )}
      {/*
        MARK UNREAD IS NOT A SEND, so it is never disabled by a missing mailbox — it is a note to
        yourself about your own list. "Not yet", said while scanning, is the whole of what it is
        for, and it is the one button here that gets pressed in a hurry.
      */}
      {onMarkUnread && (
        <ActionButton onClick={onMarkUnread} icon={<Mail size={13} />}
          title="Put this back on the unread list to follow up later">
          Mark unread
        </ActionButton>
      )}
    </div>
  )
}

/** The quiet ones. Outlined, so the accent stays on the single action people came to take. */
function ActionButton({ onClick, disabled, title, icon, children }: {
  onClick: () => void
  disabled?: boolean
  title?: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg
        border border-slate-200 text-slate-600 bg-white hover:border-[#c9a052] hover:bg-gold-50
        disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:bg-white">
      {icon} {children}
    </button>
  )
}

/**
 * The one button that starts a new message, wherever a record carries email.
 *
 * "In emails and clients, for example, it asks to compose, but in accounts it says write to them.
 * So maybe just make it all the same, like write to them. I kind of like that." Three screens said
 * Compose in an outlined grey; the account said Write to them in gold. One wording, one colour.
 */
export function WriteButton({ canSend = true, onClick, className = '', disabledNote }: {
  canSend?: boolean
  onClick: () => void
  className?: string
  disabledNote?: string
}) {
  return (
    <button type="button" onClick={onClick} disabled={!canSend}
      title={canSend ? undefined : (disabledNote ?? 'Connect your mailbox in Settings → Integrations first')}
      className={`inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg
        border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500
        disabled:opacity-40 disabled:hover:bg-gold-400 ${className}`}>
      <Mail size={14} /> Write to them
    </button>
  )
}
