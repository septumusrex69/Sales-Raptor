/**
 * What a phone call to a debtor costs, and what the timeline says about it.
 *
 * Pure, so the fee decision can be read and argued with without a database in front of you.
 * Annexure B prices two different things and the difference is the whole of this file.
 */
import { formatMoney } from '../data/mockData.ts'
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
 * Charged on a call the debtor did NOT answer -- the firm asked for it: "it charges a
 * consultation correctly, but it doesn't charge the telephone call". Their own history charges
 * it the same way: a R25 charge in August 2026 commented "WhatsApp Call - No Contact" (see
 * LEGACY_NAME_OVERRIDES in actionTariff.ts).
 *
 * NEVER both on one call, and that is the gazette's own doing rather than a policy of ours.
 * Item 2 is defined as the call "which is not a consultation", so a call cannot be an item 2 and
 * an item 7 at once: one conversation, one fee. An answered call is a consultation at R60; an
 * unanswered one is a phone call at R25. Between them every call now earns something, which is
 * what the firm was missing, without charging twice for a single act.
 */
export const ATTEMPT_ITEM_ID = '2'

/** What the debtor reads on the statement for a call that was not a conversation. */
export const ATTEMPT_DESCRIPTION = 'Telephone call'

/** What the timeline says when the call is placed. */
export function dialledNote(number: string, extension: string | null): string {
  const how = extension ? ` from extension ${extension}` : ''
  return `Called ${number}${how}. Charged once we know whether it was answered.`
}

/** What the timeline says once somebody confirms the debtor picked up. */
export function consultationNote(number: string, charge: ChargeOutcome | null): string {
  return `Consultation with the debtor on ${number}. ${earned(charge, '7')}`
}

/** What the timeline says when the call was placed and nobody picked up. */
export function noAnswerNote(number: string, charge: ChargeOutcome | null): string {
  return `No answer on ${number}. ${earned(charge, '2')}`
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
