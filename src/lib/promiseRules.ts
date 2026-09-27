/**
 * What a promise to pay is allowed to say, and what it costs.
 *
 * Pure, and kept out of accountPromises.ts for the same reason arrangements.ts is kept out of
 * accountWorkspace.ts: that file lives beside the Supabase client, and these are rules about
 * money that should be arguable without a browser or a database in front of you. The firm asked
 * for them after watching a collector take a promise for more than the account was worth.
 */
import { describeArrangement, type Arrangement } from './arrangements.ts'
/*
 * The same money the rest of the app writes. The first attempt hand-rolled it here and produced
 * "R1 500.00" with a full stop, while every other figure on the page reads "R 1 500,00" -- two
 * spellings of one amount on one screen. mockData is types and formatters only, no database, so
 * a pure module may import it.
 */
import { formatMoney } from '../data/mockData.ts'

/**
 * Item 5: "Settlement account drawn up and furnished at the debtor's request, other than the
 * six-monthly one." R50 excluding VAT under the 2026 schedule.
 *
 * Not a guess. The firm's own charging history maps its "Promise to Pay" action onto item 5 --
 * see TARIFF_HISTORY in actionTariff.ts, where promise_to_pay carries the item 5 rate in all
 * four schedules. Taking an arrangement means working out and furnishing what it takes to
 * settle, which is what item 5 pays for. It was simply never wired into the button, so every
 * arrangement taken in Raptor so far has been free.
 */
export const PROMISE_ITEM_ID = '5'

/** What the debtor reads on the statement. Not "promise to pay" -- that is our word for it. */
export const PROMISE_DESCRIPTION = 'Payment arrangement'

/**
 * The charge, as much of it as these rules need.
 *
 * Structural rather than importing ChargeResult, which lives next to the Supabase client.
 */
export interface ChargeOutcome {
  exclVat: number
  reason: 'charged' | 'written-off' | 'item-total-spent' | 'monthly-limit' | 'at-ceiling'
}

/**
 * The most a promise may be for.
 *
 * A once-off settlement is quoted at the settlement figure -- the balance PLUS the item 9 receipt
 * fee that settling in full attracts -- because that is the number that actually clears the
 * account. Quoting the bare balance takes a promise that leaves the debtor still owing the
 * receipt fee, which is how an account everybody believes is closed turns up open.
 *
 * An instalment is capped at the balance instead: a single instalment larger than the whole debt
 * is not an instalment. The firm's words -- "the monthly instalment or the weekly instalment
 * cannot be more than the actual outstanding balance".
 */
export function promiseCeiling(arrangement: Arrangement, balance: number, settlement: number): number {
  return arrangement === 'once_off' ? settlement : balance
}

/**
 * Why an amount cannot be taken, or null if it can.
 *
 * Returns the sentence rather than a boolean, because "no" without "why" on a form somebody is
 * filling in with a debtor on the phone is the worst of both.
 */
export function promiseProblem(
  arrangement: Arrangement,
  amount: number,
  balance: number,
  settlement: number,
): string | null {
  if (!(amount > 0)) return null
  // Questioned on the form, never refused here: a once-off above the settlement figure is
  // legitimate, since interest runs until the money actually arrives and a debtor may be
  // rounding up to cover it.
  if (arrangement === 'once_off') return null
  if (amount > promiseCeiling(arrangement, balance, settlement)) {
    return `That is more than the ${formatMoney(balance)} outstanding on the account. `
      + 'A single payment that size is a once-off settlement, not an instalment.'
  }
  return null
}

/**
 * What the timeline says happened.
 *
 * No fee named. Every charge is already its own entry on this timeline and its own line on
 * Transactions, and the firm had the fee sentence taken out of the notes for exactly that
 * reason: "it's on the transaction list."
 */
export function promiseNote(p: {
  amount: number
  arrangement: Arrangement
  dueOn: string
  dayOfMonth: number | null
  onLastDay: boolean
  dayOfWeek: number | null
}): string {
  const how = describeArrangement(p).toLowerCase()
  return `Payment arrangement taken — ${formatMoney(p.amount)} ${how}, first due ${p.dueOn}.`
}

/* ------------------------------------------------------------------ *
 * Cancelling one
 * ------------------------------------------------------------------ */

