/**
 * WHEN a workflow step falls due.
 *
 * Kept apart from what a step DOES, because the two go wrong for different reasons and at
 * different times. What a step does is content and is reviewed by the attorney; when it falls is
 * arithmetic, and arithmetic that is wrong is wrong on every account at once, quietly, until
 * somebody notices a section 129 went out on a Sunday.
 *
 * THREE WAYS OF SAYING WHEN, because the firm's own 160-day workflow uses all three and they are
 * not interchangeable:
 *
 *   - CALENDAR DAYS. "Day 10 — Intention to List", "7 days to settle". The debtor's clock.
 *   - BUSINESS DAYS. "20 business days", "within 5 business days". The statutory clock, and the
 *     one the Act counts in. Counting these as calendar days shortens every statutory period the
 *     firm relies on, which is the kind of mistake that is only found in court.
 *   - A DAY OF THE MONTH. Clerk rotation is not an offset at all — it is "the 5th", and no number
 *     of days from a handover lands on the 5th of anything.
 *
 * Pure: every input is passed in, nothing is fetched, and there is no clock of its own. A
 * workflow that has to be reproducible three months after the fact cannot depend on a function
 * that reads today.
 */
import { addWorkingDays, isWorkingDay } from './workingDays.ts'

export type WhenSpec =
  /** N calendar days after the anchor. Day 0 is the anchor itself. */
  | { kind: 'calendar_days'; days: number }
  /** N working days after the anchor, skipping weekends and South African public holidays. */
  | { kind: 'business_days'; days: number }
  /**
   * A fixed day of the month, N months after the anchor's month.
   *
   * `monthsAhead: 0` means the anchor's own month, so a handover on 18 September with
   * `{ day: 5, monthsAhead: 0 }` is 5 September — already past. That is intentional and the
   * caller decides what to do about it; silently rolling forward would hide a workflow that has
   * been written wrong.
   */
  | { kind: 'month_day'; day: number; monthsAhead: number }

/** Whether a date that lands on a weekend or a public holiday moves, and which way. */
export type NonWorkingDay =
  /** Leave it where it falls. Correct for a deadline the debtor is given: their clock runs. */
  | 'keep'
  /** The next working day. Correct for anything a person has to DO — nobody rotates on a Sunday. */
  | 'forward'

const pad = (n: number): string => String(n).padStart(2, '0')

const shiftCalendarDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** How many days February actually has in that year, and so on. */
export function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate()
}

/**
 * The date this step falls on.
 *
 * `onNonWorkingDay` defaults to 'keep' because most of what a workflow produces is a notice with
 * a deadline, and a debtor's deadline does not move because the office is shut. The steps that
 * ask a PERSON to do something pass 'forward'.
 */
export function dueDate(
  anchor: string,
  spec: WhenSpec,
  onNonWorkingDay: NonWorkingDay = 'keep',
  holidays: Record<string, string> = {},
): string {
  let date: string
  switch (spec.kind) {
    case 'calendar_days':
      date = shiftCalendarDays(anchor, spec.days)
      break
    case 'business_days':
      // addWorkingDays with 0 already returns the next working day on or after the anchor, which
      // is what a zero-day business offset means: "the first day anybody is here".
      date = addWorkingDays(anchor, spec.days, holidays)
      break
    case 'month_day': {
      const year = Number(anchor.slice(0, 4))
      const month = Number(anchor.slice(5, 7))
      const target = new Date(Date.UTC(year, month - 1 + spec.monthsAhead, 1))
      const y = target.getUTCFullYear()
      const m = target.getUTCMonth() + 1
      // Clamped, not rolled over: "the 31st" of a month with thirty days is the 30th, not the 1st
      // of the next one. A rotation that jumped a month every February would be found in February.
      const day = Math.min(Math.max(1, spec.day), daysInMonth(y, m))
      date = `${y}-${pad(m)}-${pad(day)}`
      break
    }
  }
  if (onNonWorkingDay === 'forward' && !isWorkingDay(date, holidays)) {
    return addWorkingDays(date, 0, holidays)
  }
  return date
}

/* ---------------------------------------------------------------- clerk rotation */

