/**
 * What a diary entry is, how urgent it is, and how a day's work is ordered.
 *
 * Pure on purpose: no database, no clock of its own, no imports outside this file and the
 * working-day calendar. Everything takes and returns 'YYYY-MM-DD'. That is what lets the
 * ordering be tested against real dates without a server, and what lets the same ladder be
 * stated once and checked against the SQL.
 *
 * THE LADDER IS DUPLICATED IN SQL, in public.diary_priority(). It has to be: the book will
 * reach six figures, so the day list is ordered and paged in the database, not in the browser.
 * scripts/qa/check-diary-priority.mjs reads both and fails if they drift apart.
 */
import { isWorkingDay } from './workingDays.ts'

/**
 * The kinds of work that land in a collections diary.
 *
 * The order of this list is the firm's order of importance, and it is not arbitrary:
 *
 * A BROKEN PROMISE comes before everything. That debtor answered the phone, agreed an amount
 * and a date, and then did not pay -- which makes them the most collectable person on the book
 * and the most likely to slip away if nobody rings the day it fails.
 *
 * A NEW ACCOUNT is next. Debt collects best when it is fresh; a handover that sits for a month
 * before its first call is worth measurably less than one worked in its first week.
 *
 * A ROUTINE REVIEW comes last however long it has waited. This is the point of having a ladder
 * at all: without one, a day that opens oldest-first buries a promise that broke this morning
 * under two hundred chases from last year.
 */
export type DiaryKind =
  | 'promise_broken'
  | 'payment_default'
  | 'new_account'
  | 'promise_due'
  | 'callback'
  | 'dispute_chase'
  | 'trace'
  | 'review'

/** Lower is sooner. Mirrors public.diary_priority() exactly. */
export const DIARY_PRIORITY: Record<DiaryKind, number> = {
  promise_broken: 10,
  payment_default: 15,
  new_account: 20,
  promise_due: 30,
  callback: 40,
  dispute_chase: 50,
  trace: 60,
  review: 70,
}

interface KindMeta {
  /** What it says in the day list. */
  label: string
  /** Why it is where it is on the ladder, shown as the row's tooltip. */
  why: string
}

export const DIARY_KINDS: Record<DiaryKind, KindMeta> = {
  promise_broken: {
    label: 'Broken promise',
    why: 'They agreed an amount and a date and did not pay. Most collectable, and most likely to go quiet if left.',
  },
  payment_default: {
    label: 'Payment defaulted',
    why: 'An instalment on a running arrangement did not come off.',
  },
  new_account: {
    label: 'New account',
    why: 'Freshly handed over and never worked. Debt collects best while it is new.',
  },
  promise_due: {
    label: 'Promise due',
    why: 'Money was due today. Check it arrived before it becomes a broken promise.',
  },
  callback: {
    label: 'Call back',
    why: 'We told the debtor we would ring on this day.',
  },
  dispute_chase: {
    label: 'Dispute chase',
    why: 'The seven working days the debtor was given are running out.',
  },
  trace: {
    label: 'Trace',
    why: 'Waiting on a tracing result.',
  },
  review: {
    label: 'Review',
    why: 'The ordinary diarised chase.',
  },
}

export const DIARY_KIND_ORDER: DiaryKind[] = (Object.keys(DIARY_PRIORITY) as DiaryKind[])
  .sort((a, b) => DIARY_PRIORITY[a] - DIARY_PRIORITY[b])

export function priorityOf(kind: DiaryKind): number {
  return DIARY_PRIORITY[kind] ?? DIARY_PRIORITY.review
}

/* ---------- ordering a day ---------- */

export interface DiaryOrderable {
  kind: DiaryKind
  dueOn: string
  /** The account's prescription date, if it has one. */
  prescriptionOn?: string | null
}

/**
 * How close to prescription an account has to be before it jumps the queue.
 *
 * Three years after the last payment or acknowledgement the debt cannot be enforced at all, and
 * the work that interrupts prescription has to happen BEFORE the date, not on it. Sixty days is
 * enough to get a letter out, get it delivered, and get an acknowledgement back.
 */
