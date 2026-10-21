/**
 * WHAT THE FIRM EARNED, CLIENT BY CLIENT, IN PARTS THAT SUM TO THE WHOLE.
 *
 * THE DATABASE DECIDES THE SPLIT (business_income) and this file only names the parts and adds them
 * up -- pure, so a check can hold that the parts and the total cannot disagree on the screen.
 *
 * WHY THE SPLIT IS EXACT: the trust ledger's entry for a receipt IS interest + costs + commission +
 * commission VAT off its own allocation (trust_creditors_on_allocation builds it from those four),
 * so splitting it back by its allocation is arithmetic, not an estimate. Whatever is not a receipt's
 * earnings -- unclaimed credit taken, anything unrecognised -- is its own line, never folded into one
 * of the four. CHARGES count when RAISED, so a charge later set off against a payover is not counted
 * a second time when the ledger records it being recovered.
 *
 * NOT THE SPLIT OF THE BALANCE HELD (HANDOFF section 4, item 4). That is a different question --
 * what the money sitting in trust IS -- and it cannot sum, because a drawing is not by component.
 */

export interface IncomeRow {
  companyId: string | null
  companyName: string | null
  interest: number
  costs: number
  commission: number
  commissionVat: number
  creditTaken: number
  chargesRaised: number
  /** The bank's interest on the trust account: the firm's interest income (the regulator allows it). */
  bankInterest: number
  other: number
  total: number
}

export type IncomePart = Exclude<keyof IncomeRow, 'companyId' | 'companyName' | 'total'>

/** The parts, in the order the firm reads an income statement, in the firm's words. */
export const INCOME_PARTS: { key: IncomePart; label: string; note?: string }[] = [
  { key: 'commission', label: 'Commission' },
  { key: 'commissionVat', label: 'VAT on commission', note: 'Collected for SARS, not kept' },
  { key: 'costs', label: 'Annexure B fees and costs', note: 'Including VAT' },
  { key: 'interest', label: 'Interest' },
  { key: 'chargesRaised', label: 'Charges to clients', note: 'Withdrawals and listings, including VAT' },
  { key: 'bankInterest', label: 'Bank interest on the trust account', note: 'Paid by the bank; the firm\'s to keep' },
  { key: 'creditTaken', label: 'Unclaimed credit taken', note: 'Less any given back' },
  { key: 'other', label: 'Other entries', note: 'On the trust ledger but not one of the above' },
]

export function toIncomeRow(r: Record<string, unknown>): IncomeRow {
  const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
  return {
    companyId: (r.company_id as string | null) ?? null,
    companyName: (r.company_name as string | null) ?? null,
    interest: n(r.interest), costs: n(r.costs), commission: n(r.commission),
    commissionVat: n(r.commission_vat), creditTaken: n(r.credit_taken),
    chargesRaised: n(r.charges_raised), bankInterest: n(r.bank_interest), other: n(r.other), total: n(r.total),
  }
}

/** Every client's parts added up, and the total -- which is the sum of the parts, by construction. */
export function incomeTotals(rows: IncomeRow[]): Record<IncomePart | 'total', number> {
  const out = { interest: 0, costs: 0, commission: 0, commissionVat: 0, creditTaken: 0, chargesRaised: 0, bankInterest: 0, other: 0, total: 0 }
  for (const r of rows) {
    for (const p of INCOME_PARTS) out[p.key] += r[p.key]
    out.total += r.total
  }
  return out
}