/**
 * WHY A CANCELLED ARRANGEMENT WAS CANCELLED.
 *
 * THE FIRM, HAVING CANCELLED ONE AND WATCHED NOTHING HAPPEN: "If the payment arrangement is
 * cancelled, there should be a reason. So the person should write a reason, say why has it been
 * cancelled. And if it's because of a dispute, a dispute should be raised. And if it's because the
 * debtor just decided not to pay, then it should go back to the section 129... it can't go out of
 * the workflow. It should be in a workflow. All accounts should be somewhere and somehow in a
 * workflow."
 *
 * A CLOSED LIST BECAUSE EACH ONE DECIDES SOMETHING, and free text decides nothing. The database
 * acts on the cause -- see workflow_on_promise_cancelled -- and between the three of them every
 * cancelled account lands back inside a sequence rather than in the gap the firm found.
 *
 * THE THIRD ONE IS NOT IN THE FIRM'S TWO AND IT IS NOT OPTIONAL. A promise may stop a running
 * sequence ONCE per run, ever -- their own rule: "if we stop it for all of that time, then that's
 * a problem. Unless we can stop it only once. Not twice." So an arrangement cancelled because it
 * was captured wrongly must NOT give the hold back, or the corrected one recorded a minute later
 * cannot take it again and a section 129 runs at a debtor who is paying. It is the one case where
 * cancelling means "wait", not "carry on".
 */
export type CancelCause = 'disputed' | 'refusing' | 'replaced'

export interface CancelChoice {
  cause: CancelCause
  /** What the collector picks. The debtor's side of it, not the workflow's. */
  label: string
  /** What Raptor will do about it, said plainly, because it is not a small thing. */
  consequence: string
}

/**
 * THE THREE, IN THE ORDER A COLLECTOR MEETS THEM.
 *
 * A dispute first because it is the one with a legal clock attached, refusing second because it is
 * the common one, and a mis-capture last because it is housekeeping rather than an outcome.
 *
 * EACH SAYS WHAT WILL HAPPEN. The consequence is on the screen rather than in a comment: these
 * press a statutory sequence back into motion, and a collector who did not know that is a
 * collector who will cancel an arrangement to tidy it up.
 */
export const CANCEL_CHOICES: CancelChoice[] = [
  {
    cause: 'disputed',
    label: 'The debtor disputes the account',
    consequence: 'A dispute is raised and the collection sequence carries on until it is answered.',
  },
  {
    cause: 'refusing',
    label: 'The debtor will not pay',
    consequence: 'The collection sequence goes on from where the arrangement stopped it.',
  },
  {
    cause: 'replaced',
    label: 'It was captured wrongly — a corrected one is being recorded',
    consequence: 'Nothing is sent. The collection sequence stays paused for the corrected arrangement.',
  },
]

/** What a cancelled arrangement's chosen cause reads as, on a timeline or in a list. */
export const CANCEL_CAUSE_LABEL: Record<CancelCause, string> =
  Object.fromEntries(CANCEL_CHOICES.map((c) => [c.cause, c.label])) as Record<CancelCause, string>

/**
 * WHAT A CANCELLATION SAYS WHEN SOMEBODY WRITES NOTHING.
 *
 * `cancel_reason` is required by the box but not by the column, and the arrangements cancelled
 * before there was a question to answer have neither. A blank line on the timeline reading
 * "Arrangement cancelled" with nothing after it is exactly what the firm complained about, so the
 * cause stands in for the sentence where there is no sentence.
 *
 * NULL RATHER THAN A PHRASE where there is neither, because the entry already says it was
 * cancelled and "cancelled: no reason given" reads as an accusation about the collector.
 */
export function promiseCancelWords(
  p: { cancelCause?: CancelCause | null; cancelReason?: string | null },
): string | null {
  const said = p.cancelReason?.trim()
  const cause = p.cancelCause ? CANCEL_CAUSE_LABEL[p.cancelCause] : null
  if (cause && said) return `${cause} — ${said}`
  return cause ?? said ?? null
}

/**
 * WHAT THE CLOSING ENTRY IS CALLED, which is not the status word.
 *
 * "cancelled" beside "Promise to pay" is what made an arrangement's two events read as one, and
 * the firm read it exactly that way: "I don't see that the payment arrangement has been created, I
 * can only see that it's been cancelled." A title is what somebody scanning a timeline reads, so
 * each of these says what was decided rather than naming a column value.
 *
 * `defaulted` IS DELIBERATELY ABSENT. It is not an ending: it is the 48 hours the firm's own
 * default letter gives the debtor to put it right, and the arrangement is still live inside it.
 */
export const PROMISE_ENDED: Record<string, string> = {
  kept: 'Arrangement kept',
  broken: 'Arrangement broken',
  cancelled: 'Arrangement cancelled',
}