export const PRESCRIPTION_WARNING_DAYS = 60

const DAY = 86_400_000
const at = (date: string): number => Date.parse(`${date}T00:00:00Z`)

/** Whole days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  return Math.round((at(to) - at(from)) / DAY)
}

/**
 * Is this account close enough to prescribing that it should be worked ahead of its band?
 *
 * Returns false for an account with no prescription date rather than guessing one -- a missing
 * date is a gap in the imported data, and inventing urgency from a gap would push real work down
 * the list for no reason.
 */
export function nearPrescription(prescriptionOn: string | null | undefined, today: string): boolean {
  if (!prescriptionOn) return false
  const left = daysBetween(today, prescriptionOn)
  return left <= PRESCRIPTION_WARNING_DAYS
}

/**
 * The order an agent's day is worked in.
 *
 * Prescription first, then the ladder, then oldest first inside a band.
 *
 * Prescription overrides the ladder because it is the one deadline the firm cannot argue with:
 * a routine review on an account that prescribes in three weeks is worth more than a broken
 * promise on one that has years to run, because after that date the first is worth nothing at
 * all. Everything else is a judgement about collectability; this one is a judgement about
 * whether the debt still exists.
 */
export function compareDiary(a: DiaryOrderable, b: DiaryOrderable, today: string): number {
  const ap = nearPrescription(a.prescriptionOn, today)
  const bp = nearPrescription(b.prescriptionOn, today)
  if (ap !== bp) return ap ? -1 : 1
  if (ap && bp) {
    // Both running out: the one running out sooner.
    const ad = daysBetween(today, a.prescriptionOn as string)
    const bd = daysBetween(today, b.prescriptionOn as string)
    if (ad !== bd) return ad - bd
  }
  const pd = priorityOf(a.kind) - priorityOf(b.kind)
  if (pd !== 0) return pd
  return at(a.dueOn) - at(b.dueOn)
}

export function sortDiary<T extends DiaryOrderable>(entries: T[], today: string): T[] {
  return [...entries].sort((x, y) => compareDiary(x, y, today))
}

/* ---------- how full a day is ---------- */

/** What the firm assumes a day holds when nobody has set a figure for this person. */
export const DEFAULT_DIARY_CAPACITY = 30

export type DayLoadLevel = 'free' | 'filling' | 'full' | 'over'

export interface DayLoad {
  date: string
  booked: number
  capacity: number
  level: DayLoadLevel
  /** A weekend or a public holiday: nobody is at a desk. */
  closed: boolean
}

/**
 * How full a day is, as something a colour can be chosen from.
 *
 * The thresholds are proportions rather than counts so they hold for an agent set to 15 a day
 * and one set to 60. "Filling" starts at three quarters, which is late enough not to nag and
 * early enough to still pick a different day.
 */
export function dayLoad(input: { date: string; booked: number; capacity?: number | null }): DayLoad {
  const capacity = input.capacity && input.capacity > 0 ? input.capacity : DEFAULT_DIARY_CAPACITY
  const closed = !isWorkingDay(input.date)
  const ratio = input.booked / capacity
  const level: DayLoadLevel = input.booked >= capacity
    ? (ratio >= 1.25 ? 'over' : 'full')
    : ratio >= 0.75 ? 'filling' : 'free'
  return { date: input.date, booked: input.booked, capacity, level, closed }
}

/**
 * What to say about a day in one line, under the date.
 *
 * Written as a sentence rather than "18/30" because the number on its own does not tell somebody
 * who has never seen their capacity setting whether eighteen is a lot.
 */
export function dayLoadSentence(load: DayLoad): string {
  if (load.closed) return 'Nobody is at a desk'
  if (load.booked === 0) return 'Nothing booked'
  const each = load.booked === 1 ? '1 account' : `${load.booked} accounts`
  switch (load.level) {
    case 'over': return `${each} — well over a day`
    case 'full': return `${each} — a full day`
    case 'filling': return `${each} of ${load.capacity}`
    default: return `${each} booked`
  }
}

