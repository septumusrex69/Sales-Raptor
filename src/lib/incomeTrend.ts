/**
 * WHAT THE FIRM EARNED, MONTH BY MONTH, AND HOW MUCH OF WHAT IT COLLECTED THAT WAS (S7).
 *
 * The firm, 13 Oct: "line graphs are good for profit made from interest, profit made from fees,
 * profit made from commission, and then obviously total profit ... the correlation between how much
 * have we collected and what is our profit". They put it at 40 to 50%, and staging, once collections
 * were dated by approval like the earnings, reads 39 to 49%.
 *
 * THE DATABASE SUMS (business_income_months calls business_income once a month); this file only
 * folds the eight parts into the four lines the firm named, and is pure so a check can hold that the
 * four lines and the total cannot disagree:
 *   - INTEREST is the debtors' interest plus the bank's interest on the trust account, which is the
 *     firm's to keep (the firm, 8 Oct: "The regulator said that we can take it");
 *   - FEES are the Annexure B fees and costs plus the charges raised to clients;
 *   - COMMISSION is without its VAT, because the VAT is collected for SARS and never the firm's;
 *   - EARNED is the whole ledger total less that VAT -- so unclaimed credit and "other entries" are in
 *     it, as they are on the Income page, and the three lines need not add up to it exactly. The gap is
 *     those two, never a rounding.
 * NOT PROFIT AFTER EXPENSES. It is what came in; the firm's own spending is on Expenses and is not
 * taken off here, and the screen says so rather than calling it profit.
 */

export interface IncomeMonth {
  month: string
  interest: number
  costs: number
  commission: number
  commissionVat: number
  creditTaken: number
  chargesRaised: number
  bankInterest: number
  other: number
  total: number
  collected: number
}

export interface TrendPoint {
  month: string
  /** Short axis label, "Jun '26". */
  name: string
  /** Tooltip label, "June 2026". */
  fullLabel: string
  interest: number
  fees: number
  commission: number
  earned: number
  collected: number
  /** Earned as a share of what was collected, in percent; null in a month with nothing collected. */
  ratio: number | null
}

const r2 = (v: number): number => Math.round(v * 100) / 100
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function toIncomeMonth(r: Record<string, unknown>): IncomeMonth {
  const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
  return {
    month: String(r.month).slice(0, 10),
    interest: n(r.interest), costs: n(r.costs), commission: n(r.commission), commissionVat: n(r.commission_vat),
    creditTaken: n(r.credit_taken), chargesRaised: n(r.charges_raised), bankInterest: n(r.bank_interest),
    other: n(r.other), total: n(r.total), collected: n(r.collected),
  }
}

export function trendPoint(m: IncomeMonth): TrendPoint {
  const y = Number(m.month.slice(0, 4))
  const mo = Number(m.month.slice(5, 7))
  const earned = r2(m.total - m.commissionVat)
  return {
    month: m.month,
    name: `${MONTHS[mo - 1].slice(0, 3)} '${String(y).slice(2)}`,
    fullLabel: `${MONTHS[mo - 1]} ${y}`,
    interest: r2(m.interest + m.bankInterest),
    fees: r2(m.costs + m.chargesRaised),
    commission: r2(m.commission),
    earned,
    collected: r2(m.collected),
    // A rate over nothing is undefined, and drawing it as 0% draws a collapse that never happened.
    ratio: m.collected > 0.004 ? Math.round((earned / m.collected) * 1000) / 10 : null,
  }
}

/**
 * The months to draw: every month asked for, less the empty ones BEFORE the first month anything
 * happened -- "since the start" asks from 2015, and ten years of flat zeroes would squash the real
 * line into the last inch of the chart. Empty months AFTER the first are kept: a month nothing was
 * earned in is a fact the line must show.
 */
export function trendSeries(months: IncomeMonth[]): TrendPoint[] {
  const first = months.findIndex((m) => Math.abs(m.total) > 0.004 || Math.abs(m.collected) > 0.004)
  if (first < 0) return []
  return months.slice(first).map(trendPoint)
}

/** Across the months drawn: what was earned in all, collected in all, and the share overall. */
export function trendTotals(points: TrendPoint[]): { earned: number; collected: number; ratio: number | null } {
  const earned = r2(points.reduce((t, p) => t + p.earned, 0))
  const collected = r2(points.reduce((t, p) => t + p.collected, 0))
  return { earned, collected, ratio: collected > 0.004 ? Math.round((earned / collected) * 1000) / 10 : null }
}
