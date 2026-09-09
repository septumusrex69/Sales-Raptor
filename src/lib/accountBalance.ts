/**
 * What a debtor owes, and the statement that shows how.
 *
 * The balance is computed, never stored. That is the whole point: a debtor, a client or the
 * Council for Debt Collectors can ask how a figure was arrived at, and a stored number cannot
 * answer. Every line below traces to a row in one of the three ledgers.
 *
 * The formula, as the business states it and as the migrated book confirms:
 *
 *     balance   = capital handed over
 *               + interest accrued
 *               + fees, including VAT
 *               + the receipt fee on every payment already received
 *               - payments received
 *
 *     settlement = balance + the receipt fee on that balance
 *
 * The fourth line is the one that is easy to miss and impossible to leave out. Item 9 is charged
 * when each instalment arrives, not only at settlement — 10% of the instalment, capped at R610,
 * plus VAT. Checked against Swordfish's own closing figures across 735 migrated accounts:
 * without any receipt fee, **zero** accounts matched; with only the settlement fee, 232; with the
 * per-payment fee as well, 168 of 199 active accounts and 123 of 145 frozen ones agree to the
 * cent.
 *
 * The accounts that still disagree do so for two known reasons, both handled below and both
 * flagged rather than silently absorbed: in duplum, where accrual stops at the ceiling, and
 * write-off, where the account stopped and accrual stopped with it.
 */
import { receiptFeeInclVat, settlementReceiptFee, roundToCents, scheduleFor, type AnnexureBSchedule } from './annexureB.ts'
import { accrueToDate, accrualEnd, coveredTo as lastCoveredDay } from './interestAccrual.ts'

export interface LedgerLines {
  /** Every payment received, oldest first. Reversed payments are excluded by the caller. */
  payments: { date: string; amount: number; paidToClient?: boolean }[]
  /** Every fee raised. `inclVat` is what was actually charged. */
  fees: { date: string; description: string; exclVat: number; vat: number; billed: boolean }[]
  /** Every interest accrual period. */
  interest: { from: string; days: number; amount: number }[]
}

export interface BalanceInput {
  /** Capital as at handover. The account opens here and everything else is movement. */
  capitalHandedOver: number
  handoverDate: string | null
  ledgers: LedgerLines
  /**
   * In duplum: non-capital may not exceed the capital outstanding when the debt was handed over.
   * Where it binds, interest and fees stop — they do not accrue and then get written back.
   */
  inDuplum?: boolean
  /** An account written off stops accruing on this date. */
  writtenOffAt?: string | null
  vatRate?: number
  /**
   * Annual interest rate as a percentage (24 = 24% a year). With `accrueTo` below, the balance
   * grows every day instead of standing still between monthly postings.
   */
  interestRateAnnual?: number
  /**
   * Accrue interest up to and including this day — today, on a screen. Absent means show the
   * book exactly as posted, which is what a historical statement wants.
   */
  accrueTo?: string | null
}

export interface BalanceBreakdown {
  capital: number
  interest: number
  fees: number
  /** Item 9 charged as each instalment arrived. */
  receiptFees: number
  /**
   * VAT contained in the fees and receipt fees above, so a statement can say how much of what it
   * shows is tax. Capital and interest carry none: we did not sell the debtor anything and
   * interest is not a supply. It is a component OF the figures above, never added to them.
   */
  vat: number
  payments: number
  /** What is owed today, before any settlement quotation. */
  balance: number
  /** Item 9 on the balance: what settling in full today would add. */
  settlementFee: number
  /** What it would cost to settle in full today. */
  settlement: number
  /** Set where a rule stopped the balance growing, so the number can be explained. */
  cappedBy?: 'in duplum' | 'written off'
  /** How much interest and fees the cap withheld. Nonzero only when `cappedBy` is set. */
  withheld: number
  /**
   * Interest since the last posted accrual, computed to `accrueTo` and already included in
   * `interest` above. Kept separate so a statement can label the line as still running rather
   * than present it as charged.
   */
  interestAccruing: number
  /** Calendar days the accruing figure covers. Zero when nothing is accruing. */
  interestAccruingDays: number
  /** First day of the open period, for the statement line. */
  interestAccruingFrom: string | null
}