/**
 * The next working day an agent has room on, starting from `from`.
 *
 * Used to suggest a date rather than to impose one: an agent who wants the 5th because that is
 * what they told the debtor gets the 5th. This only stops the app suggesting a Sunday, or the
 * day that already has forty accounts on it.
 */
export function firstDayWithRoom(
  from: string,
  loads: Map<string, number>,
  capacity: number | null | undefined,
  limit = 60,
): string {
  let date = from
  for (let i = 0; i < limit; i += 1) {
    const load = dayLoad({ date, booked: loads.get(date) ?? 0, capacity })
    if (!load.closed && (load.level === 'free' || load.level === 'filling')) return date
    date = nextDate(date)
  }
  return from
}

export function nextDate(date: string): string {
  const d = new Date(at(date) + DAY)
  return d.toISOString().slice(0, 10)
}

export function shiftDate(date: string, days: number): string {
  return new Date(at(date) + days * DAY).toISOString().slice(0, 10)
}

/**
 * The days to show in the picker's strip: whole weeks, so the columns line up under Mon-Sun
 * headings, starting from the Monday of the week `from` falls in.
 */
export function calendarStrip(from: string, weeks: number): string[] {
  const start = new Date(at(from))
  // getUTCDay: 0 is Sunday. Monday-first means Sunday counts as the seventh day.
  const back = (start.getUTCDay() + 6) % 7
  const first = shiftDate(from, -back)
  return Array.from({ length: weeks * 7 }, (_, i) => shiftDate(first, i))
}

/* ---------- what a missed entry is ---------- */

/**
 * Missed is not a state anybody writes down: it is an open entry whose day has gone.
 *
 * Deliberately derived rather than stored. A stored flag needs something to set it, which means
 * a nightly job, which means a night it does not run is a night the diary quietly lies. This
 * cannot drift because there is nothing to drift from.
 */
export function isMissed(entry: { state: string; dueOn: string }, today: string): boolean {
  return entry.state === 'open' && entry.dueOn < today
}

/** How overdue, in words, for the row that says so. */
export function overdueBy(dueOn: string, today: string): string {
  const days = daysBetween(dueOn, today)
  if (days <= 0) return ''
  if (days === 1) return '1 day late'
  if (days < 14) return `${days} days late`
  if (days < 60) return `${Math.round(days / 7)} weeks late`
  if (days < 365) return `${Math.round(days / 30)} months late`
  const years = (days / 365).toFixed(days < 730 ? 1 : 0)
  return `${years} year${days < 730 ? '' : 's'} late`
}

/* ---------- spreading a backlog over real days ---------- */

/**
 * `count` consecutive WORKING days, starting at or after `start`.
 *
 * The whole point of the bulk re-diarise tool. Moving 214 missed accounts onto one date is what
 * produced the problem in the first place — one agent came across from the old system carrying
 * 44 accounts on a single day, none of which were worked. So the tool never offers a single day;
 * it offers a run of them, and weekends and public holidays are simply not in the run.
 */
export function workingDaysFrom(start: string, count: number, limit = 400): string[] {
  const days: string[] = []
  let date = start
  for (let i = 0; i < limit && days.length < count; i += 1) {
    if (isWorkingDay(date)) days.push(date)
    date = nextDate(date)
  }
  return days
}

export interface SpreadPlan {
  days: string[]
  perDay: number
  /** How many land on the last day, which is usually fewer than the rest. */
  onLastDay: number
}

/**
 * What re-diarising a pile will actually do, worked out before anybody presses the button.
 *
 * Returned rather than described so the modal can say "214 accounts across 8 working days,
 * 15 September to 24 September, 30 a day" — which is a sentence somebody can disagree with,
 * unlike a button that silently does something to two hundred records.
 */
