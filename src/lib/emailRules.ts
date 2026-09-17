/**
 * What an email to a debtor costs, and what the timeline says about it.
 *
 * Pure, so the fee decision can be read and argued with without a database in front of you, and
 * so the inbound sync can compose the same words the browser does.
 */

/**
 * Item 1(a): "Necessary ordinary letter, registered letter, facsimile or e-mail." R25 excluding
 * VAT under the 2026 schedule.
 *
 * Charged on every message we SEND, at the firm's instruction: "25 rand for every email sent or
 * responded to". Both halves of that describe an outgoing message — a fresh email and a reply are
 * each a letter under 1(a) — so a reply charges exactly as a first email does.
 *
 * What ARRIVES is charged separately, under item 6 — see CORRESPONDENCE_ITEM_ID.
 */
export const EMAIL_ITEM_ID = '1a'

/** Our action catalogue code, for the timeline's icon and for reconciliation. */
export const EMAIL_ACTION_CODE = 'email'

/** What the debtor reads on the statement. */
export const EMAIL_DESCRIPTION = 'Email'

/**
 * Item 6: "Correspondence received and attended to." R13 excluding VAT under the 2026 schedule.
 *
 * Raised on every email a debtor sends us, at the firm's instruction: "for every email received,
 * there's also a correspondence fee." So an exchange where we write and they answer costs the
 * debtor R25 under item 1(a) and R13 under item 6.
 *
 * Worth writing down that this is the firm's reading and not the only one available. The gazette
 * says "received AND ATTENDED TO", and on a strict reading the fee is earned by an agent dealing
 * with the message rather than by it landing in a mailbox — an out-of-office or a one-line
 * "received, thanks" would then earn nothing. The firm was shown that reading and chose to
 * charge on receipt. If the charge is ever queried, this comment is the reason it looks the way
 * it does.
 *
 * One practical consequence to know about: this is raised by the inbound sync, with no person
 * present, so it is the only fee on the system nobody clicks a button to create. It is capped
 * like any other — a written-off account and the items 1–7 ceiling both stop it — and a message
 * that earns nothing is still filed, marked unbilled.
 */
export const CORRESPONDENCE_ITEM_ID = '6'

/** Its own action code, so the statement and the timeline can tell the two directions apart. */
export const CORRESPONDENCE_ACTION_CODE = 'email_in'

/**
 * What the debtor reads on the statement.
 *
 * Just "Correspondence". The direction is already obvious from a debtor's own statement — they
 * know which letters they sent — and "Correspondence received" beside "Email" read like two
 * different kinds of thing rather than the two halves of one exchange.
 */
export const CORRESPONDENCE_DESCRIPTION = 'Correspondence'

/** Note kinds, which is how the timeline knows to draw an envelope rather than a sticky note. */
export const EMAIL_OUT_KIND = 'email_out'
export const EMAIL_IN_KIND = 'email_in'

/**
 * The whole of a message, in the order someone reads it.
 *
 * The body is included rather than summarised because the note IS the record: a collector
 * scanning two years of history to find what the debtor was actually told should not have to open
 * anything. The Emails tab shows the same message with its own structure.
 */
export function sentEmailNote(to: string, subject: string, body: string): string {
  return `Email to ${to}\nSubject: ${subject || '(no subject)'}\n\n${body.trim()}`
}

/**
 * What the timeline says when the debtor writes back.
 *
 */
export function receivedEmailNote(from: string, subject: string, body: string): string {
  return `Email from ${from}\nSubject: ${subject || '(no subject)'}\n\n${body.trim()}`
}

/**
 * A subject line for replying to one.
 *
 * Kept idempotent, so replying to a reply to a reply does not produce "Re: Re: Re:". Mail clients
 * differ on this and several will happily stack them; a debtor's inbox should not show our thread
 * turning into a stutter.
 */
