/**
 * A NEW ACCOUNT THAT WAS NOT WORKED ON THE DAY IT LANDED.
 *
 * The firm: "if there is a new account and the section 129 is not triggered within 24 hours of
 * loading, then it should be reported to the team leader and flagged for the agent as well… if an
 * account has been loaded on the 23rd of September and the person has been logged 15 new accounts
 * and they've only worked five of them, the remaining 10 should automatically carry over as
 * priority on the next day's diary, not on the backlog."
 *
 * THREE DECISIONS ARE BUILT INTO THIS FILE AND EACH ONE COST SOMETHING TO GET RIGHT.
 *
 * 1. THE DATE NEVER MOVES. The obvious implementation is to re-diarise the ten accounts onto
 *    tomorrow. diary.ts already says what that costs, about the system Raptor replaces: "updating
 *    `due_on` in place… is why nobody can say how much work was missed last year." An entry that
 *    was silently re-dated looks as though it was always due tomorrow; the miss disappears, and
 *    the report to the team leader becomes uncomputable because the evidence it needs IS the date
 *    that was missed. So nothing here writes. The entry keeps the day it was always due and is
 *    CARRIED — which is a question about where it is shown, not about what it is.
 *
 * 2. DERIVED, NEVER STORED, for the same reason `isMissed` is: a stored flag needs something to
 *    set it, which means a nightly job, which means a night it does not run is a night the diary
 *    quietly lies. There is nothing here to drift from.
 *
 * 3. WORKING DAYS, NOT 24 HOURS. An account loaded at four on a Friday would otherwise be late on
 *    Saturday morning with nobody in the building — and the first thing anybody would do is stop
 *    believing the flag. The firm's own clock is the one in workingDays.ts, holidays and all.
 *
 * WHY NEW ACCOUNTS AND NOT EVERYTHING. The diary shows today's work and the backlog as two lists
 * on purpose: the imported book arrived with 279 overdue entries, and merged into one list today's
 * actual work sits at the bottom of a year of arrears. That design stands. This is the narrow
 * exception the firm asked for, and it earns it — a new account is rung two on the ladder, the
 * debtor has never been contacted, and a day lost is a day of interest and a debtor going cold.
 */
import type { DiaryKind } from './diaryPriority.ts'
import { isWorkingDay, workingDaysBetween } from './workingDays.ts'

/** Only what deciding this needs. Anything with these three fields can be asked. */
export interface CarryableEntry {
  kind: DiaryKind
  state: string
  dueOn: string
}

/**
 * Is this a new account that has already had its day?
 *
 * OPEN, NEW, AND PAST ITS DAY. All three: a closed entry was worked, and an entry due today is
 * not late until today is over — a flag that fires at nine in the morning on work somebody has
 * until five to do is the kind of warning people stop reading.
 */
export function isCarried(entry: CarryableEntry, today: string): boolean {
  return entry.state === 'open' && entry.kind === 'new_account' && entry.dueOn < today
}

/**
 * How many WORKING days it has been sitting, which is the severity the team leader sorts on.
 *
 * One means it landed yesterday and is being carried for the first time. Weekends and public
 * holidays do not count, so an account loaded on the Friday is carried once on the Monday rather
 * than being three days late for having sat through a weekend nobody worked.
 */
export function daysCarried(
  entry: CarryableEntry, today: string, holidays: Record<string, string> = {},
): number {
  if (!isCarried(entry, today)) return 0
  return Math.max(1, workingDaysBetween(entry.dueOn, today, holidays))
}

/**
 * Was it loaded recently enough that nobody is late yet?
 *
 * The firm's rule read back precisely: the collector has the day it landed AND, where it landed
 * on a day the office was shut, the first working day after that. So an account diarised for a
 * Saturday is not late on the Monday morning — the Monday is its day.
 */
export function stillInTime(entry: CarryableEntry, today: string, holidays: Record<string, string> = {}): boolean {
  if (entry.state !== 'open' || entry.kind !== 'new_account') return false
  if (entry.dueOn >= today) return true
  /* Dated to a day the office was shut: the clock starts on the first working day after it. */
  return !isWorkingDay(entry.dueOn, holidays) && daysCarried(entry, today, holidays) <= 1
}

