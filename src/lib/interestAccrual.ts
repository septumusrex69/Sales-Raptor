/**
 * Interest between the last posted accrual and today.
 *
 * The book Raptor inherited posts interest once a month. Every one of the 12,078 migrated
 * accruals is a monthly row, and the ratio between consecutive full-month accruals is exactly
 * 1.0200 on 4,845 of them (and 1.0404 — 1.02 squared — on a further 453 where a month was
 * skipped). That is 24% a year charged as a flat 2% of the running balance each month,
 * capitalised, and it does not vary with whether the month had 28, 29, 30 or 31 days.
 *
 * A month is a long time to wait for a balance to move. So the balance is accrued to TODAY here,
 * pro-rated across the days elapsed, and the figure is computed rather than written: no job, no
 * cron, nothing to double-charge, and no row to reverse if the account turns out to have been
 * settled last week. The moment the open period closes, the amount this produces is exactly the
 * 2% the book has always charged — pro-rating by days-in-that-calendar-month is what makes a
 * full month land on the monthly figure to the cent.
 *
 * Compounding happens at each month boundary, as it does in the posted history: an open period
 * spanning September and October accrues September on the opening balance and October on the
 * balance September left behind.
 *
 * The convention lives in ONE place — `MONTHS_PER_YEAR` and `proRata` below — because it is the
 * one number in this system that turns time into money. If the business ever moves to true daily
 * interest (365ths of the annual rate rather than 12ths of it, which is a different and slightly
 * larger amount), it changes here and the statement follows.
 */

const MONTHS_PER_YEAR = 12

export interface OpenAccrual {
  /** First day of the open period (the day after the last posted accrual covered). */
  from: string
  /** Last day accrued — today. */
  to: string
  /** Calendar days in the open period, counting both ends. */
  days: number
  /** Interest accrued and not yet posted. */
  amount: number
}

export interface AccrualInput {
  /** What the account owed at the close of the last posted accrual. Interest runs on this. */
  openingBalance: number
  /** Annual rate as a percentage: 24 means 24% a year. */
  annualRate: number
  /** Last day already covered by a posted accrual (inclusive). */
  coveredTo: string
  /** Accrue up to and including this day. */
  asAt: string
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const parse = (s: string) => new Date(`${s}T00:00:00Z`)
const addDays = (s: string, n: number) => iso(new Date(parse(s).getTime() + n * 86_400_000))
const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000)
const daysInMonth = (s: string) => {
  const d = parse(s)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
}
const endOfMonth = (s: string) => `${s.slice(0, 7)}-${String(daysInMonth(s)).padStart(2, '0')}`
const round = (n: number) => Math.round(n * 100) / 100

/**
 * The last day a posted accrual covers.
 *
 * Swordfish stores `days` as an exclusive count, so `accrued_on + days` is the last covered day:
 * a row of 1 August for 30 days covers to 31 August, and the stub of 1 September for 6 days
 * covers to 7 September, which is where the migrated book stops. Checked against February 2026
 * (27 days → the 28th) and June (29 days → the 30th).
 */
export function coveredTo(accruals: { from: string; days: number }[]): string | null {
  let latest: string | null = null
  for (const a of accruals) {
    const end = addDays(a.from, Math.max(0, a.days))
    if (!latest || end > latest) latest = end
  }
  return latest
}

/**
 * Interest from the day after `coveredTo` up to and including `asAt`.
 *
 * Returns null where nothing has accrued — no rate, nothing owed, or the book is already current.
 * A caller that gets null shows the posted position and says so; it does not show a zero.
 */
export function accrueToDate(input: AccrualInput): OpenAccrual | null {
  const { openingBalance, annualRate, coveredTo: covered, asAt } = input
  if (!(annualRate > 0) || !(openingBalance > 0)) return null
  const from = addDays(covered, 1)
  if (from > asAt) return null

  const monthlyRate = annualRate / 100 / MONTHS_PER_YEAR
  let balance = openingBalance
  let accrued = 0

  // Month by month, so interest capitalises at each boundary exactly as the posted history does.
  let cursor = from
  while (cursor <= asAt) {
    const monthEnd = endOfMonth(cursor)
    const segmentEnd = monthEnd < asAt ? monthEnd : asAt
    const segmentDays = daysBetween(cursor, segmentEnd) + 1
    // A whole month is segmentDays === daysInMonth, so this lands on the flat monthly rate.
    const amount = balance * monthlyRate * (segmentDays / daysInMonth(cursor))
    accrued += amount
    balance += amount
    cursor = addDays(segmentEnd, 1)
  }

  return { from, to: asAt, days: daysBetween(from, asAt) + 1, amount: round(accrued) }
}
