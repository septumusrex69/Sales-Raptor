/**
 * EVERY TICKET'S CLOCK, AND WHAT IT SAYS ABOUT WHOEVER OWNS IT (S14, Raptor H13).
 *
 * THE FIRM, 27 Oct: "every query has like a timer on to say how long has it been, how long did it take to
 * resolve this ... it can form part of their statistics ... how long did they resolve all of their queries
 * in general" -- and, asked what should count against the clerk or communications agent, BOTH: the time it
 * sat WITH US (the clock stopped while the client had it) and the WHOLE time it was open.
 *
 * OFFICE HOURS, NOT THE CALENDAR. 08:00-16:30 on a working day -- the firm's own hours (firm_settings:
 * "Monday to Friday, 08:00 - 16:30") -- with weekends and public holidays off (workingDays.ts). A ticket
 * raised at four on a Friday and answered at nine on Monday was answered within an hour; counted on the
 * calendar it took three days, and the person who answered it first thing would read as the slowest.
 *
 * Johannesburg time, which has no daylight saving, so a fixed two hours from UTC.
 *
 * PURE: the stages (account_query_stages), the first reply and "now" are passed in.
 */
import { isWorkingDay } from './workingDays.ts'

export const DAY_STARTS = 8 * 60
export const DAY_ENDS = 16 * 60 + 30
/** One working day, in minutes: what "1 d" means on a ticket. */
export const WORKING_DAY_MINUTES = DAY_ENDS - DAY_STARTS
const SAST_MS = 2 * 60 * 60 * 1000

/** Office minutes between two instants: the overlap with 08:00-16:30 on each working day between them. */
export function workingMinutes(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso) + SAST_MS
  const to = Date.parse(toIso) + SAST_MS
  if (!(to > from)) return 0
  let total = 0
  /* Day by day in "Johannesburg as if it were UTC": midnight of the first day to the end. */
  for (let day = Math.floor(from / 86_400_000) * 86_400_000; day < to; day += 86_400_000) {
    const date = new Date(day).toISOString().slice(0, 10)
    if (!isWorkingDay(date)) continue
    const open = day + DAY_STARTS * 60_000
    const close = day + DAY_ENDS * 60_000
    const a = Math.max(open, from), b = Math.min(close, to)
    if (b > a) total += (b - a) / 60_000
  }
  return Math.round(total)
}

export interface StageMark { stage: string; status: string; at: string }

export interface TicketTimes {
  /** Raised to resolved, or to now while it is open -- office minutes. */
  open: number
  /** Of that, the time the client had it (stage 'client'). */
  withClient: number
  /** Of that, the time it sat with us: open less withClient. */
  withUs: number
  /** Raised to the first thing done about it: an email to the client, or the ticket moving on. Null while nothing has. */
  firstResponse: number | null
  resolved: boolean
}

/**
 * The ticket's clock out of its stage history. Each mark holds from its own time to the next one; the last
 * holds to the close or to now. A ticket with no history (raised before the history was kept and never
 * moved since) is one long stretch with us, which is the honest reading of what is known.
 */
export function ticketTimes(input: {
  raisedAt: string
  closedAt: string | null
  stages: StageMark[]
  /** The first email we sent about it, if any. */
  firstReplyAt?: string | null
}, nowIso: string): TicketTimes {
  const end = input.closedAt ?? nowIso
  const marks = [...input.stages].sort((a, b) => a.at.localeCompare(b.at))
  let withClient = 0
  for (let i = 0; i < marks.length; i += 1) {
    if (marks[i].status === 'closed') break
    if (marks[i].stage !== 'client') continue
    const until = i + 1 < marks.length ? marks[i + 1].at : end
    withClient += workingMinutes(marks[i].at, until < end ? until : end)
  }
  const open = workingMinutes(input.raisedAt, end)
  /* The first MOVE: the first mark after the one it was raised with. */
  const moved = marks.find((m) => m.at > input.raisedAt)?.at ?? null
  const firsts = [input.firstReplyAt ?? null, moved].filter((x): x is string => !!x && x >= input.raisedAt).sort()
  return {
    open,
    withClient: Math.min(withClient, open),
    withUs: Math.max(0, open - withClient),
    firstResponse: firsts.length ? workingMinutes(input.raisedAt, firsts[0]) : null,
    resolved: !!input.closedAt,
  }
}

/** "2 d 3 h", "3 h 20 min", "15 min" -- working days of 8½ hours, because that is what a day here is. */
export function formatWorkingTime(minutes: number | null): string {
  if (minutes === null) return '—'
  const m = Math.max(0, Math.round(minutes))
  const d = Math.floor(m / WORKING_DAY_MINUTES)
  const h = Math.floor((m % WORKING_DAY_MINUTES) / 60)
  const min = m % 60
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`
  if (h > 0) return min > 0 ? `${h} h ${min} min` : `${h} h`
  return `${min} min`
}

export interface PersonTicketStats {
  ownerId: string
  resolved: number
  open: number
  /** Averages over the RESOLVED tickets, office minutes. */
  avgFirstResponse: number | null
  avgWithUs: number | null
  avgOpen: number | null
}

/**
 * Each person's figures: how many they resolved and still hold, and on the resolved ones the averages --
 * first response, time with us, whole time open. Credited to the OWNER, the person whose ticket it was;
 * averaged over resolved tickets only, so a ticket still open does not drag a figure about finished work.
 */
export function statsByOwner(tickets: { ownerId: string | null; times: TicketTimes }[]): PersonTicketStats[] {
  const by = new Map<string, { ownerId: string; done: TicketTimes[]; open: number }>()
  for (const t of tickets) {
    if (!t.ownerId) continue
    const row = by.get(t.ownerId) ?? { ownerId: t.ownerId, done: [], open: 0 }
    if (t.times.resolved) row.done.push(t.times); else row.open += 1
    by.set(t.ownerId, row)
  }
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null)
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null
  }
  return [...by.values()].map((r) => ({
    ownerId: r.ownerId,
    resolved: r.done.length,
    open: r.open,
    avgFirstResponse: avg(r.done.map((t) => t.firstResponse)),
    avgWithUs: avg(r.done.map((t) => t.withUs)),
    avgOpen: avg(r.done.map((t) => t.open)),
  })).sort((a, b) => b.resolved - a.resolved || a.ownerId.localeCompare(b.ownerId))
}
