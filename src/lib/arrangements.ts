/**
 * Instalment arrangements: how a promise repeats, and when it next falls due.
 *
 * Pure calendar arithmetic, kept out of accountWorkspace.ts so it can be tested without a
 * browser or a database. The rules here are the ones that only misbehave in the months that
 * embarrass you — February, the 31st, a leap year — which is exactly the reason they are worth
 * testing at all.
 */

/**
 * The parts of a promise this module needs, and no more.
 *
 * Structural rather than importing PromiseToPay: that type lives beside the Supabase client, and
 * depending on it would drag the database into a file whose whole job is date arithmetic.
 */
export interface Recurring {
  arrangement: Arrangement
  dueOn: string
  dayOfMonth: number | null
  onLastDay: boolean
  dayOfWeek: number | null
}

export type Arrangement = 'once_off' | 'weekly' | 'monthly'

export const ARRANGEMENT_LABEL: Record<Arrangement, string> = {
  once_off: 'Once-off settlement',
  weekly: 'Weekly instalment',
  monthly: 'Monthly instalment',
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/**
 * The next date an arrangement falls due, given the one just kept.
 *
 * Written as calendar arithmetic rather than "add 30 days", because an instalment arrangement is
 * a date in the month, not an interval. The last day of the month is the 28th in February and the
 * 31st in March; a debtor paid on the 25th pays on the 25th. Adding days drifts, and a drifting
 * due date is one the debtor is right to argue about.
 */
export function nextDueDate(p: Recurring): string | null {
  const [y, m, d] = p.dueOn.split('-').map(Number)
  if (p.arrangement === 'weekly') {
    const next = new Date(Date.UTC(y, m - 1, d + 7))
    return next.toISOString().slice(0, 10)
  }
  if (p.arrangement === 'monthly') {
    // Day 0 of the following month is the last day of the target month, which is how the
    // last-day rule and the clamp for a 31st in a 30-day month are both expressed.
    const lastOfNext = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    const day = p.onLastDay ? lastOfNext : Math.min(p.dayOfMonth ?? d, lastOfNext)
    return new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10)
  }
  return null
}

/** How an arrangement reads to a person: "R1,500 monthly on the last day". */
export function describeArrangement(p: Recurring): string {
  if (p.arrangement === 'once_off') return 'Once-off'
  if (p.arrangement === 'weekly') {
    return p.dayOfWeek ? `Weekly on ${WEEKDAYS[p.dayOfWeek - 1]}` : 'Weekly'
  }
  if (p.onLastDay) return 'Monthly on the last day'
  return p.dayOfMonth ? `Monthly on the ${ordinal(p.dayOfMonth)}` : 'Monthly'
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}


/**
 * How many instalments have fallen due by a given day.
 *
 * COUNTED FROM THE SCHEDULE, never from a flag. An arrangement taken in June at R300 a month has
 * had four instalments due by October whatever anybody has recorded against it -- and a count
 * that waited to be told would report a debtor as current on the very day they stopped paying,
 * which is the day it matters.
 *
 * WALKED WITH nextDueDate rather than divided by 30. An instalment arrangement is a date in the
 * month, not an interval: the last day is the 28th in February and the 31st in March, and a
 * debtor who pays on the 25th pays on the 25th. Dividing drifts, and a drifting count is one the
 * debtor is right to argue about.
 *
 * THE FIRST ONE COUNTS ON ITS OWN DAY. An instalment due today is due, not due tomorrow.
 *
 * BOUNDED, because this walks. The walk cannot actually spin -- nextDueDate returns null for a
 * once-off and the loop stops on that -- so the cap is for a row nobody has thought of rather
 * than for a case that is known to exist. A weekly arrangement running five years is 260
 * instalments, so it is well past anything the firm writes.
 *
 * The once-off is answered before the loop for plainness, not for safety: one instalment is what
 * a once-off is, and saying so where it is asked reads better than inferring it from a null.
 */
export function instalmentsDue(p: Recurring, today: string): number {
  if (p.dueOn > today) return 0
  if (p.arrangement === 'once_off') return 1
  let due = 1
  let cursor: Recurring = p
  /* A weekly arrangement running five years is 260 instalments; the cap is well past anything
     the firm writes and stops a bad row walking for ever. */
  for (let i = 0; i < 600; i += 1) {
    const next = nextDueDate(cursor)
    if (!next || next > today) return due
    due += 1
    cursor = { ...cursor, dueOn: next }
  }
  return due
}
