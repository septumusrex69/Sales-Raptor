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
