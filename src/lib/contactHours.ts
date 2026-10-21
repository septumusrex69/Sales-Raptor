/**
 * WHEN THE FIRM MAY REACH A DEBTOR: the calling hours, shared by the call panel and campaigns.
 *
 * Lifted out of callScripts.ts unchanged (S10) because the campaign sender runs in a serverless
 * function and has to ask the same question -- and callScripts' `.ts` specifiers do not survive
 * Vercel's transpile. `.js` here, which both Vite and the API resolve.
 *
 * WHY A CAMPAIGN USES THE CALLING HOURS AND NOT A LONGER "LEGAL" WINDOW. The firm's hours
 * (weekdays 08:00-17:00, Saturday 09:00-13:00, never on a Sunday or a public holiday) sit inside
 * any reading of the reasonable hours the Debt Collectors Act code of conduct allows, and they are
 * the hours the firm already holds itself to. A text arriving at seven at night from a firm that
 * would not ring at that hour is the same intrusion by a cheaper route.
 *
 * Pure: no clock. The Johannesburg day and minute are passed in.
 */
import { publicHolidays } from './workingDays.js'

/**
 * The firm's own calling hours. Their policy rather than a statutory limit, and the brief says so:
 * "confirm these hours with the firm before the scripts go live."
 *
 * Minutes from midnight, so a comparison is arithmetic rather than string juggling.
 */
export const CALL_HOURS = {
  weekday: { from: 8 * 60, to: 17 * 60 },
  saturday: { from: 9 * 60, to: 13 * 60 },
  /** Sunday and public holidays: none at all. */
  sunday: null,
} as const

/**
 * May the firm dial at this moment?
 *
 * TAKES THE DAY AND THE MINUTE RATHER THAN A Date, so it can be checked without a clock and so the
 * caller is the one that reads the firm's own timezone -- the hours are Johannesburg's, and a
 * collector working from a laptop still set to London must not dial at seven in the morning.
 *
 * A PUBLIC HOLIDAY IS A SUNDAY HERE. The calendar is the same one the workflow's business days are
 * counted on, so a day that is not a working day for a statutory notice is not a day for a call.
 */
export function withinCallHours(day: string, minuteOfDay: number): boolean {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return false
  if (publicHolidays(date.getUTCFullYear()).has(day)) return false
  const weekday = date.getUTCDay()
  if (weekday === 0) return false
  const window = weekday === 6 ? CALL_HOURS.saturday : CALL_HOURS.weekday
  return minuteOfDay >= window.from && minuteOfDay < window.to
}

/** Why the firm may not ring now, in the collector's own words, or null. */
export function callHoursProblem(day: string, minuteOfDay: number): string | null {
  if (withinCallHours(day, minuteOfDay)) return null
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return 'That is not a day.'
  if (publicHolidays(date.getUTCFullYear()).has(day)) return 'The firm does not call on a public holiday.'
  if (date.getUTCDay() === 0) return 'The firm does not call on a Sunday.'
  if (date.getUTCDay() === 6) return 'On a Saturday the firm calls between 09:00 and 13:00.'
  return 'The firm calls between 08:00 and 17:00 on a weekday.'
}

/**
 * The minute of the day in Johannesburg at `at`, for withinCallHours. The server runs in Paris and
 * a browser can be set to anything, so the zone is named rather than taken from the machine.
 */
export function johannesburgMinute(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}
