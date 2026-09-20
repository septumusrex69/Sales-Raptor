import { useState } from 'react'
import { ChevronDown, ChevronRight, Download, Loader2, Mail, MailOpen, Paperclip } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { MessageActions, WriteButton } from '../../components/email/MessageActions'
import { hasOthers } from '../../lib/emailActivity'
import { formatMoney } from '../../data/mockData'
import { relativeDayLabel } from '../../lib/dateLabels'
import type { AccountEmail } from '../../lib/accountEmails'
import { useEmailView } from '../../lib/emailView'
import { EmailViewSwitcher } from '../../components/email/EmailViewSwitcher'
import { ReadingPane } from '../../components/email/ReadingPane'
import { downloadAttachment } from '../../lib/userMail'
import { useAuth } from '../../store/AuthContext'

/**
 * Every email either way on this account.
 *
 * Newest first, which is the same order the Activity timeline reads in and for the same reason:
 * a collector picking up an account wants the last thing that happened, not the first.
 *
 * Each row opens to the message itself rather than linking anywhere. The words of a demand and
 * the words of the reply to it are the record of what was said, and a list that only shows
 * subject lines makes a person open ten things to find the one that matters.
 */
export function EmailsPanel({
  emails, userId, canSend, onCompose, onReply, onReplyAll, onForward, onRead, onUnread,
}: {
  emails: AccountEmail[]
  /** Who is looking. Only the agent a message arrived for can mark it read. */
  userId: string | null
  /** False when the agent has no mailbox connected — the buttons say so rather than failing. */
  canSend: boolean
  onCompose: () => void
  onReply: (email: AccountEmail) => void
  /**
   * Answer everybody who was on it.
   *
   * Given a null Cc line by the caller where nobody else was on the message, which is how the
   * bar knows not to offer the button — see othersOn.
   */
  onReplyAll: (email: AccountEmail) => void
  /** Pass it on to somebody who was not on it — an attorney, the client, a colleague. */
  onForward: (email: AccountEmail) => void
  /** Called when an unread message is actually opened, so the Messages count can drop. */
  onRead: (email: AccountEmail) => void
  /** Put it back on the unread list. Only the agent it arrived for may — see the RLS policy. */
  onUnread: (email: AccountEmail) => void
}) {
  /*
   * Nothing opens on its own.
   *
   * This used to expand the newest message, and to expand whichever one a notification pointed
   * at. Both were wrong for the same reason, and the firm said so: "just take it to the account
   * and show the email as unread." Opening a message is how it becomes read, so opening it FOR
   * somebody destroys the only signal that says which mail still needs attention.
   */
  const [open, setOpen] = useState<string | null>(null)
  const [view, setView] = useEmailView()

  /*
   * Reading it is what marks it read — and only for the agent it arrived for, because that is
   * all the RLS policy permits. For anyone else it stays unread, which is correct: it is not
   * their message to have dealt with.
   */
  function markRead(email: AccountEmail) {
    if (!email.readAt && email.receivedBy && email.receivedBy === userId) onRead(email)
  }

  /** Select and read, without the list's close-on-second-click. */
  function select(email: AccountEmail) {
    if (open !== email.id) markRead(email)
    setOpen(email.id)
  }

  function toggle(email: AccountEmail) {
    const opening = open !== email.id
    setOpen(opening ? email.id : null)
    if (opening) markRead(email)
  }

  if (emails.length === 0) {
    return (
      <Card>
        <div className="py-10 text-center">
          <Mail size={22} className="mx-auto text-slate-300" />
          <p className="text-sm text-slate-500 mt-3">No email with this debtor yet.</p>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Anything sent from here is charged R25 under item 1(a). Their reply comes back to this
            list on its own and is charged R13 under item 6.
          </p>
          <WriteButton canSend={canSend} onClick={onCompose} className="mt-4" />
        </div>
      </Card>
    )
  }

  return (
    <Card padded={false}>
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100">
        <div>
          <h3 className="text-[11px] uppercase tracking-wide text-slate-400">Emails</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            {count(emails.filter((e) => e.direction === 'out').length, 'sent')}
            {' · '}
            {count(emails.filter((e) => e.direction === 'in').length, 'received')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <EmailViewSwitcher view={view} onChange={setView} />
          <WriteButton canSend={canSend} onClick={onCompose} />
        </div>
      </div>

      {view === 'reading' ? (
        /*
         * The same list, Outlook's way round. Rows are summaries only: ReadingPane makes each
         * one a button, so the Reply button moves into the pane beside the message — which is
         * where Outlook has it too.
         */
        <ReadingPane
          items={emails}
          selectedId={open}
          onSelect={(e) => select(e)}
          emptyDetail="Pick a message on the left to read it."
          renderRow={(e) => (
            <span className={`block px-4 py-2.5 ${e.direction === 'in' && !e.readAt ? 'bg-positive-50/40' : ''}`}>
              <EmailSummary email={e} tight />
            </span>
          )}
          renderDetail={(e) => (
            <div className="px-5 py-4">
              <div className="pb-3 mb-3 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-navy-950">{e.subject || '(no subject)'}</h3>
                <p className="text-xs text-slate-400 mt-0.5 truncate">
                  {e.direction === 'in' ? 'From' : 'To'} {e.debtorAddress}
                  {' · '}{relativeDayLabel(e.occurredAt)}
                  {e.sentByName && e.direction === 'out' && <> &middot; {e.sentByName}</>}
                  {/* The fee lives here in this view: the narrow row drops it to stay one line
                      per message, so the pane is where it gets said. */}
                  {e.chargedExclVat !== null && (
                    <> &middot; {e.chargedExclVat > 0 ? formatMoney(e.chargedExclVat) : 'no charge'}</>
                  )}
                </p>
              </div>
              <EmailBody email={e} canSend={canSend} userId={userId}
                onReply={() => onReply(e)} onReplyAll={() => onReplyAll(e)}
                onForward={() => onForward(e)} onUnread={() => onUnread(e)} />
            </div>
          )}
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {emails.map((e) => (
            <EmailRow key={e.id} email={e} expanded={open === e.id}
              onToggle={() => toggle(e)}
              canSend={canSend} userId={userId}
              onReply={() => onReply(e)} onReplyAll={() => onReplyAll(e)}
              onForward={() => onForward(e)} onUnread={() => onUnread(e)} />
          ))}
        </ul>
      )}
    </Card>
  )
}

/**
 * The summary of a message: what both views show in the list.
 *
 * Split out of the row so the reading pane can use the same block down its left. Two
 * identical-looking lists maintained separately is how they end up disagreeing.
 */
function EmailSummary({ email, tight }: { email: AccountEmail; tight?: boolean }) {
  const inbound = email.direction === 'in'
  const unread = inbound && !email.readAt
  const Icon = inbound && email.readAt ? MailOpen : Mail
  return (
    <span className="flex items-start gap-3">
      {/* Inbound takes the positive colour, like a payment does: the debtor made contact, which
          is the outcome the whole account is trying to produce. */}
      <span className={`mt-0.5 shrink-0 grid place-items-center w-7 h-7 rounded-full ${
        inbound ? 'bg-positive-50 text-positive' : 'bg-brand-50 text-brand-500'}`}>
        <Icon size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          {unread && <span className="w-1.5 h-1.5 rounded-full bg-positive shrink-0 self-center" />}
          <span className={`text-sm truncate ${unread ? 'font-semibold text-navy-950' : 'font-medium text-slate-800'}`}>
            {email.subject || '(no subject)'}
          </span>
          {email.attachmentNames.length > 0 && <Paperclip size={12} className="shrink-0 text-slate-400" />}
        </span>
        <span className="block text-xs text-slate-400 mt-0.5 truncate">
          {unread && <span className="font-semibold text-positive">Unread · </span>}
          {inbound ? 'From' : 'To'} {email.debtorAddress}
          {' · '}{relativeDayLabel(email.occurredAt)}
          {email.sentByName && !inbound && !tight && <> · {email.sentByName}</>}
        </span>
      </span>
      {/* The fee sits with the row in the list; in the reading pane's narrow column it would
          crowd the subject, and the pane's own header carries the detail instead. */}
      {!tight && email.chargedExclVat !== null && (
        <span className={`shrink-0 text-[11px] tabular-nums pt-0.5 ${
          email.chargedExclVat > 0 ? 'text-slate-500' : 'text-slate-300'}`}>
          {email.chargedExclVat > 0 ? formatMoney(email.chargedExclVat) : 'no charge'}
        </span>
      )}
    </span>
  )
}

/**
 * Whether anybody besides us and the debtor was on this message.
 *
 * The firm's own condition for the button: "reply all, if there are other people that are CC'd."
 * Our own mailbox is not somebody else — every message we received was addressed to us — and
 * neither is the debtor, who is already the To of an ordinary reply.
 *
 * Empty on everything filed before the columns existed, which correctly reads as "nobody else
 * known" and hides the button rather than offering one that would silently reply to one person.
 */
export function othersOn(email: AccountEmail): boolean {
  /*
   * THROUGH THE SHARED RULE, not beside it. This was written out again here for one commit and
   * that is exactly the shape that drifts: the CRM's copy folded case and this one did not, so
   * the same thread offered Reply all on a lead and hid it on the account. What differs between
   * the two is only who counts as "not somebody else", which is the argument and not the rule.
   */
  return hasOthers(
    email.toRecipients,
    email.ccRecipients,
    /* Our own mailbox is not somebody else — every message we received was addressed to us — and
       neither is the debtor, who is already the To of an ordinary reply. */
    [email.ourAddress, email.debtorAddress].filter((a): a is string => !!a),
  )
}

/** The message itself, shared by the expanded row and the reading pane. */
function EmailBody({ email, canSend, userId, onReply, onReplyAll, onForward, onUnread }: {
  email: AccountEmail
  canSend: boolean
  /** Who is looking, because only the agent a message arrived for may unread it. */
  userId: string | null
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
  onUnread: () => void
}) {
  const { session } = useAuth()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function download(filename: string) {
    const token = session?.access_token
    if (!token) return
    setBusy(filename)
    setError(null)
    try {
      // accountEmailId, not mailId: this is the account's copy, and the file comes from whichever
      // colleague's mailbox received it. See the route.
      await downloadAttachment({ accountEmailId: email.id, filename, accessToken: token })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const inbound = email.direction === 'in'

  return (
    <>
      {/*
        THE ACTIONS COME FIRST. They used to sit under the body, and the firm hit the obvious
        problem on a long message: "if you want to reply, you have to go all the way down."
      */}
      <MessageActions
        canSend={canSend}
        /* Item 1(a) on everything that leaves, so the button says what it costs before it is
           pressed rather than after. Fees are charged on ACCOUNTS ONLY -- this is an account. */
        replyNote="R25"
        onReply={inbound ? onReply : null}
        onReplyAll={inbound && othersOn(email) ? onReplyAll : null}
        /* Offered on our own sent mail too. Passing on what WE said to a client or an attorney
           is as ordinary as passing on what the debtor said. */
        onForward={onForward}
        /*
          Only the agent it actually arrived for, which is all the RLS policy permits. Offering
          it to anybody else would be a button that silently does nothing.
        */
        onMarkUnread={inbound && email.readAt && email.receivedBy && email.receivedBy === userId
          ? onUnread
          : null}
      />
      {/* `whitespace-pre-wrap` because an email's own line breaks are part of what it said —
          collapsing them turns a numbered arrangement into a paragraph. */}
      <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
        {email.body?.trim() || <span className="text-slate-400">No text in this message.</span>}
      </p>
      {email.attachmentNames.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {/*
            The files are still not copied into Raptor — see fetchAttachment in
            api/_lib/emailSync.ts — but they are now reachable. Each button fetches out of the
            mailbox the message arrived in and streams straight to the browser. A debtor's proof
            of income is the attachment a collector needs most, and until now the account could
            only tell you its name.
          */}
          <Paperclip size={11} className="text-slate-400" />
          {email.attachmentNames.map((name) => (
            <button key={name} onClick={() => void download(name)} disabled={busy === name}
              title={`Download ${name}`}
              className="inline-flex items-center gap-1 max-w-full text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50">
              {busy === name
                ? <Loader2 size={11} className="shrink-0 animate-spin" />
                : <Download size={11} className="shrink-0" />}
              <span className="truncate">{name}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-negative-700 mt-1.5">{error}</p>}
    </>
  )
}

function EmailRow({
  email, expanded, onToggle, canSend, userId, onReply, onReplyAll, onForward, onUnread,
}: {
  email: AccountEmail
  expanded: boolean
  onToggle: () => void
  canSend: boolean
  userId: string | null
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
  onUnread: () => void
}) {
  const unread = email.direction === 'in' && !email.readAt
  return (
    <li className={unread ? 'bg-positive-50/40' : undefined}>
      <button onClick={onToggle} aria-expanded={expanded}
        className="w-full text-left px-5 py-3 flex items-start gap-3 hover:bg-slate-50">
        <span className="min-w-0 flex-1"><EmailSummary email={email} /></span>
        <span className="shrink-0 pt-0.5 text-slate-400">
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
      </button>

      {expanded && (
        <div className="px-5 pb-4 pl-[3.75rem]">
          <EmailBody email={email} canSend={canSend} userId={userId}
            onReply={onReply} onReplyAll={onReplyAll}
            onForward={onForward} onUnread={onUnread} />
        </div>
      )}
    </li>
  )
}

const count = (n: number, word: string) => `${n} ${word}`