export function replySubject(subject: string | null): string {
  const clean = (subject ?? '').trim()
  if (!clean) return 'Re:'
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`
}

/**
 * The subject of a forwarded message.
 *
 * Idempotent like replySubject, and for the same reason: a message passed along twice should not
 * arrive as "Fwd: Fwd:". "Re:" is deliberately left alone — forwarding a reply is still a
 * forward of that reply, and stripping it would lose which turn of the thread was passed on.
 */
export function forwardSubject(subject: string | null): string {
  const clean = (subject ?? '').trim()
  if (!clean) return 'Fwd:'
  return /^fwd:/i.test(clean) ? clean : `Fwd: ${clean}`
}

/**
 * The original, quoted under a forward.
 *
 * Headers first, because a forward without them is a wall of text nobody can place — who sent
 * it, when, and what it said it was about are the whole reason it is being passed on.
 *
 * Plain text and plainly marked. The mailbox holds a snippet rather than the full body, so where
 * only the snippet is available this says so instead of quietly sending a truncated message and
 * letting the recipient assume that was all of it.
 */
export function forwardBody(
  original: { fromName: string | null; fromAddress: string; subject: string | null; occurredAt: string },
  body: string,
  /** False where only the stored snippet was available. */
  complete = true,
): string {
  const who = original.fromName?.trim() || original.fromAddress
  const when = new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(original.occurredAt))
  return [
    '',
    '---------- Forwarded message ----------',
    `From: ${who} <${original.fromAddress}>`,
    `Date: ${when}`,
    `Subject: ${(original.subject ?? '').trim() || '(no subject)'}`,
    '',
    body.trim(),
    complete ? '' : '\n[Only the stored preview of this message was available.]',
  ].join('\n')
}

/**
 * Every Message-ID a reply names, newest first.
 *
 * In-Reply-To is the direct parent and is checked first. References is checked as well because
 * some clients drop In-Reply-To entirely, and it is walked in reverse so a long thread resolves
 * to its most recent turn rather than the message that started it two months ago.
 */
export function threadIds(inReplyTo: string | null | undefined, references: string | string[] | null | undefined): string[] {
  const ids: string[] = []
  if (inReplyTo) ids.push(...inReplyTo.split(/\s+/).filter(Boolean))
  if (references) {
    const list = Array.isArray(references) ? references : references.split(/\s+/)
    ids.push(...list.filter(Boolean).reverse())
  }
  return ids.map((id) => id.trim()).filter(Boolean)
}

/**
 * Is this address one we would file against a debtor?
 *
 * Normalised the way a mail server treats it — case-insensitively, and trimmed of the display
 * name a From header wraps it in ("Ryno Buitendag <ryno@example.co.za>"). Without this the
 * lookup misses every reply whose client capitalises the local part.
 */
export function normaliseAddress(raw: string | null | undefined): string | null {
  if (!raw) return null
  const angled = raw.match(/<([^>]+)>/)
  const address = (angled ? angled[1] : raw).trim().toLowerCase()
  return address.includes('@') ? address : null
}

/* ---------- mail our own systems produced ---------- */

/**
 * Whether a message is a bounce or an out-of-office rather than something a person wrote.
 *
 * WHY THIS HAD TO EXIST. An inbound message is matched to an account by the Message-ID it quotes
 * in References or In-Reply-To, and nothing checked who sent it. A Mail Delivery Subsystem
 * failure notice for a demand letter quotes that id — so the bounce was filed on the debtor's
 * account as their correspondence, put on their timeline in the daemon's name, and charged R13
 * under item 6.
 *
 * That is money on a real debtor's statement for our own mail server talking to itself, and it
 * counts toward the items 1-7 ceiling, so it also displaces a fee the firm could have charged.
 * Once remittance has run it cannot be taken off.
 *
 * DELIBERATELY CONSERVATIVE, and the direction of the error is the reason. A bounce read as a
 * reply costs the debtor R13 and puts a wrong line on their timeline. A REPLY READ AS A BOUNCE
 * loses the debtor's own words — the thing the account exists to record. So this fires only on
 * signals that cannot be produced by a person typing a message:
 *
 *   - a null Return-Path, which is how the standards require a bounce to be sent so that it
 *     cannot itself bounce, and which no ordinary mail carries;
 *   - a delivery-status report, which is the machine-readable bounce format;
 *   - X-Failed-Recipients, which only a failing relay adds;
 *   - Auto-Submitted anything-but-'no', which RFC 3834 defines for exactly this purpose;
 *   - a sender of mailer-daemon or postmaster.
 *
 * `Precedence: bulk` is NOT here although it would catch more. Mailing lists set it, and so do
 * some legitimate senders — a debtor's message must never be discarded because their employer's
 * mail server is chatty.
 */
export type AutomatedMail = 'bounce' | 'auto_reply'

export function automatedMailKind(headers: {
  from?: string | null
  returnPath?: string | null
  autoSubmitted?: string | null
  contentType?: string | null
  failedRecipients?: string | null
  autoReply?: string | null
}): AutomatedMail | null {
  const from = (headers.from ?? '').toLowerCase()
  const returnPath = (headers.returnPath ?? '').trim()
  const contentType = (headers.contentType ?? '').toLowerCase()

  /*
   * The null sender. A bounce is sent from <> precisely so that a bounce of a bounce cannot
   * loop — it is the one header on this list that is definitional rather than conventional.
   */
  if (returnPath === '<>' || returnPath === '') {
    /* An absent Return-Path is not a null one: plenty of mail reaches us without the header. */
    if (headers.returnPath !== undefined && headers.returnPath !== null) return 'bounce'
  }
  if (/multipart\/report/.test(contentType) && /delivery-status/.test(contentType)) return 'bounce'
  if ((headers.failedRecipients ?? '').trim() !== '') return 'bounce'
  /* The two mailbox names reserved by the standards for a mail system talking about itself. */
  if (/(^|[<\s:])(mailer-daemon|postmaster)@/.test(from)) return 'bounce'

  /* RFC 3834: anything other than 'no' means a machine composed it. */
  const auto = (headers.autoSubmitted ?? '').trim().toLowerCase()
  if (auto !== '' && auto !== 'no') return 'auto_reply'
  if ((headers.autoReply ?? '').trim() !== '') return 'auto_reply'
  return null
}

/**
 * What the account's timeline says about a message we did not file.
 *
 * IT IS STILL WORTH KNOWING, which is why this exists rather than the message being dropped. A
 * demand letter that bounced did not arrive, and a collector about to ring and ask why there has
 * been no answer needs to know the letter never got there. An out-of-office is weaker but still
 * tells them when somebody is back.
 *
 * Written as OUR record, in our voice — the daemon is not the debtor and must not appear on the
 * timeline as though it were.
 */
export function automatedMailNote(kind: AutomatedMail, subject: string | null): string {
  const about = (subject ?? '').trim()
  const tail = about ? ` Subject: "${about}".` : ''
  return kind === 'bounce'
    ? `An email we sent could not be delivered.${tail} No correspondence fee has been raised — this is our mail system reporting a failure, not the debtor writing to us.`
    : `An automatic reply came back to an email we sent.${tail} No correspondence fee has been raised — nobody wrote it.`
}

/* ------------------------------------------------------------------ *
 * Replying to everybody.
 * ------------------------------------------------------------------ */

export interface Recipient { name: string | null; address: string }

/**
 * Who a reply-all goes to.
 *
 * THE FIRM ASKED FOR IT: "I also can't respond to all recipients." A debtor who copies their
 * attorney, or a client who copies two of their own people, arrived looking like a private
 * message and Reply answered the sender alone -- so the attorney never saw the answer to the
 * question they were copied on.
 *
 * THE TWO WAYS THIS GOES WRONG, and both are worse than not having the button:
 *
 *   - COPYING YOURSELF. Your own address is on the original, because it was sent to you. Left in,
 *     every reply-all puts a copy back in your own inbox and the thread doubles each round.
 *   - DROPPING SOMEBODY. The whole point is that everyone who saw the question sees the answer;
 *     a list that quietly loses one person is a private reply wearing a reply-all's label.
 *
 * Matched on the address, case-folded, because a mail server does not care about case and the
 * same person is routinely written three ways across one thread. `mine` is a list, not one
 * address: an agent's mail reaches them at their own address and at anything the firm forwards.
 *
 * Bcc is absent on purpose -- it is not in the message we received, so there is nobody to add.
 */
export function replyAllTo(input: {
  /** Who wrote it. Always the first recipient of the answer. */
  from: Recipient
  to: Recipient[]
  cc: Recipient[]
  /** Every address that is the person replying. Never copied back to themselves. */
  mine: string[]
}): { to: Recipient[]; cc: Recipient[] } {
  const key = (a: string) => a.trim().toLowerCase()
  const mine = new Set(input.mine.map(key).filter((a) => a !== ''))

  /* The sender leads, and is claimed here so the Cc pass cannot add them a second time. */
  const seen = new Set<string>([key(input.from.address)])
  const cc: Recipient[] = []

  for (const person of [...input.to, ...input.cc]) {
    const k = key(person.address)
    if (k === '' || seen.has(k) || mine.has(k)) continue
    seen.add(k)
    cc.push(person)
  }

  return { to: [input.from], cc }
}

/** One address list, as a header line reads: "Jane Smith <jane@x.co.za>, bob@y.co.za". */
export function recipientLine(people: Recipient[]): string {
  return people
    .map((p) => (p.name ? `${p.name} <${p.address}>` : p.address))
    .join(', ')
}

/**
 * A person's name, split into the two boxes a lead needs.
 *
 * Mail carries ONE name -- "Ernest Mohlalisi", or "Mohlalisi, Ernest", or nothing at all -- and a
 * lead wants a first name and a surname. Split here rather than in the modal so the awkward
 * cases are somewhere they can be argued with:
 *
 *  - "Mohlalisi, Ernest" is a surname-first form Outlook writes on its own, and reversing it is
 *    the difference between phoning "Mr Ernest" and phoning Mr Mohlalisi.
 *  - "Ernest van der Merwe" has a three-word surname. Everything after the first word is the
 *    surname, which is right far more often than taking the last word alone.
 *  - "info@" has no name behind it, and a blank is better than inventing one -- the person
 *    creating the lead is looking at the message and can type what it says.
 *
 * Nothing here is certain, which is why both halves land in editable boxes and not in the record.
 */
export function splitPersonName(name: string | null | undefined): { firstName: string; lastName: string } {
  const clean = (name ?? '').replace(/\s+/g, ' ').trim()
  if (clean === '') return { firstName: '', lastName: '' }

  /* Outlook's own ordering. The comma is the whole signal, and it is unambiguous. */
  const comma = clean.indexOf(',')
  if (comma > -1) {
    const surname = clean.slice(0, comma).trim()
    const rest = clean.slice(comma + 1).trim()
    if (surname && rest) return { firstName: rest, lastName: surname }
  }

  /*
   * A comma that was NOT an ordering -- "Mohlalisi," with nothing after it -- is punctuation left
   * behind by whatever wrote the header, and carrying it into the record puts it on the lead, on
   * every letter and on the invoice.
   */
  const parts = clean.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().split(' ')
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

/**
 * A company name to START from, read off the sender's domain.
 *
 * A GUESS, and offered as one: it lands in an editable box that the person creating the lead is
 * looking at while they read the message. "sasolburg-motors.co.za" becomes "Sasolburg Motors",
 * which is nearly always right and is always quicker to correct than to type.
 *
 * The caller decides whether to ask at all -- a gmail.com address says nothing about who somebody
 * works for, and "Gmail" as a company name would be worse than an empty box.
 */
export function companyFromDomain(domain: string | null | undefined): string {
  if (!domain) return ''
  /*
   * The South African suffixes as well as the international ones. Without co.za, every lead from
   * a local company would be called "Co" -- and nearly every company the firm deals with is local.
   */
  const bare = domain.toLowerCase()
    .replace(/^(www|mail|smtp|email)\./, '')
    .replace(/\.(co|com|net|org|gov|ac|web|edu)\.[a-z]{2}$/, '')
    .replace(/\.[a-z]{2,}$/, '')
  return bare
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
