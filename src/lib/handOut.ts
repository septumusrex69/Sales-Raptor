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
 *                    Turned OFF by `evenSplit`, which the firm asks for by name when sharing out
 *                    a shuffle: ten people and a hundred accounts is ten each, and a ceiling
 *                    crossed is reported rather than avoided.
 *   2. GRADE       — is the account within their reach? The firm earns only on what it recovers
 *                    and carries its clients' reputation while doing it.
 *   3. DIARY ROOM  — and only now, which day. The window sets the PACE: a hundred accounts over
 *                    five working days is twenty a day, over ten days is ten a day, and over one
 *                    day is all hundred today. The firm calls it the aggression of the allocation.
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
  /** No grade set: treated as Junior, and the screen says so. */
  ungraded?: boolean
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
  /**
   * The window it was actually asked for, clamped the way the planner clamped it.
   *
   * Carried out so the summary can say "past the four you asked for" rather than only naming the
   * number of days it used. Without it the sentence reads as an answer to the question when it is
   * really the planner reporting that it could not honour it — which is exactly how a firm ends
   * up asking why switching from ten days to four changed nothing below.
   */
  windowDays: number
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
  /**
   * SPLIT IT EQUALLY, and never mind the ceilings.
   *
   * Off by default, because the ordinary hand-out should protect a full book — but the firm asks
   * for this one by name: a hundred accounts across ten people is ten each, exactly, whatever
   * they are already carrying. It is how a shuffle is shared out, and arguing about headroom
   * while doing it produces a split nobody asked for and cannot predict.
   *
   * It overrides gate 1 ONLY. The grade gate still holds, because that one is not about fairness
   * — a major account on a junior desk is a client relationship, not an uneven share. And going
   * over a ceiling is allowed rather than avoided: the plan says who, in red, and a person
   * decides. That is the firm's own instruction: "even if it goes over, it should just indicate
   * that it's going over".
   */
  evenSplit?: boolean
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
  interface Desk {
    c: PlannableCollector
    ceiling: number
    /** Accounts of room at the moment the plan started. The share each person takes is weighted
     *  by this, and it is deliberately not recomputed as the plan fills — see gate 1. */
    room: number
    taking: number
    added: Record<string, number>
  }
  const state: Desk[] = input.collectors
    .map((c) => ({
      c,
      ceiling: bookCeilingOf(c.bookCeiling),
      room: Math.max(0, bookCeilingOf(c.bookCeiling) - c.inPlayNow),
      taking: 0,
      added: {} as Record<string, number>,
    }))
    .sort((a, b) => (a.c.name === b.c.name ? (a.c.userId < b.c.userId ? -1 : 1) : a.c.name < b.c.name ? -1 : 1))

  const placements: Placement[] = []
  const unplaced: HandOutPlan['unplaced'] = []
  const firstDay = nextWorkingDay(input.startOn, extra)

  /*
   * Every working day the plan may reach, in order: the window first, then the days it is
   * allowed to run past it onto. Built once — the days do not depend on who is taking what, and
   * walking the calendar again for every account is how a five-hundred-account plan gets slow.
   */
  const dayList: string[] = []
  for (let i = 0, d = firstDay; i < maxDays; i += 1) {
    dayList.push(d)
    d = nextWorkingDay(addDay(d), extra)
  }
  const windowSize = Math.min(Math.max(1, input.windowDays), dayList.length)
  const windowEnd = dayList[windowSize - 1]

  /*
   * What the day quota is divided by. Accounts skipped for already being booked are excluded —
   * dividing by a total that includes work the plan will not do makes every day's quota too
   * small, and the plan then runs past a window it had room inside.
   */
  const placeable = input.skipAlreadyBooked
    ? queue.filter((a) => !a.alreadyBooked).length
    : queue.length

  /*
   * GATE 3: WHICH DAY — and the window is how HARD the work is pushed, not a deadline it must
   * fit inside. The firm's words: "it kind of shows you the aggression of allocation."
   *
   * A hundred accounts over five days is twenty a day. Over ten days it is ten a day. Over one
   * day it is all hundred today, and that is a legitimate thing to ask for. The number is a dial
   * between "get this worked now" and "leave my people room for what I hand out tomorrow" —
   * because a diary filled to capacity today is a diary with no space for the next allocation,
   * and that is the cost the person setting this number is actually weighing.
   *
   * SO THE QUOTA IS ACROSS THE WHOLE PLAN, not per collector. Levelling each person's own days
   * separately was the previous attempt and it does not do this: thirty-nine collectors taking
   * two or three each spread those two or three across days one, two and three, so a five-day
   * window still finished in three. The aggregate is what the leader is pacing.
   */
  const perDay = Math.max(1, Math.ceil(placeable / windowSize))
  const dayTotals: Record<string, number> = {}

  /*
   * Within a day that is still under quota, the collector's EMPTIEST day wins — counting what is
   * already in their diary, so a Monday holding 38 of 40 is skipped rather than topped up. Ties
   * go to the earliest, which is what keeps the firm's ladder meaningful: the queue is dealt
   * broken-promises-first, so the most urgent work lands at the front of the window.
   *
   * The quota is relaxed before the window is abandoned. Somebody whose every under-quota day is
   * full should take a day inside the window that is over quota rather than be pushed past the
   * window entirely — the window is the instruction, the quota is how it is paced within it.
   */
  function dayFor(s: Desk): string | null {
    for (const underQuota of [true, false]) {
      let best: string | null = null
      let bestFree = -1
      for (let i = 0; i < windowSize; i += 1) {
        const day = dayList[i]
        if (underQuota && (dayTotals[day] ?? 0) >= perDay) continue
        /*
         * Fills to the FULL capacity, not to capacity minus reserve. The reserve exists to stop
         * an agent's own bookings from eating the room a team leader needs — it constrains
         * self-booking, not this. Subtracting it here would hold slots back from the only thing
         * they were ever held back for, and the reserve would make hand-outs harder, not easier.
         */
        const free = s.c.capacity - (s.c.bookedByDay[day] ?? 0) - (s.added[day] ?? 0)
        if (free <= 0) continue
        if (free > bestFree) { bestFree = free; best = day }
      }
      if (best !== null) return best
    }
    for (let i = windowSize; i < dayList.length; i += 1) {
      const day = dayList[i]
      if ((s.c.bookedByDay[day] ?? 0) + (s.added[day] ?? 0) < s.c.capacity) return day
    }
    return null
  }

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
     * GATE 1: BOOK ROOM, and everybody with room takes a SHARE OF THE WORK PROPORTIONAL TO THE
     * ROOM THEY HAVE. Dealt one account at a time to whoever is furthest behind their share.
     *
     * This is the rule the firm reported against, twice over. It first dealt to whoever had the
     * most headroom counted in accounts: Rehana, on 190 of a ceiling of 650, had more raw room
     * than eight colleagues and still did after ninety-nine accounts — so nine people were ticked
     * and the plan read "100 accounts across one person". Levelling everybody's occupancy fixed
     * that but overcorrected: three of the nine still got nothing, because their books were
     * merely fuller than the rest, not full. A leader who ticks nine names is telling the planner
     * those nine should work this stack, and a rule that quietly drops three of them is the same
     * complaint in smaller print.
     *
     * So: share, weighted by room. Somebody with 300 of room takes thirty times what somebody
     * with 10 of room takes — the near-full desk is protected without being excluded, and nine
     * level desks take an equal ninth each because equal room is an equal share. `taking` over
     * starting headroom is the whole rule; the person with the lowest ratio is next, which drives
     * everyone towards the same fraction of their own capacity to absorb work.
     *
     * Room is measured ONCE, against what they were carrying before this plan, not re-measured as
     * the plan fills. A denominator that shrinks as somebody takes work is a ratio that rises
     * twice for the same account, and the deal stops being proportional to anything.
     */
    const byShare = [...eligible].sort((a, b) => {
      /*
       * EQUAL MEANS EQUAL. With the even split on, the only thing that decides who is next is who
       * has taken least from this plan — not their ceiling, not their room, not what they are
       * already carrying. Ten people and a hundred accounts is ten each and the ceilings are
       * reported rather than respected, which is the whole point of asking for it.
       */
      if (input.evenSplit) {
        if (a.taking !== b.taking) return a.taking - b.taking
        const g = gradeRank(a.c.grade) - gradeRank(b.c.grade)
        if (g !== 0) return g
        return a.c.name < b.c.name ? -1 : 1
      }
      /*
       * Anybody at or past their ceiling sorts behind everybody who still has room — and among
       * themselves by how far past, so the least over takes first. Nothing BLOCKS: if every
       * eligible desk is full the work still lands, because refusing would leave the account
       * adrift, and the plan says plainly who it pushed over and by how much.
       */
      if ((a.room > 0) !== (b.room > 0)) return a.room > 0 ? -1 : 1
      if (a.room > 0) {
        const sa = a.taking / a.room
        const sb = b.taking / b.room
        if (sa !== sb) return sa - sb
      } else {
        const oa = (a.c.inPlayNow + a.taking) / Math.max(1, a.ceiling)
        const ob = (b.c.inPlayNow + b.taking) / Math.max(1, b.ceiling)
        if (oa !== ob) return oa - ob
      }
      // Then the less experienced of two equals, so elite desks stay free for what needs them.
      const g = gradeRank(a.c.grade) - gradeRank(b.c.grade)
      if (g !== 0) return g
      return a.c.name < b.c.name ? -1 : 1
    })

    let placed = false
    for (const s of byShare) {
      const day = dayFor(s)
      if (day === null) continue
      s.added[day] = (s.added[day] ?? 0) + 1
      dayTotals[day] = (dayTotals[day] ?? 0) + 1
      s.taking += 1
      placements.push({ accountId: account.id, userId: s.c.userId, dueOn: day, kind: account.kind })
      placed = true
      break
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

  return {
    placements,
    unplaced,
    collectors,
    days,
    lastDate,
    ranPastWindow: lastDate !== null && lastDate > windowEnd,
    windowDays: windowSize,
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
  /*
   * THE NUMBER OF DAYS IS SAID OUT LOUD, because "over five working days" is what the person
   * typed into the box and they need to see whether the plan honoured it. It used to give only
   * the finishing date, which meant a plan asked for over five days and delivered in two read as
   * a success. Distinct dates, not the span, so a gap is not counted as work.
   */
  const days = new Set(plan.placements.map((p) => p.dueOn)).size
  const parts = [
    `${n.toLocaleString('en-ZA')} ${n === 1 ? 'account' : 'accounts'} across ${people} ${people === 1 ? 'person' : 'people'}`,
  ]
  /*
   * WHEN IT OVERRAN, THE SENTENCE SAYS SO IN THE SAME BREATH. It used to name only the days it
   * used, which reads as an answer rather than as the planner reporting it could not do what was
   * asked — and that is exactly how somebody switches from ten working days to four, sees "over
   * ten working days" underneath, and concludes the screen has not noticed. It had noticed;
   * every diary in the window was full and it had nowhere else to put the work.
   */
  parts.push(plan.ranPastWindow
    ? `over ${days} working ${days === 1 ? 'day' : 'days'} — past the ${plan.windowDays} you asked for`
    : `over ${days} working ${days === 1 ? 'day' : 'days'}`)
  if (plan.lastDate) parts.push(`finishing ${plan.lastDate}`)
  if (over.length > 0) {
    parts.push(`${over.length} ${over.length === 1 ? 'person goes' : 'people go'} over their book ceiling`)
  }
  if (plan.unplaced.length > 0) {
    parts.push(`${plan.unplaced.length} not booked`)
  }
  return `${parts.join(' · ')}.`
}
