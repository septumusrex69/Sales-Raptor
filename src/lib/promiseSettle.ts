import { nextDueDate, type Arrangement } from './arrangements.js'
import { addWorkingDays } from './workingDays.js'

/**
 * KEPT OR MISSED, DECIDED BY THE MORNING RUN (request #17, Raptor H16).
 *
 * The call centre: "When a ptp is made the clerk needs to click on PTP Kept or Broken. Can we make this
 * automated as it will take extra time for the clerks to open 40 accounts." Stephan, 2 Nov, chose both
 * directions with a grace period: KEPT when approved money covers the promise, MISSED two working days
 * after the due date when it does not.
 *
 * This replaces a rule written here before: "a promise quietly marked kept by logic nobody can see is worse
 * than one somebody closed by hand." So it is not quiet -- every move writes a note on the account saying
 * what Raptor decided and on which money -- and it is not hidden: this file is the whole of the logic.
 *
 * TWO DIFFERENT SUMS, ON PURPOSE.
 *   KEPT counts APPROVED money only. A receipt still waiting for approval may yet be rejected, and a promise
 *   marked kept on money that never cleared tells the debtor's file something untrue.
 *   MISSED counts every receipt not rejected or reversed -- waiting and in suspense included. A notice of
 *   default goes out on "missed" and is charged to the debtor; sending one while their payment sits in our
 *   own approval queue is the worst mistake this can make. The asymmetry is the point: when unsure, wait.
 *
 * PARTIAL IS NOT KEPT. R600 against a R1 000 promise is a missed promise once the grace runs out; the notice
 * of default asks for "the missed {{ptp_amount}}", which is the firm's existing wording for exactly this.
 *
 * Pure, so check-promise-settle can run it: the caller reads the rows and writes the answer.
 */

export interface SettlePromise {
  id: string
  accountId: string
  status: 'open' | 'defaulted'
  amount: number
  dueOn: string
  arrangement: Arrangement
  dayOfMonth: number | null
  onLastDay: boolean
  dayOfWeek: number | null
  instalmentsKept: number
  /** The promise's created_at. Counting starts at the START of that day (see `countFrom`). */
  createdAt: string
  /** The received_at of the last payment already used to keep an instalment; null before the first. */
  countedAfter: string | null
}

export interface SettlePayment {
  id: string
  amount: number
  receivedAt: string
  approved: boolean
  /** Rejected or reversed: not money the debtor has paid. */
  undone: boolean
}

export type Settlement =
  | { action: 'keep'; instalments: number; finished: boolean; nextDueOn: string | null; countedAfter: string; paymentId: string; paid: number }
  | { action: 'miss'; seen: number; graceEnded: string }
  | { action: 'wait' }

/**
 * THE FIRST DUE DATE THIS JUDGES. A promise that fell due before the morning run learned to read the money is
 * left to a person, as it always was: switched on over a book, it would otherwise send a notice of default for
 * every promise long past its date in one morning -- and a receipt for every old payment -- which nobody asked
 * for and the debtors would rightly dispute. Production carries Swordfish's book, which this session never saw.
 */
export const SETTLED_BY_RAPTOR_FROM = '2026-11-02'

/** Working days after the due date before an unpaid promise counts as missed (Stephan, 2 Nov). */
export const GRACE_WORKING_DAYS = 2

/**
 * WHERE COUNTING STARTS. After the last payment already used; before the first, from MIDNIGHT of the day the
 * promise was made rather than its minute -- a bank line is dated to the day (00:00), so a debtor who paid that
 * morning and then phoned would otherwise have their payment fall before the promise and be sent a notice.
 * The cost is a payment made the same day for something else counting toward it, which errs toward kept.
 */
export function countFrom(p: Pick<SettlePromise, 'createdAt' | 'countedAfter'>): string {
  if (p.countedAfter) return p.countedAfter
  const day = new Date(p.createdAt).toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' })
  return new Date(`${day}T00:00:00+02:00`).toISOString()
}

export function settlePromise(p: SettlePromise, payments: SettlePayment[], today: string, extraHolidays: Record<string, string> = {}): Settlement {
  if (p.status === 'open' && p.dueOn < SETTLED_BY_RAPTOR_FROM) return { action: 'wait' }
  const from = new Date(countFrom(p)).getTime()
  /* After `from` for an instalment already counted; on or after midnight for the first (`>=`), so the
     midnight-dated bank line of the promise day is in. A payment exactly AT countedAfter is the one used. */
  const fresh = payments
    .filter((x) => !x.undone)
    .filter((x) => { const t = new Date(x.receivedAt).getTime(); return p.countedAfter ? t > from : t >= from })
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  const cents = (n: number) => Math.round(n * 100)
  const approved = fresh.filter((x) => x.approved)
  const approvedSum = approved.reduce((t, x) => t + cents(x.amount), 0)
  const want = cents(p.amount)

  if (want > 0 && approvedSum >= want) {
    /* As many instalments as the money covers -- three months paid at once is three kept -- and a once-off
       finishes on the first. The guard is a backstop on a weekly arrangement paid years ahead. */
    let left = approvedSum
    let due: string | null = p.dueOn
    let kept = 0
    let finished = false
    while (left >= want && kept < 60) {
      left -= want
      kept += 1
      const next: string | null = p.arrangement === 'once_off' || !due
        ? null
        : nextDueDate({ arrangement: p.arrangement, dueOn: due, dayOfMonth: p.dayOfMonth, onLastDay: p.onLastDay, dayOfWeek: p.dayOfWeek })
      if (!next) { finished = true; due = null; break }
      due = next
    }
    const last = approved[approved.length - 1]
    return { action: 'keep', instalments: kept, finished, nextDueOn: due, countedAfter: last.receivedAt, paymentId: last.id, paid: approvedSum / 100 }
  }

  /* A promise already in default is the 48 hours' business (expireDefaultedPromises); only money revives it. */
  if (p.status !== 'open') return { action: 'wait' }

  const graceEnded = addWorkingDays(p.dueOn, GRACE_WORKING_DAYS, extraHolidays)
  const seen = fresh.reduce((t, x) => t + cents(x.amount), 0)
  if (today > graceEnded && seen < want) return { action: 'miss', seen: seen / 100, graceEnded }
  return { action: 'wait' }
}
