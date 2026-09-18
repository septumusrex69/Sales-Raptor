/**
 * Pace against a month's collection target.
 *
 * This is the arithmetic behind the firm's own daily spreadsheets — "Clerks Needing Attention"
 * and "Teams Progress" — rebuilt so Raptor produces the same answer from the same month rather
 * than from a workbook somebody has to remember to refresh.
 *
 * THE MONTH IS COUNTED IN WORK DAYS, NOT CALENDAR DAYS, and that is the whole point of this
 * file. A percentage of target means nothing without the point in the month it is read at: 10%
 * on the second working day is exactly on pace, and 10% on the eighteenth is a crisis. The
 * firm's sheet carries "Work Days / Days Worked / Days Left / Expected Pace" in its header for
 * precisely that reason, and every status on it is a comparison against that pace.
 *
 * The counts here reproduce the firm's sheet exactly. Its September 2026 run shows 20 work days
 * with 2 worked as at Monday 14 September — which is the Sales Month (11 Sep – 10 Oct), Monday
 * to Friday, less Heritage Day on the 24th. That agreement is not a coincidence to be admired;
 * it is the thing that lets a team leader put this screen next to the spreadsheet and trust it.
 *
 * Pure on purpose: no database, no clock of its own, and its only import is the public-holiday
 * calendar it must share with the rest of Raptor.
 */
import { isWorkingDay } from './workingDays.ts'

/* Local calendar date, never UTC. `toISOString()` on a local midnight in SAST reports the
   previous day, which would move the start of the month and silently lose a work day. */
const pad = (n: number) => String(n).padStart(2, '0')
export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const nextDay = (key: string): string => {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Work days from `from` to `to`, counting BOTH ends. A one-day month is one work day. */
export function workDaysInclusive(from: string, to: string, extra: Record<string, string> = {}): number {
  if (to < from) return 0
  let count = 0
  let cursor = from
  // A Sales Month is 31 days at most; the guard is against a malformed date, not a long month.
  for (let guard = 0; cursor <= to && guard < 400; guard++) {
    if (isWorkingDay(cursor, extra)) count += 1
    cursor = nextDay(cursor)
  }
  return count
}

/**
 * The working day before this one.
 *
 * "COLLECTED TODAY, UP 14% ON YESTERDAY" IS A LIE EVERY MONDAY if yesterday means the calendar
 * day before. Sunday's takings are nought, so Monday would always read as an infinite
 * improvement and Tuesday as a collapse — a comparison that swings wildly for reasons that have
 * nothing to do with the work is one people learn to ignore within a week.
 *
 * Steps back over weekends and public holidays. It may cross out of the month, and that is
 * correct: the previous working day is a fact about days, not about the reporting period.
 */
export function previousWorkingDay(day: string, extra: Record<string, string> = {}): string | null {
  let cursor = day
  /* Christmas to New Year is the longest stretch this has to cross; ten days is ample. */
  for (let guard = 0; guard < 10; guard += 1) {
    cursor = addDays(cursor, -1)
    if (isWorkingDay(cursor, extra)) return cursor
  }
  return null
}

const addDays = (key: string, by: number): string => {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + by)
  return d.toISOString().slice(0, 10)
}

export interface MonthPace {
  workDays: number
  /** Work days elapsed INCLUDING today — see the note in `monthPace`. */
  daysWorked: number
  daysLeft: number
  /** Whole weeks the days left fall into, for the firm's "needed a week" figure. */
  weeksLeft: number
  /** How far through the month's work days we are, 0–1. The line every status is drawn against. */
  expected: number
  /** The month is over; there is no pace left to keep, only a result. */
  finished: boolean
}

/**
 * Where a month stands, in work days.
 *
 * TODAY COUNTS AS WORKED FROM THE MOMENT IT STARTS. That is the firm's convention — their sheet
 * printed on Monday the 14th counts the 11th and the 14th — and it means everybody reads as
 * slightly behind at nine in the morning and catches up through the day. Counting only finished
 * days would flatter the whole floor by one day's pace and, worse, would disagree with the
 * spreadsheet a team leader has open beside this screen.
 */
export function monthPace(
  start: Date,
  end: Date,
  today: Date,
  extra: Record<string, string> = {},
): MonthPace {
  const first = dayKey(start)
  const last = dayKey(end)
  const now = dayKey(today)
  const workDays = workDaysInclusive(first, last, extra)

  /* Before the month opens nothing has been worked; after it closes everything has. A past month
     read today must show its full length worked, not a number capped at some arbitrary today. */
  const through = now < first ? null : now > last ? last : now
  const daysWorked = through === null ? 0 : workDaysInclusive(first, through, extra)

  return {
    workDays,
    daysWorked,
    daysLeft: Math.max(0, workDays - daysWorked),
    weeksLeft: Math.ceil(Math.max(0, workDays - daysWorked) / 5),
    expected: workDays > 0 ? daysWorked / workDays : 1,
    finished: now > last,
  }
}

export type PaceStanding = 'met' | 'on-track' | 'behind' | 'critical' | 'no-target'

export interface PaceLine {
  target: number | null
  collected: number
  /** Of target, 0–1. Null when there is no target: 0% of nothing is not an achievement of nought. */
  achieved: number | null
  expected: number
  /** Achieved less expected, in the same units. Negative is behind. */
  gap: number | null
  stillNeeded: number | null
  /** What is left, spread over the work days left. Null once no days remain to spread it over. */
  neededADay: number | null
  neededAWeek: number | null
  standing: PaceStanding
}

