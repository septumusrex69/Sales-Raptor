/**
 * What a phone call to a debtor costs, and what the timeline says about it.
 *
 * Pure, so the fee decision can be read and argued with without a database in front of you.
 * Annexure B prices two different things and the difference is the whole of this file.
 */

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

/*
 * What the timeline says, and what it deliberately does NOT say.
 *
 * No fee. These notes used to end with "Charged R25,00 plus VAT under item 2." and the firm had
 * it removed: "don't have to say about the charges in the notes, it's on the transaction list."
 * They were right, and it was worse than redundant — every fee is already its own entry on this
 * same timeline as well as a line on Transactions, so a call appeared twice and the history read
 * like an invoice instead of a record of what happened.
 */

/** What the timeline says when the call is placed. */
export function dialledNote(number: string, extension: string | null): string {
  const how = extension ? ` from extension ${extension}` : ''
  return `Called ${number}${how}.`
}

/** What the timeline says once somebody confirms the debtor picked up. */
export function consultationNote(number: string): string {
  return `Consultation with the debtor on ${number}.`
}

/** What the timeline says when nobody picked up. */
export function noAnswerNote(number: string): string {
  return `No answer on ${number}.`
}
