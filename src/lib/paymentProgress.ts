/**
 * How far through a debt a paying debtor actually is.
 *
 * THE FIRM: "a progress report or a progress bar for a debtor that is paying" -- on the account,
 * on the section 129, on the reports and the transaction reports, and on the invoices.
 *
 * ONE ARITHMETIC, WRITTEN ONCE, because it is going on a letter a debtor receives, a report a
 * client is sent and an invoice. Three renderers computing "how much is paid off" separately is
 * three chances to tell one person a different number from another -- and the two who would
 * compare them are the client and the debtor.
 *
 * ---- TWO MEASURES, AND THEY ANSWER DIFFERENT QUESTIONS ----
 *
 * MONEY is "how much of what it would take to clear this account has come in". It is true of
 * every account, arrangement or no arrangement, and it is what a client asks about.
 *
 * IT INCLUDES THE RECEIPT FEE ON SETTLING, at the firm's instruction, and that is the whole of
 * what `settlementFee` is doing on this module. See `owed`.
 *
 * INSTALMENTS is "are they keeping to what they agreed". It exists only where there IS an
 * agreement, and it is the one that tells a collector whether to ring. A debtor 60% paid who has
 * missed the last three instalments is not the same account as one 60% paid and current, and the
 * money bar alone reports them identically.
 *
 * PURE, so it can be read back without a database, and so the same numbers reach a PDF that has
 * no browser in it.
 */

import type { Arrangement } from './arrangements.ts'

/** What has come in against what it takes to clear the account. */
export interface MoneyProgress {
  /** Payments received, net of reversals -- see computeBalance. */
  recovered: number
  /**
   * WHAT IT TAKES TO CLOSE THE ACCOUNT TODAY: the balance plus the receipt fee on settling it.
   *
   * THE FIRM, POINTING AT THE BAR: "that doesn't include the receipt fee. So the receipt fee
   * should be added and also included always in that bar if the person settles the full amount...
   * if the person was about to close this account, in this scenario it would be 1350.28."
   *
   * The bar said R 1 211,01 still owed on an account that could not be closed for less than
   * R 1 350,28. A debtor reading it, or a collector quoting it down the telephone, is out by the
   * item 9 fee -- and that fee is not optional: it is charged the moment the settlement is
   * received.
   */
  owed: number
  /** The part of `owed` that is the fee for settling, so a caption can explain the difference. */
  settlementFee: number
  /** What is owed before that fee -- the plain balance, for callers that report both. */
  balance: number
  /**
   * Everything it would take to have cleared this account: capital, interest, fees, the receipt
   * fees already charged, and the one on settling.
   */
  charged: number
  /** recovered / charged, 0..1. Zero where nothing has been charged, never NaN. */
  fraction: number
}

/** How an arrangement is being kept. Null where there is no arrangement to keep. */
export interface InstalmentProgress {
  /** How many instalments the arrangement is for. */
  planned: number
  kept: number
  /** Due and not paid. Never negative -- see below. */
  missed: number
  /** Still to fall due. */
  toCome: number
  amount: number
  arrangement: Arrangement
}

export interface PaymentProgress {
  money: MoneyProgress
  instalments: InstalmentProgress | null
}

/**
 * The money half.
 *
 * `charged` IS RECOVERED PLUS OWED, not the capital handed over, and the difference matters on
 * every account that has run for a while. An account handed over at R12 480 that has accrued
 * R3 000 of interest and R600 of fees has been charged R16 080; measured against the capital, a
 * debtor who has paid R12 480 would read as 100% settled while still owing R3 600.
 *
 * WHICH ALSO MAKES IT MONOTONIC IN THE RIGHT DIRECTION. A payment raises `recovered` and lowers
 * `owed` by the same amount, so the fraction rises. Interest accruing raises `owed` alone, so the
 * fraction falls -- which is true, and is the thing a debtor paying the minimum needs to see.
 *
 * NEVER ABOVE ONE AND NEVER BELOW NOUGHT. An overpayment awaiting refund would otherwise draw a
 * bar past its own end, and a credit balance would draw a negative one.
 */
