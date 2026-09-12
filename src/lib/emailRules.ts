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

/** What the debtor reads on the statement. */
export const CORRESPONDENCE_DESCRIPTION = 'Correspondence received'

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
  return `Email to ${to}\nSubject: ${subject || '(no subject)'}\n\n${body.trim()}\n\n${earned(charge, '1(a)')}`
}

/**
 * What the timeline says when the debtor writes back.
 *
 * Carries its own fee line, under item 6 rather than item 1(a). A debtor reading their statement
 * sees two different charges for one exchange, and the timeline has to account for both or the
 * R13 looks like it came from nowhere.
 */
export function receivedEmailNote(from: string, subject: string, body: string, charge: ChargeOutcome | null): string {
  return `Email from ${from}\nSubject: ${subject || '(no subject)'}\n\n${body.trim()}\n\n${earned(charge, '6')}`
}

/**
 * What a charge came to, or why it did not happen, in one sentence.
 *
 * Shared by both directions so the two cannot drift into describing the same outcome
 * differently — an account at the ceiling should read the same whichever way the message went.
 */
function earned(charge: ChargeOutcome | null, item: string): string {
  if (!charge) return 'Not charged.'
  switch (charge.reason) {
    case 'charged': return `Charged ${formatMoney(charge.exclVat)} plus VAT under item ${item}.`
    case 'written-off': return 'Not charged — the account is written off.'
    case 'item-total-spent': return `Not charged — item ${item} has already been used on this account.`
    case 'monthly-limit': return `Not charged — the monthly allowance for item ${item} is spent.`
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
