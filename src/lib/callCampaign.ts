/**
 * A CALL CAMPAIGN: ACCOUNTS PUT ON THE COLLECTORS' DIARIES TO BE RUNG (S10, 21 Oct).
 *
 * THE FIRM, asked how a campaign should be worked: "you can do the campaign now ... it takes
 * priority over everything else, even PTPs, everything", or "set the expiry date of a campaign ...
 * work the next couple of accounts over the next couple of days. Then it should be ranking pretty
 * high. Like, I think you can choose where you want to put it ... it should be able to spread out" --
 * into the room a collector keeps free: "this is exactly why" somebody who can work 50 a day may
 * only diarise 40 themselves.
 *
 * So two modes, and the difference is the whole design:
 *   NOW     every call on today, above everything on the diary (workedNow in diaryPriority.ts),
 *           whatever that does to the day. Over capacity is SHOWN, not solved -- it is the point.
 *   SPREAD  from today to the end date, at the place on the ladder the person chose, filling each
 *           collector's free room a day at a time. What does not fit before the end is reported
 *           and not placed: a campaign that quietly overfills a diary is the backlog the reserve
 *           exists to prevent.
 *
 * A CALL GOES TO THE COLLECTOR WHO HOLDS THE ACCOUNT. A campaign never reassigns: grade decides
 * who may hold an account, and that is a team leader's decision made elsewhere.
 *
 * NO FEE IS RAISED FOR BEING ON A CAMPAIGN. A call is not a chargeable action; the consultation it
 * leads to is, and the collector logs that exactly as on any other call.
 *
 * Pure, and `.js` specifiers, because the serverless route imports it.
 */
import { isWorkingDay } from './workingDays.js'

export type CallMode = 'now' | 'spread'

/** Where a campaign's calls sit on the day. The numbers are the stored `rank` (coalesced over the
    rung in the database), placed BETWEEN the rungs so a campaign never ties with one. */
export interface CallRank { rank: number; label: string }

/** Worked now: above a broken promise, which is 10. */
export const NOW_RANK = 5

/** A spread campaign's choices. Never above a broken promise -- only NOW is. */
export const SPREAD_RANKS: CallRank[] = [
  { rank: 15, label: 'Just under broken PTPs' },
  { rank: 25, label: 'Under new accounts' },
  { rank: 35, label: 'Under PTPs due' },
  { rank: 45, label: 'Under callbacks' },
  { rank: 65, label: 'Above routine follow-ups only' },
]
/** "Ranking pretty high": just under the one thing the firm never lets anything above. */
export const DEFAULT_SPREAD_RANK = 15

export function rankWords(mode: CallMode, rank: number): string {
  if (mode === 'now') return 'Now, above everything'
  return SPREAD_RANKS.find((r) => r.rank === rank)?.label ?? `Rank ${rank}`
}

/**
 * A day's work where nobody has set a figure: diaryPriority.ts's DEFAULT_DIARY_CAPACITY, the
 * company standard of 50. Restated rather than imported because that file imports with `.ts`
 * specifiers and the serverless route cannot load it; check-call-campaigns holds the two equal.
 */
export const STANDARD_DAY = 50

/** The longest a spread campaign may run. A campaign that lasts a quarter is a book, not a push. */
export const MAX_CALL_DAYS = 30

