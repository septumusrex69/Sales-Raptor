/**
 * Annexure B to the Regulations under the Debt Collectors Act 114 of 1998.
 *
 * Sources, newest first:
 *   - GN R.7207, GG 54273, 6 March 2026 — substituted Annexure B in full and amended
 *     regulation 11 from R1023,00 to R1225,00.
 *   - GN R.580, GG 43343, 22 May 2020 — substituted Annexure B in full and amended
 *     regulation 11 from R965,00 to R1023,00.
 *
 * This is gazetted fact, not house policy, and it is versioned by effective date rather than
 * edited in place. A tariff that is corrected in place silently rewrites history: an account
 * worked in 2025 must keep being calculated on the tariff that applied in 2025, or a statement
 * reissued years later will not match the one the debtor was originally sent. When the next
 * gazette lands, add a new schedule above the others — never change these numbers.
 *
 * The rules never change; only the amounts do. That is why the ceiling, the receipt-fee rate
 * and the per-month limits all live on the schedule rather than in the code that applies them.
 */

export type AnnexureBItemId =
  | '1a' | '1b' | '1c' | '2' | '3' | '4a' | '4b' | '4c' | '5' | '6' | '7' | '8' | '9'

/**
 * Item 4(a) is the one tariff line that isn't a single figure: the Magistrates' Courts Rules
 * band it by the size of the debt. Both amounts exclude VAT.
 */
export interface FeeBand {
  /** Applies while the debt is below this figure. The last band has no ceiling. */
  below?: number
  /** Rands, excluding VAT. */
  amount: number
}

export const ACKNOWLEDGEMENT_OF_DEBT_BANDS: FeeBand[] = [
  { below: 50000, amount: 161 },
  { amount: 209 },
]

export interface AnnexureBItem {
  id: AnnexureBItemId
  description: string
  /** Rands. Null where the tariff points elsewhere rather than naming an amount — see `externalTariff`. */
  amount: number | null
  /**
   * Items 1(b) and 4(a) are prescribed by the Magistrates' Courts Rules, not by this Annexure,
   * and move independently of it. They cannot be hardcoded here without going stale silently.
   */
  externalTariff?: string
  /** Some items may only be charged so many times in a calendar month, per account. */
  maxPerMonth?: number
  /** Whether the item counts towards the items 1–7 total cap. Items 8 and 9 do not. */
  countsTowardCap: boolean
  /** True where the tariff gives a total rather than a per-occurrence rate. */
  isTotal?: boolean
  /** Set where the amount depends on the size of the debt rather than being fixed. */
  bandedAmounts?: FeeBand[]
}

export interface AnnexureBSchedule {
  /** Inclusive. An account is worked on the schedule in force on the date of the action. */
  effectiveFrom: string
  citation: string
  /**
   * Every amount in this schedule excludes VAT; VAT is added on top when the fee is raised.
   * Recorded explicitly because the gazette itself doesn't say, and reading these figures as
   * VAT-inclusive would understate every fee on every account by the VAT rate.
   */
  vatBasis: 'exclusive'
  /**
   * "The total amount to be recovered from the debtor in respect of items 1 to 7 of the
   * Annexure shall not exceed the capital amount of the debt or R1225,00, whichever is the
   * lesser."
   *
   * Two halves, and only one of them is commonly implemented. The flat figure is enforced in
   * the migrated book to the cent — 161 accounts sit on exactly R1,023.00 and 52 on exactly
   * R1,225.00, with the fee that would have crossed the line trimmed to land on it. The
   * *capital* half is not: 8 accounts were charged more in fees than the debt was worth,
   * R1,647.01 more than the Act allows. Both halves are enforced here.
   *
   * Note this binds recovery, so it has to be applied as fees accrue — work done beyond it was
   * never recoverable, and discovering that at settlement is too late.
   *
   * On the same VAT-exclusive basis as the amounts themselves — the consistent reading of a
   * single gazetted tariff, though the gazette does not spell it out.
   */
  itemsOneToSevenCeiling: number
  /** Item 9: a fee of 10% of the instalment received. */
  receiptFeeRate: number
  /** Item 9: "subject to a maximum amount of R610,00" (R509,00 under the 2020 schedule). */
  receiptFeeMaximum: number
  items: AnnexureBItem[]
}

