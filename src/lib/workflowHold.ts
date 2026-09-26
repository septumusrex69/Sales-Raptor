import { addWorkingDays, workingDaysBetween } from './workingDays.js'
import type { DayUnit } from './workflowBuilder.js'

/**
 * HOW FAR A PAUSE MOVES THE REST OF A SEQUENCE.
 *
 * THE FIRM'S OWN SENTENCE, off the mockup they drew of the workflow pane: "Completed notices are
 * preserved; upcoming dates recalculated." A held run's clock stops; when it is let go, everything
 * still to come moves on by however long the pause lasted.
 *
 * WHY THAT IS HONEST FOR THIS SEQUENCE, WHICH IS NOT A GENERAL LICENCE. Every notice after the
 * demand asserts that a period has ELAPSED — "the period given in our Section 129 notice has
 * ended", "you were given 20 business days" — so a pause can only ever make those sentences MORE
 * true. It is the opposite for tracing, which is why the firm start again there rather than
 * resuming: wrong contact details mean the notices may never have arrived at all.
 *
 * COUNTED IN THE RUN'S OWN UNIT. A section 129 counts in business days, so a pause over Easter is
 * shorter in the unit that matters than the calendar says. Counting it in calendar days and then
 * adding it to a business-day chart would push every remaining step past where it belongs — the
 * same class of error as reading a business day number as a calendar one, which cost this
 * codebase a fortnight once already.
 *
 * ITS OWN FILE, PURE, AND ON THE APP SIDE ON PURPOSE. The SQL records WHEN a run was held and
 * when it was let go and does no arithmetic at all, because workingDays.ts is the only thing that
 * knows about Heritage Day. A second working-day calendar in the database would be the one that
 * is wrong in the year nobody checks.
 */

/** One pause, as the arithmetic needs it. Matches RunHold and the workflow_run_holds row. */
export interface HoldPeriod {
  startedOn: string
  /** Null while the pause is still on. */
  endedOn: string | null
}

/**
 * The total a run's remaining steps should move, in the run's own unit.
 *
 * ONLY PAUSES THAT HAVE ENDED COUNT. A run still held is not sending anything, so there is
 * nothing to re-date yet — and counting an open pause would move the dates a little further every
 * day it stayed open, which on a screen reads as a sequence running away from you.
 *
 * INCLUSIVE OF NEITHER END IN BUSINESS DAYS, which is what workingDaysBetween gives: a pause from
 * Friday to the following Monday is one working day, because only the Monday was lost. A pause
 * that started and ended on one day moves nothing, which is right — nothing was missed.
 */
export function heldDays(
  holds: HoldPeriod[], unit: DayUnit, holidays: Record<string, string> = {},
): number {
  let total = 0
  for (const hold of holds) {
    if (!hold.endedOn) continue
    if (hold.endedOn <= hold.startedOn) continue
    total += unit === 'business'
      ? workingDaysBetween(hold.startedOn, hold.endedOn, holidays)
      : calendarDaysBetween(hold.startedOn, hold.endedOn)
  }
  return total
}

/**
 * A date moved on by a pause, in the unit the run counts in.
 *
 * SEPARATE FROM landsOn RATHER THAN FOLDED INTO IT, and the difference matters: landsOn turns a
 * DAY NUMBER off the firm's chart into a date, and day 12 is day 12 whatever has happened to the
 * account. The pause is a thing that happened afterwards. Folded together, a step's day number
 * and the delay it suffered would become one number, and nobody could answer "what day of the
 * sequence is this" afterwards — which is the question the whole chart is written in.
 */
export function movedOn(
  date: string, days: number, unit: DayUnit, holidays: Record<string, string> = {},
): string {
  if (days <= 0) return date
  if (unit === 'business') return addWorkingDays(date, days, holidays)
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function calendarDaysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  return Math.max(0, Math.round((b - a) / 86400000))
}