export function moneyProgress(input: {
  payments: number
  balance: number
  /**
   * THE ITEM 9 FEE ON SETTLING, AND IT IS NOT OPTIONAL ON THIS CALL.
   *
   * The firm: "all across the board, wherever this bar is visible, it should be calculated like
   * that." A parameter with a default of nought would let a fourth bar be written next year that
   * quietly reports the old, short figure and looks exactly like the other three. Required, the
   * compiler asks the question at every call site.
   *
   * `computeBalance` works it out and caps it under in duplum, where it can be nil -- so nought
   * here is a real answer on an account at its ceiling, not a caller who forgot.
   */
  settlementFee: number
}): MoneyProgress {
  const recovered = Math.max(0, input.payments)
  const balance = Math.max(0, input.balance)
  /*
   * ONLY WHERE THERE IS A BALANCE TO SETTLE. A settled account is owed nothing and costs nothing
   * to close; adding a fee to nought would draw a bar short of its end on an account that is
   * finished, and tell a debtor who has paid in full that they have not.
   */
  const settlementFee = balance > 0 ? Math.max(0, input.settlementFee) : 0
  const owed = balance + settlementFee
  const charged = recovered + owed
  return {
    recovered,
    owed,
    settlementFee,
    balance,
    charged,
    /* Nothing charged is not "fully paid": an account with no capital on it has no progress to
       report, and 0/0 drawn as 100% would be a full green bar on an empty ledger. */
    fraction: charged <= 0 ? 0 : Math.min(1, recovered / charged),
  }
}

/**
 * The instalment half, off the arrangement the account is on.
 *
 * HOW MANY INSTALMENTS is derived rather than stored: the promise carries what was agreed in
 * total and what each instalment is, and the count is the one that follows. Rounded UP, because
 * an arrangement of R1 000 total at R300 a month is four payments and not three and a third --
 * and a debtor who has made three has not finished.
 *
 * MISSED IS WHAT WAS DUE AND IS NOT PAID, computed from the dates rather than from a flag, and
 * clamped at nought. An arrangement where somebody paid early has more kept than were due, which
 * is a good thing and must not read as a negative number of missed instalments.
 */
export function instalmentProgress(input: {
  amount: number
  totalPromised: number | null
  instalmentsKept: number
  arrangement: Arrangement
  /** How many have fallen due so far. The caller works this out from the schedule. */
  due: number
}): InstalmentProgress | null {
  if (!(input.amount > 0)) return null
  const total = input.totalPromised ?? 0
  /* A once-off is one instalment whatever the totals say -- there is no schedule to divide. */
  const planned = input.arrangement === 'once_off'
    ? 1
    : Math.max(1, Math.ceil((total > 0 ? total : input.amount) / input.amount))
  const kept = Math.max(0, Math.min(planned, input.instalmentsKept))
  const due = Math.max(0, Math.min(planned, input.due))
  return {
    planned,
    kept,
    missed: Math.max(0, due - kept),
    toCome: Math.max(0, planned - Math.max(kept, due)),
    amount: input.amount,
    arrangement: input.arrangement,
  }
}

/**
 * What the bar says beside itself.
 *
 * A PERCENTAGE AND THE TWO FIGURES IT CAME FROM. A bar with only a percentage on it is one
 * nobody can check, and this one goes to a debtor on a section 129 and to a client on a report --
 * both of whom are entitled to add it up themselves.
 *
 * ROUNDED, AND NEVER ROUNDED TO 100 SHORT OF IT. R12 479 of R12 480 is 99.99%, and a notice
 * telling somebody they have paid 100% while demanding a rand is the kind of thing that gets read
 * out in court.
 */
export function progressPercent(m: MoneyProgress): number {
  const raw = m.fraction * 100
  if (raw >= 100) return 100
  if (raw > 99) return 99
  if (raw > 0 && raw < 1) return 1
  return Math.round(raw)
}

/**
 * Whether it is worth drawing at all.
 *
 * NOTHING PAID IS NOT PROGRESS. An empty bar on every account in the book is a thing people stop
 * seeing, and on a section 129 it would be a graphic whose message is "you have paid nothing" --
 * which the notice already says in words, twice, and better.
 */
export function hasProgress(p: PaymentProgress): boolean {
  return p.money.recovered > 0 || (p.instalments?.kept ?? 0) > 0
}
