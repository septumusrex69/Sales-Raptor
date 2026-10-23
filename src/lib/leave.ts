import { isWorkingDay } from './workingDays.ts'

/**
 * LEAVE: WHAT EACH PERSON HAS TAKEN, OF WHICH KIND, AND WHAT THEY HAVE LEFT (23 Oct 2026).
 *
 * THE FIRM (Stephan): track leave days per employee, the types of leave and how much each has left.
 * "Me and Camille and any administrator can see the leave. Team leaders can also see the leave of
 * their teams. Leaves can be done in half days or full days." Who may see it is permissions.ts and
 * the database's leave_visible(); this file is the arithmetic, and it is pure -- no clock, no
 * database -- so check-leave can hold every figure below to the Act.
 *
 * THE KINDS ARE THE BASIC CONDITIONS OF EMPLOYMENT ACT'S, plus unpaid leave:
 *
 *   annual          s20: 21 consecutive days a cycle, which is 15 WORKING days on a five-day week;
 *                   or, by agreement, one day for every 17 days worked.
 *   sick            s22: the working days of six weeks in a 36-month cycle -- 30 on a five-day week;
 *                   in the first six months only one day for every 26 days worked.
 *   family          s27: 3 days a year, once somebody has worked for the firm longer than 4 months.
 *   maternity       s25: four consecutive months. Not paid by the employer unless its policy says so
 *                   (UIF pays a benefit) -- which is why nothing here touches the basic.
 *   parental        s25A: 10 consecutive days, for a parent not taking maternity leave.
 *   adoption        s25B: 10 consecutive weeks (a child under two).
 *   commissioning   s25C: 10 consecutive weeks (a surrogacy agreement).
 *   unpaid          no entitlement; recorded so the payroll can deduct it.
 *
 * LEAVE IS COUNTED IN WORKING DAYS ONLY -- Monday to Friday, not a South African public holiday
 * (workingDays.ts, the same calendar the pro-rata basic counts in). A week off from a Monday over a
 * Freedom Day is four days of leave, not five. The four statutory PERIODS above (maternity and the
 * three ten-day/ten-week ones) are given in the Act as consecutive calendar time; they are still
 * RECORDED in working days like everything else, and shown against their statutory period in words
 * rather than as a balance, because they are not a pot that runs down.
 *
 * HALF DAYS: a record may begin at midday on its first day or end at midday on its last; a single
 * day with the half box ticked is half a day. So every figure is a multiple of 0.5 and the database
 * refuses anything else.
 *
 * NOT PAY DATA, AND NOT PAY MATHS. Leave is shown on the pay statement and in the SimplePay export as
 * information; the basic is not reduced here for unpaid leave or anything else. Whether and how
 * unpaid leave is deducted is the payroll's to do (HANDOFF §4).
 */

export type LeaveKind = 'annual' | 'sick' | 'family' | 'maternity' | 'parental' | 'adoption' | 'commissioning' | 'unpaid'

/** In the order a person is asked for it: the two everybody takes first, unpaid last. */
export const LEAVE_KINDS: LeaveKind[] = ['annual', 'sick', 'family', 'maternity', 'parental', 'adoption', 'commissioning', 'unpaid']

/**
 * accrues: builds up month by month and carries forward (annual).
 * cycle:   a fixed number of days per cycle, reset at the end of it (sick, family).
 * period:  a statutory stretch of time, not a pot that runs down (maternity and its relatives).
 * none:    no entitlement at all (unpaid).
 */
export type LeaveRule = 'accrues' | 'cycle' | 'period' | 'none'

export interface LeaveMeta {
  label: string
  rule: LeaveRule
  /** The Act's entitlement in one line, for the screen. */
  law: string
}

export const LEAVE_META: Record<LeaveKind, LeaveMeta> = {
  annual: { label: 'Annual leave', rule: 'accrues', law: '15 working days a year (BCEA s20), accrued monthly' },
  sick: { label: 'Sick leave', rule: 'cycle', law: '30 working days per 36-month cycle; 1 day per 26 worked in the first six months (s22)' },
  family: { label: 'Family responsibility leave', rule: 'cycle', law: '3 days a year, after four months’ service (s27)' },
  maternity: { label: 'Maternity leave', rule: 'period', law: 'Four consecutive months (s25); not paid by the firm unless its policy says so' },
  parental: { label: 'Parental leave', rule: 'period', law: '10 consecutive days, for a parent not taking maternity leave (s25A)' },
  adoption: { label: 'Adoption leave', rule: 'period', law: '10 consecutive weeks, for a child under two (s25B)' },
  commissioning: { label: 'Commissioning parental leave', rule: 'period', law: '10 consecutive weeks (s25C)' },
  unpaid: { label: 'Unpaid leave', rule: 'none', law: 'No entitlement; recorded so the payroll can deduct it' },
}

