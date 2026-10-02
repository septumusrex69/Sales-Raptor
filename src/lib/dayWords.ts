/**
 * A 'YYYY-MM-DD' AS WORDS, IN ONE PLACE.
 *
 * These were at the foot of DiaryDatePicker, which is where they were first needed. The task
 * picker needs the same three, and a component importing another component's date formatting is
 * how a page ends up with "Thu 8 Oct" in one control and "Thursday 8 October" in the one beside
 * it. They are also pure, which a .tsx file is not allowed to be here -- scripts/qa resolves .ts
 * only, so a function left in a component can be checked by matching its source and hoping.
 *
 * PARSED AT MIDDAY, NEVER MIDNIGHT. `new Date('2026-10-08')` is midnight UTC, which is the day
 * before for every reader west of Greenwich -- and the firm is two hours east, so the bug would
 * never have shown here and would have shown on a client's screen abroad. The UTC timeZone below
 * is the other half: the day is already the day, and letting the formatter localise it would move
 * it back again.
 */

const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-ZA', { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))

export const longDate = (date: string) => fmt(date, { weekday: 'long', day: 'numeric', month: 'long' })
export const shortDate = (date: string) => fmt(date, { day: 'numeric', month: 'short' })

/**
 * THE MONTHS A STRIP OF WEEKS COVERS, for the heading above a grid.
 *
 * ACROSS A MONTH END THE REPEATED YEAR GOES: "September – October 2026", not "September 2026 –
 * October 2026". Across a year end both stay, because that is the one time the year is the fact
 * somebody needs.
 */
export function monthSpan(days: string[]): string {
  const first = fmt(days[0], { month: 'long', year: 'numeric' })
  const last = fmt(days[days.length - 1], { month: 'long', year: 'numeric' })
  if (first === last) return first
  const [fm, fy] = first.split(' ')
  const [lm, ly] = last.split(' ')
  return fy === ly ? `${fm} – ${lm} ${ly}` : `${first} – ${last}`
}