export const ANNEXURE_B_2026: AnnexureBSchedule = {
  effectiveFrom: '2026-03-06',
  citation: 'GN R.7207, GG 54273, 6 March 2026',
  vatBasis: 'exclusive',
  itemsOneToSevenCeiling: 1225,
  receiptFeeRate: 0.1,
  receiptFeeMaximum: 610,
  items: [
    {
      id: '1a',
      description: 'Necessary ordinary letter, registered letter, facsimile or e-mail',
      amount: 25,
      countsTowardCap: true,
    },
    {
      id: '1b',
      description: "Registered letter (section 57 of the Magistrates' Courts Act, 1944)",
      amount: null,
      externalTariff: "Item 8 of Annexure 2, Table A, Part II of the Magistrates' Courts Rules",
      countsTowardCap: true,
    },
    {
      id: '1c',
      description: 'Necessary electronic communication, other than facsimile or e-mail (each)',
      amount: 3.5,
      maxPerMonth: 10,
      countsTowardCap: true,
    },
    { id: '2', description: 'Necessary phone call, which is not a consultation (per call)', amount: 25, countsTowardCap: true },
    {
      id: '3',
      description: 'Other necessary expenses not specifically provided for',
      amount: 25,
      isTotal: true,
      countsTowardCap: true,
    },
    {
      id: '4a',
      description: 'Acknowledgement of debt and undertaking to pay (section 57 or 58), including the necessary consultation',
      amount: null,
      externalTariff: "Items 9 and 10 of Annexure 2, Table A, Part II of the Magistrates' Courts Rules",
      // Banded by the size of the debt rather than a single amount — see acknowledgementOfDebtFee.
      bandedAmounts: ACKNOWLEDGEMENT_OF_DEBT_BANDS,
      countsTowardCap: true,
    },
    {
      id: '4b',
      description: "Original documents signed by the debtor under item 4(a) at the debtor's residence or place of work",
      amount: 250,
      countsTowardCap: true,
    },
    { id: '4c', description: 'Necessary registered credit bureau search', amount: 16, maxPerMonth: 4, countsTowardCap: true },
    {
      id: '5',
      description: 'Settlement account drawn up and furnished at the debtor’s request, other than the six-monthly one',
      amount: 50,
      countsTowardCap: true,
    },
    { id: '6', description: 'Correspondence received and attended to', amount: 13, countsTowardCap: true },
    { id: '7', description: 'Necessary consultation with debtor', amount: 60, countsTowardCap: true },
    { id: '8', description: 'Attending taxation', amount: 98, countsTowardCap: false },
    {
      id: '9',
      description: 'On receipt of an instalment in redemption of the debt, including instalments made directly to the client',
      amount: null,
      countsTowardCap: false,
    },
  ],
}

/**
 * The schedule that ran for nearly six years before the 2026 substitution.
 *
 * It is here because 161 accounts in the migrated book stopped charging at exactly R1,023.00 —
 * this schedule's ceiling — and 52 at exactly R1,225.00. Those two figures are how the cohorts
 * date themselves: the last charge on an R1,023 account falls no later than January 2026, and
 * the first on an R1,225 account no earlier than April 2026. Without this schedule the older
 * accounts cannot be recomputed at all, and every reissued statement on them would be wrong.
 */
