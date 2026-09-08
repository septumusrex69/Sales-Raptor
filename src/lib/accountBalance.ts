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
import { receiptFee, settlementReceiptFee, roundToCents, scheduleFor, type AnnexureBSchedule } from './annexureB'

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
}

export interface BalanceBreakdown {
  capital: number
  interest: number
  fees: number
  /** Item 9 charged as each instalment arrived. */
  receiptFees: number
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
  const fees = roundToCents(
    ledgers.fees.filter((f) => within(f.date)).reduce((t, f) => t + f.exclVat + f.vat, 0),
  )
  const payments = roundToCents(ledgers.payments.reduce((t, p) => t + p.amount, 0))

  // Item 9 on each instalment, priced on the schedule in force the day it arrived — a payment
  // taken in 2024 carries the R509 maximum, not today's R610.
  const receiptFees = roundToCents(
    ledgers.payments.reduce(
      (t, p) => t + roundToCents(receiptFee(p.amount, scheduleFor(p.date)) * (1 + vatRate)),
      0,
    ),
  )

  const nonCapital = interest + fees + receiptFees
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
  const settlementFee = balance > 0 ? settlementReceiptFee(balance, vatRate) : 0

  return {
    capital,
    interest,
    fees,
    receiptFees,
    payments,
    balance,
    settlementFee,
    settlement: roundToCents(balance + settlementFee),
    cappedBy,
    withheld,
  }
}

export type StatementKind = 'handover' | 'interest' | 'fee' | 'receipt-fee' | 'payment'

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

  for (const i of ledgers.interest) {
    if (stopAt && i.from > stopAt) continue
    if (i.amount === 0) continue
    pending.push({
      date: i.from,
      kind: 'interest',
      description: i.days > 1 ? `Interest, ${i.days} days` : 'Interest',
      debit: i.amount,
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
    const fee = roundToCents(receiptFee(p.amount, schedule ?? scheduleFor(p.date)) * (1 + vatRate))
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
    handover: 0, interest: 1, fee: 2, payment: 3, 'receipt-fee': 4,
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
      ? `Interest and fees stopped at the in duplum ceiling. ${money(breakdown.withheld)} accrued beyond it and is not recoverable.`
      : breakdown.cappedBy === 'written off'
        ? `The account was written off on ${stopAt}. ${money(breakdown.withheld)} of later interest and fees is excluded.`
        : undefined,
  }
}

const money = (n: number) => `R${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
