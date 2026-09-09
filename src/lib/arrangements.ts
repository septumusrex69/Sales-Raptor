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

