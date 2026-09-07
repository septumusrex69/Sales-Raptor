import { endOfDay, endOfWeek, format, startOfDay, startOfWeek } from 'date-fns'
import type { SalesMonthPeriod } from './salesMonth'

/**
 * The few ranges that aren't months at all — a day, a week, an arbitrary span, everything.
 *
 * The calendar-month helpers that used to live here are gone. They existed so the Leads page
 * could filter on 1–30 September while the rest of Raptor counted the Sales Month of 11 Aug –
 * 10 Sep, which meant a lead created on the 15th sat in one month on Leads and a different one
 * on the dashboard. Months are now the business's months everywhere; see salesMonth.ts.
 *
 * These share the same {start,end,label,rangeLabel,key} shape so they plug straight into
 * isWithinPeriod() alongside a real Sales Month.
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

export function getAllTime(ref: Date): SalesMonthPeriod {
  return { start: new Date(0), end: endOfDay(ref), label: 'All Time', rangeLabel: 'Every lead, any date', key: 'all-time' }
}

export function getToday(ref: Date): SalesMonthPeriod {
  return buildRange(startOfDay(ref), endOfDay(ref), 'Today', `today-${format(ref, 'yyyy-MM-dd')}`)
}

export function getThisWeek(ref: Date): SalesMonthPeriod {
  const start = startOfWeek(ref, { weekStartsOn: 1 })
  const end = endOfWeek(ref, { weekStartsOn: 1 })
  return buildRange(start, end, 'This Week', `week-${format(start, 'yyyy-MM-dd')}`)
}

export function buildCustomDateRange(startStr: string, endStr: string): SalesMonthPeriod | undefined {
  if (!startStr || !endStr) return undefined
  const start = startOfDay(new Date(`${startStr}T00:00:00`))
  const end = endOfDay(new Date(`${endStr}T00:00:00`))
  if (start > end) return undefined
  return buildRange(start, end, 'Custom Range', `custom-${startStr}-${endStr}`)
}

