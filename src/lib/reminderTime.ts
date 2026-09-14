/**
 * The arithmetic behind "call me back in an hour".
 *
 * Separated from everything that touches a database or a screen because it is the half that can
 * be wrong quietly. A reminder that fires an hour late is worse than no reminder: the debtor was
 * told a time, and the collector believed the app.
 */

/** What somebody reaches for mid-call, in the order they reach for it. */
export const REMINDER_PRESETS = [
  { minutes: 15, label: 'In 15 minutes' },
  { minutes: 30, label: 'In 30 minutes' },
  { minutes: 60, label: 'In an hour' },
  { minutes: 120, label: 'In 2 hours' },
  { minutes: 240, label: 'In 4 hours' },
] as const

/** How long a snooze is. One value, so the button and the write cannot disagree. */
export const SNOOZE_MINUTES = 10

/**
 * The moment a reminder is due.
 *
 * NOT rounded to the nearest five minutes, and that is a decision rather than an omission. "In
 * an hour" means an hour: a debtor told "I will ring you at twenty past" is not served by a
 * reminder at half past, and the collector has no way to know the app moved it.
 */
export function dueAt(minutes: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + minutes * 60_000)
}

/**
 * The time of day a reminder lands, for the button that sets it: "In an hour · 15:40".
 *
 * Shown because "in an hour" and a clock time are different questions, and somebody on a call
 * is usually being told one and thinking in the other.
 */
export function clockTime(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * How late a reminder is, in words, for the popup.
 *
 * A reminder nobody was there for is the normal case — a tab was closed, a call ran long — so
 * this has to read well hours later as well as on the minute. Under a minute says "now" rather
 * than "0 minutes late", which reads like a bug.
 */
export function lateness(due: Date, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - due.getTime()) / 1000)
  if (seconds < 60) return 'now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) {
    return rest === 0
      ? `${hours} hour${hours === 1 ? '' : 's'} ago`
      : `${hours}h ${rest}m ago`
  }

  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * Is it time yet?
 *
 * A second of slack either way is meaningless here, so this is a plain comparison — the polling
 * interval is the real resolution, and pretending otherwise would be false precision.
 */
export function isDue(due: Date, now: Date = new Date()): boolean {
  return due.getTime() <= now.getTime()
}

/**
 * A time typed as "15:40" against a day, for the custom option.
 *
 * Returns null rather than a guess for anything that is not a time, and for a time that has
 * already gone today — a reminder in the past would pop the instant it was saved, which reads
 * as the app malfunctioning rather than as the mistake it is.
 */
export function atClockTime(value: string, from: Date = new Date()): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const hours = Number(m[1])
  const minutes = Number(m[2])
  if (hours > 23 || minutes > 59) return null

  const at = new Date(from)
  at.setHours(hours, minutes, 0, 0)
  return at.getTime() <= from.getTime() ? null : at
}
