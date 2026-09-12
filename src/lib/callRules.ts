/**
 * What a phone call to a debtor costs, and what the timeline says about it.
 *
 * Pure, so the fee decision can be read and argued with without a database in front of you.
 * Annexure B prices two different things and the difference is the whole of this file.
 */
// `.js`, because this module is imported by api/_lib/buzzbox/webhook.ts. See the note at the top
// of chargeEngine.ts: Vercel ships transpiled files, so a `.ts` specifier survives into the
// output and points at nothing. Run this file's QA script with scripts/qa/tsresolve.mjs.
import { formatMoney } from '../data/mockData.js'
import type { ChargeOutcome } from './promiseRules.ts'

/**
 * Item 7: "Necessary consultation with debtor." R60 excluding VAT under the 2026 schedule.
 *
 * Charged when the debtor actually answers and the call runs -- the firm's instruction: "the
 * moment that the person answers the call and that the call actually starts running, it should
 * automatically charge a consultation".
 */
export const CONSULTATION_ITEM_ID = '7'

/** What the debtor reads on the statement. */
export const CONSULTATION_DESCRIPTION = 'Consultation'

/**
 * Item 2: "Necessary phone call, which is not a consultation (per call)." R25.
 *
 * Charged on EVERY outgoing call, at the firm's instruction: "if we make an outgoing call, it's
 * charged, even if the person answers or not. If the person answers, a consultation and the
 * telephone call is charged." So an answered call carries both items and costs R85 excluding VAT.
 *
 * That is their decision and not a reading of the tariff, which is why it is written down here.
 * The gazette defines item 2 as the call "WHICH IS NOT a consultation", and the plain reading of
 * that is that an answered call carries item 7 INSTEAD of item 2, not as well as. The firm was
 * shown that reading and chose both. If the charge is ever queried, this is where the answer is.
 */
export const ATTEMPT_ITEM_ID = '2'

/** What the debtor reads on the statement for a call that was not a conversation. */
export const ATTEMPT_DESCRIPTION = 'Telephone call'

/** What the timeline says when the call is placed. */
export function dialledNote(number: string, extension: string | null, charge: ChargeOutcome | null): string {
  const how = extension ? ` from extension ${extension}` : ''
  return `Called ${number}${how}. ${earned(charge, '2')}`
}

/** What the timeline says once somebody confirms the debtor picked up. */
export function consultationNote(number: string, charge: ChargeOutcome | null): string {
  return `Consultation with the debtor on ${number}. ${earned(charge, '7')}`
}

/**
 * What the timeline says when nobody picked up.
 *
 * No fee named, because the dial already charged item 2 and its own line says so. Repeating it
 * here would read as a second R25 on a call that only earned one.
 */
export function noAnswerNote(number: string): string {
  return `No answer on ${number}.`
}

/**
 * What a charge came to, or why it did not happen, in one sentence.
 *
 * Shared by both notes so the two cannot drift into describing the same outcome differently --
 * an account at the ceiling should read the same whoever answered the phone.
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