/* ------------------------------------------------------------------------------------------------
 * The Act's figures. Named, so check-leave holds each one to the section it came from.
 * ---------------------------------------------------------------------------------------------- */

/** s20(2)(a): 21 consecutive days = 15 working days on a five-day week. */
export const ANNUAL_DAYS_PER_YEAR = 15
/**
 * ACCRUED MONTHLY: 15 / 12 = 1.25 days for every completed month of service. The Act also allows
 * "one day for every 17 days worked" (s20(2)(b)), which comes to about 14.7 a year on ~250 working
 * days; ANNUAL_WORKED_RATIO is that alternative and annualByDaysWorked works it, but the balance uses
 * the monthly figure -- it is what payroll systems (SimplePay among them) accrue by default and it
 * reaches exactly 15 at the year end. Which the firm uses is HANDOFF §4.
 */
export const ANNUAL_PER_MONTH = ANNUAL_DAYS_PER_YEAR / 12
export const ANNUAL_WORKED_RATIO = 17
/** s22(2): six weeks' working days in a 36-month cycle -- 30 on a five-day week. */
export const SICK_DAYS_PER_CYCLE = 30
export const SICK_CYCLE_MONTHS = 36
/** s22(3): during the first six months, one day for every 26 days worked. */
export const SICK_EARLY_MONTHS = 6
export const SICK_EARLY_RATIO = 26
/** s27(1)-(2): 3 days in each annual cycle, for somebody employed longer than four months. */
export const FAMILY_DAYS_PER_YEAR = 3
export const FAMILY_AFTER_MONTHS = 4

/* ------------------------------------------------------------------------------------------------
 * Dates
 * ---------------------------------------------------------------------------------------------- */

const pad = (n: number) => String(n).padStart(2, '0')