export function planSpread(total: number, start: string, perDay: number): SpreadPlan {
  const safePerDay = Math.max(1, Math.floor(perDay))
  const needed = Math.max(1, Math.ceil(total / safePerDay))
  const days = workingDaysFrom(start, needed)
  const onLastDay = total === 0 ? 0 : total - safePerDay * (days.length - 1)
  return { days, perDay: safePerDay, onLastDay }
}

/* ---------- choosing what to look at first ---------- */

/**
 * How an agent wants their day ordered.
 *
 * The ladder is the right DEFAULT and the wrong law. A collector who has a settlement meeting at
 * eleven wants the big balances; one chasing a bad month wants every promise that is due; one
 * coming back from leave wants the oldest thing first. The firm asked to choose, and choosing is
 * not the same as filtering — nothing is hidden, it is only reordered.
 */
export type DiaryOrder =
  | 'urgent'
  | 'amount'
  | 'oldest'
  /** 'first:<kind>' floats one kind to the top and leaves the ladder alone underneath it. */
  | `first:${DiaryKind}`

export const DIARY_ORDER_LABELS: { id: DiaryOrder; label: string }[] = [
  { id: 'urgent', label: 'Most urgent first' },
  { id: 'amount', label: 'Biggest balance first' },
  { id: 'oldest', label: 'Longest waiting first' },
  ...DIARY_KIND_ORDER.map((k) => ({ id: `first:${k}` as DiaryOrder, label: `${DIARY_KINDS[k].label} first` })),
]

/** The kind a 'first:<kind>' order floats, or null for the orders that do not float one. */
export function floatedKind(order: DiaryOrder): DiaryKind | null {
  if (!order.startsWith('first:')) return null
  const kind = order.slice('first:'.length) as DiaryKind
  return kind in DIARY_PRIORITY ? kind : null
}

export interface DiaryOrderable2 extends DiaryOrderable {
  /** What is still owed. Only consulted by the 'amount' order. */
  outstanding?: number
}

/**
 * Order a day the way the agent asked.
 *
 * Every order falls back to the ladder once its own question is settled, so a list is never
 * arbitrary below the fold: "biggest balance first" still puts a broken promise above a review
 * when two accounts owe the same, and floating callbacks to the top leaves everything under them
 * in the order it would have been anyway.
 *
 * Prescription is NOT overridden by any of this. An account that stops being enforceable next
 * month is not a matter of preference — see compareDiary.
 */
export function orderDiary<T extends DiaryOrderable2>(entries: T[], order: DiaryOrder, today: string): T[] {
  const ladder = (a: T, b: T) => compareDiary(a, b, today)

  if (order === 'amount') {
    return [...entries].sort((a, b) => {
      const pa = nearPrescription(a.prescriptionOn, today)
      const pb = nearPrescription(b.prescriptionOn, today)
      if (pa !== pb) return pa ? -1 : 1
      const d = (b.outstanding ?? 0) - (a.outstanding ?? 0)
      return d !== 0 ? d : ladder(a, b)
    })
  }

  if (order === 'oldest') {
    return [...entries].sort((a, b) => {
      const pa = nearPrescription(a.prescriptionOn, today)
      const pb = nearPrescription(b.prescriptionOn, today)
      if (pa !== pb) return pa ? -1 : 1
      return a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : ladder(a, b)
    })
  }

  const floated = floatedKind(order)
  if (floated) {
    return [...entries].sort((a, b) => {
      // Prescription first here too. Floating "broken promises" must not bury an account that
      // stops being enforceable next month underneath one that has four years to run.
      const pa = nearPrescription(a.prescriptionOn, today)
      const pb = nearPrescription(b.prescriptionOn, today)
      if (pa !== pb) return pa ? -1 : 1
      const fa = a.kind === floated
      const fb = b.kind === floated
      if (fa !== fb) return fa ? -1 : 1
      return ladder(a, b)
    })
  }

  return sortDiary(entries, today)
}
