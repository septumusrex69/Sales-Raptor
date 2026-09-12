import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Mail, MailOpen, Paperclip, Reply } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { formatMoney } from '../../data/mockData'
import { relativeDayLabel } from '../../lib/dateLabels'
import type { AccountEmail } from '../../lib/accountEmails'

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
export function EmailsPanel({ emails, focusId, canSend, onCompose, onReply }: {
  emails: AccountEmail[]
  /**
   * One message to open on arrival, from the Messages menu's `?email=` link.
   *
   * Without it, following "Ryno replied" lands on a list with the reply collapsed somewhere in
   * it, which is the same as not linking to it at all.
   */
  focusId?: string | null
  /** False when the agent has no mailbox connected — the buttons say so rather than failing. */
  canSend: boolean
  onCompose: () => void
  onReply: (email: AccountEmail) => void
}) {
  // Newest open by default; the linked one instead when we were sent here to read it.
  const [open, setOpen] = useState<string | null>(focusId ?? emails[0]?.id ?? null)
  // The list arrives empty on the first render and fills in after the fetch, so the id has to be
  // applied when it lands rather than only at mount.
  useEffect(() => { if (focusId) setOpen(focusId) }, [focusId])

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
          <SendButton canSend={canSend} onClick={onCompose} className="mt-4" />
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
        <SendButton canSend={canSend} onClick={onCompose} />
      </div>

      <ul className="divide-y divide-slate-100">
        {emails.map((e) => (
          <EmailRow key={e.id} email={e} expanded={open === e.id}
            onToggle={() => setOpen(open === e.id ? null : e.id)}
            canSend={canSend} onReply={() => onReply(e)} />
        ))}
      </ul>
    </Card>
  )
}

function EmailRow({ email, expanded, onToggle, canSend, onReply }: {
  email: AccountEmail
  expanded: boolean
  onToggle: () => void
  canSend: boolean
  onReply: () => void
}) {
  const inbound = email.direction === 'in'
  const Icon = inbound ? MailOpen : Mail
  return (
    <li>
      <button onClick={onToggle}
        className="w-full text-left px-5 py-3 flex items-start gap-3 hover:bg-slate-50">
        {/* Inbound takes the positive colour, like a payment does: the debtor made contact, which
            is the outcome the whole account is trying to produce. */}
        <span className={`mt-0.5 shrink-0 grid place-items-center w-7 h-7 rounded-full ${
          inbound ? 'bg-positive-50 text-positive' : 'bg-brand-50 text-brand-500'}`}>
          <Icon size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-slate-800 truncate">
              {email.subject || '(no subject)'}
            </span>
            {email.attachmentNames.length > 0 && (
              <Paperclip size={12} className="shrink-0 text-slate-400" />
            )}
          </span>
          <span className="block text-xs text-slate-400 mt-0.5 truncate">
            {inbound ? 'From' : 'To'} {email.debtorAddress}
            {' · '}{relativeDayLabel(email.occurredAt)}
            {email.sentByName && !inbound && <> · {email.sentByName}</>}
          </span>
        </span>
        <span className="shrink-0 flex items-center gap-2 pt-0.5">
          {/*
            Both directions carry a fee — R25 out under item 1(a), R13 in under item 6 — so a
            figure here is the ordinary case. Zero is a message that earned nothing because a cap
            left no room; it is greyed rather than hidden, because the message still happened and
            the statement still shows it as unbilled. Null means no fee was ever recorded at all,
            which on an inbound row means the charge failed and a R13 is owing by hand.
          */}
          {email.chargedExclVat !== null && (
            <span className={`text-[11px] tabular-nums ${
              email.chargedExclVat > 0 ? 'text-slate-500' : 'text-slate-300'}`}>
              {email.chargedExclVat > 0 ? formatMoney(email.chargedExclVat) : 'no charge'}
            </span>
          )}
          {expanded ? <ChevronDown size={15} className="text-slate-400" />
            : <ChevronRight size={15} className="text-slate-400" />}
        </span>
      </button>

      {expanded && (
        <div className="px-5 pb-4 pl-[3.75rem]">
          {/* The message as it was written. `whitespace-pre-wrap` because an email's own line
              breaks are part of what it said — collapsing them turns a numbered arrangement
              into a paragraph. */}
          <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
            {email.body?.trim() || <span className="text-slate-400">No text in this message.</span>}
          </p>
          {email.attachmentNames.length > 0 && (
            <p className="text-xs text-slate-400 mt-3">
              {/* Names only. The files stay in the mailbox they arrived in — see fetchAttachment
                  in api/_lib/emailSync.ts for why they are not copied into Raptor. */}
              <Paperclip size={11} className="inline mr-1" />
              {email.attachmentNames.join(', ')}
            </p>
          )}
          {inbound && (
            <button onClick={onReply} disabled={!canSend}
              title={canSend ? undefined : 'Connect your mailbox in Settings → Integrations first'}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:bg-transparent">
              <Reply size={13} /> Reply · R25
            </button>
          )}
        </div>
      )}
    </li>
  )
}

function SendButton({ canSend, onClick, className = '' }: {
  canSend: boolean; onClick: () => void; className?: string
}) {
  return (
    <button onClick={onClick} disabled={!canSend}
      title={canSend ? undefined : 'Connect your mailbox in Settings → Integrations first'}
      className={`inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 disabled:opacity-40 ${className}`}>
      <Mail size={14} /> Write to them
    </button>
  )
}

const count = (n: number, word: string) => `${n} ${word}`
