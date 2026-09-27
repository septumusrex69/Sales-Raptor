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
 * A PERUSAL OF DOCUMENTS, ONCE A DAY.
 *
 * THE FIRM: "we should add a fee perusal of documents. This is any time anybody saves a document
 * or opens a document, but limited to one a day. So one charge a day. Can't be more than one
 * perusal of documents in a day. This includes a trace and everything else."
 *
 * ONE FUNCTION SO THE THREE PLACES CANNOT NAME IT THREE WAYS. Saving a document, opening one and
 * reading a trace report are the same fee, and a description written out at each call site is how
 * one statement comes to carry "Perusal", "Perusal of documents" and "Document opened" for one
 * kind of work.
 *
 * THE ONCE-A-DAY IS NOT HERE. It is DAILY_LIMIT, read by the engine, for the same reason the
 * monthly allowances are: a cap enforced at the call site is a cap the next call site forgets.
 * Every one of these calls goes out expecting to be refused most days, and `reason` says which.
 *
 * NEVER THROWS. A document has to save and a document has to open; a fee that will not write is
 * something to report afterwards, not a reason to refuse somebody the file they asked for. Null
 * is what the caller gets, and the caller says so.
 */
export async function chargePerusal(input: {
  accountId: string
  createdBy?: string | null
  at?: Date
}): Promise<ChargeResult | null> {
  try {
    return await chargeItem({
      accountId: input.accountId,
      itemId: PERUSAL_ITEM_ID,
      actionCode: 'perusal',
      description: PERUSAL_DESCRIPTION,
      createdBy: input.createdBy ?? null,
      at: input.at,
    })
  } catch (e) {
    console.error('[perusal] the document was handled but the fee was not raised:', e)
    return null
  }
}

/**
 * Item 3, "other necessary expenses not specifically provided for".
 *
 * NOT A GUESS. `perusal` has been mapped to item 3 since the import, with four schedules of rates
 * behind it -- see actionTariff.ts, where the mapping is recorded with its evidence -- and raising
 * a dispute has charged exactly this pair all along.
 */
export const PERUSAL_ITEM_ID = '3'

/** What the debtor reads on the statement. The firm's own words for it. */
export const PERUSAL_DESCRIPTION = 'Perusal of documents'