export interface CarriedSplit<T> {
  /** New accounts past their day: shown at the top of today, never in the backlog. */
  carried: T[]
  /** What is left of the backlog once they have been taken out of it. */
  backlog: T[]
}

/**
 * Take the carried new accounts out of the backlog.
 *
 * RETURNS BOTH HALVES rather than filtering twice. Two filters over one list is two places for
 * the condition to be written, and the day they disagree an entry is either in both lists or in
 * neither — one of which double-counts a collector's day and the other loses an account.
 */
export function splitCarried<T extends CarryableEntry>(
  backlog: T[], today: string, holidays: Record<string, string> = {},
): CarriedSplit<T> {
  const carried: T[] = []
  const rest: T[] = []
  for (const entry of backlog) {
    if (isCarried(entry, today) && !stillInTime(entry, today, holidays)) carried.push(entry)
    else rest.push(entry)
  }
  /* Longest waiting first. The one carried four times is worse than the one carried once, and a
     list that opens with yesterday's is a list where the real problem is below the fold. */
  carried.sort((a, b) => a.dueOn.localeCompare(b.dueOn))
  return { carried, backlog: rest }
}

export interface DayWeight {
  /** Work actually dated today. */
  due: number
  /** New accounts carried in from before. */
  carried: number
  total: number
  /** The standard, or this person's own ceiling where a team leader has set one. */
  capacity: number
  /** How far past it the day is. Zero when it fits. */
  over: number
}

/**
 * What the day actually weighs once the carried accounts are in it.
 *
 * SHOWN, NOT SOLVED. Ten carried onto a fifty-a-day diary is sixty, and three days of that is a
 * diary lying about capacity. The tempting fix is to push the routine reviews out to make room —
 * they are the last rung and the only kind with no event behind them, so they are the obvious
 * thing to yield. It is still wrong: quietly reshuffling until the day reads fifty removes the
 * one signal that somebody is underwater, which is the number the team leader actually needs.
 */
export function dayWeight(input: { due: number; carried: number; capacity: number }): DayWeight {
  const total = input.due + input.carried
  return {
    due: input.due,
    carried: input.carried,
    total,
    capacity: input.capacity,
    over: Math.max(0, total - input.capacity),
  }
}

/**
 * What the collector is told, in the firm's words.
 *
 * ONE SENTENCE AND ONLY WHEN THERE IS SOMETHING TO SAY. Null where nothing was carried — a panel
 * that renders "0 new accounts carried over" every morning is a panel people stop looking at.
 */
export function carriedLine(weight: DayWeight): string | null {
  if (weight.carried === 0) return null
  const what = weight.carried === 1 ? '1 new account' : `${weight.carried} new accounts`
  const head = `${what} carried over — work ${weight.carried === 1 ? 'it' : 'them'} first.`
  if (weight.over === 0) return head
  return `${head} That puts ${weight.total} on today against ${weight.capacity}.`
}

export interface LateForLeader {
  ownerId: string
  /** How many of this person's new accounts are being carried. */
  carried: number
  /** Working days the oldest of them has been waiting. */
  worst: number
}

/**
 * The team leader's list: who is carrying new accounts, worst first.
 *
 * BY PERSON, NOT BY ACCOUNT. A team leader does not act on an account, they act on a collector
 * who is behind — and a list of two hundred accounts is one nobody reads. Sorted by how long the
 * oldest has waited rather than by how many there are: five accounts sitting a week is a problem,
 * twenty that landed yesterday is a busy Tuesday.
 */
export function lateForLeaders<T extends CarryableEntry & { ownerId: string | null }>(
  entries: T[], today: string, holidays: Record<string, string> = {},
): LateForLeader[] {
  const by = new Map<string, LateForLeader>();
  for (const entry of entries) {
    if (entry.ownerId === null) continue
    if (!isCarried(entry, today) || stillInTime(entry, today, holidays)) continue
    const waited = daysCarried(entry, today, holidays)
    const row = by.get(entry.ownerId) ?? { ownerId: entry.ownerId, carried: 0, worst: 0 }
    row.carried += 1
    row.worst = Math.max(row.worst, waited)
    by.set(entry.ownerId, row)
  }
  return [...by.values()].sort((a, b) => b.worst - a.worst || b.carried - a.carried)
}
