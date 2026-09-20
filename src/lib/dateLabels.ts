/**
 * How a date reads in a list.
 *
 * Recent dates are easier to place by name than by number — "Yesterday" lands immediately
 * where "05 Sep 2026" needs a moment's arithmetic. That advantage runs out fast, though: past
 * a fortnight nobody counts back, so an exact date beats "37 days ago". This switches over at
 * the point the counting stops being useful.
 *
 * Uses a fresh clock on every call rather than a module-level constant — a tab left open
 * overnight would otherwise still be calling this morning "yesterday".
 */
export function relativeDayLabel(iso?: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const dayDiff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000)

  if (dayDiff === 0) return 'Today'
  if (dayDiff === 1) return 'Yesterday'
  if (dayDiff > 1 && dayDiff < 7) return date.toLocaleDateString('en-ZA', { weekday: 'long' })
  if (dayDiff >= 7 && dayDiff < 14) return 'Last week'

  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: sameYear ? undefined : 'numeric' })
}

/**
 * The heading a run of rows sits under when a list is ordered by date.
 *
 * Coarser than `relativeDayLabel` on purpose: a per-day heading suits emails, which arrive in
 * clusters, but leads and deals trickle in over months — day headings there would produce a
 * page of headings with one row under each. So the recent past keeps its day names, and
 * anything older collapses into the month it happened in.
 */
export function dateGroupLabel(iso?: string): string {
  if (!iso) return 'No date'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'No date'

  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86400000)

  if (dayDiff === 0) return 'Today'
  if (dayDiff === 1) return 'Yesterday'
  if (dayDiff > 1 && dayDiff < 7) return date.toLocaleDateString('en-ZA', { weekday: 'long' })
  if (dayDiff >= 7 && dayDiff < 14) return 'Last week'
  // Dates in the future (a back-dated close date, a mistyped year) shouldn't be filed under
  // a month heading that reads as though they already happened.
  if (dayDiff < 0) return 'Upcoming'

  const sameMonth = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
  if (sameMonth) return 'Earlier this month'

  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString('en-ZA', { month: 'long', year: sameYear ? undefined : 'numeric' })
}

/**
 * How long an account has been on the desk: "11 months on the desk".
 *
 * WHOLE MONTHS, ROUNDED DOWN, because that is how the work is talked about — a collector says
 * "we have had this one eleven months", never "three hundred and thirty-four days". Under a
 * month says so rather than reading "0 months", and past two years it switches to years, since
 * by then the month is no longer the interesting part.
 *
 * The day-of-month comparison is the whole of the difference between right and nearly right.
 * Handed over on the 20th of September and read on the 14th of the following September is
 * ELEVEN months, not twelve: the anniversary has not come round yet. Without that line the
 * account would claim to be a year old six days early, which on a book where prescription is
 * counted in years is not a rounding error.
 *
 * A date in the future is a data error rather than an age, and comes back empty so the caller
 * shows the date alone.
 */
export function timeOnDesk(iso?: string | null, now: Date = new Date()): string {
  if (!iso) return ''
  const from = new Date(iso)
  if (Number.isNaN(from.getTime())) return ''

  let months = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth())
  if (now.getDate() < from.getDate()) months -= 1

  if (months < 0) return ''
  if (months === 0) return 'this month'
  if (months === 1) return '1 month on the desk'
  if (months < 24) return `${months} months on the desk`
  const years = Math.floor(months / 12)
  return `${years} years on the desk`
}

/**
 * The time of day a message arrived, beside the day it arrived on.
 *
 * `relativeDayLabel` answers "which day", which is the right answer in a list. Open one message
 * and "Today" stops being enough -- two emails from the same debtor an hour apart are a different
 * story from two a week apart, and the hour is what tells them apart.
 *
 * 24-hour, because that is how South Africa writes a time and because "13:42" cannot be misread
 * the way a stray am/pm can.
 */
export function timeOfDay(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * "14 Mar 2026" — a date short enough to sit on a workflow card.
 *
 * HAND-ROLLED, LIKE longDate, AND FOR THE SAME REASON. `toLocaleDateString('en-ZA')` renders
 * September as "Sept" — four letters where every other month gets three — so a column of dates
 * comes out visibly ragged one month in twelve. It also groups with a non-breaking space
 * elsewhere in that locale, which is the other half of the same trap. Twelve strings written out
 * are cheaper than either.
 *
 * The year is kept. A 160-day workflow dated from November closes in April, and a card reading
 * "12 Apr" beside one reading "3 Nov" invites exactly the wrong reading.
 */
export function shortDate(date: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d || m < 1 || m > 12) return date
  return `${d} ${months[m - 1]} ${y}`
}