/**
 * One person or one team against their target.
 *
 * THE THREE BANDS ARE THE FIRM'S, read back off their own sheet rather than invented here:
 * at or past the pace is on track, at least half the pace is slightly behind, below half is
 * critical. Every one of the thirty rows on their September sheet falls out of those lines —
 * including the two that disprove the legend printed at the top of it. That legend says
 * "<10% Critical, 10–19% Below pace, >=20% On Track", but Keamogetse Mose sits at 19.9% and is
 * marked On Track, while the line between Tumisang Mose at 5.1% and Amanda Coertze at 4.9% is
 * exactly half of the day's 10% pace. The fixed percentages are that day's pace written out
 * longhand; they stop being true on every other day of the month, which is why the rule here is
 * expressed against the pace and not against the numbers it happened to produce.
 */
export function paceLine(
  collected: number,
  target: number | null | undefined,
  pace: MonthPace,
): PaceLine {
  const base = { collected, expected: pace.expected }
  if (target == null || target <= 0) {
    return {
      ...base, target: null, achieved: null, gap: null,
      stillNeeded: null, neededADay: null, neededAWeek: null, standing: 'no-target',
    }
  }
  const achieved = collected / target
  const stillNeeded = Math.max(0, target - collected)
  const standing: PaceStanding =
    achieved >= 1 ? 'met'
      : achieved >= pace.expected ? 'on-track'
        : achieved >= pace.expected / 2 ? 'behind'
          : 'critical'
  return {
    ...base,
    target,
    achieved,
    gap: achieved - pace.expected,
    stillNeeded,
    /* Nought days left is not nought rand a day — it is a question with no answer, and a screen
       that prints R0 a day on the last afternoon of the month is telling a comfortable lie. */
    neededADay: pace.daysLeft > 0 ? stillNeeded / pace.daysLeft : null,
    neededAWeek: pace.weeksLeft > 0 ? stillNeeded / pace.weeksLeft : null,
    standing,
  }
}

/**
 * A progress bar that laps.
 *
 * THE FIRM'S OWN IDEA, and a good one: "when somebody has exceeded their target, the bar that's
 * there starts over, but now it's a different colour." A bar that simply pins at 100% tells you
 * somebody is past target and nothing else — a collector at 260% and one at 101% look identical,
 * on a screen whose whole job is to show who is carrying the month.
 *
 * AN EXACT MULTIPLE SHOWS A FULL BAR, NOT AN EMPTY ONE. Somebody who has just hit their target
 * has earned a full bar; resetting it to nothing at the instant they got there would be the
 * screen taking the moment away from them. So 100% is one full lap, 101% is a second bar with a
 * sliver in it, and 200% is a second bar full.
 */
export interface TargetLaps {
  /** How full the bar on screen is, 0–1. */
  fill: number
  /** How many whole targets are already behind them. Nought until the first one is passed. */
  laps: number
  /** Past target, so the bar is on its second lap or beyond and must not be the first colour. */
  over: boolean
}

export function targetLaps(achieved: number | null | undefined): TargetLaps {
  if (achieved == null || achieved <= 0) return { fill: 0, laps: 0, over: false }
  /* ceil-1 rather than floor: it is what makes an exact multiple a full bar instead of an empty
     one. At 1 it gives 0 laps and a fill of 1; at 1.01, one lap and a fill of 0.01. */
  const laps = Math.max(0, Math.ceil(achieved) - 1)
  return { fill: Math.min(1, achieved - laps), laps, over: laps >= 1 }
}

/** The firm's words for each band. "Slightly behind" is theirs; it is not "below target". */
export function standingLabel(s: PaceStanding): string {
  switch (s) {
    case 'met': return 'Target reached'
    case 'on-track': return 'On track'
    case 'behind': return 'Slightly behind'
    case 'critical': return 'Critical'
    case 'no-target': return 'No target'
  }
}

export interface TeamTotal {
  /** Summed from the members who have a target. Null when not one of them does. */
  target: number | null
  collected: number
  members: number
  /** How many of those members have a target set. */
  withTarget: number
}

/**
 * A team's figures, from its members'.
 *
 * THE TARGET IS THE SUM OF THE PEOPLE'S, not the head count times a floor-wide figure. The firm's
 * own Teams sheet does the latter — seven members at R89 285.71 — and it disagrees with their
 * clerk sheet, where the same people are set R100 000, R80 000, R60 000 and R45 000 individually
 * and sum to R1 905 000 rather than R2 500 000. Summing what was actually set is the only total
 * that a team leader can take apart again and explain to the person it is made of.
 *
 * `withTarget` is returned rather than hidden because a team where five of seven have a target
 * has a target that is understated, and the screen has to say so instead of showing a confident
 * number that is quietly short by two people.
 */
export function teamTotal(members: { collected: number; target: number | null }[]): TeamTotal {
  const withTarget = members.filter((m) => m.target != null && m.target > 0)
  return {
    target: withTarget.length === 0 ? null : withTarget.reduce((t, m) => t + (m.target ?? 0), 0),
    collected: members.reduce((t, m) => t + m.collected, 0),
    members: members.length,
    withTarget: withTarget.length,
  }
}
