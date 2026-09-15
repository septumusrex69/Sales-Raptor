/**
 * Handing a stack of accounts out to the people who will work them.
 *
 * TWO DIFFERENT THINGS, and the whole design turns on keeping them apart. ALLOCATING changes
 * whose book an account is in — ongoing ownership. BOOKING IN creates a diary entry — one
 * appointment, on one day. Allocating without booking is exactly how 355 accounts arrived from
 * Swordfish belonging to somebody and diarised by nobody.
 *
 * THIS FILE IS THE PLANNER AND NOTHING ELSE. It takes what is true — the accounts, the people,
 * what they are already carrying, what is already in their diaries — and returns a plan. It
 * writes nothing, reads nothing, and knows no dates but the ones it is given, which is what
 * makes a distribution rule that decides where a billion rand of work goes something a test can
 * actually hold. handOut.write.ts does the writing, against a plan a person has already seen.
 *
 * THREE GATES, IN THIS ORDER, and the order is the point:
 *
 *   1. BOOK ROOM   — is this person below their ceiling? How many accounts somebody carries is
 *                    the real load; the diary is only the schedule on top of it. A collector
 *                    with 480 in play does not get 50 more because next Tuesday happens to be
 *                    quiet, and that was the first heuristic this planner had. It was wrong.
 *   2. GRADE       — is the account within their reach? The firm earns only on what it recovers
 *                    and carries its clients' reputation while doing it.
 *   3. DIARY ROOM  — and only now, which day.
 *
 * Nothing here blocks. The plan says who goes over their ceiling and by how much, and a person
 * decides — the same rule the diary already follows for capacity.
 */
import { priorityOf, type DiaryKind } from './diaryPriority.ts'
import { isWorkingDay } from './workingDays.ts'
import {
  bookCeilingOf, gradeRank, mayTake, type AccountBand, type CollectorGrade,
} from './collectorGrade.ts'

export interface PlannableAccount {
  id: string
  /** For the preview. A plan somebody cannot read is a plan they cannot refuse. */
  label: string
  band: AccountBand
  kind: DiaryKind
  capitalOutstanding: number
  /** An open diary entry already exists on this account. */
  alreadyBooked?: boolean
}

export interface PlannableCollector {
  userId: string
  name: string
  grade: CollectorGrade
  /** Null takes the company standard. */
  bookCeiling: number | null
  /** Accounts in play on their desk right now. Written-off and frozen do not consume a slot. */
  inPlayNow: number
  /** How many this person works in a day. */
  capacity: number
  /** due_on (ISO date) → open entries already booked on it. */
  bookedByDay: Record<string, number>
}

export type UnplacedReason =
  | 'already_booked'
  | 'no_one_graded'
  | 'no_room'

export interface Placement {
  accountId: string
  userId: string
  dueOn: string
  kind: DiaryKind
}

export interface CollectorPlan {
  userId: string
  name: string
  grade: CollectorGrade
  ceiling: number
  before: number
  taking: number
  after: number
  /**
   * How far past the ceiling THIS PLAN pushes them. Zero when it does not.
   *
   * Measured as the excess the plan is responsible for, not the total excess — because a person
   * who is already over their ceiling and is given nothing has not been pushed anywhere by this
   * plan, and counting them would fire the warning on a hand-out that carefully avoided them.
   * A warning that cries wolf on the plan that did the right thing is a warning people stop
   * reading, and then it is worse than no warning at all.
   */
  overBy: number
  /** They were over their ceiling before this plan. Why they are getting little or nothing. */
  alreadyOver: boolean
}

export interface DayPlan {
  userId: string
  date: string
  existing: number
  added: number
  capacity: number
}

export interface HandOutPlan {
  placements: Placement[]
  unplaced: { accountId: string; label: string; reason: UnplacedReason }[]
  collectors: CollectorPlan[]
  days: DayPlan[]
  /** The furthest day the plan reaches. Null when nothing was placed. */
  lastDate: string | null
  /** True when the plan ran past the window it was asked for. */
  ranPastWindow: boolean
}

