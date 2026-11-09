/**
 * OUR SHARE OF COLLECTIONS (S21 · Raptor H19).
 *
 * Stephan, 9 Nov: "if we collect 2 million, or 3 million, how much of that is [our] share? How much of that is the client
 * share? It's like the profitability margin ratio." Agreed the same day: called "Our share of collections", on Business
 * -> Income, behind business.income -- the tick no role is born with (CLAUDE.md: commission and Annexure B income are
 * "not even for an administrator").
 *
 * OURS is what the firm earned ON RECEIPTS: commission, Annexure B fees and costs, interest -- the parts of a debtor's
 * payment the firm keeps. VAT ON COMMISSION is SARS's -- neither ours nor the client's -- and is shown as itself. The
 * CLIENTS' share is the rest: collected less ours less that VAT, which is what the clients are paid. Charges to clients,
 * bank interest and unclaimed credit are the firm's income but not a share of anything a debtor paid, so they stay out
 * of the ratio (they are on the Income figures above it). Both sides are dated by approval, as business_income_months
 * dates them, so a month's collections and the earnings on them are the same month.
 *
 * PURE, so a check can hold it.
 */

export interface ShareFigures {
  collected: number
  ours: number
  /** VAT on commission: collected for SARS. */
  vat: number
  clients: number
  /** ours / collected, 0..1; null when nothing was collected (a ratio of nothing is not 0%). */
  ratio: number | null
}

const r2 = (v: number): number => Math.round(v * 100) / 100

export function shareOf(collected: number, ours: number, vat = 0): ShareFigures {
  const c = r2(collected)
  const o = r2(ours)
  const v = r2(vat)
  return { collected: c, ours: o, vat: v, clients: r2(c - o - v), ratio: c > 0 ? o / c : null }
}

/** Our share out of a month of the Income figures: commission + fees and costs + interest; the VAT apart. */
export function oursFromIncome(m: { interest: number; costs: number; commission: number; commissionVat: number }): { ours: number; vat: number } {
  return { ours: r2(m.interest + m.costs + m.commission), vat: r2(m.commissionVat) }
}

/** "38.4%", or a dash when nothing was collected. */
export function percent(ratio: number | null): string {
  return ratio === null ? '—' : `${(Math.round(ratio * 1000) / 10).toFixed(1)}%`
}

/** Several rows added up: the totals, and the ratio of the totals -- never an average of the rows' ratios. */
export function totalShare(rows: { collected: number; ours: number; vat?: number }[]): ShareFigures {
  return shareOf(rows.reduce((t, r) => t + r.collected, 0), rows.reduce((t, r) => t + r.ours, 0), rows.reduce((t, r) => t + (r.vat ?? 0), 0))
}
