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
 * NOT ON ITS OWN. A message we send also raises item 6, because sending is corresponding — see
 * CORRESPONDENCE_ITEM_ID and sentEmailItems below.
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
 * One practical consequence to know about: on an INCOMING message this is raised by the sync,
 * with no person present, so it is the only fee on the system nobody clicks a button to create.
 * It is capped like any other — a written-off account and the items 1–7 ceiling both stop it —
 * and a message that earns nothing is still filed, marked unbilled.
 *
 * RAISED IN BOTH DIRECTIONS, at the firm's instruction. It was incoming-only until they said
 * otherwise: "any email that is sent for any data under anything that is matched charges a mail
 * and correspondence, because you're corresponding and you're sending an email." So a message we
 * send earns item 1(a) for the letter AND item 6 for the correspondence — R38 excluding VAT, not
 * R25 — and an exchange where the debtor then answers costs R51 rather than R38.
 *
 * Worth being plain that this is the firm's reading of the tariff and a broad one: item 6 is
 * "correspondence received and attended to", and "received" most naturally describes what
 * arrives. The firm's position is that answering a debtor is attending to correspondence
 * whichever way the letter travels. They were asked directly and confirmed it. If it is ever
 * queried, this paragraph is why the statement looks the way it does.
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

/**
 * Every Annexure B item a message we SEND raises, in the order they go on the statement.
 *
 * Pure and exported so the rule can be read, checked and argued with on its own — see
 * scripts/qa/check-emails.mjs, which prices this list against the gazetted schedule rather than
 * against a number written down twice.
 *
 * The order is the order they are charged in, and it matters at the ceiling: item 1(a) is the
 * letter itself and takes precedence, so where an account has room for only one of the two it is
 * the R25 that lands and the R13 that comes back unbilled.
 */
export const sentEmailItems = [
  { itemId: EMAIL_ITEM_ID, description: EMAIL_DESCRIPTION },
  { itemId: CORRESPONDENCE_ITEM_ID, description: CORRESPONDENCE_DESCRIPTION },
] as const

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
