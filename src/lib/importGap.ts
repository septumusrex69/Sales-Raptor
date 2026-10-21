/**
 * RAPTOR'S BALANCE AGAINST SWORDFISH'S, AND WHAT IS BETWEEN THEM.
 *
 * THE FIRM, AFTER THE FIRST TEST IMPORT: "Balances disagree with Swordfish, mainly on fees...
 * Swordfish's 'Fees & Expenses' figure is roughly double Raptor's rebuilt fee ledger (BPM0113:
 * Swordfish R1 354.70, Raptor ledger R777.40). It looks like Swordfish includes its future
 * collection commission (FCC, 10% of the balance) in fees, but confirm that... Explain each gap on
 * the account, or fix the rebuild. A balance the firm cannot explain must not reach a client
 * statement or payover."
 *
 * ---------------------------------------------------------------------------------------------
 * CONFIRMED, AND IT IS NOT DOUBLE. IT IS THE RECEIPT FEE FOLDED IN.
 * ---------------------------------------------------------------------------------------------
 *
 * Measured on the five accounts the firm named. Swordfish's "Fees & Expenses" less Raptor's fee
 * ledger, against how many payments the account has:
 *
 *     BPM0113     0 payments     R1 354.70 - R777.40   = R577.30
 *     BPM20038    0 payments     R1 644.50 - R1 067.20 = R577.30
 *     BPM0109     6 payments     R2 616.25 - R1 361.63 = R1 254.62
 *     BPM0186    11 payments     R2 329.78 - R1 082.15 = R1 247.63
 *     KIS0007    12 payments     R7 863.45 - R1 176.45 = R6 687.00
 *
 * ON THE TWO WITH NO PAYMENTS THE DIFFERENCE IS R577.30 TO THE CENT, BOTH TIMES. That is the item 9
 * cap of R502 plus VAT: one settlement receipt fee -- what Swordfish calls the FCC -- and nothing
 * else. On the three with payments the difference is that same fee PLUS the item 9 fee on each
 * receipt, which is why it grows with the number of payments and not with the balance.
 *
 * SO IT IS THE SAME MONEY, PRESENTED DIFFERENTLY. Swordfish reports one "Fees & Expenses" column
 * with the receipt fees inside it; Raptor keeps items 1 to 7 in `account_fees` and counts item 9
 * separately, because item 9 is charged per receipt and the two are owed by the debtor on different
 * events. The imported ledger holds NO item 9 rows at all -- confirmed on all five, zero rows --
 * which is why the fee ledger alone always reads short of Swordfish's column.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS FILE DOES
 * ---------------------------------------------------------------------------------------------
 *
 * It does not reconcile. It states the two figures and names what is between them, which is what
 * the firm asked for: "explain each gap on the account". IMPORTED HISTORY IS FROZEN AT WHAT WAS
 * IMPORTED -- Swordfish's figure is what the client was invoiced on and stays the record -- so
 * where the two differ, both are shown and the difference is reported rather than reconciled away.
 */

export interface GapInput {
  /** What Swordfish said the balance was on the day of the import. Null where it was not exported. */
  swordfishBalance: number | null
  /** Swordfish's "Fees & Expenses" column, likewise. */
  swordfishFees: number | null
  /** Raptor's own figures, out of computeBalance. */
  balance: number
  /** Items 1 to 7, including VAT: the rebuilt fee ledger. */
  fees: number
  /** Item 9 on every receipt, plus the fee for settling. Counted apart, which is the whole point. */
  receiptFees: number
}

export interface Gap {
  /** Raptor's balance less Swordfish's. Positive means Raptor says the debtor owes more. */
  difference: number
  /** True where the two agree to the cent. */
  agrees: boolean
  /** Raptor's fees and receipt fees together -- the figure comparable to Swordfish's column. */
  feesLikeSwordfish: number
  /** That, less what Swordfish reported. */
  feeDifference: number
  /** What is known to be between them, in the firm's words. Empty where nothing is. */
  reasons: string[]
}

const r2 = (v: number): number => Math.round(v * 100) / 100

/** Nothing to compare against: the account did not come from Swordfish, or the column was absent. */
export const NO_COMPARISON: Gap = {
  difference: 0, agrees: true, feesLikeSwordfish: 0, feeDifference: 0, reasons: [],
}

export function compareWithSwordfish(input: GapInput): Gap | null {
  if (input.swordfishBalance === null) return null

  const difference = r2(input.balance - input.swordfishBalance)
  const feesLikeSwordfish = r2(input.fees + input.receiptFees)
  const feeDifference = input.swordfishFees === null
    ? 0 : r2(feesLikeSwordfish - input.swordfishFees)

  const reasons: string[] = []
  /*
   * THE ONE THAT EXPLAINS MOST OF IT, AND IT IS NOT A DISAGREEMENT. Said first because somebody
   * reading a difference wants to know whether it is arithmetic or a mistake.
   */
  if (input.swordfishFees !== null && input.receiptFees > 0) {
    reasons.push(
      'Swordfish reports one "Fees & Expenses" figure with the receipt fees inside it. Raptor '
      + 'keeps items 1 to 7 apart from item 9, because item 9 is charged on each receipt. The two '
      + 'columns are not the same thing and are compared added together.',
    )
  }
  /* AND A GAP THAT SURVIVES THAT IS THE ONE WORTH LOOKING AT. */
  if (Math.abs(feeDifference) >= 0.05) {
    reasons.push(
      feeDifference > 0
        ? `Raptor has ${feeDifference.toFixed(2)} more in fees than Swordfish reported.`
        : `Swordfish reported ${Math.abs(feeDifference).toFixed(2)} more in fees than Raptor rebuilt.`,
    )
  }
  return { difference, agrees: Math.abs(difference) < 0.05, feesLikeSwordfish, feeDifference, reasons }
}

/**
 * IS THIS BALANCE FIT TO PUT IN FRONT OF A CLIENT?
 *
 * THE FIRM'S OWN RULE: "A balance the firm cannot explain must not reach a client statement or
 * payover." A difference under five cents is rounding; anything above it is a figure somebody has
 * to stand behind, and the statement says so rather than printing it quietly.
 *
 * NOT A BLOCK. It is a mark on the account, because refusing to show a balance is refusing to show
 * the one thing somebody came for -- and because the imported figure is the record either way.
 */
export function balanceIsExplained(gap: Gap | null): boolean {
  return gap === null || gap.agrees
}
