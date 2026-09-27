/**
 * Taking a promise to pay: write it, charge for it, and say so on the timeline.
 *
 * The rules about what a promise may say live in promiseRules.ts, which touches no database.
 * This file is the part that does.
 */
import { chargeItem, type ChargeResult } from './accountCharges.ts'
import { addNote, addPromise, type PromiseToPay } from './accountWorkspace.ts'
import { promiseNote, PROMISE_DESCRIPTION, PROMISE_ITEM_ID } from './promiseRules.ts'
import type { Arrangement } from './arrangements.ts'
import { nudgeWorkflows } from './accountRun.ts'

export { promiseCeiling, promiseProblem, promiseNote, PROMISE_DESCRIPTION, PROMISE_ITEM_ID } from './promiseRules.ts'

/**
 * Take a promise.
 *
 * The charge comes after the write on purpose. A promise that was taken and not billed is a
 * bookkeeping problem; a fee raised against a promise that failed to save is a wrong statement.
 */
export async function recordPromise(input: {
  accountId: string
  amount: number
  dueOn: string
  arrangement: Arrangement
  dayOfMonth?: number | null
  onLastDay?: boolean
  dayOfWeek?: number | null
  method?: string | null
  notes?: string | null
  actor: { id: string | null; name: string | null }
  /**
   * THE CALLER'S SESSION, SO THE CONFIRMATION GOES OUT ON THE PRESS.
   *
   * THE FIRM, HAVING RECORDED ONE: "I've recorded a promise now on Stella Artwa, but it didn't
   * trigger the workflow and what was necessary for the workflows."
   *
   * THE DATABASE STARTS THE RUN -- workflow_start_on_promise, beside the allocation trigger it is
   * modelled on -- but a run is created with NO DATES AND NOTHING SENT. Left to the morning sweep,
   * an arrangement agreed at ten o'clock is confirmed to the debtor the following dawn, and the
   * confirmation is an email with an SMS behind it, which a once-a-day timer cannot express at all.
   * This is the same nudge an allocation already makes for the handover.
   *
   * OPTIONAL, AND ITS ABSENCE NEVER FAILS THE PROMISE. Callers without a session -- a check, an
   * import -- record the promise and leave the sending to the sweep.
   */
  accessToken?: string | null
}): Promise<{ promise: PromiseToPay; charge: ChargeResult }> {
  const promise = await addPromise({
    accountId: input.accountId,
    amount: input.amount,
    dueOn: input.dueOn,
    method: input.method,
    notes: input.notes,
    createdBy: input.actor.id,
    arrangement: input.arrangement,
    dayOfMonth: input.dayOfMonth,
    onLastDay: input.onLastDay,
    dayOfWeek: input.dayOfWeek,
  })

  const charge = await chargeItem({
    accountId: input.accountId,
    itemId: PROMISE_ITEM_ID,
    actionCode: 'promise_to_pay',
    description: PROMISE_DESCRIPTION,
    createdBy: input.actor.id,
  })

  await addNote({
    accountId: input.accountId,
    body: promiseNote(promise),
    // Raptor's words, not a person's: hidden when the timeline is set to show only
    // what people wrote. See TimelineEntry.automated.
    source: 'system',
    authorName: input.actor.name,
    createdBy: input.actor.id,
  })

  /*
   * AND LAST, BECAUSE IT IS THE ONLY PART THAT REACHES A DEBTOR.
   *
   * AFTER THE NOTE, NOT BEFORE: everything above is the firm's own record of what was agreed, and
   * a confirmation sent against a promise whose fee or timeline entry then failed would be a
   * message the account cannot account for. Fire and forget -- the sweep is the backstop, and a
   * network error here must not tell a collector their promise did not save when it did.
   */
  if (input.accessToken) nudgeWorkflows(input.accessToken, input.accountId)

  return { promise, charge }
}
