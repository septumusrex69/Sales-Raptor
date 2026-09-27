/**
 * THE INSTALMENTS OF AN ARRANGEMENT, AS DATES, AND WHICH ONE A NOTICE IS ABOUT.
 *
 * THE FIRM ASKED FOR FIVE NOTICES ON AN ARRANGEMENT and every one of them quotes an amount and a
 * date: the confirmation, the reminder two business days out, the one on the day, the receipt, and
 * the notice of default three business days after. On a three-instalment arrangement that is
 * fifteen notices quoting three different pairs of figures, and the whole risk sits in one
 * question -- WHICH instalment is "the" instalment on the notice going out today.
 *
 * ONE ANSWER, AND IT IS THE EARLIEST INSTALMENT NOT YET PAID. That single definition is right on
 * all five steps, which is why it is worth stating rather than deciding per notice:
 *
 *   - on the confirmation it is instalment 1, because nothing is paid yet;
 *   - on a reminder it is the one coming up;
 *   - on the day, the one due today;
 *   - on a receipt it is the NEXT one, because the payment just allocated moved the boundary --
 *     which is what "Next payment: {{ptp_amount}} on {{ptp_date}}" on that email means;
 *   - on a default it is the one that was MISSED, because an unpaid instalment is still the
 *     earliest unpaid one. The firm's letter says "{{ptp_amount}}, due on {{ptp_date}}, has not
 *     reached our trust account", and this is what makes that true.
 *
 * THE PROMPT SAYS "the NEXT instalment, never the first or the total" and this is that rule read
 * precisely. "Next" cannot mean "the one after today" -- on the default letter that would quote
 * the instalment the debtor has not missed yet, over the words "has not reached our trust
 * account", which is a demand for money that is not yet owed.
 *
 * PURE, like arrangements.ts beside it: no database, no clock of its own, everything
 * 'YYYY-MM-DD'. The months that misbehave are February, the 31st and a leap year, and none of
 * them can be tested through a browser.
 */
/* `.js`, not `.ts`: this file is reachable from api/ through the workflow runner, and a .ts
   specifier does not survive Vercel's transpile. check-api-imports walks for it. */
import { nextDueDate, type Arrangement, type Recurring } from './arrangements.js'

/** One instalment of an arrangement: which number it is, what it is, and when it falls. */
export interface Instalment {
  /** 1-based, as the firm counts them: "R500 for three months" is instalments 1, 2 and 3. */
  no: number
  amount: number
  dueOn: string
}

/**
 * The parts of a promise this module needs.
 *
 * STRUCTURAL RATHER THAN IMPORTING PromiseToPay, for the reason arrangements.ts gives about
 * Recurring: that type lives beside the Supabase client, and depending on it would drag the
 * database into a file whose whole job is arithmetic.
 */
export interface Arranged extends Recurring {
  /** Per instalment, never the total. The column is named `amount` and means this. */
  amount: number
  /** What was agreed in total. Null on an arrangement nobody totalled, and on a once-off. */
  totalPromised: number | null
  /** How many instalments have actually been paid. Written when a payment is allocated. */
  instalmentsKept: number
}

/**
 * HOW MANY INSTALMENTS THE ARRANGEMENT IS, derived and never stored.
 *
 * The same arithmetic paymentProgress.ts does and for the same reason it gives: the promise
 * carries what was agreed in total and what each instalment is, and the count is the one that
 * follows. ROUNDED UP, because R1 000 at R300 a month is four payments and not three and a third,
 * and a debtor who has made three has not finished.
 *
 * A ONCE-OFF IS ONE, whatever the totals say: there is no schedule to divide.
 *
 * WHY NOT CALL instalmentProgress? That function answers a different question -- how a live
 * arrangement is GOING, with kept and missed counts in it -- and it takes `due` from its caller.
 * This needs only the count, before anything has happened. check-ptp-schedule holds the two
 * against each other so they cannot disagree about a number that ends up on a letter.
 */
export function instalmentCount(p: Arranged): number {
  if (!(p.amount > 0)) return 0
  if (p.arrangement === 'once_off') return 1
  const total = p.totalPromised ?? 0
  return Math.max(1, Math.ceil((total > 0 ? total : p.amount) / p.amount))
}

