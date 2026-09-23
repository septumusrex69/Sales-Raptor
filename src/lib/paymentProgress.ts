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
 * MONEY is "how much of what this account has been charged has come in". It is true of every
 * account, arrangement or no arrangement, and it is what a client asks about.
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

/** What has come in against what has been charged. */
export interface MoneyProgress {
  /** Payments received, net of reversals -- see computeBalance. */
  recovered: number
  /** What is still owed today. */
  owed: number
  /** Everything this account has ever been charged: capital, interest, fees and receipt fees. */
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
export function moneyProgress(input: { payments: number; balance: number }): MoneyProgress {
  const recovered = Math.max(0, input.payments)
  const owed = Math.max(0, input.balance)
  const charged = recovered + owed
  return {
    recovered,
    owed,
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
