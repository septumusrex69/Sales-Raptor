/**
 * THE FIRM'S SHARE OF THE TRUST, BY WHAT IT IS.
 *
 * THE FIRM'S DESIGN: "BF funds held: Commission + Fees + VAT = total", under the ownership table.
 * On 8 October: "the commission fees and the VAT split on the trust balance is a good idea ... We
 * can do that."
 *
 * WHAT IT EARNED, LESS WHAT LEFT. A receipt's firm entry is its allocation's interest + costs +
 * commission + VAT, so those four parts are exact. A DRAWING is not: it takes from the firm's
 * share as a whole, and the ledger does not say which part it took. So it is its own line, "Less:
 * drawn to the business account", rather than being shared out across the parts by a rule nobody
 * chose -- and the lines add up to the firm's share by construction (firm_held_parts).
 *
 * PURE, so check-firm-held can hold the sum without a database.
 */

export interface FirmHeld {
  commission: number
  commissionVat: number
  costs: number
  interest: number
  chargesRecovered: number
  creditTaken: number
  bankInterest: number
  other: number
  /** Negative: the bank's charges on the trust account, which the business owes back. */
  bankCharges: number
  /** Positive: money the business account paid into the trust. */
  paidIn: number
  /** Negative: drawings to the business account. */
  drawn: number
  held: number
}

export type FirmHeldPart = Exclude<keyof FirmHeld, 'held'>

/**
 * The lines, in the order of the firm's design: the three it named first, then whatever else the
 * firm's share is made of. `always` lines are drawn even at nil -- the three the firm asked for --
 * and the rest only when there is something in them.
 */
export const FIRM_HELD_LINES: { key: FirmHeldPart; label: string; note: string; always?: boolean }[] = [
  { key: 'commission', label: 'Commission', note: 'Earned on receipts', always: true },
  { key: 'costs', label: 'Fees and costs', note: 'Annexure B, including VAT', always: true },
  { key: 'commissionVat', label: 'VAT on commission', note: 'Collected for SARS', always: true },
  { key: 'interest', label: 'Interest', note: 'Recovered from debtors' },
  { key: 'chargesRecovered', label: 'Charges recovered', note: 'Set off against client payovers' },
  { key: 'creditTaken', label: 'Unclaimed credit taken', note: 'Less any given back' },
  { key: 'bankInterest', label: 'Bank interest', note: 'Paid on the trust account' },
  { key: 'other', label: 'Other entries', note: 'On the trust ledger but not one of the above' },
  { key: 'bankCharges', label: 'Less: bank charges', note: 'The business’s cost, owed back to the trust' },
  { key: 'paidIn', label: 'Paid in by the business', note: 'From the business account' },
  { key: 'drawn', label: 'Less: drawn to the business account', note: 'Taken from the share as a whole, not from one part' },
]

export function toFirmHeld(r: Record<string, unknown>): FirmHeld {
  const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
  return {
    commission: n(r.commission), commissionVat: n(r.commission_vat), costs: n(r.costs),
    interest: n(r.interest), chargesRecovered: n(r.charges_recovered), creditTaken: n(r.credit_taken),
    bankInterest: n(r.bank_interest), other: n(r.other), bankCharges: n(r.bank_charges),
    paidIn: n(r.paid_in), drawn: n(r.drawn), held: n(r.held),
  }
}

/** The lines worth drawing: the firm's three always, the rest when not nil. */
export function firmHeldLines(h: FirmHeld) {
  return FIRM_HELD_LINES.filter((l) => l.always || Math.abs(h[l.key]) >= 0.005)
    .map((l) => ({ ...l, amount: h[l.key] }))
}

/** Every part added up, in cents so 0.1 + 0.2 cannot drift a cent off the total. */
export function firmHeldSum(h: FirmHeld): number {
  return FIRM_HELD_LINES.reduce((s, l) => s + Math.round(h[l.key] * 100), 0) / 100
}