export interface PlanInput {
  accounts: PlannableAccount[]
  collectors: PlannableCollector[]
  /** First working day to book onto. A non-working day rolls forward to the next one. */
  startOn: string
  /** How many working days the plan was asked to fit into. */
  windowDays: number
  /**
   * How far past the window it may run before giving up.
   *
   * IT RUNS PAST RATHER THAN DROPPING ACCOUNTS. Filling the window and leaving the rest unbooked
   * recreates the exact hole this whole feature exists to close — accounts belonging to somebody
   * with nobody booked to ring them — and the leader would have to remember to come back. So it
   * keeps going and says how far it went. Bounded, because "keep going" without a limit quietly
   * books work into March.
   */
  maxWindowDays?: number
  /** Public holidays beyond the statutory ones, as workingDays takes them. */
  extraHolidays?: Record<string, string>
  /** Accounts that already carry an open diary entry: skipped rather than moved. */
  skipAlreadyBooked?: boolean
}

const DEFAULT_MAX_WINDOW = 40

/** The next working day on or after `date`. */
function nextWorkingDay(date: string, extra: Record<string, string>): string {
  const d = new Date(`${date}T00:00:00Z`)
  for (let i = 0; i < 30; i += 1) {
    const iso = d.toISOString().slice(0, 10)
    if (isWorkingDay(iso, extra)) return iso
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return d.toISOString().slice(0, 10)
}

function addDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * The plan.
 *
 * Deterministic: the same inputs give the same plan every time, ties broken by name and then by
 * id. A distributor that shuffles is one nobody can check, and "why did Thandi get that one"
 * has to have an answer.
 */
export function planHandOut(input: PlanInput): HandOutPlan {
  const extra = input.extraHolidays ?? {}
  const maxDays = input.maxWindowDays ?? DEFAULT_MAX_WINDOW

  /*
   * ORDERED BY THE FIRM'S OWN LADDER, then by size within a rung. The ladder decides what gets
   * seen first — a broken promise before a fresh handover before a trace — and the balance
   * decides which of two equally urgent accounts goes to the better collector, because the
   * planner deals in this order and the best desks fill first.
   */
  const queue = [...input.accounts].sort((a, b) => {
    const p = priorityOf(a.kind) - priorityOf(b.kind)
    if (p !== 0) return p
    if (b.capitalOutstanding !== a.capitalOutstanding) return b.capitalOutstanding - a.capitalOutstanding
    return a.id < b.id ? -1 : 1
  })

  // Working state per collector, so the plan can be built without mutating the caller's data.
  const state = input.collectors
    .map((c) => ({
      c,
      ceiling: bookCeilingOf(c.bookCeiling),
      taking: 0,
      added: {} as Record<string, number>,
    }))
    .sort((a, b) => (a.c.name === b.c.name ? (a.c.userId < b.c.userId ? -1 : 1) : a.c.name < b.c.name ? -1 : 1))

  const placements: Placement[] = []
  const unplaced: HandOutPlan['unplaced'] = []
  const firstDay = nextWorkingDay(input.startOn, extra)

  for (const account of queue) {
    if (input.skipAlreadyBooked && account.alreadyBooked) {
      /*
       * An account carries ONE open diary entry — the database refuses a second. So a hand-out
       * that included an already-booked account would drag it off whoever's Tuesday it was
       * sitting on, silently. Skipped and reported instead.
       */
      unplaced.push({ accountId: account.id, label: account.label, reason: 'already_booked' })
      continue
    }

    const eligible = state.filter((s) => mayTake(s.c.grade, account.band))
    if (eligible.length === 0) {
      unplaced.push({ accountId: account.id, label: account.label, reason: 'no_one_graded' })
      continue
    }

    /*
     * GATE 1: BOOK ROOM, and dealt by HEADROOM rather than by free diary slots.
     *
     * Headroom is ceiling minus what they carry minus what this plan has already given them, so
     * the work lands in proportion to what each person can actually hold: an Elite on 200 of 500
     * takes more than a Junior on 140 of 150, without anybody choosing a ratio.
     *
     * Nobody is over their ceiling YET is preferred; if every eligible desk is full the least
     * over one still takes it, because refusing would leave the account adrift and the plan says
     * plainly who it pushed over.
     */
    const byHeadroom = [...eligible].sort((a, b) => {
      const ha = a.ceiling - a.c.inPlayNow - a.taking
      const hb = b.ceiling - b.c.inPlayNow - b.taking
      if (ha !== hb) return hb - ha
      // Then the less experienced of two equals, so elite desks stay free for what needs them.
      const g = gradeRank(a.c.grade) - gradeRank(b.c.grade)
      if (g !== 0) return g
      return a.c.name < b.c.name ? -1 : 1
    })

    let placed = false
    for (const s of byHeadroom) {
      // GATE 3: which day. The earliest with room in this person's diary.
      let day = firstDay
      for (let i = 0; i < maxDays; i += 1) {
        if (!isWorkingDay(day, extra)) { day = addDay(day); i -= 1; continue }
        const existing = s.c.bookedByDay[day] ?? 0
        const added = s.added[day] ?? 0
        /*
         * Fills to the FULL capacity, not to capacity minus reserve. The reserve exists to stop
         * an agent's own bookings from eating the room a team leader needs — it constrains
         * self-booking, not this. Subtracting it here would hold slots back from the only thing
         * they were ever held back for.
         */
        if (existing + added < s.c.capacity) {
          s.added[day] = added + 1
          s.taking += 1
          placements.push({ accountId: account.id, userId: s.c.userId, dueOn: day, kind: account.kind })
          placed = true
          break
        }
        day = addDay(day)
      }
      if (placed) break
    }

    if (!placed) unplaced.push({ accountId: account.id, label: account.label, reason: 'no_room' })
  }

  /* ---------- what the plan looks like to a person ---------- */

  const collectors: CollectorPlan[] = state.map((s) => {
    const after = s.c.inPlayNow + s.taking
    const excessBefore = Math.max(0, s.c.inPlayNow - s.ceiling)
    const excessAfter = Math.max(0, after - s.ceiling)
    return {
      userId: s.c.userId,
      name: s.c.name,
      grade: s.c.grade,
      ceiling: s.ceiling,
      before: s.c.inPlayNow,
      taking: s.taking,
      after,
      overBy: Math.max(0, excessAfter - excessBefore),
      alreadyOver: excessBefore > 0,
    }
  })

  const days: DayPlan[] = []
  for (const s of state) {
    for (const date of Object.keys(s.added).sort()) {
      days.push({
        userId: s.c.userId,
        date,
        existing: s.c.bookedByDay[date] ?? 0,
        added: s.added[date],
        capacity: s.c.capacity,
      })
    }
  }

  const dates = placements.map((p) => p.dueOn).sort()
  const lastDate = dates.length > 0 ? dates[dates.length - 1] : null

  // The last day the window asked for, so "ran past it" is a fact rather than an impression.
  let windowEnd = firstDay
  for (let i = 1; i < input.windowDays; i += 1) {
    windowEnd = nextWorkingDay(addDay(windowEnd), extra)
  }

  return {
    placements,
    unplaced,
    collectors,
    days,
    lastDate,
    ranPastWindow: lastDate !== null && lastDate > windowEnd,
  }
}

/** The plan in a sentence, for the line above the preview. */
export function planSummary(plan: HandOutPlan): string {
  const n = plan.placements.length
  if (n === 0) return 'Nothing can be booked in. See the reasons below.'
  const people = plan.collectors.filter((c) => c.taking > 0).length
  /*
   * overBy is already plan-relative — it counts only the excess THIS hand-out added — so
   * somebody who took nothing has an overBy of zero however overloaded they already were, and no
   * `taking > 0` guard is needed here. Do not add one: a second rule saying the same thing is a
   * second rule that can disagree, and this one is the tested half.
   */
  const over = plan.collectors.filter((c) => c.overBy > 0)
  const parts = [
    `${n.toLocaleString('en-ZA')} ${n === 1 ? 'account' : 'accounts'} across ${people} ${people === 1 ? 'person' : 'people'}`,
  ]
  if (plan.lastDate) parts.push(`finishing ${plan.lastDate}`)
  if (over.length > 0) {
    parts.push(`${over.length} ${over.length === 1 ? 'person goes' : 'people go'} over their book ceiling`)
  }
  if (plan.unplaced.length > 0) {
    parts.push(`${plan.unplaced.length} not booked`)
  }
  return `${parts.join(' · ')}.`
}