export const ANNEXURE_B_2020: AnnexureBSchedule = {
  effectiveFrom: '2020-05-22',
  citation: 'GN R.580, GG 43343, 22 May 2020',
  vatBasis: 'exclusive',
  itemsOneToSevenCeiling: 1023,
  receiptFeeRate: 0.1,
  receiptFeeMaximum: 509,
  items: [
    {
      id: '1a',
      description: 'Necessary ordinary letter, registered letter, facsimile or e-mail',
      amount: 21,
      countsTowardCap: true,
    },
    {
      id: '1b',
      description: "Registered letter (section 57 of the Magistrates' Courts Act, 1944)",
      amount: null,
      externalTariff: "Item 8 of Annexure 2, Table A, Part II of the Magistrates' Courts Rules",
      countsTowardCap: true,
    },
    {
      id: '1c',
      description: 'Necessary electronic communication, other than facsimile or e-mail (each)',
      amount: 3,
      maxPerMonth: 10,
      countsTowardCap: true,
    },
    { id: '2', description: 'Necessary phone call, which is not a consultation (per call)', amount: 21, countsTowardCap: true },
    {
      id: '3',
      description: 'Other necessary expenses not specifically provided for',
      amount: 21,
      isTotal: true,
      countsTowardCap: true,
    },
    {
      id: '4a',
      description: 'Acknowledgement of debt and undertaking to pay (section 57 or 58), including the necessary consultation',
      amount: null,
      externalTariff: "Items 9 and 10 of Annexure 2, Table A, Part II of the Magistrates' Courts Rules",
      countsTowardCap: true,
    },
    {
      id: '4b',
      description: "Original documents signed by the debtor under item 4(a) at the debtor's residence or place of work",
      amount: 210,
      countsTowardCap: true,
    },
    { id: '4c', description: 'Necessary registered credit bureau search', amount: 14, maxPerMonth: 4, countsTowardCap: true },
    {
      id: '5',
      description: 'Settlement account drawn up and furnished at the debtor’s request, other than the six-monthly one',
      amount: 41,
      countsTowardCap: true,
    },
    { id: '6', description: 'Correspondence received and attended to', amount: 11, countsTowardCap: true },
    { id: '7', description: 'Necessary consultation with debtor', amount: 52, countsTowardCap: true },
    { id: '8', description: 'Attending taxation', amount: 82, countsTowardCap: false },
    {
      id: '9',
      description: 'On receipt of an instalment (one or more) in redemption of the debt, inclusive of instalments made directly to the client',
      amount: null,
      countsTowardCap: false,
    },
  ],
}

/** Newest first, so the schedule in force on a date is the first one that started on or before it. */
export const ANNEXURE_B_SCHEDULES: AnnexureBSchedule[] = [ANNEXURE_B_2026, ANNEXURE_B_2020]

export function scheduleFor(date: string | Date): AnnexureBSchedule {
  const iso = typeof date === 'string' ? date : date.toISOString()
  return ANNEXURE_B_SCHEDULES.find((s) => s.effectiveFrom <= iso.slice(0, 10)) ?? ANNEXURE_B_2026
}

/**
 * The ceiling on items 1–7 for a given debt: the capital or R1225, whichever is lower.
 *
 * On a large book this bites hard — a R100,000 debt still caps action fees at R1,225 — so
 * recovery on big handovers comes from commission, interest and the item 9 receipt fee rather
 * than from the work itself.
 */
export function feeCeiling(capitalAmount: number, schedule: AnnexureBSchedule = ANNEXURE_B_2026): number {
  return Math.min(capitalAmount, schedule.itemsOneToSevenCeiling)
}

/**
 * Item 9 on one instalment: 10%, capped at R610 (R509 before March 2026).
 *
 * **This fee has three names and they all mean this function.** Annexure B calls it nothing in
 * particular; Swordfish calls it "collection commission"; the export column calls the settlement
 * quotation of it "FCC". We call it the **receipt fee**, deliberately — "commission" is the
 * percentage we charge the *client*, and using one word for both makes every conversation about
 * money ambiguous. The receipt fee comes off the debtor's payment; commission comes off what is
 * remitted to the client. Different payer, different base, different rate.
 *
 * The gazette adds a rule worth keeping in view: "No additional fee shall be charged for any
 * attendance in connection with the receipt or payment of any instalment." Taking the payment is
 * covered by this fee, so a phone call logged for chasing that same instalment is not separately
 * chargeable.
 *
 * It also says the fee applies "inclusive of instalments made directly to the client" — so a PTC
 * payment attracts it exactly like one that reaches our trust account (§7a). That is gazetted,
 * not a house reading.
 *
 * STILL UNCONFIRMED: whether the maximum applies per instalment or in aggregate across the
 * account. The 2020 wording — "On receipt of an instalment (one or more) in redemption of the
 * debt" — leans per-receipt, and the per-instalment reading reproduces the business's own
 * statements, so that is what this does. Not settled.
 */
export function receiptFee(instalment: number, schedule: AnnexureBSchedule = ANNEXURE_B_2026): number {
  return roundToCents(Math.min(instalment * schedule.receiptFeeRate, schedule.receiptFeeMaximum))
}

