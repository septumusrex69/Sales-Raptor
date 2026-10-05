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
   * WHAT THE FIRM MADE: earned plus invoiced, less spent.
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