/**
 * EVERY INSTALMENT, DATED.
 *
 * WALKED WITH nextDueDate rather than multiplied out, which is the rule arrangements.ts already
 * wrote down: an instalment arrangement is a date in the month, not an interval. The last day is
 * the 28th in February and the 31st in March, and a debtor who pays on the 25th pays on the 25th.
 *
 * THE LAST ONE MAY BE SMALLER, and it is dishonest to round it up. R1 000 at R300 a month is
 * R300, R300, R300 and R100 -- and a reminder quoting R300 for the fourth is a demand for R200
 * the debtor never agreed to. The remainder is worked out from the total, and where there is no
 * total every instalment is the full amount because that is all the arrangement says.
 *
 * BOUNDED, because it walks. The cap is far past anything the firm writes -- a weekly arrangement
 * running five years is 260 instalments -- and exists for a row nobody has thought of.
 */
export function instalmentSchedule(p: Arranged): Instalment[] {
  const count = instalmentCount(p)
  if (count === 0) return []
  const total = (p.totalPromised ?? 0) > 0 ? (p.totalPromised as number) : null
  const out: Instalment[] = []
  let cursor: Recurring = p
  let paidOut = 0
  for (let n = 1; n <= Math.min(count, 600); n += 1) {
    /* THE REMAINDER ON THE LAST ONE. Only where a total is known, and only where it is actually
       smaller -- a total that divides exactly leaves the last instalment at the full amount. */
    const left = total === null ? p.amount : Math.max(0, total - paidOut)
    const amount = total === null ? p.amount : Math.min(p.amount, left)
    out.push({ no: n, amount, dueOn: cursor.dueOn })
    paidOut += amount
    const next = nextDueDate(cursor)
    if (!next) break
    cursor = { ...cursor, dueOn: next }
  }
  return out
}

/**
 * THE INSTALMENT EVERY ARRANGEMENT NOTICE IS ABOUT: the earliest one not yet paid.
 *
 * READ OFF instalmentsKept, which is a COUNT of payments and not a set of them. That is a real
 * limitation and it is the right one for this firm: an arrangement is paid in order, and a debtor
 * who pays the third instalment while owing the second has not paid the second. Counting forward
 * from what is kept is therefore the same answer as naming them individually, and it needs no
 * table of allocations to be right.
 *
 * NULL WHERE THE ARRANGEMENT IS FINISHED -- every instalment is paid -- and null is what leaves
 * {{ptp_amount}} standing as a placeholder rather than printing a gap. A notice about an
 * instalment that does not exist must not go out, and an unresolved field is exactly how the rest
 * of Raptor stops one.
 */
export function nextUnpaid(p: Arranged): Instalment | null {
  const schedule = instalmentSchedule(p)
  const kept = Math.max(0, Math.floor(p.instalmentsKept))
  return schedule[kept] ?? null
}

/**
 * THE ARRANGEMENT AN ACCOUNT IS ACTUALLY ON, out of everything ever promised on it.
 *
 * TWO STATES COUNT AS LIVE AND THE SECOND IS THE ONE WORTH EXPLAINING. `defaulted` is the 48 hours
 * the firm's default letter promises -- the arrangement is still on its existing terms in that
 * window and a payment revives it -- so a notice written inside it must still be able to quote the
 * instalment that was missed. Read `open` only and the default letter, the SMS beside it and
 * anything a collector composes in those two days would all merge a blank amount.
 *
 * THE NEWEST ONE WHERE THERE ARE SOMEHOW TWO. One arrangement per account is the rule and the
 * firm's own -- "somebody can only make one arrangement... and one arrangement can be changed" --
 * but this is a list read off a table, and reading the first row of an order nobody set is how the
 * non-deterministic sort bug happens. Ordered here so the answer cannot depend on which row
 * Postgres last rewrote.
 *
 * NOTHING LIVE RETURNS A ZERO ARRANGEMENT, whose schedule is empty and whose nextUnpaid is null --
 * which leaves both placeholders standing, which is what stops an arrangement notice being merged
 * against an account that has no arrangement.
 */
export function liveArrangement<T extends Arranged & { status: string; createdAt?: string }>(
  promises: T[],
): Arranged {
  const live = promises
    .filter((p) => p.status === 'open' || p.status === 'defaulted')
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0]
  return live ?? NO_ARRANGEMENT
}

