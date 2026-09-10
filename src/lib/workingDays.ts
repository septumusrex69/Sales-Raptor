/**
 * Working days, South African.
 *
 * A query gives the debtor seven working days to put their dispute in writing, and a letter that
 * says "by 18 September" has to be right — it is the date the firm will later stand on when it
 * says the debtor was given their chance. Seven calendar days and seven working days can be more
 * than a week apart over Easter, so this counts properly rather than adding 7 and hoping.
 *
 * A working day here is Monday to Friday and not a public holiday, which is what the National
 * Credit Act means by a business day.
 *
 * Pure on purpose: no imports, no database, no clock of its own. Everything takes and returns
 * 'YYYY-MM-DD'.
 */

/** The fixed-date holidays of the Public Holidays Act 36 of 1994, as month/day. */
const FIXED: [month: number, day: number, name: string][] = [
  [1, 1, "New Year's Day"],
  [3, 21, 'Human Rights Day'],
  [4, 27, 'Freedom Day'],
  [5, 1, "Workers' Day"],
  [6, 16, 'Youth Day'],
  [8, 9, "National Women's Day"],
  [9, 24, 'Heritage Day'],
  [12, 16, 'Day of Reconciliation'],
  [12, 25, 'Christmas Day'],
  [12, 26, 'Day of Goodwill'],
]

const iso = (d: Date): string => d.toISOString().slice(0, 10)
const parse = (s: string): Date => new Date(`${s}T00:00:00Z`)
const shift = (s: string, days: number): string => {
  const d = parse(s)
  d.setUTCDate(d.getUTCDate() + days)
  return iso(d)
}

/**
 * Easter Sunday, by the anonymous Gregorian computus. Good Friday is two days before it and
 * Family Day the day after, and both are public holidays here.
 */
export function easterSunday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Every public holiday in a year, as date -> name.
 *
 * The Sunday rule (s2(1) of the Act): a public holiday falling on a Sunday moves to the Monday.
 * It does NOT cascade — in 2022 Christmas fell on the Sunday and the Monday was already the Day
 * of Goodwill, and 27 December was not a holiday. So the Monday is added only if it is free.
 *
 * `extra` is for the once-off holidays a President declares — election days, days of mourning.
 * They are real and they are not predictable, so they are supplied rather than computed.
 */
export function publicHolidays(year: number, extra: Record<string, string> = {}): Map<string, string> {
  const days = new Map<string, string>()
  const add = (date: string, name: string) => {
    if (!days.has(date)) days.set(date, name)
  }
  for (const [month, day, name] of FIXED) {
    add(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, name)
  }
  const easter = easterSunday(year)
  add(shift(easter, -2), 'Good Friday')
  add(shift(easter, 1), 'Family Day')

  // Applied after every holiday is known, so a Sunday holiday never lands on another one.
  for (const [date, name] of [...days]) {
    if (parse(date).getUTCDay() === 0) add(shift(date, 1), `${name} (observed)`)
  }
  for (const [date, name] of Object.entries(extra)) {
    if (date.startsWith(`${year}-`)) days.set(date, name)
  }
  return days
}

/** Public holidays across the years a range touches, so a count can cross New Year. */
function holidaysFor(from: string, to: string, extra: Record<string, string>): Map<string, string> {
  const first = Number(from.slice(0, 4))
  const last = Number(to.slice(0, 4))
  const all = new Map<string, string>()
  for (let y = Math.min(first, last); y <= Math.max(first, last); y++) {
    for (const [d, n] of publicHolidays(y, extra)) all.set(d, n)
  }
  return all
}

export function isWeekend(date: string): boolean {
  const day = parse(date).getUTCDay()
  return day === 0 || day === 6
}

export function isWorkingDay(date: string, extra: Record<string, string> = {}): boolean {
  if (isWeekend(date)) return false
  return !publicHolidays(Number(date.slice(0, 4)), extra).has(date)
}

/**
 * `count` working days after `from`, not counting `from` itself.
 *
 * A letter sent on Monday giving seven working days is due the Wednesday of the following week —
 * the day it was sent is not one of the days the debtor gets. Passing 0 gives back the next
 * working day on or after `from`, which is what a date has to be moved to when the thing that
 * produced it landed on a Saturday.
 */
export function addWorkingDays(from: string, count: number, extra: Record<string, string> = {}): string {
  if (count <= 0) {
    let cursor = from
    let guard = 0
    while (!isWorkingDay(cursor, extra) && guard++ < 30) cursor = shift(cursor, 1)
    return cursor
  }
  let cursor = from
  let left = count
  let guard = 0
  while (left > 0 && guard++ < 400) {
    cursor = shift(cursor, 1)
    if (isWorkingDay(cursor, extra)) left--
  }
  return cursor
}

/** `count` working days before `to`. Used for the reminder that goes out ahead of a deadline. */
export function subtractWorkingDays(to: string, count: number, extra: Record<string, string> = {}): string {
  let cursor = to
  let left = count
  let guard = 0
  while (left > 0 && guard++ < 400) {
    cursor = shift(cursor, -1)
    if (isWorkingDay(cursor, extra)) left--
  }
  return cursor
}

/** How many working days lie between two dates, excluding `from` and including `to`. */
export function workingDaysBetween(from: string, to: string, extra: Record<string, string> = {}): number {
  if (to <= from) return 0
  const holidays = holidaysFor(from, to, extra)
  let count = 0
  let cursor = from
  let guard = 0
  while (cursor < to && guard++ < 4000) {
    cursor = shift(cursor, 1)
    if (!isWeekend(cursor) && !holidays.has(cursor)) count++
  }
  return count
}
