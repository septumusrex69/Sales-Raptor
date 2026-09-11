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
 * Deliberately NOT charged, and worth writing down why rather than leaving a silence.
 *
 * Item 2 would cover a call that was necessary but was not a consultation -- a number dialled
 * that rang out, say. The firm's own history shows they have charged it that way at least once:
 * a R25 charge in August 2026 commented "WhatsApp Call - No Contact" (see LEGACY_NAME_OVERRIDES
 * in actionTariff.ts). But they did not ask for it here, they asked only for the consultation on
 * an answered call, and billing R25 every time somebody misdials is not a default to choose on
 * anyone's behalf. Under-charging is lawful; over-charging is not. Switch it on when they say so.
 */
export const ATTEMPT_ITEM_ID = '2'

/** What the timeline says when the call is placed. */
export function dialledNote(number: string, extension: string | null): string {
  const how = extension ? ` from extension ${extension}` : ''
  return `Called ${number}${how}. Nothing charged unless it is answered.`
}

/** What the timeline says once somebody confirms the debtor picked up. */
export function consultationNote(number: string, charge: ChargeOutcome | null): string {
  const earned = !charge
    ? 'Not charged.'
    : charge.reason === 'charged'
      ? `Charged ${formatMoney(charge.exclVat)} plus VAT under item 7.`
      : charge.reason === 'written-off'
        ? 'Not charged — the account is written off.'
        : charge.reason === 'item-total-spent'
          ? 'Not charged — item 7 has already been used on this account.'
          : charge.reason === 'monthly-limit'
            ? 'Not charged — the monthly allowance for item 7 is spent.'
            : 'Not charged — the account is at the Annexure B fee ceiling.'
  return `Consultation with the debtor on ${number}. ${earned}`
}

/** What the timeline says when the call was placed and nobody picked up. */
export function noAnswerNote(number: string): string {
  return `No answer on ${number}. Not charged.`
}
