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
