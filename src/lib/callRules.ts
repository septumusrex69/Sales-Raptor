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

/**
 * ITEM 7 IS CHARGED FOR A CONVERSATION WITH ANYBODY WHO CAN SPEAK TO THE ACCOUNT, NOT ONLY WITH
 * THE DEBTOR. The firm's decision, taken after being shown the opposite reading.
 *
 * THE GAZETTE SAYS "Necessary consultation with debtor", and the narrow reading is that speaking
 * to somebody else is not that. The firm was shown it and overruled it: "you can charge the
 * consultation for anybody that you speak to because it's relating the debtor's affairs...
 * sometimes we have a consultation with the debtor's mother about the account, and then she would
 * take responsibility for that. Or it will be somebody in the company -- not the owner, but the
 * receptionist or the accounts lady making an agreement."
 *
 * AND THE COMPANY HALF OF THAT IS NOT A PREFERENCE, IT IS THE ONLY POSSIBLE READING. A company has
 * no voice of its own; there is no conversation to be had with the debtor itself, only with a
 * person who acts for it. On a company account "consultation with the debtor" MEANS the accounts
 * lady, or the clause describes work nobody could ever do.
 *
 * WRITTEN DOWN BECAUSE IT IS A DECISION RATHER THAN A DEDUCTION, same as the item 2 note above. If
 * the charge is ever taxed, this is where the reasoning is -- and the thing that makes it stand up
 * is the record beside it: who was spoken to, and what they said. See `spokeTo` on the call box.
 */
export const CONSULTATION_ITEM_NOTE =
  'Charged for a conversation about the account with anybody who can speak to it.'

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
export function consultationNote(number: string, spokeTo?: string | null): string {
  /*
   * WHO WAS SPOKEN TO, WHERE IT WAS NOT THE DEBTOR.
   *
   * THE FIRM: "sometimes we have a consultation with the debtor's mother about the account, and
   * then she would take responsibility for that. Or it will be somebody in the company -- not the
   * owner, but the receptionist or the accounts lady making an agreement."
   *
   * THE FEE DOES NOT TURN ON THIS -- see CONSULTATION_ITEM_NOTE, where the firm settled that any
   * conversation about the account is chargeable. The RECORD does, and in a way that matters more
   * than the money: "the mother agreed to pay R500 a month" is not the debtor promising anything,
   * and a receptionist cannot bind a company where a director can. A timeline that says only
   * "Consultation with the debtor" when it was neither is how an arrangement comes to be relied on
   * against somebody who never made one.
   *
   * IT IS ALSO WHAT MAKES THE CHARGE DEFENSIBLE. The firm's reading of item 7 is the wide one; the
   * thing that holds it up if it is ever taxed is a note saying who was consulted and about what.
   */
  const who = (spokeTo ?? '').trim()
  return who
    ? `Consultation on ${number} with ${who}, about the debtor's account.`
    : `Consultation with the debtor on ${number}.`
}

/** What the timeline says when nobody picked up. */
export function noAnswerNote(number: string): string {
  return `No answer on ${number}.`
}
