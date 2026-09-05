export interface ParsedEmailActivity {
  direction: 'sent' | 'received'
  isSpam: boolean
  /** The email's own subject line, with the CRM's own "Email sent:"/"Email received:" framing stripped off. */
  subject: string
}

const PREFIXES: { prefix: string; direction: ParsedEmailActivity['direction']; isSpam: boolean }[] = [
  { prefix: 'Email received (was in Spam/Junk): ', direction: 'received', isSpam: true },
  { prefix: 'Email received: ', direction: 'received', isSpam: false },
  { prefix: 'Email sent: ', direction: 'sent', isSpam: false },
]

/**
 * "Today" / "Yesterday" / "Friday 4 September" / "4 September 2025" — the heading a run of
 * emails sits under, so each row can show just a time instead of repeating the full date
 * twenty-one times down the list.
 */
export function emailDayLabel(iso: string): string {
  const date = new Date(iso)
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const dayDiff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000)
  if (dayDiff === 0) return 'Today'
  if (dayDiff === 1) return 'Yesterday'
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('en-ZA', {
    weekday: dayDiff < 7 ? 'long' : undefined,
    day: 'numeric',
    month: 'long',
    year: sameYear ? undefined : 'numeric',
  })
}

/** Just the clock time — the day heading above the row carries the date. */
export function emailTimeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Parses an Activity's stored `subject` (see ComposeEmailModal.tsx / emailSync.ts) back into direction + the email's real subject. Returns null for anything not logged in that convention. */
export function parseEmailActivity(rawSubject: string): ParsedEmailActivity | null {
  for (const { prefix, direction, isSpam } of PREFIXES) {
    if (rawSubject.startsWith(prefix)) return { direction, isSpam, subject: rawSubject.slice(prefix.length) }
  }
  return null
}
