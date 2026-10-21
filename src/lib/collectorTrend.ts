/**
 * A collector's last twelve months, and where they stand on the floor.
 *
 * THE RULES ONLY — no queries, no clock of its own — so the bucketing can be checked without a
 * database. That matters more here than usual: a trend chart is the one screen where being wrong
 * looks exactly like being right. Nobody double-checks a line that slopes the way they expected.
 *
 * The firm asked for both halves of this: "graphs in terms of previous months, like their
 * collections for the last, let's say, 12 months, so they can see their progress", and "they
 * should also be able to see the entire company's performance, and where they stand relative to
 * everybody else."
 */
import type { DailyTake } from './collectorStats.ts'
import { dayKey } from './collectionPace.ts'

export interface MonthWindow {
  key: string
  label: string
  start: Date
  end: Date
}

export interface MonthTake {
  key: string
  label: string
  collected: number
  payments: number
  /** Nothing came in that month, as opposed to that month not having happened yet. */
  empty: boolean
}

/**
 * A year of days, bucketed into the firm's own months.
 *
 * THE BOUNDARIES COME IN AS DATES AND ARE COMPARED AS LOCAL DAYS. The firm's month runs the 11th
 * to the 10th, so a payment on the 10th and one on the 11th belong to different months — which
 * means an off-by-one here does not smooth a line, it moves a month's takings into the month
 * beside it and makes both wrong. Comparing on the day key rather than on timestamps is what
 * keeps the edges exact: `end` is the last day INCLUSIVE, the way the firm reads it.
 *
 * Every window asked for comes back, including the ones with nothing in them. A chart that simply
 * omits a quiet month draws a straight line through it and tells the reader the takings held up.
 */
export function bucketByMonth(daily: DailyTake[], windows: MonthWindow[]): MonthTake[] {
  return windows.map((w) => {
    const from = dayKey(w.start)
    const to = dayKey(w.end)
    let collected = 0
    let payments = 0
    for (const d of daily) {
      if (d.day < from || d.day > to) continue
      collected += d.collected
      payments += d.payments
    }
    return { key: w.key, label: w.label, collected, payments, empty: payments === 0 }
  })
}

/** The biggest month in a set, for scaling a chart. Never nought, so nothing divides by it. */
export function peakOf(months: MonthTake[]): number {
  return Math.max(1, ...months.map((m) => m.collected))
}

/**
 * How this month compares with the average of the ones before it.
 *
 * AGAINST THE MONTHS BEFORE IT, not against last month alone. One quiet August makes September
 * look like a triumph and October like a collapse, and a collector reading their own page should
 * not be handed that. Null until there are at least three months to average, because two is not a
 * trend and saying so would be inventing one.
 */
export function trendAgainstAverage(months: MonthTake[]): number | null {
  /*
   * THREE MONTHS TO AVERAGE, and that single guard is the whole rule. A length check on `months`
   * used to sit above this one and was unreachable: `past` can never be longer than `months`
   * minus one, so anything the outer guard would have caught this one catches first. Found by
   * break-testing it — the mutation that loosened it changed no answer at all.
   */
  const past = months.slice(0, -1).filter((m) => !m.empty)
  if (past.length < 3) return null
  const average = past.reduce((t, m) => t + m.collected, 0) / past.length
  if (average <= 0) return null
  return months[months.length - 1].collected / average - 1
}

/* ---------- where somebody stands ---------- */

export interface Standing {
  /** 1 is the top. Ties share a place, the way a results board does. */
  place: number
  /** How many people the place is out of. */
  outOf: number
}

/**
 * Rank a floor on one figure, with ties sharing a place.
 *
 * SHARED PLACES, NOT SEQUENTIAL ONES. Two collectors on the same figure are in the same place,
 * and the next one down takes the place their count implies — 1, 2, 2, 4. Numbering them 1, 2, 3,
 * 4 would tell one of two identical people they are behind the other, which is a fact the screen
 * would be inventing.
 */
export function standings<T extends { userId: string }>(
  rows: T[], value: (row: T) => number,
): Map<string, Standing> {
  const sorted = [...rows].sort((a, b) => value(b) - value(a))
  const out = new Map<string, Standing>()
  let place = 0
  let seen = 0
  let last: number | null = null
  for (const row of sorted) {
    seen += 1
    const v = value(row)
    if (last === null || v !== last) { place = seen; last = v }
    out.set(row.userId, { place, outOf: rows.length })
  }
  return out
}

/**
 * How to say a place out loud.
 *
 * "3rd of 28" and not "top 11%". A percentile is a way of describing a person that nobody uses
 * about themselves, and on a floor of twenty-eight it is also less precise than the plain number.
 */
export function placeLabel(standing: Standing | undefined): string {
  if (!standing) return '—'
  const n = standing.place
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th'
    : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
  return `${n}${suffix} of ${standing.outOf}`
}
