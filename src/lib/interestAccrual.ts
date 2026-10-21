/**
 * Interest between the last posted accrual and today.
 *
 * The book Raptor inherited posts interest once a month. Every one of the 12,078 migrated
 * accruals is a monthly row, and the ratio between consecutive full-month accruals is exactly
 * 1.0200 on 4,845 of them (and 1.0404 — 1.02 squared — on a further 453 where a month was
 * skipped). That is 24% a year charged as a flat 2% of the running balance each month,
 * capitalised, and it does not vary with whether the month had 28, 29, 30 or 31 days.
 *
 * A month is a long time to wait for a balance to move. So the balance is accrued to TODAY here,
 * pro-rated across the days elapsed, and the figure is computed rather than written: no job, no
 * cron, nothing to double-charge, and no row to reverse if the account turns out to have been
 * settled last week. The moment the open period closes, the amount this produces is exactly the
 * 2% the book has always charged — pro-rating by days-in-that-calendar-month is what makes a
 * full month land on the monthly figure to the cent.
 *
 * Compounding happens at each month boundary, as it does in the posted history: an open period
 * spanning September and October accrues September on the opening balance and October on the
 * balance September left behind.
 *
 * WHERE THE CLOCK STARTS, IN THE FIRM'S OWN WORDS. Asked how interest behaves across an import:
 * "normally, interest starts occurring from the date of handover. Sometimes the client does put
 * their interest in. Sometimes not, but the handover is the capital. Whether or not they charge the
 * interest is up to them. So we will not ask Raptor to calculate this."
 *
 * Three rules come out of that and they are the whole of it:
 *
 *   1. THE HANDOVER FIGURE IS THE CAPITAL. Whatever interest the client rolled in before they gave
 *      the firm the file is inside that number. It is not separable and nobody is asked to separate
 *      it -- which is also why in duplum's ceiling is that figure and never twice it.
 *   2. RAPTOR'S CLOCK STARTS AT THE HANDOVER, never earlier. A date before the handover belongs to
 *      the client's own book: accruing from it would be Raptor recomputing interest the client has
 *      already charged and already folded into the capital, on a file the firm did not have yet.
 *      `debtor_accounts.interest_from` is a RECORD OF WHAT THE CLIENT TOLD US and on 63 of the 738
 *      imported accounts it is 1 to 95 days BEFORE the handover -- so it is not the column to
 *      accrue from, and nothing in accountBalance.ts reads it.
 *   3. IT RUNS ON THE OUTSTANDING BALANCE, NOT ON THE CAPITAL. The firm, asked what the base is:
 *      "interest is calculated on the outstanding balance, which includes the handover plus fees
 *      plus other interest minus payments." So Annexure B fees bear interest like everything else,
 *      and interest compounds on interest -- which is what the posted history already does, and
 *      what `computeBalance` already hands this file (capital + interest + fees + receiptFees -
 *      payments). It is written down here because it is a decision and not an implementation
 *      detail: a reading of "interest on the capital" is defensible, several creditors work that
 *      way, and it would be a smaller number on every account in the book.
 *   3a. AND WHERE NOTHING HAS BEEN POSTED, THE HANDOVER IS WHERE IT STARTS. `openAccrual` falls back
 *      to the day before the handover date, so the first accruing day is the handover itself. This
 *      was left unbuilt for a year and the cost was quiet: 23 039 of the 23 774 live accounts on
 *      staging had no posted accrual and were standing still -- three of them imported, the rest
 *      accounts Raptor captured or seeded itself, which is every account the firm opens from here
 *      on. The firm read one of them and asked "no interest?"
 *   4. AN IMPORT CONTINUES, IT DOES NOT RECOMPUTE. The firm: "the interest ... has already run. So
 *      it's exported from Swordfish. And then we will import it on the same day. So then it should
 *      just continue running." The posted accruals come across as they were posted and `coveredTo`
 *      picks up the day after the last of them. This is the frozen-history rule in CLAUDE.md
 *      applied to interest, and it is why this file computes only the OPEN period.
 *
 * The convention lives in ONE place — `MONTHS_PER_YEAR` and `proRata` below — because it is the
 * one number in this system that turns time into money. If the business ever moves to true daily
 * interest (365ths of the annual rate rather than 12ths of it, which is a different and slightly
 * larger amount), it changes here and the statement follows.
 */

const MONTHS_PER_YEAR = 12

export interface OpenAccrual {
  /** First day of the open period (the day after the last posted accrual covered). */
  from: string
  /** Last day accrued — today. */
  to: string
  /** Calendar days in the open period, counting both ends. */
  days: number
  /** Interest accrued and not yet posted. */
  amount: number
}

