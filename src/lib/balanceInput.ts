/**
 * TURNING AN ACCOUNT'S THREE LEDGERS INTO WHAT computeBalance READS.
 *
 * HELD APART SO TWO SCREENS CAN SHARE IT, which is the whole reason this file exists.
 *
 * THE FIRM, of the accounts list: "in here, I want to see what the current balance is. Capital,
 * fees, interest, paid, balance." The account page already computes exactly those, and the list had
 * none of them -- so the obvious thing was to work them out again somewhere cheaper. There is a SQL
 * side that looks ready to do it: `engine_balances` returns capital, interest and costs per account
 * in one query.
 *
 * IT RETURNS A DIFFERENT NUMBER. On RRC00005 it gives R817,01 where the account page gives R760,00,
 * because it applies the in duplum ceiling to the INTEREST only while computeBalance caps the
 * aggregate -- the R57,01 between them is the VAT on fees that are already at the ceiling. Either
 * reading may turn out to be the firm's, and that is a question they have not answered yet; what is
 * certain is that a list saying R817,01 beside an account page saying R760,00 is the failure
 * CLAUDE.md names in as many words. The same figures on two screens, one calculation.
 *
 * SO THE LIST DOES WHAT THE ACCOUNT PAGE DOES. It fetches the ledgers for the rows it is showing --
 * a page, never the book -- and runs the same function over them. No second arithmetic, nothing to
 * drift, and the in duplum cap that the account page applies is the one the list shows.
 *
 * THE COST IS BOUNDED BY THE PAGE AND IS WORTH NAMING. Three queries against the visible ids, so
 * fifty rows is three round trips rather than fifty; the volume is the ledger rows those accounts
 * carry, which on the inherited book runs to hundreds on the busiest. If that ever bites, the
 * honest lever is a smaller page, not a second calculation.
 *
 * PURE: no database, no clock. The caller supplies today, because the firm's day is not the
 * server's -- see firmToday.
 */

import type { BalanceInput } from './accountBalance.ts'
import { firmDay } from './dateLabels.ts'

/**
 * An account's ledger ROWS as accountBook hands them over.
 *
 * NOT `AccountLedgers`, which is already that file's name for the same rows plus the totals it
 * computes beside them. This is the subset the balance reads, and naming it apart is what lets both
 * live in one import list.
 */
export interface LedgerRows {
  payments: {
    id: string
    receivedAt: string
    amount: number
    paidToClient: boolean
    reversedAt: string | null
    receiptFeeLegacy: number | null
  }[]
  fees: {
    incurredAt: string
    description: string
    amountExclVat: number
    vatAmount: number
    billed: boolean
    segments?: number
    annexureItem?: string | null
    paymentId?: string | null
    cancelledAt?: string | null
    legacyName?: string | null
  }[]
  accruals: { accruedOn: string; days: number; amountAccrued: number }[]
}

/**
 * What an account is worth asking computeBalance about.
 *
 * `writtenOffAt` IS IMPRECISE AND SAYS SO. Swordfish records the closing date inside a comment
 * ("Closed on 2026/09/07 ..."), which Raptor does not have, so the last action stands in for it.
 * Carried here rather than decided per screen, or the list and the account would stop a written-off
 * account's clock on two different days.
 */
export function balanceInputFor(input: {
  account: {
    capitalHandedOver: number
    handoverDate: string | null
    interestRateAnnual: number
    status: string
    lastActionAt: string | null
  }
  ledgers: LedgerRows
  /** Today in Johannesburg. Passed in: this file has no clock. */
  today: string
  /** Whether this account's status reads as written off. The one function that decides it. */
  writtenOff: (status: string) => boolean
}): BalanceInput {
  const { account, ledgers } = input
  return {
    capitalHandedOver: account.capitalHandedOver,
    handoverDate: account.handoverDate,
    writtenOffAt: input.writtenOff(account.status) ? account.lastActionAt : null,
    /* Interest runs to today, not to the last monthly posting. Without this the balance stands
       still between postings and a collector quotes a settlement that is days out of date. */
    interestRateAnnual: account.interestRateAnnual,
    accrueTo: input.today,
    ledgers: {
      payments: ledgers.payments
        .filter((p) => !p.reversedAt)
        .map((p) => ({
          /* THE ID TRAVELS, so an item 9 fee row can be matched to the payment it was raised on
             and the same fee is not counted a second time. See splitFeeLedger. */
          id: p.id,
          /* THE FIRM'S DAY, not the first ten characters of a UTC string -- a payment dated
             29 September is stored as 22:00 on the 28th and read back a day early. */
          date: firmDay(p.receivedAt),
          amount: p.amount,
          paidToClient: p.paidToClient,
          receiptFeeExclVat: p.receiptFeeLegacy,
        })),
      fees: ledgers.fees.map((f) => ({
        date: firmDay(f.incurredAt),
        at: f.incurredAt,
        description: f.description,
        exclVat: f.amountExclVat,
        vat: f.vatAmount,
        billed: f.billed,
        segments: f.segments,
        /* Item 9 is the receipt fee and is counted as one, not as a cost. See splitFeeLedger. */
        annexureItem: f.annexureItem,
        paymentId: f.paymentId,
        /* WHETHER IT IS STILL OWED. A cancelled fee comes off the balance -- the firm, on a
           reversal: "I agree when you reverse a payment that the receipt fee is removed" -- and an
           imported promise to pay is the one exception. `feeStands` decides; these two are what it
           reads, and without them every cancelled fee reads as live. */
        cancelledAt: f.cancelledAt,
        legacyName: f.legacyName,
      })),
      /*
       * WHAT THE DEBT EARNED, NOT WHAT MAY BE TAKEN.
       *
       * `amount_accrued`, never `amount_recoverable`. computeBalance applies the in duplum ceiling
       * to the AGGREGATE of non-capital, so handing it interest that open_interest has already
       * clipped would cap the same account twice -- once on the way in and once on the way out --
       * and quietly understate what the debt actually earned. The two columns exist precisely so
       * the client can be given an honest account of what was written off.
       */
      interest: ledgers.accruals.map((i) => ({
        from: i.accruedOn, days: i.days, amount: i.amountAccrued,
      })),
    },
  }
}