/**
 * The balance, with every component kept separate.
 *
 * Nothing is netted before it is returned: a statement has to show the receipt fees and the
 * payments as different things, and a caller that only wants the total can add them up.
 */
export function computeBalance(input: BalanceInput): BalanceBreakdown {
  const { capitalHandedOver: capital, ledgers, vatRate = 0.15 } = input
  const stopAt = input.writtenOffAt ?? null

  const within = (date: string) => !stopAt || date <= stopAt

  const interest = roundToCents(
    ledgers.interest.filter((i) => within(i.from)).reduce((t, i) => t + i.amount, 0),
  )
  const chargedFees = ledgers.fees.filter((f) => within(f.date))
  const fees = roundToCents(chargedFees.reduce((t, f) => t + f.exclVat + f.vat, 0))
  const feeVat = roundToCents(chargedFees.reduce((t, f) => t + f.vat, 0))
  const payments = roundToCents(ledgers.payments.reduce((t, p) => t + p.amount, 0))

  // Item 9 on each instalment, priced on the schedule in force the day it arrived — a payment
  // taken in 2024 carries the R509 maximum, not today's R610.
  const receiptFees = roundToCents(
    ledgers.payments.reduce(
      (t, p) => t + receiptFeeInclVat(p.amount, vatRate, scheduleFor(p.date)),
      0,
    ),
  )

  // Interest between the last posted accrual and today. Computed, never written: see
  // interestAccrual.ts for why a daily figure does not need a daily row.
  const open = openAccrual(input, roundToCents(capital + interest + fees + receiptFees - payments))

  const nonCapital = interest + open.amount + fees + receiptFees
  let cappedBy: BalanceBreakdown['cappedBy']
  let withheld = 0

  // In duplum caps non-capital at the capital outstanding when the debt was handed over. The
  // ceiling is fixed there and never recalculated as the balance falls (§5).
  let recoverableNonCapital = nonCapital
  if (input.inDuplum && nonCapital > capital) {
    recoverableNonCapital = capital
    withheld = roundToCents(nonCapital - capital)
    cappedBy = 'in duplum'
  } else if (stopAt) {
    cappedBy = 'written off'
    withheld = roundToCents(
      ledgers.interest.filter((i) => !within(i.from)).reduce((t, i) => t + i.amount, 0)
      + ledgers.fees.filter((f) => !within(f.date)).reduce((t, f) => t + f.exclVat + f.vat, 0),
    )
  }

  const balance = roundToCents(capital + recoverableNonCapital - payments)

  /*
   * The receipt fee on a settlement is a FEE, so in duplum binds it like every other fee.
   *
   * It used to be worked out on the capped balance and then added to it, which quietly put the
   * settlement figure above the ceiling the cap had just enforced — the rule applied to the
   * balance and then abandoned one line later. Once non-capital has reached the capital there is
   * no headroom left, so the fee for settling is nil: the debtor pays the ceiling and no more.
   * Where the cap is close but not yet reached, only the part of the fee that still fits is
   * charged.
   */
  const headroom = input.inDuplum ? Math.max(0, roundToCents(capital - recoverableNonCapital)) : Infinity
  const settlementFee = balance > 0 ? Math.min(settlementReceiptFee(balance, vatRate), headroom) : 0

  // The VAT already inside `fees` and `receiptFees`. A receipt fee is charged VAT-inclusive, so
  // its tax is the inclusive amount less the amount it grossed up from — not the amount times
  // the rate, which would overstate it by the rate squared.
  const receiptFeeVat = roundToCents(receiptFees - receiptFees / (1 + vatRate))

  return {
    capital,
    interest: roundToCents(interest + open.amount),
    fees,
    receiptFees,
    vat: roundToCents(feeVat + receiptFeeVat),
    payments,
    balance,
    settlementFee,
    settlement: roundToCents(balance + settlementFee),
    cappedBy,
    withheld,
    interestAccruing: open.amount,
    interestAccruingDays: open.days,
    interestAccruingFrom: open.from,
  }
}