export interface AccrualInput {
  /** What the account owed at the close of the last posted accrual. Interest runs on this. */
  openingBalance: number
  /** Annual rate as a percentage: 24 means 24% a year. */
  annualRate: number
  /** Last day already covered by a posted accrual (inclusive). */
  coveredTo: string
  /** Accrue up to and including this day. */
  asAt: string
  /**
   * WHAT MOVED THE BALANCE *INSIDE* THE OPEN PERIOD — a fee as a debit (+), a payment as a
   * credit (−) — each on its own day.
   *
   * It was safe to leave these out while the open period was the few days between the last
   * monthly posting and today: a fee raised inside it earns interest for five days either way and
   * the difference is cents. It stopped being safe the moment the period could start at the
   * HANDOVER, because an account captured last May has sixteen months of open period, and running
   * one closing balance across all of it charges the debtor interest from day one on a fee raised
   * in month eight and never gives back the months after a payment.
   *
   * Applied at the START of the day they are dated, which is the reading that cannot overcharge:
   * a fee raised on the 10th bears interest for the 10th onward, and a payment received on the
   * 10th stops bearing from the 10th. The firm's rule is that interest runs on the outstanding
   * balance (interestAccrual rule 3) — this is that rule read day by day rather than once.
   *
   * Interest still capitalises at the MONTH boundary and nowhere else, exactly as the posted
   * history does: a movement splits the month into segments charged at the balance in force, and
   * the month's interest joins the balance when the month closes.
   */
  movements?: { date: string; amount: number }[]
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const parse = (s: string) => new Date(`${s}T00:00:00Z`)
const addDays = (s: string, n: number) => iso(new Date(parse(s).getTime() + n * 86_400_000))
const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000)
const daysInMonth = (s: string) => {
  const d = parse(s)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
}
const endOfMonth = (s: string) => `${s.slice(0, 7)}-${String(daysInMonth(s)).padStart(2, '0')}`
const round = (n: number) => Math.round(n * 100) / 100

/**
 * The day before a given day.
 *
 * `coveredTo` is the last day ALREADY covered, so a caller that wants interest to start ON a date
 * passes the day before it. That is a one-day trap on the one date the firm actually named — the
 * handover — so the arithmetic lives here rather than being written out at the call site.
 */
export function dayBefore(date: string): string {
  return addDays(date, -1)
}

/**
 * The last day a posted accrual covers.
 *
 * Swordfish stores `days` as an exclusive count, so `accrued_on + days` is the last covered day:
 * a row of 1 August for 30 days covers to 31 August, and the stub of 1 September for 6 days
 * covers to 7 September, which is where the migrated book stops. Checked against February 2026
 * (27 days → the 28th) and June (29 days → the 30th).
 */
export function coveredTo(accruals: { from: string; days: number }[]): string | null {
  let latest: string | null = null
  for (const a of accruals) {
    const end = accrualEnd(a.from, a.days)
    if (!latest || end > latest) latest = end
  }
  return latest
}

/**
 * The last day a single accrual covers.
 *
 * Split out of `coveredTo` so the statement can date a row at the end of the period it covers —
 * which is where Swordfish posts it, and where a debtor expects to find it — without restating
 * the exclusive-count convention somewhere else and letting the two drift apart.
 */
export function accrualEnd(from: string, days: number): string {
  return addDays(from, Math.max(0, days))
}

/**
 * Interest from the day after `coveredTo` up to and including `asAt`.
 *
 * Returns null where nothing has accrued — no rate, nothing owed, or the book is already current.
 * A caller that gets null shows the posted position and says so; it does not show a zero.
 */
export function accrueToDate(input: AccrualInput): OpenAccrual | null {
  const { openingBalance, annualRate, coveredTo: covered, asAt } = input
  if (!(annualRate > 0) || !(openingBalance > 0)) return null
  const from = addDays(covered, 1)
  if (from > asAt) return null

  const monthlyRate = annualRate / 100 / MONTHS_PER_YEAR
  let balance = openingBalance
  let accrued = 0

  // In date order, so one cursor can walk both the calendar and the ledger. Movements outside the
  // open period are not this function's business: what falls before `from` is already inside the
  // opening balance, and what falls after `asAt` has not happened yet.
  const moves = (input.movements ?? [])
    .filter((m) => m.date >= from && m.date <= asAt && m.amount !== 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  let nextMove = 0

  // Month by month, so interest capitalises at each boundary exactly as the posted history does.
  let cursor = from
  while (cursor <= asAt) {
    const monthEnd = endOfMonth(cursor)
    const segmentEnd = monthEnd < asAt ? monthEnd : asAt
    /* The month's interest is accumulated and joined to the balance ONCE, at the close. Adding
       each segment as it is earned would compound within the month, which the posted history
       does not do — the book has always charged a flat 2% of the running balance per month. */
    let monthInterest = 0
    let day = cursor
    while (day <= segmentEnd) {
      // Everything dated today lands before today earns anything.
      while (nextMove < moves.length && moves[nextMove].date <= day) {
        balance += moves[nextMove].amount
        nextMove += 1
      }
      /* The run of days the balance holds for: up to the day before the next movement, or to the
         end of the month, whichever comes first. With no movements this is the whole segment and
         the arithmetic below is the flat monthly rate it always was. */
      const upcoming = nextMove < moves.length && moves[nextMove].date <= segmentEnd
        ? addDays(moves[nextMove].date, -1)
        : segmentEnd
      const runDays = daysBetween(day, upcoming) + 1
      // A whole month is runDays === daysInMonth, so this lands on the flat monthly rate.
      // Guarded above zero because an overpaid account must not earn the debtor interest.
      if (balance > 0) monthInterest += balance * monthlyRate * (runDays / daysInMonth(cursor))
      day = addDays(upcoming, 1)
    }
    accrued += monthInterest
    balance += monthInterest
    cursor = addDays(segmentEnd, 1)
  }

  return { from, to: asAt, days: daysBetween(from, asAt) + 1, amount: round(accrued) }
}
