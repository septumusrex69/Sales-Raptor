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
