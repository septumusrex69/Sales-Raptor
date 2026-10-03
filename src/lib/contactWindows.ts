/**
 * WHEN THIS DEBTOR ASKED TO BE TELEPHONED.
 *
 * THE FIRM: "maybe we can add something like there, contact time, between certain hours, and then
 * you can choose the two hours and then add a different schedule -- for example the debtor likes
 * to be contacted between 8 and 9, and 7 and 5."
 *
 * TWO WINDOWS, NOT ONE RANGE, and that example is the reason. Somebody who can take a call before
 * work and again after it is not available all day, and a single "08:00 to 17:00" says exactly
 * that -- which is how a collector rings a man on a factory floor at eleven in the morning, is
 * told to stop calling, and the account goes quiet.
 *
 * WHY IT IS NOT A PREFERENCE. `contact_preference` is HOW to reach them -- SMS, WhatsApp, a call.
 * This is WHEN, and the two are independent: a debtor who wants WhatsApp only still wants it
 * during their lunch hour. Kept apart on the row for the same reason they are kept apart on the
 * screen.
 *
 * Pure: no database, no clock of its own. The time to compare against is passed in, because the
 * firm's hour is Johannesburg's and not the browser's -- see firmClock.
 */

/** A time of day the firm may ring, as "HH:MM" on a 24-hour clock either side. */
export interface ContactWindow {
  from: string
  to: string
}

/** "08:00" and nothing else. A stored value is whatever an earlier version of this wrote. */
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isTime(value: unknown): value is string {
  return typeof value === 'string' && TIME.test(value)
}

/**
 * What came back from the column, as windows.
 *
 * DEFENSIVE BECAUSE THE COLUMN IS `jsonb`. Postgres will hold anything there -- an older shape, a
 * hand-run UPDATE, a null -- and a panel that throws on one bad row takes the debtor's name and
 * telephone number down with it. Anything that is not a pair of times is simply not a window.
 */
export function parseWindows(raw: unknown): ContactWindow[] {
  if (!Array.isArray(raw)) return []
  const out: ContactWindow[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { from, to } = item as { from?: unknown; to?: unknown }
    if (!isTime(from) || !isTime(to)) continue
    if (to <= from) continue
    out.push({ from, to })
  }
  return sortWindows(out)
}

/**
 * EARLIEST FIRST, because the panel lists them and a list in the order somebody happened to type
 * them is a list people re-read. "HH:MM" sorts correctly as a string, which is the whole reason
 * for storing it that way.
 */
function sortWindows(windows: ContactWindow[]): ContactWindow[] {
  return [...windows].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
}

/**
 * Why this window cannot be saved, in the firm's words, or null.
 *
 * SAID RATHER THAN PREVENTED everywhere else on this panel -- an ID number that looks wrong is
 * still stored, because what the collector was given is the only thing anybody has to work from.
 * A time is different: there is nothing to preserve in "17:00 to 09:00", it is a typo every time,
 * and stored it would make the window read as a ban on the middle of the day.
 */
export function windowProblem(w: ContactWindow): string | null {
  if (!isTime(w.from) || !isTime(w.to)) return 'Both times are needed, as hours and minutes.'
  if (w.to === w.from) return 'That is the same time twice.'
  if (w.to < w.from) return 'The end of the window is before its start.'
  return null
}

/**
 * Add one, keeping the list sorted and without repeating a window already on it.
 *
 * A DUPLICATE IS NOT A SECOND WINDOW. Two identical rows read as two separate instructions and
 * there is no way to tell them apart to remove one.
 */
export function withWindow(windows: ContactWindow[], add: ContactWindow): ContactWindow[] {
  if (windowProblem(add)) return windows
  if (windows.some((w) => w.from === add.from && w.to === add.to)) return windows
  return sortWindows([...windows, add])
}

/** Take one out, by its place in the list the panel drew. */
export function withoutWindow(windows: ContactWindow[], index: number): ContactWindow[] {
  return windows.filter((_, i) => i !== index)
}

/** "08:00 – 09:00", with an en dash because it is a range and not a subtraction. */
export function formatWindow(w: ContactWindow): string {
  return `${w.from} – ${w.to}`
}

/** Every window on one line, for a slot that has one line to say it in. */
export function describeWindows(windows: ContactWindow[]): string {
  return windows.map(formatWindow).join(', ')
}

/**
 * Is the firm's clock inside one of them?
 *
 * INCLUSIVE AT THE START AND EXCLUSIVE AT THE END, the way an hour is spoken: a debtor who says
 * "between 8 and 9" means you may ring at 8 and not at 9.
 *
 * NO WINDOWS IS NOT A BAD TIME. Nearly every account on the book has none recorded, and a screen
 * that warned on all of them would be a screen nobody reads -- the caller is given a caution only
 * where somebody has actually been told an hour.
 */
export function insideWindow(windows: ContactWindow[], clock: string): boolean {
  if (windows.length === 0) return true
  if (!isTime(clock)) return true
  return windows.some((w) => clock >= w.from && clock < w.to)
}
