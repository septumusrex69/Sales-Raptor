import { addMonths, endOfDay, endOfMonth, endOfWeek, format, startOfDay, startOfMonth, startOfWeek, startOfYear, subMonths } from 'date-fns'
import type { SalesMonthPeriod } from './salesMonth'

/**
 * Calendar-based date ranges for the Leads page "Date Added" period filter —
 * deliberately separate from salesMonth.ts's fiscal 11th–10th Sales Month
 * system used by Dashboard/Reports. Shares the same {start,end,label,
 * rangeLabel,key} shape so it plugs straight into isWithinPeriod().
 */

function buildRange(start: Date, end: Date, label: string, key: string): SalesMonthPeriod {
  return {
    start,
    end,
    label,
    rangeLabel: `${format(start, 'd MMM yyyy')} – ${format(end, 'd MMM yyyy')}`,
    key,
  }
}

export function getToday(ref: Date): SalesMonthPeriod {
  return buildRange(startOfDay(ref), endOfDay(ref), 'Today', `today-${format(ref, 'yyyy-MM-dd')}`)
}

export function getThisWeek(ref: Date): SalesMonthPeriod {
  const start = startOfWeek(ref, { weekStartsOn: 1 })
  const end = endOfWeek(ref, { weekStartsOn: 1 })
  return buildRange(start, end, 'This Week', `week-${format(start, 'yyyy-MM-dd')}`)
}

export function getThisCalendarMonth(ref: Date): SalesMonthPeriod {
  const start = startOfMonth(ref)
  const end = endOfMonth(ref)
  return buildRange(start, end, format(ref, 'MMMM yyyy'), `month-${format(ref, 'yyyy-MM')}`)
}

export function getLastCalendarMonth(ref: Date): SalesMonthPeriod {
  return getThisCalendarMonth(subMonths(ref, 1))
}

export function getLastNCalendarMonths(ref: Date, n: number): SalesMonthPeriod {
  const start = startOfMonth(subMonths(ref, n - 1))
  const end = endOfMonth(ref)
  return buildRange(start, end, `Last ${n} Months`, `last-${n}-${format(ref, 'yyyy-MM')}`)
}

export function getThisCalendarYear(ref: Date): SalesMonthPeriod {
  const start = startOfYear(ref)
  return buildRange(start, endOfDay(ref), `${format(ref, 'yyyy')} Year to Date`, `year-${format(ref, 'yyyy')}`)
}

export function buildCustomDateRange(startStr: string, endStr: string): SalesMonthPeriod | undefined {
  if (!startStr || !endStr) return undefined
  const start = startOfDay(new Date(`${startStr}T00:00:00`))
  const end = endOfDay(new Date(`${endStr}T00:00:00`))
  if (start > end) return undefined
  return buildRange(start, end, 'Custom Range', `custom-${startStr}-${endStr}`)
}

/** Steps a month-shaped period (as returned by getThisCalendarMonth) forward/back by one calendar month. */
export function getAdjacentCalendarMonth(period: SalesMonthPeriod, direction: 1 | -1): SalesMonthPeriod {
  const anchor = direction === 1 ? addMonths(period.start, 1) : subMonths(period.start, 1)
  return getThisCalendarMonth(anchor)
}

/** The equivalent-length period immediately before `period`, for period-over-period comparison. */
export function getPreviousEquivalentRange(period: SalesMonthPeriod): SalesMonthPeriod {
  const lengthMs = period.end.getTime() - period.start.getTime()
  const end = new Date(period.start.getTime() - 1)
  const start = new Date(end.getTime() - lengthMs)
  return buildRange(start, end, 'Previous Period', `prev-${period.key}`)
}
