/* `.ts` spelled out, because the check script beside this file imports it through Node's own
   resolver and Node does not guess extensions. See CLAUDE.md. */
import { relativeDayLabel } from './dateLabels.ts'

export interface ParsedEmailActivity {
  direction: 'sent' | 'received'
  isSpam: boolean
  /** The email's own subject line, with the CRM's own "Email sent:"/"Email received:" framing stripped off. */
  subject: string
}

const PREFIXES: { prefix: string; direction: ParsedEmailActivity['direction']; isSpam: boolean }[] = [
  { prefix: 'Email received (was in Spam/Junk): ', direction: 'received', isSpam: true },
  { prefix: 'Email received: ', direction: 'received', isSpam: false },
  { prefix: 'Email sent: ', direction: 'sent', isSpam: false },
]

/**
 * The heading a run of emails sits under, so each row shows just a time instead of repeating
 * the full date twenty-one times down the list. Shares one definition with the leads and deals
 * tables — a date should read the same wherever it appears.
 */
export function emailDayLabel(iso: string): string {
  return relativeDayLabel(iso)
}

/** Just the clock time — the day heading above the row carries the date. */
export function emailTimeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Parses an Activity's stored `subject` (see ComposeEmailModal.tsx / emailSync.ts) back into direction + the email's real subject. Returns null for anything not logged in that convention. */
export function parseEmailActivity(rawSubject: string): ParsedEmailActivity | null {
  for (const { prefix, direction, isSpam } of PREFIXES) {
    if (rawSubject.startsWith(prefix)) return { direction, isSpam, subject: rawSubject.slice(prefix.length) }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Answering one, from the record it is filed on.
 * ------------------------------------------------------------------ */

/** Reply, reply-all or forward — the three ways of answering a message that is already filed. */
export type AnswerMode = 'reply' | 'replyAll' | 'forward'

/** One person on a header line. Same shape the mailbox and the account's copy already use. */
export interface Recipient {
  name: string | null
  address: string
}

/** How the composer should open. Fed straight into ComposeEmailModal's props. */
export interface ComposeOpening {
  mode: AnswerMode
  /** Empty on a forward: the person it is going to was not in the conversation. */
  to: string
  cc: string
  subject: string
  /** Only a forward carries the original — see below. */
  body?: string
  /** Only a reply threads. A forward must not, or it lands inside a thread nobody has seen. */
  inReplyTo: string | null
}

/**
 * What the composer opens with, given a filed message and which button was pressed.
 *
 * ONE FUNCTION FOR THREE PAGES. A lead, a deal and a client all show the same email card and all
 * three answer mail the same way; written out three times, the reply-all on the deal page ends up
 * dropping somebody the client page keeps. Pure and testable, which is the point — the failure
 * modes here (copying yourself back into your own thread, quietly dropping a recipient) are
 * invisible on screen and obvious in a check.
 *
 * WHY A FORWARD IS THE ONLY ONE THAT QUOTES. A reply goes to somebody who already has the
 * message; quoting it back opens the box with two layers of "> " before anybody has typed a word,
 * which is exactly why it was removed from the account composer. A forward goes to somebody who
 * was never in the conversation and is unreadable without it.
 */
export function openingFor(
  message: {
    /** The activity's stored subject, framing and all. Parsed here so callers do not have to. */
    rawSubject: string
    /** Who wrote it, on a received message. Null on one we sent. */
    fromName: string | null
    fromAddress: string | null
    to: Recipient[]
    cc: Recipient[]
    body: string
    occurredAt: string
    messageId: string | null
  },
  mode: AnswerMode,
  /** Every address that is US, so a reply-all never copies the sender back to themselves. */
  mine: string[],
): ComposeOpening {
  const subject = parseEmailActivity(message.rawSubject)?.subject ?? message.rawSubject
  const from: Recipient = { name: message.fromName, address: message.fromAddress ?? '' }

  if (mode === 'forward') {
    return {
      mode,
      to: '',
      cc: '',
      subject: forwardSubjectOf(subject),
      body: forwardedOriginal(from, subject, message.occurredAt, message.body),
      inReplyTo: null,
    }
  }

  const everyone = mode === 'replyAll' ? othersBesides(message.to, message.cc, [...mine, from.address]) : []
  return {
    mode,
    to: from.address,
    cc: everyone.map(headerName).join(', '),
    subject: replySubjectOf(subject),
    inReplyTo: message.messageId,
  }
}

/**
 * Everyone on the message who is neither us nor the person we are already replying to.
 *
 * Case-folded on the address, because a mail server does not care about case and the same person
 * is routinely written three ways across one thread. Both failure modes are silent: leaving our
 * own address in doubles the thread every round, and dropping somebody turns a reply-all into a
 * private reply wearing a reply-all's label.
 */
export function othersBesides(to: Recipient[], cc: Recipient[], exclude: string[]): Recipient[] {
  const key = (a: string) => a.trim().toLowerCase()
  const skip = new Set(exclude.map(key).filter((a) => a !== ''))
  const seen = new Set<string>()
  const out: Recipient[] = []
  for (const person of [...to, ...cc]) {
    const k = key(person.address ?? '')
    if (k === '' || skip.has(k) || seen.has(k)) continue
    seen.add(k)
    out.push(person)
  }
  return out
}

/** Whether a reply-all would actually reach anybody a plain reply would not. */
export function hasOthers(to: Recipient[], cc: Recipient[], exclude: string[]): boolean {
  return othersBesides(to, cc, exclude).length > 0
}

const headerName = (p: Recipient): string => (p.name ? `${p.name} <${p.address}>` : p.address)

/** Idempotent, so answering a reply to a reply does not produce "Re: Re: Re:". */
function replySubjectOf(subject: string): string {
  const clean = subject.trim()
  if (!clean) return 'Re:'
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`
}

/** Idempotent too. "Re:" is left alone: forwarding a reply is still a forward of that reply. */
function forwardSubjectOf(subject: string): string {
  const clean = subject.trim()
  if (!clean) return 'Fwd:'
  return /^fwd:/i.test(clean) ? clean : `Fwd: ${clean}`
}

/** Headers first — a forward without them is a wall of text nobody can place. */
function forwardedOriginal(
  from: Recipient, subject: string, occurredAt: string, body: string,
): string {
  const who = from.name?.trim() || from.address || 'Unknown sender'
  const when = new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(occurredAt))
  return [
    '',
    '---------- Forwarded message ----------',
    `From: ${who}${from.address ? ` <${from.address}>` : ''}`,
    `Date: ${when}`,
    `Subject: ${subject.trim() || '(no subject)'}`,
    '',
    body.trim(),
  ].join('\n')
}
