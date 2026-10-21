/**
 * Raising a fee against an account, from the browser.
 *
 * The one place in the app that writes to the fee ledger, and deliberately narrow. accountBook.ts
 * is read-only because a balance assembled by several hands is a balance nobody can defend; this
 * exists so that when the app does have to charge something, the Annexure B arithmetic lives in
 * exactly one function rather than at every call site that fancies raising a fee.
 *
 * That function is now chargeEngine.ts, which takes the database as a parameter so the BuzzBox
 * webhook can charge with the service-role client when a call connects and no browser is open.
 * This file is the browser half: the same call with the anon client filled in. Every existing
 * caller keeps working unchanged, and there is still only one set of Annexure B rules.
 */
import { supabase } from './supabase'
import { chargeItemWith, type ChargeInput, type ChargeResult } from './chargeEngine.ts'

export { chargeMessage } from './chargeEngine.ts'
export type { ChargeResult } from './chargeEngine.ts'

/** Charge an Annexure B item to an account, respecting every cap. See chargeEngine.ts. */
export function chargeItem(input: ChargeInput): Promise<ChargeResult> {
  return chargeItemWith(supabase, input)
}

/**
 * NO PERUSAL OF DOCUMENTS, ANY MORE.
 *
 * THE FIRM (S10, 21 Oct): "Remove the perusal of documents fee completely: no new charges, the
 * setting and code gone, and existing perusal fees removed too (not credited)."
 *
 * There used to be a `chargePerusal` here, raising item 3 once a day whenever a document on an
 * account was saved, opened or downloaded, or a trace report read. It is gone rather than switched
 * off, because a fee behind a flag is a fee the next person turns back on. Saving, opening and
 * reading now charge nothing at all. `check-perusal` holds the absence, comments stripped first.
 *
 * The `perusal` ACTION CODE survives in actionTariff.ts for one reason only: Swordfish's imported
 * history carries it, and imported history is frozen at what was imported (CLAUDE.md). Raptor
 * raises none.
 */

/**
 * CONFIRMING A PTC — a debtor who paid the client direct.
 *
 * THE FIRM, correcting me: "You can charge a perusal fee for a PTC because the debtor has paid
 * into the client's account and it cost us administration to verify this... handle it as other
 * necessary expenses and call it a PTC confirmation."
 *
 * I HAD MADE THIS FREE AND THE REASONING WAS WRONG. I read the client's confirmation letter as the
 * FIRM's own evidence for raising a commission invoice, and therefore not something a debtor pays
 * for. But the work exists because the DEBTOR chose to pay somebody else: the firm has to obtain
 * the confirmation, read it, and satisfy itself the money is real before it moves a balance. That
 * is item 3 -- "other necessary expenses not specifically provided for".
 *
 * NOT SUBJECT TO ANY DAILY LIMIT, which is why it has its own action code. When this was written
 * the perusal of documents was capped at one a day; a PTC confirmation is one verification of one
 * payment, and two PTCs are two pieces of work. Sharing a capped code (today that is `dispute`)
 * would make the second PTC of a day free.
 *
 * RAISED AFTER THE PAYMENT IS RECORDED, never before: a PTC that would not save has not been
 * confirmed, and charging for it first is how a debtor pays for work nobody did.
 *
 * NEVER THROWS: the payment is the thing that matters and a fee that will not write is something to
 * report afterwards.
 */
export async function chargePtcConfirmation(input: {
  accountId: string
  createdBy?: string | null
  at?: Date
}): Promise<ChargeResult | null> {
  try {
    return await chargeItem({
      accountId: input.accountId,
      itemId: OTHER_EXPENSES_ITEM_ID,
      actionCode: 'ptc_confirmation',
      description: PTC_CONFIRMATION_DESCRIPTION,
      createdBy: input.createdBy ?? null,
      at: input.at,
    })
  } catch (e) {
    console.error('[ptc] the payment was recorded but the confirmation fee was not raised:', e)
    return null
  }
}

/**
 * Item 3 again, under its own name.
 *
 * THE ONLY NAME IT HAS NOW. It used to be `PERUSAL_ITEM_ID` too, which read as though item 3 WERE
 * the perusal item. It is "other necessary expenses not specifically provided for" -- a dispute
 * and a PTC confirmation both land on it -- and since the firm removed the perusal fee (S10) the
 * old name went with it, so the constant says what the ITEM is.
 */
export const OTHER_EXPENSES_ITEM_ID = '3'

/** What the debtor reads on the statement. The firm's own words for it. */
export const PTC_CONFIRMATION_DESCRIPTION = 'PTC confirmation'

/**
 * AN ACKNOWLEDGEMENT OF DEBT, ISSUED.
 *
 * THE FIRM: "it should charge the fee in accordance with acknowledgement of debt... the moment
 * that thing is issued, or sent via an email, it charges on top of the email or any necessary
 * correspondence -- it charges the acknowledgement of debt. And the two different fees that I
 * added, it depends on the amount: it's below 50,000 and over 50,000 for the claim amount."
 *
 * ON ISSUE, NOT ON SIGNATURE, which is the firm's own word and is also the only defensible
 * moment. Item 4(a) prices "acknowledgement of debt and undertaking to pay (section 57 or 58),
 * INCLUDING THE NECESSARY CONSULTATION" -- the work it pays for is drawing the instrument and
 * talking the debtor through it, all of which has happened by the time the link goes out. A
 * debtor who reads it and refuses has still had the consultation.
 *
 * ON TOP OF THE EMAIL, not instead of it. Sending it is item 1(a) at R25 and is charged by the
 * composer exactly as any other email is; this is a second, different piece of work and the
 * firm said so in as many words ("it charges on top of the email").
 *
 * BANDED ON THE CLAIM, which the caller passes -- see ChargeInput.debtAmount for why it is not
 * read off the account here.
 *
 * NEVER THROWS, for the reason chargePtcConfirmation does not: the document has been issued and the link
 * is in somebody's hands. A fee that would not write is something to report afterwards, never a
 * reason to pretend the acknowledgement was not sent.
 */
export async function chargeAcknowledgementOfDebt(input: {
  accountId: string
  /** The claim the acknowledgement states. Decides which of the two bands applies. */
  claimAmount: number
  createdBy?: string | null
  at?: Date
}): Promise<ChargeResult | null> {
  try {
    return await chargeItem({
      accountId: input.accountId,
      itemId: ACKNOWLEDGEMENT_OF_DEBT_ITEM_ID,
      actionCode: 'acknowledgement_of_debt',
      description: ACKNOWLEDGEMENT_OF_DEBT_DESCRIPTION,
      debtAmount: input.claimAmount,
      createdBy: input.createdBy ?? null,
      at: input.at,
    })
  } catch (e) {
    console.error('[aod] the document was issued but the fee was not raised:', e)
    return null
  }
}

/** Item 4(a). Priced by the Magistrates' Courts Rules rather than by the Annexure itself. */
export const ACKNOWLEDGEMENT_OF_DEBT_ITEM_ID = '4a'

/** What the debtor reads on the statement. The gazette's own words, shortened to fit a line. */
export const ACKNOWLEDGEMENT_OF_DEBT_DESCRIPTION = 'Acknowledgement of debt and undertaking to pay'
