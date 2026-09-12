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

  return { promise, charge }
}
