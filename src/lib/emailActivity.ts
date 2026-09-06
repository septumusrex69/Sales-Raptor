import { relativeDayLabel } from './dateLabels'

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
 * The heading a run of emails sits under, so each row shows just a time instead of repeating
 * the full date twenty-one times down the list. Shares one definition with the leads and deals
 * tables — a date should read the same wherever it appears.
 */
export function emailDayLabel(iso: string): string {
  return relativeDayLabel(iso)
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