/** A spread campaign's end date problem, or null. `today` and `endsOn` are 'YYYY-MM-DD'. */
export function endDateProblem(mode: CallMode, today: string, endsOn: string | null): string | null {
  if (mode === 'now') return null
  if (!endsOn || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return 'Choose the last day the campaign runs.'
  if (endsOn < today) return 'The end date has already gone.'
  if (callDays(today, endsOn).length === 0) return 'There is no working day between today and the end date.'
  if (callDays(today, endsOn).length > MAX_CALL_DAYS) return `A campaign runs ${MAX_CALL_DAYS} working days at most.`
  return null
}

/** The working days a spread campaign has, today to the end inclusive. */
export function callDays(from: string, to: string): string[] {
  const out: string[] = []
  let d = from
  for (let i = 0; i < 400 && d <= to; i += 1) {
    if (isWorkingDay(d)) out.push(d)
    const t = new Date(`${d}T00:00:00Z`)
    t.setUTCDate(t.getUTCDate() + 1)
    d = t.toISOString().slice(0, 10)
  }
  return out
}

export interface CallAccount { accountId: string; ownerId: string }

export interface CallPlan {
  placed: { accountId: string; ownerId: string; dueOn: string }[]
  /** Spread only: no room before the end date. */
  unplaced: CallAccount[]
  /** Per collector: how far over their day the calls take them (NOW), or 0. */
  over: Map<string, number>
}

/**
 * WHERE EACH CALL LANDS.
 *
 *   capacityOf(owner)       their working rate (diary_capacity, 50 where unset).
 *   loadOf(owner, day)      what is already open on their diary that day.
 *
 * SPREAD EVENLY, then fill. A campaign of twenty over five days is four a day rather than twenty on
 * Monday: "it should be able to spread out". The even share is capped by the room on that day; a
 * second pass puts what is left into whatever room remains, earliest first.
 */
export function planCalls(input: {
  mode: CallMode
  today: string
  endsOn: string
  accounts: CallAccount[]
  capacityOf: (ownerId: string) => number
  loadOf: (ownerId: string, day: string) => number
}): CallPlan {
  const placed: CallPlan['placed'] = []
  const unplaced: CallAccount[] = []
  const over = new Map<string, number>()
  const byOwner = new Map<string, string[]>()
  for (const a of input.accounts) byOwner.set(a.ownerId, [...(byOwner.get(a.ownerId) ?? []), a.accountId])

  for (const [ownerId, ids] of byOwner) {
    const cap = input.capacityOf(ownerId)
    if (input.mode === 'now') {
      for (const accountId of ids) placed.push({ accountId, ownerId, dueOn: input.today })
      const beyond = input.loadOf(ownerId, input.today) + ids.length - cap
      if (beyond > 0) over.set(ownerId, beyond)
      continue
    }
    const days = callDays(input.today, input.endsOn)
    const room = new Map(days.map((d) => [d, Math.max(0, cap - input.loadOf(ownerId, d))]))
    const share = Math.ceil(ids.length / Math.max(1, days.length))
    let next = 0
    const put = (day: string, n: number) => {
      for (let i = 0; i < n && next < ids.length; i += 1) {
        placed.push({ accountId: ids[next], ownerId, dueOn: day })
        next += 1
        room.set(day, (room.get(day) ?? 0) - 1)
      }
    }
    for (const d of days) put(d, Math.min(share, room.get(d) ?? 0))
    for (const d of days) put(d, room.get(d) ?? 0)
    for (; next < ids.length; next += 1) unplaced.push({ accountId: ids[next], ownerId })
  }
  return { placed, unplaced, over }
}

/** The confirm step's sentence, read back before anything lands on anybody's diary. */
export function callConfirmation(input: {
  name: string; mode: CallMode; rank: number; endsOn: string; placing: number; collectors: number
  skipped: number; unplaced: number; overCollectors: number; endWords: string
}): string {
  const n = (x: number) => x.toLocaleString('en-ZA')
  const who = `${input.collectors} ${input.collectors === 1 ? 'collector' : 'collectors'}`
  const calls = `${n(input.placing)} ${input.placing === 1 ? 'call' : 'calls'}`
  const head = input.mode === 'now'
    ? `“${input.name}” puts ${calls} on today’s diary for ${who}, above everything else on it.`
    : `“${input.name}” spreads ${calls} over ${who}’ diaries until ${input.endWords}, ${rankWords('spread', input.rank).toLowerCase()}.`
  const tail = [
    input.skipped > 0 ? `${n(input.skipped)} skipped` : '',
    input.unplaced > 0 ? `${n(input.unplaced)} do not fit before the end date and are left off` : '',
    input.overCollectors > 0 ? `${input.overCollectors} ${input.overCollectors === 1 ? 'collector goes' : 'collectors go'} over their day` : '',
  ].filter(Boolean)
  return `${head}${tail.length ? ` ${tail.join('; ')}.` : ''} Anything not worked by the end is taken off, and still counted as missed.`
}
