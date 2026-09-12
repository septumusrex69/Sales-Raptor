/**
 * What an email to a debtor costs, and what the timeline says about it.
 *
 * Pure, so the fee decision can be read and argued with without a database in front of you, and
 * so the inbound sync can compose the same words the browser does.
 */
// `.js`, because this module is imported by api/_lib/emailSync.ts. See the note at the top of
// chargeEngine.ts: Vercel ships transpiled files, so a `.ts` specifier survives into the output
// and points at nothing. Run this file's QA script with scripts/qa/tsresolve.mjs.
import { formatMoney } from '../data/mockData.js'
import type { ChargeOutcome } from './promiseRules.js'

/**
 * Item 1(a): "Necessary ordinary letter, registered letter, facsimile or e-mail." R25 excluding
 * VAT under the 2026 schedule.
 *
 * Charged on every message we SEND, at the firm's instruction: "25 rand for every email sent or
 * responded to". Both halves of that describe an outgoing message — a fresh email and a reply are
 * each a letter under 1(a) — so a reply charges exactly as a first email does.
 *
 * What arrives charges nothing by itself. That is deliberate and it is the tariff's own shape:
 * the item for incoming post is item 6, "correspondence received AND ATTENDED TO", and it is
 * R13, not R25. Nothing here raises it, because whether a message was attended to is a fact
 * about a person's afternoon and not about an email arriving. In practice the reply is the
 * attending, and the reply bills at R25.
 */
export const EMAIL_ITEM_ID = '1a'

/** Our action catalogue code, for the timeline's icon and for reconciliation. */
export const EMAIL_ACTION_CODE = 'email'

/** What the debtor reads on the statement. */
export const EMAIL_DESCRIPTION = 'Email'

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
export function sentEmailNote(to: string, subject: string, body: string, charge: ChargeOutcome | null): string {
  return `Email to ${to}\nSubject: ${subject || '(no subject)'}\n\n${body.trim()}\n\n${earned(charge)}`
}

/**
 * What the timeline says when the debtor writes back.
 *
 * No fee named at all, not even "not charged" — there is no fee to explain. Saying "not charged"
 * on an inbound message would read as a charge that failed rather than one that was never due.
 */
export function receivedEmailNote(from: string, subject: string, body: string): string {
  return `Email from ${from}\nSubject: ${subject || '(no subject)'}\n\n${body.trim()}`
}

/** What a charge came to, or why it did not happen, in one sentence. */
function earned(charge: ChargeOutcome | null): string {
  if (!charge) return 'Not charged.'
  switch (charge.reason) {
    case 'charged': return `Charged ${formatMoney(charge.exclVat)} plus VAT under item 1(a).`
    case 'written-off': return 'Not charged — the account is written off.'
    case 'item-total-spent': return 'Not charged — item 1(a) has already been used on this account.'
    case 'monthly-limit': return 'Not charged — the monthly allowance for item 1(a) is spent.'
    default: return 'Not charged — the account is at the Annexure B fee ceiling.'
  }
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