/**
 * The open interest period, or nothing.
 *
 * Nothing is the answer more often than not: an account with no rate, an account already written
 * off (accrual stopped when it did), a caller reprinting a historical statement, or a book that
 * is already current. Each of those has to produce a real zero rather than an accidental one, so
 * they are all decided here in one place.
 */
function openAccrual(
  input: BalanceInput,
  balanceAtLastPosting: number,
): { amount: number; days: number; from: string | null } {
  const none = { amount: 0, days: 0, from: null }
  if (!input.accrueTo || input.writtenOffAt) return none
  const covered = lastCoveredDay(input.ledgers.interest)
  if (!covered) return none
  const open = accrueToDate({
    openingBalance: balanceAtLastPosting,
    annualRate: input.interestRateAnnual ?? 0,
    coveredTo: covered,
    asAt: input.accrueTo,
  })
  return open ? { amount: open.amount, days: open.days, from: open.from } : none
}

export type StatementKind =
  | 'handover'
  | 'interest'
  /** Interest since the last posting, computed to today and not yet charged. */
  | 'interest-accruing'
  | 'fee'
  | 'receipt-fee'
  | 'payment'

export interface StatementLine {
  date: string
  kind: StatementKind
  description: string
  /** Increases what is owed. */
  debit: number
  /** Reduces what is owed. */
  credit: number
  /** What is owed after this line. */
  balance: number
}

export interface Statement {
  lines: StatementLine[]
  breakdown: BalanceBreakdown
  /** Set where a rule stopped the balance growing partway down the statement. */
  note?: string
}

/**
 * Every movement on the account, in date order, with a running balance.
 *
 * This is the document a debtor is entitled to and a client asks for: the opening capital, then
 * every fee, every accrual and every payment as its own dated line, ending at what is owed. A
 * statement that showed only totals would be a claim; this is the working.
 *
 * A payment carries two lines, not one — the payment itself and the receipt fee it attracted —
 * because they are different transactions with different payers, and netting them would hide a
 * fee the debtor is entitled to see charged.
 */
