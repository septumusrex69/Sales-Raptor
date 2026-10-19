/**
 * A CLIENT'S COLLECTIONS, MONTH BY MONTH (S9, 19 Oct) -- "Collections performance" on the client
 * page, after the firm's own mock: what was collected each month as a bar, and the recovery rate as
 * a line.
 *
 * SALES MONTHS, the 11th to the 10th, named for the month they end in: the payover cycle, the
 * handover chart beside it and the firm's own dashboard ("16 Mar 2022 - 10 Sep 2026") all cut the
 * year there, and a client chart cut on the 1st would put one month's money in two bars.
 *
 * THE RATE IS THE BOOK'S, TO THAT MONTH'S END: everything collected so far over everything handed
 * over so far -- not the month's collections over the month's handovers, which swings from nothing
 * to several hundred percent and means nothing. So the line ends on the very figure the tile and
 * the ring state, because it is the same division over the same accounts (withdrawn left out of
 * both, by client_money_by_day exactly as by client_account_outcomes).
 *
 * PURE: the rows and the window come in; the browser's clock does not.
 */
import { getSalesMonthForDate, getPreviousSalesMonth } from './salesMonth.ts'

export interface MoneyDay { day: string; capital: number; collected: number }
export interface CollectionMonth {
  key: string
  label: string
  collected: number
  /** Recovery rate of the whole book at this month's end, in percent; null before anything was handed over. */
  rate: number | null
  /** Still running: today falls inside it. Its bar is drawn, and said to be partial. */
  current: boolean
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const at = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`)

/**
 * The last `months` sales months up to the one holding `today`, oldest first -- or, with
 * `months: 'all'`, every month from the first one anything happened in.
 */
export function collectionMonths(rows: MoneyDay[], today: string, months: number | 'all'): CollectionMonth[] {
  const now = getSalesMonthForDate(at(today))
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day))
  let first = now
  if (months === 'all') {
    if (sorted.length > 0) first = getSalesMonthForDate(at(sorted[0].day))
  } else {
    for (let i = 1; i < months; i++) first = getPreviousSalesMonth(first)
  }
  const periods = [first]
  while (periods[periods.length - 1].key < now.key) {
    const last = periods[periods.length - 1]
    periods.push(getSalesMonthForDate(new Date(last.end.getTime() + 86_400_000)))
  }
  const years = new Set(periods.map((p) => p.key.slice(0, 4)))

  /* THE RUNNING TOTALS START BEFORE THE WINDOW: a rate at the end of June is the whole book's to
     June, including every year before the chart's first bar. */
  let capital = 0
  let collected = 0
  let i = 0
  const firstStart = periods[0].start
  while (i < sorted.length && at(sorted[i].day) < firstStart) {
    capital += sorted[i].capital; collected += sorted[i].collected; i += 1
  }
  return periods.map((p) => {
    let inMonth = 0
    while (i < sorted.length && at(sorted[i].day) <= p.end) {
      capital += sorted[i].capital; collected += sorted[i].collected; inMonth += sorted[i].collected; i += 1
    }
    const [y, m] = p.key.split('-').map(Number)
    return {
      key: p.key,
      label: years.size > 1 ? `${MON[m - 1]} ${String(y).slice(2)}` : MON[m - 1],
      collected: Math.round(inMonth * 100) / 100,
      rate: capital > 0 ? Math.round((collected / capital) * 1000) / 10 : null,
      current: p.key === now.key,
    }
  })
}
