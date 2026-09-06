import { addMonths, endOfDay, format, isWithinInterval, parseISO, setDate, startOfDay, startOfYear, subMonths } from 'date-fns'

/**
 * Romulus's fiscal reporting period: the 11th of a month through the
 * 10th of the following month, inclusive. Named after the month it ends in
 * (e.g. 11 Aug – 10 Sep is the "September" Sales Month).
 */
export interface SalesMonthPeriod {
  start: Date
  end: Date
  /** Month the period ends in, e.g. "September 2026" */
  label: string
  /** Full date range, e.g. "11 Aug 2026 – 10 Sep 2026" */
  rangeLabel: string
  /** Stable sort/compare key, e.g. "2026-09" */
  key: string
}

function buildPeriod(start: Date, end: Date): SalesMonthPeriod {
  return {
    start,
    end,
    label: format(end, 'MMMM yyyy'),
    rangeLabel: `${format(start, 'd MMM yyyy')} – ${format(end, 'd MMM yyyy')}`,
    key: format(end, 'yyyy-MM'),
  }
}

/** Returns the Sales Month period containing the given date. */
export function getSalesMonthForDate(d: Date): SalesMonthPeriod {
  // If we're on/after the 11th, this period ends next calendar month;
  // otherwise it ends in the current calendar month.
  const endMonthAnchor = d.getDate() >= 11 ? addMonths(d, 1) : d
  const end = endOfDay(setDate(endMonthAnchor, 10))
  const start = startOfDay(setDate(subMonths(endMonthAnchor, 1), 11))
  return buildPeriod(start, end)
}

export function getCurrentSalesMonth(referenceDate: Date): SalesMonthPeriod {
  return getSalesMonthForDate(referenceDate)
}

export function getPreviousSalesMonth(period: SalesMonthPeriod): SalesMonthPeriod {
  return getSalesMonthForDate(subMonths(period.end, 1))
}

export function getNextSalesMonth(period: SalesMonthPeriod): SalesMonthPeriod {
  return getSalesMonthForDate(addMonths(period.start, 1))
}

/** True if `referenceDate` falls inside this period (i.e. it's the in-progress current period). */
export function isCurrentPeriod(period: SalesMonthPeriod, referenceDate: Date): boolean {
  return isWithinInterval(referenceDate, { start: period.start, end: period.end })
}

/**
 * The last `count` Sales Months up to and including the one containing
 * `referenceDate`, oldest first — the shape a trend chart's x-axis wants.
 */
export function listRecentSalesMonths(referenceDate: Date, count: number): SalesMonthPeriod[] {
  const out: SalesMonthPeriod[] = []
  let cursor = getCurrentSalesMonth(referenceDate)
  for (let i = 0; i < count; i++) {
    out.unshift(cursor)
    cursor = getPreviousSalesMonth(cursor)
  }
  return out
}

/**
 * A single wide period spanning the last `count` Sales Months, for
 * "Last 3/6/12 Sales Months" filter options — start of the oldest period
 * through end of the current one.
 */
export function getLastNSalesMonthsRange(referenceDate: Date, count: number): SalesMonthPeriod {
  const months = listRecentSalesMonths(referenceDate, count)
  const start = months[0].start
  const end = months[months.length - 1].end
  return {
    start,
    end,
    label: `Last ${count} Sales Months`,
    rangeLabel: `${format(start, 'd MMM yyyy')} – ${format(end, 'd MMM yyyy')}`,
    key: `last-${count}`,
  }
}

/** Every record ever entered, through `referenceDate` — no start date to reason about. */
export function getAllTimeRange(referenceDate: Date): SalesMonthPeriod {
  return {
    start: new Date(0),
    end: referenceDate,
    label: 'All Time',
    rangeLabel: 'Since the beginning',
    key: 'all-time',
  }
}

/** Calendar-year Year to Date, through `referenceDate` (not through the full in-progress Sales Month). */
export function getYTDRange(referenceDate: Date): SalesMonthPeriod {
  const start = startOfYear(referenceDate)
  return {
    start,
    end: referenceDate,
    label: `${format(referenceDate, 'yyyy')} Year to Date`,
    rangeLabel: `${format(start, 'd MMM yyyy')} – ${format(referenceDate, 'd MMM yyyy')}`,
    key: `ytd-${format(referenceDate, 'yyyy')}`,
  }
}

export function isWithinPeriod(iso: string | undefined, period: SalesMonthPeriod): boolean {
  if (!iso) return false
  return isWithinInterval(parseISO(iso), { start: period.start, end: period.end })
}

export function encodeSalesMonthParam(period: SalesMonthPeriod): string {
  return `${format(period.start, 'yyyy-MM-dd')}_${format(period.end, 'yyyy-MM-dd')}`
}

export function decodeSalesMonthParam(param: string | null | undefined): SalesMonthPeriod | undefined {
  if (!param) return undefined
  const [startStr, endStr] = param.split('_')
  if (!startStr || !endStr) return undefined
  try {
    return buildPeriod(startOfDay(parseISO(startStr)), endOfDay(parseISO(endStr)))
  } catch {
    return undefined
  }
}