/**
 * How much of a fee may actually be recovered, given what this account has already been charged.
 *
 * This is the whole cap, applied the way the Act words it: a limit on the *total recovered* for
 * items 1 to 7, not a limit on any one fee. So the fee that would cross the line is trimmed to
 * land exactly on it, and everything after it is free. That is not a rounding artefact — it is
 * why 161 accounts in the migrated book sit on exactly R1,023.00 and 52 on exactly R1,225.00,
 * and why a R25 phone call there appears charged at R2.50.
 *
 * `alreadyCharged` is the account's running total of items 1–7 only, excluding VAT. Items 8 and
 * 9 are outside the cap and must not be counted into it.
 *
 * Returns the recoverable portion, which may be zero. The action still happened and the fee was
 * still incurred — record it with `billed: false` rather than discarding it, because the work is
 * part of the account's history whether or not the debtor can be charged for it.
 */
export function recoverableFee(
  feeExclVat: number,
  alreadyCharged: number,
  capitalAmount: number,
  schedule: AnnexureBSchedule = ANNEXURE_B_2026,
): number {
  const headroom = feeCeiling(capitalAmount, schedule) - alreadyCharged
  if (headroom <= 0) return 0
  return roundToCents(Math.min(feeExclVat, headroom))
}

/**
 * Round to cents, half up, in spite of binary floating point.
 *
 * R2 075 x 10% x 1.15 is exactly 238.625 in decimal, and the business's own statement shows
 * R238.63. In a double it is 238.62499999999997, so `toFixed(2)` and a plain `Math.round`
 * both give 238.62 — a cent light on every statement, on every account, forever. The epsilon
 * nudge closes the representation gap without affecting any figure that is not already sitting
 * exactly on a half-cent.
 *
 * Every rand figure this module returns goes through here. Money that disagrees with the
 * client's own statement by a cent is money someone has to explain.
 */
export function roundToCents(value: number): number {
  const nudge = value >= 0 ? 1e-6 : -1e-6
  return Math.round(value * 100 + nudge) / 100
}

/**
 * The receipt fee on a settlement — what paying the whole balance today would cost.
 *
 * Swordfish calls this "Final Collection Commission" and the export column calls it FCC, which
 * is the line that made "All Fees (inc VAT + FCC)" impossible to interpret. It is not a separate
 * charge and not a fee that has been earned: it is item 9 applied to a hypothetical final
 * instalment — hence the one-line body — shown on the statement so the settlement figure is a
 * single honest number rather than something the debtor has to work out.
 *
 * Three consequences, and getting any of them wrong corrupts the ledger:
 *
 * 1. **It is never revenue.** Across the September 2026 export it was 47% of everything reported
 *    as fees — R168,563 of R360,811. Counting it as earned would overstate the book by nearly
 *    half. In the full four-report export the same gap is R539,146 of R1,232,240.
 * 2. **It is recomputed, never accumulated.** Each statement replaces the previous figure; it is
 *    a derived display line, not a posted transaction. Store it as a fee row and it compounds
 *    against itself on every statement.
 * 3. **It is computed after everything else**, including the commission actually earned on
 *    payments already received, because those reduce what is left to settle.
 *
 * Verified against 214 live accounts: exact to the cent on 193 of them (90%), including both
 * worked statements from the business. The remainder are almost entirely in duplum accounts,
 * where the ceiling interacts with this and the behaviour is not yet confirmed.
 */
export function settlementReceiptFee(
  balanceBeforeFee: number,
  vatRate = 0.15,
  schedule: AnnexureBSchedule = ANNEXURE_B_2026,
): number {
  if (balanceBeforeFee <= 0) return 0
  return roundToCents(receiptFee(balanceBeforeFee, schedule) * (1 + vatRate))
}

/**
 * Item 4(a), by debt size: R161 up to R49,999 and R209 from R50,000 up. Both exclude VAT.
 *
 * The boundary is confirmed: exactly R50,000 falls in the higher band.
 */
export function acknowledgementOfDebtFee(debtAmount: number): number {
  const band = ACKNOWLEDGEMENT_OF_DEBT_BANDS.find((b) => b.below !== undefined && debtAmount < b.below)
  return band?.amount ?? ACKNOWLEDGEMENT_OF_DEBT_BANDS[ACKNOWLEDGEMENT_OF_DEBT_BANDS.length - 1].amount
}

export function annexureBItem(id: AnnexureBItemId, schedule: AnnexureBSchedule = ANNEXURE_B_2026): AnnexureBItem | undefined {
  return schedule.items.find((i) => i.id === id)
}
