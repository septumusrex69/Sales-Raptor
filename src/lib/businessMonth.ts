/**
 * THE FIRM'S OWN MONTH — the shapes and the words, with nothing that talks to the database.
 *
 * Split from businessApi.ts the way accountEnding.ts is split from its calls, so a check can run
 * the arithmetic rather than match strings in a component.
 */

export const EXPENSE_CATEGORIES = [
  'Premises',
  'Payroll',
  'Technology',
  'Communications',
  'Bureau and gateway',
  'Bank charges',
  'Professional fees',
  'Other',
] as const

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number]

export interface BusinessExpense {
  id: string
  incurredOn: string
  category: ExpenseCategory
  supplier: string | null
  description: string
  amount: number
  vat: number
  paidAt: string | null
  cancelledAt: string | null
  cancelledReason: string | null
}

export interface BusinessMonth {
  /** Commission, interest and fees that fell due in the period. */
  earned: number
  /** Moved out of trust into the business account in the period. */
  drawn: number
  /** Earned and still sitting in trust, whenever it was earned. */
  stillInTrust: number
  invoiced: number
  invoicesPaid: number
  owedByClients: number
  expenses: number
  expensesVat: number
  /**
   * WHAT THE FIRM MADE: earned plus invoiced, less spent, less the trust account's bank charges
   * (10 Oct: a cost, owed by the firm to the trust -- left out of both earned and spent before).
   *
   * NOT DRAWN LESS SPENT. Money earned and still sitting in trust has been earned; a month read on
   * drawings would say the firm made nothing in any month it chose not to transfer, which is a
   * statement about a bank transfer rather than about the business.
   */
  made: number
}

/** The period the business side is read over. Calendar months, unlike the payover's 11th-to-10th. */
export function monthBounds(year: number, month: number): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, '0')
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` }
}

/**
 * THE CALENDAR MONTH, NOT THE PAYOVER CYCLE, AND THE DIFFERENCE IS DELIBERATE.
 *
 * The payover cycle runs the 11th to the 10th because that is when the firm pays its clients. The
 * firm's own books run on calendar months because that is what every other thing asking — VAT, the
 * accountant, the year end — runs on. Reading the business side on a collection cycle would put
 * eleven days of one month's rent into the previous month's result.
 */
export function thisMonth(today: Date): { year: number; month: number } {
  return { year: today.getFullYear(), month: today.getMonth() + 1 }
}

export function monthLabel(year: number, month: number): string {
  /* en-ZA renders September as "Sept", which is the firm's own abbreviation, so it is left alone. */
  return new Date(Date.UTC(year, month - 1, 1))
    .toLocaleDateString('en-ZA', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** VAT is split out because the firm reclaims it; the cash that left is the inclusive figure. */
export function expenseTotal(e: Pick<BusinessExpense, 'amount' | 'vat'>): number {
  return Math.round((e.amount + e.vat + Number.EPSILON) * 100) / 100
}

/**
 * AN EXPENSE AS IT IS TYPED: THE AMOUNT ON THE SLIP, VAT INCLUDED (the firm, 10 Oct: "the VAT
 * should automatically charge fifteen percent ... if you want to remove it, you should be able to
 * remove it ... for ninety-five [percent] of people, we use this VAT included"). What left the
 * account is the figure somebody has in front of them; the VAT is worked out of it at the firm's
 * rate, rounded to the cent, and the part before VAT is the rest -- so the two always add back to
 * what was typed. A supplier not registered for VAT charges none: the whole amount is the expense.
 */
export function splitExpense(total: number, vatRate: number, includesVat: boolean): { amount: number; vat: number } {
  const t = Math.round((total + Number.EPSILON) * 100) / 100
  if (!includesVat || !(vatRate > 0)) return { amount: t, vat: 0 }
  const vat = Math.round((t * vatRate / (1 + vatRate) + Number.EPSILON) * 100) / 100
  return { amount: Math.round((t - vat) * 100) / 100, vat }
}

/**
 * THE TRUST ACCOUNT'S OWN INTEREST AND CHARGES (trust_bank_costs), and what they leave to do.
 *
 * The firm, 10 Oct: "the trust is not a place of expenses. There's interest, yes, but the interest
 * is due to the company ... you can't pay expenses out of the trust." Interest the bank pays on
 * the trust account is the firm's income; a bank charge taken from it is the firm's cost, owed by
 * Bredell Ferreira to the trust. It is covered by the firm's own share still in trust; only when
 * that share is below nothing (`firmHeld` < 0) is the trust actually short, and then the business
 * account has to pay it back -- the one state somebody has to act on.
 */
export interface TrustBankCosts {
  interest: number
  charges: number
  /** Paid back into the trust from the business account. */
  repaid: number
  interestToDate: number
  chargesToDate: number
  repaidToDate: number
  /** The firm's balance on the trust ledger now. Negative = the firm owes the trust. */
  firmHeld: number
}

export function trustBankCostsState(c: TrustBankCosts): { tone: 'clear' | 'bad'; line: string; owed: number } {
  const owed = Math.round(Math.max(0, -c.firmHeld) * 100) / 100
  if (owed > 0) {
    return {
      tone: 'bad',
      owed,
      line: 'The charges are more than Bredell Ferreira holds in trust, so client money is covering them. '
        + 'Pay this back from the business account and allocate it on Trust → Exceptions as “from the business account”.',
    }
  }
  return {
    tone: 'clear',
    owed: 0,
    line: c.chargesToDate > 0
      ? 'Covered by Bredell Ferreira’s own share in trust — no client money pays for them.'
      : 'No bank charges have come off the trust account.',
  }
}