export function buildStatement(input: BalanceInput, schedule?: AnnexureBSchedule): Statement {
  const { capitalHandedOver: capital, ledgers, vatRate = 0.15 } = input
  const breakdown = computeBalance(input)
  const stopAt = input.writtenOffAt ?? null

  type Pending = Omit<StatementLine, 'balance'>
  const pending: Pending[] = []

  if (input.handoverDate) {
    pending.push({
      date: input.handoverDate,
      kind: 'handover',
      description: 'Capital handed over',
      debit: capital,
      credit: 0,
    })
  }

  /*
   * Dated at the END of the period it covers, and labelled with that period.
   *
   * Interest is earned across a stretch of days and posted once at the close of it, which is
   * where Swordfish puts it: ACF10044's R36.88 for August sits on 31 August on the statement the
   * debtor was sent. Dating it at the start put the same money a month earlier and sorted it
   * above the fees it had actually accrued on, so a reissued statement did not match the
   * original — and the day count on its own said nothing about which days were meant.
   *
   * The count is Swordfish's exclusive offset, not a number of days: 1 September for 6 covers to
   * the 7th, seven days. Printing it as "6 days" was reading that field as if it meant what it
   * says. `accrualEnd` holds the convention.
   */
  for (const i of ledgers.interest) {
    if (stopAt && i.from > stopAt) continue
    if (i.amount === 0) continue
    const to = accrualEnd(i.from, i.days)
    pending.push({
      date: to,
      kind: 'interest',
      description: `Interest, ${periodLabel(i.from, to)}`,
      debit: i.amount,
      credit: 0,
    })
  }

  // The open period, dated today and marked as still running. It is the last debit on the
  // statement by construction: nothing can be dated after the day it is accrued to.
  if (breakdown.interestAccruing > 0 && input.accrueTo) {
    const from = breakdown.interestAccruingFrom
    pending.push({
      date: input.accrueTo,
      kind: 'interest-accruing',
      // Pull the statement on the 7th and this reads "1 to 7 September": the days since the last
      // posting are on the page, named, rather than left for the reader to work out from a count.
      description: from
        ? `Interest, ${periodLabel(from, input.accrueTo)} — still accruing`
        : 'Interest — still accruing',
      debit: breakdown.interestAccruing,
      credit: 0,
    })
  }

  for (const f of ledgers.fees) {
    if (stopAt && f.date > stopAt) continue
    // An action taken past the Annexure B ceiling is real history and no charge. It belongs in
    // the account's activity, not on a statement of what is owed.
    if (!f.billed || f.exclVat + f.vat === 0) continue
    pending.push({
      date: f.date,
      kind: 'fee',
      description: f.description,
      debit: roundToCents(f.exclVat + f.vat),
      credit: 0,
    })
  }

  for (const p of ledgers.payments) {
    pending.push({
      date: p.date,
      kind: 'payment',
      description: p.paidToClient ? 'Payment received by client' : 'Payment received',
      debit: 0,
      credit: p.amount,
    })
    const fee = receiptFeeInclVat(p.amount, vatRate, schedule ?? scheduleFor(p.date))
    if (fee > 0) {
      pending.push({
        date: p.date,
        kind: 'receipt-fee',
        description: 'Receipt fee on payment',
        debit: fee,
        credit: 0,
      })
    }
  }

  /*
   * Date order, and within a date a fixed order of kinds. Two lines on the same day have no
   * inherent sequence, and letting them fall out in whatever order the ledgers were read in
   * would make the running balance jitter between one rendering and the next — the same
   * statement, reissued, showing different intermediate figures.
   */
  const rank: Record<StatementKind, number> = {
    handover: 0, interest: 1, 'interest-accruing': 1, fee: 2, payment: 3, 'receipt-fee': 4,
  }
  pending.sort((a, b) => a.date.localeCompare(b.date) || rank[a.kind] - rank[b.kind])

  let running = 0
  const lines: StatementLine[] = pending.map((l) => {
    running = roundToCents(running + l.debit - l.credit)
    return { ...l, balance: running }
  })

  return {
    lines,
    breakdown,
    note: breakdown.cappedBy === 'in duplum'
      ? `Interest and fees stopped at the in duplum ceiling. ${money(breakdown.withheld)} accrued beyond it and is not recoverable`
        + `${breakdown.settlementFee === 0 ? ', and the receipt fee on a settlement falls away with it' : ''}.`
      : breakdown.cappedBy === 'written off'
        ? `The account was written off on ${stopAt}. ${money(breakdown.withheld)} of later interest and fees is excluded.`
        : undefined,
  }
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * The period an interest line covers, as "1 to 7 September", or "20 July to 2 August" where it
 * crosses a month, or just "7 September" for a single day.
 *
 * No year: the date column beside it carries one, and a period long enough to span a new year
 * still reads unambiguously against it.
 */
function periodLabel(from: string, to: string): string {
  const day = (iso: string) => Number(iso.slice(8, 10))
  const month = (iso: string) => MONTH_NAMES[Number(iso.slice(5, 7)) - 1]
  if (from >= to) return `${day(to)} ${month(to)}`
  if (from.slice(0, 7) === to.slice(0, 7)) return `${day(from)} to ${day(to)} ${month(to)}`
  return `${day(from)} ${month(from)} to ${day(to)} ${month(to)}`
}

const money = (n: number) => `R${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
