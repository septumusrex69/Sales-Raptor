import type { ClientPosition } from './clientPosition.ts'
import type { DiaryKind } from './diaryPriority.ts'

/**
 * What came of working an account.
 *
 * THE CLERK PICKS THE POSITION, AND THE RECORD IS WRITTEN ANYWAY. Both halves matter and they
 * were once in tension.
 *
 * It read as eight EVENTS — "they agreed to pay", "no answer" — because a clerk can answer "what
 * happened?" in a tap while the debtor is still on the line, and the status followed. The firm
 * asked for the firm's own vocabulary instead: one list, the rungs an account is reported on, no
 * second set of words to learn. So each choice now LEADS with the rung it produces and carries
 * the event underneath it, which is the same eight choices read the way the firm reads them.
 *
 * What did NOT change is that choosing one writes the record. That is what stops the book filling
 * with statuses nothing stands behind: 58 accounts on the imported book say "Promise To Pay" and
 * only 43 have a promise, 5 say "Tracing" and none has ever been charged for a trace. Asked
 * directly, the firm kept it — a status is still a consequence of something recorded, never a
 * keystroke on its own.
 *
 * A status with no record behind it cannot be followed up, cannot break, and cannot be reported
 * on. So each answer here WRITES THE RECORD — a promise with its amount and date, a dispute, a
 * trace request — and the status is a consequence rather than a keystroke.
 *
 * ONLY SOME OF THIS NEEDS A HUMAN, and that is the point of asking at exactly this moment. Money
 * arriving and a promise falling due are observable and are never asked about here. What no
 * machine can observe is whether a person on a telephone said yes, no, or "I have no job" — and
 * that is what this captures, once, from the only person who knows.
 */

export type CallOutcome =
  | 'promised'
  | 'negotiating'
  | 'refused'
  | 'cannot_pay'
  | 'disputed'
  | 'no_answer'
  | 'wrong_number'
  | 'under_administration'

export interface OutcomeMeta {
  /** What the agent reads. Their words, about the call, not about the database. */
  label: string
  /** The second line, where the choice needs distinguishing from its neighbour. */
  hint?: string
  /** Did the agent actually speak to the debtor? Drives Negotiating against In progress. */
  reached: boolean
  /** Where the account lands once this is recorded. */
  position: ClientPosition
  /** What the diary should book next, unless the agent says otherwise. */
  suggests: DiaryKind
  /**
   * The sub-status written onto the account.
   *
   * Written immediately rather than by a nightly job: this is an observation somebody has just
   * made, not a deduction from the passage of time. Only the time-based transitions — a promise
   * falling due and going unpaid — need a job.
   */
  subStatus: string
}

export const CALL_OUTCOMES: Record<CallOutcome, OutcomeMeta> = {
  promised: {
    label: 'Arranged',
    hint: 'They agreed to pay — take the amount and the date',
    reached: true,
    position: 'arranged',
    suggests: 'promise_due',
    subStatus: 'Promise To Pay',
  },
  negotiating: {
    label: 'Negotiating',
    hint: 'Spoke to them, nothing agreed yet',
    reached: true,
    position: 'negotiating',
    suggests: 'review',
    subStatus: 'Negotiating',
  },
  refused: {
    /*
     * THE ONE THAT SENDS AN ACCOUNT TOWARDS LITIGATION, which is exactly why it must be something
     * a person deliberately recorded after speaking to the debtor. It is never inferred from
     * silence — somebody who does not answer the telephone has not refused anything.
     */
    label: 'Refusing to pay',
    hint: 'Reached, and the answer was no',
    reached: true,
    position: 'refusing',
    suggests: 'review',
    subStatus: 'Refuses to pay',
  },
  cannot_pay: {
    label: 'Cannot pay',
    hint: 'Unemployed, pensioner, in hospital, business closed',
    reached: true,
    position: 'cannot_pay',
    suggests: 'review',
    subStatus: 'Cannot pay',
  },
  disputed: {
    label: 'Disputed',
    hint: 'They dispute it — raises a dispute and starts the clock',
    reached: true,
    position: 'disputed',
    suggests: 'dispute_chase',
    subStatus: 'Defended Matter',
  },
  no_answer: {
    label: 'In progress',
    hint: 'No answer — rang out, voicemail, nobody home',
    reached: false,
    position: 'in_progress',
    suggests: 'no_contact',
    subStatus: 'In progress',
  },
  wrong_number: {
    label: 'Tracing',
    hint: 'The number is wrong — raises a trace',
    reached: false,
    position: 'tracing',
    suggests: 'trace',
    subStatus: 'Tracing',
  },
  under_administration: {
    label: 'Under administration',
    hint: 'Debt review, deceased or liquidation — the practitioner from here',
    reached: false,
    position: 'under_administration',
    suggests: 'review',
    subStatus: 'Under administration',
  },
}

/**
 * The order they are offered in.
 *
 * Best news first, and not for cheerfulness: an agent coming off a call where the debtor agreed
 * to pay is reaching for the first thing on the list, and that is the outcome the firm most wants
 * captured properly because it is the one that carries an amount and a date.
 */
export const CALL_OUTCOME_ORDER: CallOutcome[] = [
  'promised', 'negotiating', 'cannot_pay', 'refused',
  'disputed', 'no_answer', 'wrong_number', 'under_administration',
]

/** Does this answer need an amount and a date before it can be saved? */
export function needsPromise(outcome: CallOutcome | null): boolean {
  return outcome === 'promised'
}

/**
 * Does this answer need a few words before it can be saved?
 *
 * Only where the label alone leaves a client's report unable to say anything useful. "They cannot
 * pay" without a reason is exactly the gap that had the firm reporting hardship as refusal, and
 * "they dispute it" without the substance cannot be answered by anybody.
 */
export function needsWords(outcome: CallOutcome | null): boolean {
  return outcome === 'cannot_pay' || outcome === 'disputed' || outcome === 'under_administration'
}
