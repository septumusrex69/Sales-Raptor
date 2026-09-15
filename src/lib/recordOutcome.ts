import { supabase } from './supabase'
import { addPromise } from './accountWorkspace.ts'
import { raiseQuery } from './accountQueries.ts'
import { CALL_OUTCOMES, type CallOutcome } from './callOutcome.ts'

/**
 * Turning what the agent saw into records that can be followed up.
 *
 * THE POINT OF THE WHOLE EXERCISE. An agent says "they agreed to pay" and three things have to
 * happen: a promise exists with an amount and a date, the diary has something to check on that
 * date, and the account reports as Arranged. Only the first is a fact; the other two follow from
 * it. Write only the status and you have the imported book's problem — 58 accounts claiming a
 * promise to pay, 43 promises, and fifteen follow-ups that will never happen.
 *
 * WRITTEN IMMEDIATELY, NOT BY A NIGHTLY JOB. This is an observation somebody has just made, not
 * a deduction from the passage of time. Only the time-based transition — a promise falling due
 * and going unpaid — needs a job, because nobody is present at the moment it breaks.
 *
 * EVERY WRITE IS ALLOWED TO FAIL WITHOUT LOSING THE REST. The account is being finished by
 * somebody who is probably still on a call; a dispute that would not save must not cost them the
 * promise they just took. What cannot be written is reported back so the caller can say so.
 */

export interface OutcomeRecorded {
  /** What could not be written. Empty when everything landed. */
  failed: string[]
}

export async function recordOutcome(input: {
  accountId: string
  outcome: CallOutcome
  /** Only for 'promised'. */
  promise?: { amount: number; dueOn: string } | null
  /** The agent's words, where the outcome needs them. */
  words?: string
  actor: { id: string | null; name: string | null }
}): Promise<OutcomeRecorded> {
  const meta = CALL_OUTCOMES[input.outcome]
  const failed: string[] = []
  const words = input.words?.trim() || null

  if (input.outcome === 'promised' && input.promise) {
    try {
      await addPromise({
        accountId: input.accountId,
        amount: input.promise.amount,
        dueOn: input.promise.dueOn,
        notes: words,
        createdBy: input.actor.id,
      })
    } catch (e) {
      failed.push(`the promise (${e instanceof Error ? e.message : String(e)})`)
    }
  }

  if (input.outcome === 'disputed') {
    try {
      await raiseQuery({
        accountId: input.accountId,
        description: words ?? 'The debtor disputes the account.',
        kind: 'dispute',
        raisedBy: input.actor.id,
        raisedByName: input.actor.name,
        /*
         * NOT CHARGED. Item 3 is for a dispute taken up with somebody else; one an agent writes
         * down at their own desk mid-call is the job, not a necessary expense recoverable from
         * the debtor. See the note on raiseQuery's `charge`.
         */
        charge: false,
      })
    } catch (e) {
      failed.push(`the dispute (${e instanceof Error ? e.message : String(e)})`)
    }
  }

  /*
   * The sub-status last, so that a failure above does not leave the account claiming something
   * no record supports — which is the exact fault this whole path exists to end.
   */
  if (failed.length === 0) {
    const { error } = await supabase
      .from('debtor_accounts')
      .update({ sub_status: meta.subStatus })
      .eq('id', input.accountId)
    if (error) failed.push(`the status (${error.message})`)
  }

  return { failed }
}
