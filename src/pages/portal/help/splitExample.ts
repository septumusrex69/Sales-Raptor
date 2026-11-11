/**
 * THE 50/50 SPLIT, AS AN EXAMPLE A CLIENT CAN PLAY WITH (Ryno, 11 Nov · Raptor · Handover 19).
 *
 * Ryno, asking for the portal's help section: "we will have a fun and professional video explaining the 50/50
 * allocation split to our clients and how payments are allocated." The explainer and the "try it yourself" panel
 * both draw from this one function, so the story the animation tells and the figures under it cannot disagree.
 *
 * IT IS AN ILLUSTRATION, NOT THE ENGINE, and it says so on the screen. The real split is `finance_split` in the
 * database, and what a client was actually paid is on the remittance advice -- that is the record. This file
 * exists to TEACH the shape the firm drew (allocationRules.ts, top of file):
 *
 *   "first we will handle the fees section and then we will handle the capital section. It's 50-50 unless the
 *    fees are less than 50% of the payment, then the rest is allocated to the capital."
 *
 *   the fees half, in strict order:  interest -> the receipt fee (item 9, 10% plus VAT) -> the Annexure B fees
 *   the capital half:                half the payment, plus whatever the fees half could not spend
 *   commission:                      on capital ONLY, plus VAT; the client is paid the capital less both
 *
 * AN EXAMPLE THAT BREAKS THE FIRM'S OWN RULES IS WORSE THAN NO EXAMPLE -- it teaches a client to expect a figure
 * their advice will never show. So `check-portal-help` runs every example through `checkAllocation`, the very
 * rules the payment run is held to, and an illustration that drifts from them fails the build.
 *
 * Deliberately left out, because a help page is the wrong place to teach them: the receipt fee's monthly cap, the
 * in duplum ceiling, and credits on an overpayment beyond what the account owed (`excess` below catches the last
 * so the arithmetic still closes, and the guide mentions all three in words).
 *
 * PURE: no clock, no database, no imports from the money files (which a marketing change may not touch --
 * CODEOWNERS). It rounds the way the engine does, to the cent, half up.
 */

export interface SplitInput {
  /** What the debtor paid. */
  payment: number
  /** Interest outstanding on the account before this payment. */
  interestOwing: number
  /** Annexure B fees outstanding before this payment (letters, SMSs, calls...), VAT included. */
  feesOwing: number
  /** Capital still outstanding before this payment. */
  capitalOwing: number
  /** The client's commission rate on capital, as a fraction (0.15 is 15%). */
  commissionRate: number
  vatRate?: number
  receiptFeeRate?: number
}

export interface SplitResult {
  payment: number
  /** The two halves, before anything rolls. */
  half: number
  otherHalf: number
  receiptFee: number
  toInterest: number
  toReceiptFee: number
  toFees: number
  /** What the fees half actually spent. */
  feesSide: number
  /** What the fees half could not spend, and so rolled across to capital. */
  rolled: number
  toCapital: number
  commission: number
  commissionVat: number
  /** Paid over to the client. */
  toClient: number
  /** The firm's: interest, the receipt fee, the Annexure B fees and the commission. VAT is SARS's, not ours. */
  toFirm: number
  /** More than the account owed -- held as a credit. Nought in every example the page shows. */
  excess: number
  /** What is still outstanding afterwards, line by line. */
  interestLeft: number
  receiptFeeLeft: number
  feesLeft: number
  capitalLeft: number
}

/* To the cent, half up, the way Postgres rounds an exact numeric (allocationRules.cents says why toFixed first). */
export function cents(x: number): number {
  const c = Number((Math.abs(x) * 100).toFixed(6))
  return Math.sign(x) * Math.round(c) / 100
}

export function splitPayment(input: SplitInput): SplitResult {
  const vat = input.vatRate ?? 0.15
  const rate = input.receiptFeeRate ?? 0.10
  const payment = cents(Math.max(0, input.payment))
  const interestOwing = cents(Math.max(0, input.interestOwing))
  const feesOwing = cents(Math.max(0, input.feesOwing))
  const capitalOwing = cents(Math.max(0, input.capitalOwing))

  /* The odd cent goes to the capital half, as the engine gives it to half B, so the two always add back. */
  const half = cents(payment / 2)
  const otherHalf = cents(payment - half)
  /* The receipt fee is RAISED BY this payment, on the whole of it, and joins the fees owed before it is paid. */
  const excl = cents(payment * rate)
  const receiptFee = cents(excl + excl * vat)

  let budget = half
  const take = (owing: number) => { const t = cents(Math.min(owing, budget)); budget = cents(budget - t); return t }
  const toInterest = take(interestOwing)
  const toReceiptFee = take(receiptFee)
  const toFees = take(feesOwing)
  const feesSide = cents(toInterest + toReceiptFee + toFees)
  const rolled = cents(half - feesSide)

  const toCapital = cents(Math.min(payment - feesSide, capitalOwing))
  const excess = cents(payment - feesSide - toCapital)
  const commission = cents(toCapital * input.commissionRate)
  const commissionVat = cents(commission * vat)
  const toClient = cents(toCapital - commission - commissionVat)

  return {
    payment, half, otherHalf, receiptFee,
    toInterest, toReceiptFee, toFees, feesSide, rolled,
    toCapital, commission, commissionVat, toClient,
    toFirm: cents(feesSide + commission),
    excess,
    interestLeft: cents(interestOwing - toInterest),
    receiptFeeLeft: cents(receiptFee - toReceiptFee),
    feesLeft: cents(feesOwing - toFees),
    capitalLeft: cents(capitalOwing - toCapital),
  }
}

/**
 * THE EXAMPLES THE EXPLAINER TELLS, chosen so that between them they show the three things a client asks about:
 * the fees half running out of things to pay (the roll), the fees half using all of its half (no roll), and an
 * account whose fees are already paid. Round numbers, because a client is reading them, not reconciling them.
 */
export const SPLIT_EXAMPLES: { id: string; title: string; caption: string; input: SplitInput }[] = [
  {
    id: 'roll',
    title: 'The fees are small: the rest rolls to capital',
    caption: 'Interest and fees take less than their half, so what is left over goes to your capital.',
    input: { payment: 1000, interestOwing: 80, feesOwing: 150, capitalOwing: 10000, commissionRate: 0.15 },
  },
  {
    id: 'full',
    title: 'The fees are large: each side takes its half',
    caption: 'Interest and fees could take more, but never more than half. The other half is always yours to recover.',
    input: { payment: 1000, interestOwing: 240, feesOwing: 600, capitalOwing: 10000, commissionRate: 0.15 },
  },
  {
    id: 'clear',
    title: 'The fees are already paid',
    caption: 'Only this payment’s own receipt fee is taken. Everything else goes to capital.',
    input: { payment: 1000, interestOwing: 0, feesOwing: 0, capitalOwing: 10000, commissionRate: 0.15 },
  },
]