/** An arrangement that is not one: no amount, so it schedules nothing and quotes nothing. */
export const NO_ARRANGEMENT: Arranged = {
  amount: 0, dueOn: '', arrangement: 'once_off', dayOfMonth: null, onLastDay: false,
  dayOfWeek: null, instalmentsKept: 0, totalPromised: null,
}

/**
 * A PROMISE ROW, AS THE DATABASE HANDS IT OVER, TURNED INTO SOMETHING THIS MODULE CAN SCHEDULE.
 *
 * THE ONE PLACE THE COLUMN NAMES APPEAR ON THE SERVER SIDE. CLAUDE.md's warning about hand-written
 * mappers is the reason it is one place and not two: AuthContext.mapProfileRow and
 * accountBook.toAccount both list every field by hand, and a column present in the table, the type
 * and the select but missing from the mapper reads as `undefined` for ever with nothing failing.
 * `diary_capacity` sat in that state for months. Here the same slip would read as an arrangement of
 * one instalment -- so a three-instalment arrangement would stop sending reminders after the first,
 * and nothing anywhere would report it.
 *
 * THE BROWSER NEEDS NO MAPPER AT ALL. `PromiseToPay` in accountWorkspace.ts already carries these
 * eight under exactly the names `Arranged` asks for, so it satisfies the interface structurally and
 * is passed straight to nextUnpaid. That is deliberate: one fewer list to fall behind.
 *
 * NULL IN IS NULL OUT -- an account with no live arrangement -- which is what leaves both
 * placeholders standing rather than merging a blank amount into a demand.
 */
export function arrangedFromRow(row: {
  amount?: number | string | null
  due_on?: string | null
  arrangement?: string | null
  day_of_month?: number | string | null
  on_last_day?: boolean | null
  day_of_week?: number | string | null
  instalments_kept?: number | string | null
  total_promised?: number | string | null
} | null | undefined): Arranged | null {
  if (!row || !row.due_on) return null
  const num = (v: number | string | null | undefined): number | null =>
    v === null || v === undefined || v === '' ? null : Number(v)
  return {
    amount: num(row.amount) ?? 0,
    dueOn: row.due_on,
    arrangement: (row.arrangement ?? 'once_off') as Arrangement,
    dayOfMonth: num(row.day_of_month),
    onLastDay: !!row.on_last_day,
    dayOfWeek: num(row.day_of_week),
    instalmentsKept: num(row.instalments_kept) ?? 0,
    totalPromised: num(row.total_promised),
  }
}

/** The instalment a notice merged off a database row is about. The two above, in one call. */
export function nextUnpaidFromRow(row: Parameters<typeof arrangedFromRow>[0]): Instalment | null {
  const arranged = arrangedFromRow(row)
  return arranged === null ? null : nextUnpaid(arranged)
}

/**
 * WHAT THE SCREEN CALLS AN ARRANGEMENT'S SHAPE: "3 instalments of R2 500.00, monthly on the 5th".
 *
 * The count belongs in this sentence because of what the firm's own letters say about it: an
 * arrangement taking more than six instalments to settle is reported to the bureaus as SLOW
 * PAYING, and the collector agreeing to a seventh instalment should be able to see that they are.
 */
export function describeSchedule(
  p: Arranged, money: (n: number) => string, shape: string,
): string {
  const count = instalmentCount(p)
  if (count === 0) return shape
  if (count === 1) return `One payment of ${money(p.amount)}`
  return `${count} instalments of ${money(p.amount)}, ${shape.toLowerCase()}`
}

/**
 * MORE THAN SIX INSTALMENTS IS REPORTED AS SLOW PAYING, and the firm's own letters say so to the
 * debtor in those words -- on the confirmation, before they agree to it, and again on the default.
 *
 * SO IT IS WORTH SHOWING THE COLLECTOR TOO, and worth being one function rather than a `> 6` in
 * two places: the number is the credit bureaus' and not ours, and if it moves it moves once.
 */
export const SLOW_PAYING_FROM = 7

export function readsAsSlowPaying(p: Arranged): boolean {
  return instalmentCount(p) >= SLOW_PAYING_FROM
}

/** The arrangements this module can schedule. Re-exported so a caller needs one import. */
export type { Arrangement }