export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function prevDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** The same day `n` months on; the 31st into a short month is that month's last day. */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const i = y * 12 + (m - 1) + n
  const ny = Math.floor(i / 12)
  const nm = (i % 12) + 1
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${ny}-${pad(nm)}-${pad(Math.min(d, last))}`
}

/**
 * WHOLE MONTHS OF SERVICE COMPLETED BY THE END OF `asAt`. Somebody who started on 15 January has
 * completed one month at the end of 14 February.
 */
export function completedMonths(from: string, asAt: string): number {
  if (asAt < from) return 0
  const end = nextDay(asAt)
  let k = 0
  while (addMonths(from, k + 1) <= end && k < 1200) k += 1
  return k
}

/** Working days from `from` to `to`, BOTH INCLUSIVE. */
export function workingDaysInclusive(from: string, to: string): number {
  let n = 0
  for (let d = from; d <= to; d = nextDay(d)) if (isWorkingDay(d)) n += 1
  return n
}

/* ------------------------------------------------------------------------------------------------
 * One record
 * ---------------------------------------------------------------------------------------------- */

/**
 * ONE ROW OF leave_records. Every field by hand (peopleApi.ts maps it, check-leave holds the mapper
 * to the table). `entry: 'opening'` is the annual balance somebody brought with them on `startsOn`
 * -- see annual below.
 */
export interface LeaveRecord {
  id: string
  userId: string
  kind: LeaveKind
  entry: 'taken' | 'opening'
  startsOn: string
  endsOn: string
  /** Begins at midday on the first day (or, on a single day, is half that day). */
  startHalf: boolean
  /** Ends at midday on the last day. Never on a single day: that is startHalf. */
  endHalf: boolean
  /** Working days, a multiple of 0.5, worked out when it was recorded and kept as recorded. */
  days: number
  note: string | null
  createdBy: string | null
  createdAt: string
  cancelledAt: string | null
  cancelledBy: string | null
  cancelReason: string | null
}

/**
 * HOW MANY WORKING DAYS A STRETCH OF LEAVE IS, or why it cannot be recorded.
 *
 * A HALF DAY MUST FALL ON A WORKING DAY: half of a Saturday is nothing, and a record that subtracted
 * it anyway would charge somebody half a day for a day they were never due at work.
 */
export function leaveDays(r: { startsOn: string; endsOn: string; startHalf: boolean; endHalf: boolean }): { days: number | null; problem: string | null } {
  if (!r.startsOn || !r.endsOn) return { days: null, problem: 'Say which days.' }
  if (r.endsOn < r.startsOn) return { days: null, problem: 'The last day is before the first.' }
  const single = r.startsOn === r.endsOn
  if (single && r.endHalf) return { days: null, problem: 'One day is either a full day or a half day.' }
  if (r.startHalf && !isWorkingDay(r.startsOn)) return { days: null, problem: 'A half day has to be a working day; the first day is a weekend or a public holiday.' }
  if (r.endHalf && !isWorkingDay(r.endsOn)) return { days: null, problem: 'A half day has to be a working day; the last day is a weekend or a public holiday.' }
  const full = workingDaysInclusive(r.startsOn, r.endsOn)
  const days = full - (r.startHalf ? 0.5 : 0) - (r.endHalf ? 0.5 : 0)
  if (days <= 0) return { days: null, problem: 'There are no working days in that stretch: weekends and public holidays are not leave.' }
  return { days, problem: null }
}

const isLive = (r: LeaveRecord) => r.cancelledAt === null
const isTaken = (r: LeaveRecord) => isLive(r) && r.entry === 'taken'

/**
 * THE PART OF A RECORD THAT FALLS BETWEEN TWO DAYS (both inclusive) -- the pay statement's salary
 * month, the SimplePay export's. Wholly inside: the days as recorded. Straddling: the working days of
 * the overlap, less a half at whichever end is the record's own half-day end.
 */
export function daysWithin(r: Pick<LeaveRecord, 'startsOn' | 'endsOn' | 'startHalf' | 'endHalf' | 'days'>, from: string, to: string): number {
  const a = r.startsOn > from ? r.startsOn : from
  const b = r.endsOn < to ? r.endsOn : to
  if (a > b) return 0
  if (a === r.startsOn && b === r.endsOn) return r.days
  let n = workingDaysInclusive(a, b)
  if (r.startHalf && a === r.startsOn && isWorkingDay(a)) n -= 0.5
  if (r.endHalf && b === r.endsOn && isWorkingDay(b)) n -= 0.5
  return Math.max(0, n)
}

/** Leave taken between two days, by kind. Cancelled records and opening balances are not leave. */
export function leaveInPeriod(records: LeaveRecord[], from: string, to: string): Record<LeaveKind, number> {
  const out = Object.fromEntries(LEAVE_KINDS.map((k) => [k, 0])) as Record<LeaveKind, number>
  for (const r of records.filter(isTaken)) out[r.kind] += daysWithin(r, from, to)
  return out
}

/** "Annual 2.5 days, sick 1 day" -- the kinds with any leave in them, in LEAVE_KINDS order. */
export function leaveWords(byKind: Record<LeaveKind, number>): string {
  return LEAVE_KINDS.filter((k) => byKind[k] > 0)
    .map((k) => `${LEAVE_META[k].label} ${fmtDays(byKind[k])} ${byKind[k] === 1 ? 'day' : 'days'}`)
    .join(', ')
}

/**
 * 2.5 as "2.5", 3 as "3", 3.75 as "3.75". Leave TAKEN is in half days; a balance can be a quarter,
 * because annual leave accrues 1.25 a month -- rounding it for the screen would show a day nobody has.
 */
export function fmtDays(n: number): string {
  const r = Math.round(n * 100) / 100
  return String(r)
}

/**
 * A NEW RECORD THAT LIES OVER ONE ALREADY THERE. One day off is one day off: two records over the
 * same day would count it twice against a balance. The database refuses it too.
 */
export function overlapping(records: LeaveRecord[], c: { userId: string; startsOn: string; endsOn: string }): LeaveRecord | null {
  return records.find((r) => isTaken(r) && r.userId === c.userId && r.startsOn <= c.endsOn && c.startsOn <= r.endsOn) ?? null
}

/* ------------------------------------------------------------------------------------------------
 * Balances
 * ---------------------------------------------------------------------------------------------- */

export interface LeaveBalance {
  kind: LeaveKind
  rule: LeaveRule
  /** What the Act gives at `asAt` for the current cycle (or accrued so far); null where it has no pot. */
  entitled: number | null
  /** Live records that have begun by `asAt`, in the cycle the balance is about. */
  taken: number
  /** Live records that begin after `asAt`, in the same cycle: booked ahead. */
  booked: number
  /** entitled - taken - booked. Negative is shown as it is: somebody has taken more than accrued. */
  left: number | null
  /** The cycle the figures are for, where there is one. */
  cycle: { from: string; to: string } | null
  /** Why a pot cannot be worked out, or what the statutory period is. */
  words: string | null
}

/**
 * EVERY KIND'S BALANCE FOR ONE PERSON AT ONE DAY.
 *
 * `startDate` is profiles.start_date (any Administrator sets it). Without it nothing that depends on
 * length of service can be worked out, and the balance says so rather than guessing a date.
 *
 * ANNUAL LEAVE CARRIES FORWARD and is accrued from the start date -- or, where somebody had been
 * working here long before Raptor kept their leave, from an OPENING BALANCE: "on this day they had
 * this many days". Then accrual counts from that day and only leave from that day on is taken off
 * it, so twelve years of leave nobody recorded here is not counted as twelve years unused.
 *
 * SICK AND FAMILY LEAVE RESET at the end of their cycle and need no opening balance: what was taken
 * earlier in the current cycle is recorded as leave on the days it was taken.
 *
 * A LEAVER accrues to their end date and no further.
 */
export function leaveBalances(input: {
  startDate: string | null
  endedOn?: string | null
  records: LeaveRecord[]
  asAt: string
}): LeaveBalance[] {
  const asAt = input.endedOn && input.endedOn < input.asAt ? input.endedOn : input.asAt
  const mine = input.records.filter(isLive)
  const taken = mine.filter((r) => r.entry === 'taken')
  const sumIn = (kind: LeaveKind, from: string | null, to: string | null) =>
    taken.filter((r) => r.kind === kind && (from === null || r.startsOn >= from) && (to === null || r.startsOn <= to))
      .reduce((s, r) => s + r.days, 0)
  const start = input.startDate

  return LEAVE_KINDS.map((kind): LeaveBalance => {
    const rule = LEAVE_META[kind].rule
    if (kind === 'annual') {
      const opening = mine.filter((r) => r.kind === 'annual' && r.entry === 'opening' && r.startsOn <= asAt)
        .sort((a, b) => (a.startsOn < b.startsOn ? 1 : a.startsOn > b.startsOn ? -1 : 0))[0] ?? null
      const base = opening ? opening.startsOn : start
      if (!base) {
        return { kind, rule, entitled: null, taken: sumIn(kind, null, asAt), booked: sumIn(kind, nextDay(asAt), null), left: null, cycle: null,
          words: 'Start date not set, so nothing has accrued.' }
      }
      const entitled = round2((opening?.days ?? 0) + ANNUAL_PER_MONTH * completedMonths(base, asAt))
      const t = sumIn(kind, base, asAt)
      const b = sumIn(kind, nextDay(asAt), null)
      return { kind, rule, entitled, taken: t, booked: b, left: round2(entitled - t - b), cycle: { from: base, to: asAt },
        words: opening ? `From an opening balance of ${fmtDays(opening.days)} on ${opening.startsOn}.` : null }
    }
    if (kind === 'sick' || kind === 'family') {
      if (!start) {
        return { kind, rule, entitled: null, taken: sumIn(kind, null, asAt), booked: sumIn(kind, nextDay(asAt), null), left: null, cycle: null,
          words: 'Start date not set, so the cycle is not known.' }
      }
      const months = completedMonths(start, asAt)
      const len = kind === 'sick' ? SICK_CYCLE_MONTHS : 12
      const idx = Math.floor(months / len)
      const from = addMonths(start, idx * len)
      const to = prevDay(addMonths(start, (idx + 1) * len))
      let entitled: number
      let words: string | null = null
      if (kind === 'sick') {
        if (months < SICK_EARLY_MONTHS) {
          entitled = Math.floor(workingDaysInclusive(start, asAt) / SICK_EARLY_RATIO)
          words = 'First six months: one day for every 26 days worked.'
        } else entitled = SICK_DAYS_PER_CYCLE
      } else if (completedMonths(start, prevDay(asAt)) < FAMILY_AFTER_MONTHS) {
        /* "LONGER THAN four months" (s27(1)(a)): four months completed by the end of yesterday. */
        entitled = 0
        words = 'Due once somebody has worked here longer than four months.'
      } else entitled = FAMILY_DAYS_PER_YEAR
      const t = sumIn(kind, from, asAt)
      const b = sumIn(kind, nextDay(asAt), to)
      return { kind, rule, entitled, taken: t, booked: b, left: round2(entitled - t - b), cycle: { from, to }, words }
    }
    return { kind, rule, entitled: null, taken: sumIn(kind, null, asAt), booked: sumIn(kind, nextDay(asAt), null), left: null, cycle: null,
      words: LEAVE_META[kind].law }
  })
}

/** s20(2)(b)'s alternative, for the firm to compare: one day for every 17 days worked. */
export function annualByDaysWorked(daysWorked: number): number {
  return Math.floor(daysWorked / ANNUAL_WORKED_RATIO)
}

const round2 = (n: number) => Math.round(n * 100) / 100
