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
 * TWO TRACKS, NOT ONE, at the firm's instruction — and this is the decision everything else here
 * is shaped by.
 *
 * The NOTICE track is anchored to the file: demand and section 129 on day 1, intention to list on
 * day 10, final notice on day 35, whoever happens to be holding it. The ROTATION track is
 * anchored to the calendar, on the 5th. They are independent, and they come apart immediately —
 * the chart's "Phase 2 · Clerk 2 · day 40-80" is no longer a single thing, because day 42 and the
 * day Clerk 2 takes over are now two different dates.
 *
 * THE REASON IS THAT A STATUTORY DEADLINE MUST NOT MOVE BECAUSE SOMEBODY WAS REALLOCATED. If the
 * notices hung off the phase, then rotating a clerk would shift the date of a section 129, and a
 * date the Act fixes would be decided by an allocation screen. The cost of keeping them apart is
 * that a clerk can inherit a file mid-sequence, which is a training problem; the cost of joining
 * them is a defective notice, which is a legal one.
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
 * The month-ends this clerk is given, as dates. Always exactly two.
 *
 * THE 5th IN THE MONTH THE ACCOUNT ARRIVED DOES NOT COUNT, and that one line is the whole rule:
 * you did not have that month. An account allocated on the 3rd of October reaches the 5th of
 * October two days later, and nobody would call that a month-end the clerk was given. One
 * allocated on the 18th of September reaches the 5th of October with seventeen days to work it,
 * and the firm's own example counts it.
 *
 * WHY THIS IS THE RULE RATHER THAN A CUT-OFF DAY. A threshold ("a month-end counts if you had it
 * before the 20th") is a third number for a floor to remember on top of the 5th and the two
 * months. The month the account arrived in is not a number at all — it is already on the file.
 *
 * AND IT MAKES THE ANSWER EXACTLY TWO, EVERY TIME, which is provable rather than hopeful. Write
 * the allocation month M and the allocation day d. Rotation is the 5th of M+2, so the 5ths in
 * play are those after the allocation date and up to it:
 *   - d < 5  gives 5/M, 5/M+1, 5/M+2, and 5/M is dropped for being in M. Two.
 *   - d >= 5 gives 5/M+1 and 5/M+2, neither of them in M. Two.
 * The check next door asserts it for every allocation date in a year rather than for the two the
 * firm happened to name.
 *
 * WHAT IT IS STILL ROUGH ABOUT, said here rather than discovered later: an account allocated on
 * the 30th of September is given the 5th of October, five days on. The rule has no way to tell
 * that from the 18th, because both are in the same month, and the firm has said they would rather
 * have that than a third number. It is generous to the clerk, never to the firm.
 */
export function monthEndsGiven(
  allocatedOn: string,
  rotatesOn: string,
  dayOfMonth: number = ROTATION_DAY_OF_MONTH,
): string[] {
  const out: string[] = []
  if (rotatesOn <= allocatedOn) return out
  /*
   * THE STARTING MONTH IS A HINT, NOT A DECISION, and that is worth writing down because a review
   * of this suite reported the offset as unguarded. Reading the month one character early, or one
   * digit short, starts the scan in the wrong month and changes NOTHING: every candidate is
   * filtered by `> allocatedOn`, by not falling in the month of arrival, and by `> rotatesOn`
   * ending the loop. Starting too early costs iterations against a guard of 120 and arrives at
   * the same list.
   *
   * What is NOT absorbed, and is checked next door: an offset that yields NaN (which sorts above
   * every real date and gets pushed), and a month-of-arrival slice that reads the day as well.
   */
  const arrivedIn = allocatedOn.slice(0, 7)
  let year = Number(allocatedOn.slice(0, 4))
  let month = Number(allocatedOn.slice(5, 7))
  for (let guard = 0; guard < 120; guard++) {
    const day = Math.min(dayOfMonth, daysInMonth(year, month))
    const candidate = `${year}-${pad(month)}-${pad(day)}`
    if (candidate > rotatesOn) break
    if (candidate > allocatedOn && candidate.slice(0, 7) !== arrivedIn) out.push(candidate)
    month += 1
    if (month > 12) { month = 1; year += 1 }
  }
  return out
}

/**
 * Every rotation date from one handover onwards, each counted from the last.
 *
 * An account handed over on 18 September rotates on 5 November, 5 January, 5 March and 5 May.
 *
 * CHAINED RATHER THAN STEPPED IN FIXED JUMPS, and the two give the same answer today — 5th of
 * M+2, M+4, M+6 is the same list. Worth saying, because the check next door tried to assert the
 * difference and could not: there isn't one while the rotation day is the 5th, since moving a 5th
 * forward off a weekend or a holiday never leaves its own month. Change the day to the 30th and
 * it would, and then a jump from the handover would drift a month against the clerk who actually
 * holds the file. The chain is the version that does not have to be revisited.
 *
 * WHICH IS WHY THE 160-DAY WORKFLOW IS NO LONGER 160 DAYS. Four clerks at two month-ends each is
 * about 230 days from handover to closure. That is a consequence of the firm's own correction and
 * not a side effect to be worked around — but it is a number their clients have been told, so it
 * is surfaced here rather than left to be noticed on the first file that reaches the end.
 */
export function rotationSchedule(
  allocatedOn: string,
  rotations: number,
  holidays: Record<string, string> = {},
): string[] {
  const out: string[] = []
  let cursor = allocatedOn
  for (let i = 0; i < Math.max(0, rotations); i++) {
    cursor = rotationDate(cursor, holidays)
    out.push(cursor)
  }
  return out
}

/**
 * HOW MANY CLERKS A FILE ACTUALLY REACHES BEFORE THE WORKFLOW CLOSES.
 *
 * NOT A PROPERTY OF THE WORKFLOW. A property of the DATE it was handed over, which is exactly why
 * it is worth computing rather than stating once: rotation is anchored to the 5th, two months on,
 * so a file handed over on the 6th gets nearly two extra months with its first clerk and a file
 * handed over on the 4th gets barely one. On some handover dates all four clerks are reached and
 * on others the file closes on the second desk.
 *
 * THIS IS THE FIRM'S OPEN QUESTION, carried here from the read-only page it was found on so that
 * retiring that page does not retire the finding with it. The pre-legal chart staffs the workflow
 * with four clerks and its notice spine closes around day 160; two months per clerk means the
 * fourth is reached only when the sequence runs past about day 180. Either the sequence runs
 * longer than it does, or it is a three-clerk workflow. Nobody at the firm has answered that yet,
 * and the app says so rather than quietly picking one.
 */
export function clerksReached(input: {
  /** The day the file was handed over, which is what rotation is anchored from. */
  handoverOn: string
  /** The last day of the workflow, counted in calendar days from the handover. */
  lastDay: number
  /** How many clerks the chart staffs it with. */
  staffedWith: number
  holidays?: Record<string, string>
}): { reached: number; closesOn: string; rotations: string[]; short: number } {
  const closesOn = shiftCalendarDays(input.handoverOn, Math.max(0, input.lastDay))
  /*
   * One fewer rotation than there are clerks: the first clerk is given the file rather than
   * rotated to it. Asking for `staffedWith` rotations and counting them would report a file that
   * reaches every clerk as reaching one more than exists.
   */
  const rotations = rotationSchedule(
    input.handoverOn, Math.max(0, input.staffedWith - 1), input.holidays ?? {},
  )
  /* Strictly before: a rotation ON the closing day hands the file to somebody who has no work
     left to do with it, which is not reaching a clerk in any sense the firm means. */
  const reached = 1 + rotations.filter((r) => r < closesOn).length
  return {
    reached,
    closesOn,
    rotations,
    short: Math.max(0, input.staffedWith - reached),
  }
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