/**
 * THE FIRM'S ROTATION RULE, and it is a calendar rule rather than a number of days.
 *
 * "I want to give each clerk two month ends to collect on it. So it means on the fifth of the
 * second month after they've had an account... today is the 18th of September, so they get to the
 * 5th of October, the 5th of November, then it is reallocated to the next clerk."
 *
 * WHY IT IS NOT "FORTY DAYS". The firm's own 160-day chart rotates on day 40, day 80 and day 120,
 * and that is the part they corrected. A day count rotates an account away from a clerk in the
 * middle of a month — sometimes days before the 5th, which is when the debit orders they spent
 * the month arranging actually run. The clerk who did the work does not get the collection, and
 * the clerk who gets the account inherits arrangements they did not make. Anchoring to the 5th
 * means every clerk is measured on the month-ends they were given.
 *
 * ROTATION MOVES TO THE NEXT WORKING DAY. It is a thing a person does — a book is handed over, a
 * diary is re-pointed — and nobody rotates on a Sunday.
 */
export const ROTATION_DAY_OF_MONTH = 5
export const ROTATION_MONTHS = 2

export function rotationDate(allocatedOn: string, holidays: Record<string, string> = {}): string {
  return dueDate(
    allocatedOn,
    { kind: 'month_day', day: ROTATION_DAY_OF_MONTH, monthsAhead: ROTATION_MONTHS },
    'forward',
    holidays,
  )
}

/**
 * The month-ends this clerk actually gets, as dates.
 *
 * WHY THIS IS SEPARATE FROM THE RULE. The rule is "the 5th, two months on" and the intent behind
 * it is "two month-ends each". Those agree for an account allocated in the middle of a month and
 * they do NOT agree for one allocated on the 3rd: the 5th is two days later, and the clerk ends
 * up with three 5ths rather than two. Returning the list rather than the count means a screen can
 * show which month-ends a clerk was given instead of asserting a number that is sometimes wrong,
 * and it is what makes the disagreement visible rather than buried in an off-by-one.
 *
 * The allocation day itself is excluded and the rotation day included: a clerk holds the account
 * up to and including the day it rotates.
 */
export function monthEndsGiven(
  allocatedOn: string,
  rotatesOn: string,
  dayOfMonth: number = ROTATION_DAY_OF_MONTH,
): string[] {
  const out: string[] = []
  if (rotatesOn <= allocatedOn) return out
  let year = Number(allocatedOn.slice(0, 4))
  let month = Number(allocatedOn.slice(5, 7))
  for (let guard = 0; guard < 120; guard++) {
    const day = Math.min(dayOfMonth, daysInMonth(year, month))
    const candidate = `${year}-${pad(month)}-${pad(day)}`
    if (candidate > rotatesOn) break
    if (candidate > allocatedOn) out.push(candidate)
    month += 1
    if (month > 12) { month = 1; year += 1 }
  }
  return out
}

/* ---------------------------------------------------------------- where a file is on the spine */

/**
 * WHICH DAY OF THE WORKFLOW A FILE IS ON.
 *
 * Counted from the day the workflow started, in calendar days, and it is a fact about the FILE
 * rather than about the clerk holding it. That matters because of the firm's own rule: "a file
 * that leaves the spine on day 52 returns to it on day 52 — never at day 1."
 *
 * PAUSED TIME IS NOT SPINE TIME. An arrangement pauses the notice sequence — the chart says so —
 * so the days spent on a kept arrangement do not advance the spine. Prescription still runs
 * throughout, which is a different clock again and deliberately not this one; conflating the two
 * is how a file comes back from a six-month arrangement already prescribed on paper and not in
 * law, or the reverse.
 */
export function spineDay(input: {
  startedOn: string
  asAt: string
  /** Closed windows during which the sequence was paused, as [from, to] inclusive-exclusive. */
  pausedFor?: { from: string; to: string }[]
}): number {
  const gross = calendarDaysBetween(input.startedOn, input.asAt)
  if (gross <= 0) return 0
  let paused = 0
  for (const window of input.pausedFor ?? []) {
    const from = window.from < input.startedOn ? input.startedOn : window.from
    const to = window.to > input.asAt ? input.asAt : window.to
    if (to > from) paused += calendarDaysBetween(from, to)
  }
  return Math.max(0, gross - paused)
}

/** Whole days from one date to another. Negative where `to` is before `from`. */
export function calendarDaysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86400000)
}

/**
 * The date a file resumes on, having left the spine and come back.
 *
 * It resumes at the SAME spine day it left on, which is the firm's rule and is the whole reason
 * spineDay exists. What changes is the calendar date that day now corresponds to.
 */
export function resumeDate(input: {
  startedOn: string
  leftOn: string
  returnedOn: string
  pausedBefore?: { from: string; to: string }[]
}): { spineDay: number; pausedFor: { from: string; to: string } } {
  return {
    spineDay: spineDay({ startedOn: input.startedOn, asAt: input.leftOn, pausedFor: input.pausedBefore }),
    pausedFor: { from: input.leftOn, to: input.returnedOn },
  }
}
