/**
 * Annexure B to the Regulations under the Debt Collectors Act 114 of 1998.
 *
 * Sources, newest first. Each substituted Annexure B in full and moved the regulation 11
 * ceiling; together they cover every action any account in the book can carry.
 *   - GN R.7207, GG 54273, 6 March 2026     R1023,00 -> R1225,00
 *   - GN R.580,  GG 43343, 22 May 2020      R965,00  -> R1023,00
 *   - GN R.1141, GG 41205, 27 October 2017  R870,00  -> R965,00
 *   - GN R.1272, GG 39552, 23 December 2015 R814,00  -> R870,00
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
   * Every amount in these schedules excludes VAT; VAT is added on top when the fee is raised.
   * The gazette does not say so itself, so this was an inference until the business confirmed
   * it directly. Reading the figures as VAT-inclusive would understate every fee on every
   * account by the VAT rate.
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
  /**
   * Item 9: "subject to a maximum amount of R610,00", and R509 / R480 / R435 in the earlier
   * schedules.
   *
   * **Per instalment, not in aggregate.** The wording carries both readings — "on receipt of an
   * instalment (one or more) in redemption of the debt" — and this was an open question for some
   * time. The business has confirmed the per-instalment reading, which is also the one that
   * reproduces their own statements. Settled.
   */
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

/**
 * 27 October 2017 to 21 May 2020.
 *
 * No account in the migrated book carries an action this old — the earliest is May 2023 — so
 * this earns its place by making the ledger complete rather than by being used today. An account
 * handed over in 2019 and revived is not a hypothetical in this business, and a schedule that
 * stops at 2020 would price its history wrong without saying so.
 */
export const ANNEXURE_B_2017: AnnexureBSchedule = {
  effectiveFrom: '2017-10-27',
  citation: 'GN R.1141, GG 41205, 27 October 2017',
  vatBasis: 'exclusive',
  itemsOneToSevenCeiling: 965,
  receiptFeeRate: 0.1,
  receiptFeeMaximum: 480,
  items: earlierItems({
    letter: 20, electronic: 2.8, phoneCall: 20, otherExpenses: 20,
    signedAtResidence: 198, creditBureau: 13, settlementAccount: 39,
    correspondenceIn: 10, consultation: 49, taxation: 78,
  }),
}

/** 23 December 2015 to 26 October 2017. Here for the same reason as the 2017 schedule. */
export const ANNEXURE_B_2015: AnnexureBSchedule = {
  effectiveFrom: '2015-12-23',
  citation: 'GN R.1272, GG 39552, 23 December 2015',
  vatBasis: 'exclusive',
  itemsOneToSevenCeiling: 870,
  receiptFeeRate: 0.1,
  receiptFeeMaximum: 435,
  items: earlierItems({
    letter: 18, electronic: 2.5, phoneCall: 18, otherExpenses: 18,
    signedAtResidence: 178, creditBureau: 12, settlementAccount: 35,
    correspondenceIn: 9, consultation: 44, taxation: 70,
  }),
}

/**
 * The item list for a schedule, given its amounts.
 *
 * Every gazette since 2015 has the same thirteen items with the same wording and the same
 * external references; only the figures move. Writing the descriptions out four times would
 * invite them to drift apart, and a typo in one copy would be a fee described wrongly on a
 * statement. The 2026 and 2020 schedules stay written out in full above because their wording
 * differs in small ways worth being able to read against the gazette.
 */
function earlierItems(a: {
  letter: number; electronic: number; phoneCall: number; otherExpenses: number
  signedAtResidence: number; creditBureau: number; settlementAccount: number
  correspondenceIn: number; consultation: number; taxation: number
}): AnnexureBItem[] {
  return [
    { id: '1a', description: 'Necessary ordinary letter, registered letter, facsimile or e-mail', amount: a.letter, countsTowardCap: true },
    {
      id: '1b',
      description: "Registered letter (section 57 of the Magistrates' Courts Act, 1944)",
      amount: null,
      externalTariff: "Item 8 of Annexure 2, Table A, Part II of the Magistrates' Courts Rules",
      countsTowardCap: true,
    },
    { id: '1c', description: 'Necessary electronic communication, other than facsimile or e-mail (each)', amount: a.electronic, maxPerMonth: 10, countsTowardCap: true },
    { id: '2', description: 'Necessary phone call, which is not a consultation (per call)', amount: a.phoneCall, countsTowardCap: true },
    { id: '3', description: 'Other necessary expenses not specifically provided for', amount: a.otherExpenses, isTotal: true, countsTowardCap: true },
    {
      id: '4a',
      description: 'Acknowledgement of debt and undertaking to pay (section 57 or 58), including the necessary consultation',
      amount: null,
      externalTariff: "Items 9 and 10 of Annexure 2, Table A, Part II of the Magistrates' Courts Rules",
      countsTowardCap: true,
    },
    { id: '4b', description: "Original documents signed by the debtor under item 4(a) at the debtor's residence or place of work", amount: a.signedAtResidence, countsTowardCap: true },
    { id: '4c', description: 'Necessary registered credit bureau search', amount: a.creditBureau, maxPerMonth: 4, countsTowardCap: true },
    { id: '5', description: 'Settlement account drawn up and furnished at the debtor’s request, other than the six-monthly one', amount: a.settlementAccount, countsTowardCap: true },
    { id: '6', description: 'Correspondence received and attended to', amount: a.correspondenceIn, countsTowardCap: true },
    { id: '7', description: 'Necessary consultation with debtor', amount: a.consultation, countsTowardCap: true },
    { id: '8', description: 'Attending taxation', amount: a.taxation, countsTowardCap: false },
    {
      id: '9',
      description: 'On receipt of an instalment (one or more) in redemption of the debt, inclusive of instalments made directly to the client',
      amount: null,
      countsTowardCap: false,
    },
  ]
}

/** Newest first, so the schedule in force on a date is the first one that started on or before it. */
export const ANNEXURE_B_SCHEDULES: AnnexureBSchedule[] = [
  ANNEXURE_B_2026, ANNEXURE_B_2020, ANNEXURE_B_2017, ANNEXURE_B_2015,
]

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
 * The same fee with VAT on it, rounded **once**, at the end.
 *
 * Every caller wants the inclusive figure, because that is what is posted and what the debtor
 * pays. Reaching it as `receiptFee(x) * 1.15` rounds twice: the exclusive amount is rounded to
 * cents first, and VAT is then charged on that rounded number instead of on the real one. It
 * costs a cent whenever 10% of the base lands on a fraction of a cent.
 *
 * ACF10043 is the worked case. A balance of R1,490.83 gives R149.083; round that to R149.08 and
 * gross it up and you get R171.44, where the statement says R171.45. Swordfish evaluates
 * 1490.83 x 10% x 1.15 in one go and rounds the answer. Across the nine statements of
 * 9 September 2026, one rounding matches all nine and two roundings match eight.
 *
 * It bites on ordinary payments too, not only on settlements — it just stays hidden while
 * debtors pay round amounts, because 10% of R500 is already exact to the cent.
 */
export function receiptFeeInclVat(
  instalment: number,
  vatRate = 0.15,
  schedule: AnnexureBSchedule = ANNEXURE_B_2026,
): number {
  if (instalment <= 0) return 0
  return roundToCents(Math.min(instalment * schedule.receiptFeeRate, schedule.receiptFeeMaximum) * (1 + vatRate))
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
  return receiptFeeInclVat(balanceBeforeFee, vatRate, schedule)
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

/**
 * Whether an item marked `isTotal` is enforced as a per-account total.
 *
 * The gazette wording is "Other necessary expenses not specifically provided for, **a total
 * amount of**: R25,00", and the same phrase appears in every schedule since 2015. Read strictly
 * that is R25 for the whole account however many sundry expenses it accumulates, and this code
 * enforced it that way until Bredell Ferreira instructed otherwise on 9 September 2026: item 3
 * is charged per occurrence, as Swordfish charged it before the migration.
 *
 * Left as a flag rather than deleted, because the reading is the thing worth keeping. Flip it
 * back and the per-account total returns, with no other change.
 *
 * The items 1–7 CEILING is untouched by this and still binds. Its wording admits no argument —
 * "the total amount to be recovered from the debtor in respect of items 1 to 7 shall not exceed
 * the capital amount of the debt or R1225,00, whichever is the lesser" — so an account still
 * stops earning at R1,225 no matter how many times item 3 is raised.
 */
export const ENFORCE_ITEM_TOTALS = false

/**
 * What may still be charged under an item, given what it has already earned on this account.
 *
 * With ENFORCE_ITEM_TOTALS off this is simply the item's rate; with it on, an item the gazette
 * prices as a total returns only its remainder.
 */
/**
 * Whether the per-month allowances bind.
 *
 * Two items carry one: a credit bureau search (four a month) and a non-email electronic
 * communication (ten). Enforced from the day the Trace button was built until Bredell Ferreira
 * instructed otherwise on 10 September 2026.
 *
 * The reason is worth recording, because it is not "the firm wants more fees". The gazette counts
 * per ACCOUNT and the work happens per PERSON: one account can carry a company plus several
 * sureties, and tracing four of them exhausts a month's allowance on a single afternoon's work
 * that was entirely necessary. The limit as written does not contemplate a multi-debtor account.
 *
 * What this costs, said plainly: Raptor no longer refuses to charge a fifth search in a month, so
 * whether a charge was necessary is now a question for the people doing the work and for the fee
 * ledger that records every one of them, not for this function. The items 1–7 CEILING is
 * untouched and still binds — an account stops earning at R1,225 however many searches it takes.
 *
 * A flag rather than a deletion, same as ENFORCE_ITEM_TOTALS: the limits stay in the schedules
 * where the gazette put them, and flipping this back restores them with no other change. The
 * better answer, when there is a debtor-level record to hang it on, is to count per person rather
 * than per account — which is what the gazette's four probably meant.
 */
export const ENFORCE_MONTHLY_LIMITS = false

/**
 * How many times an item may be charged in a calendar month, or null where it is uncapped.
 *
 * The gazette words these per month rather than as a total, so unlike item 3 the allowance comes
 * back every month and cannot be spent for good.
 */
export function monthlyLimit(itemId: string, schedule: AnnexureBSchedule = ANNEXURE_B_2026): number | null {
  if (!ENFORCE_MONTHLY_LIMITS) return null
  return schedule.items.find((i) => i.id === itemId)?.maxPerMonth ?? null
}

/**
 * How many more times an item may be charged this month.
 *
 * Only charges that actually earned money count against the allowance. A search recorded at zero
 * because the account was at the ceiling took nothing from the debtor, so it cannot be what stops
 * the next one from being recovered.
 */
export function monthlyRoom(limit: number | null, billedThisMonth: number): number {
  if (limit === null) return Infinity
  return Math.max(0, limit - billedThisMonth)
}

/**
 * What `quantity` units of an item come to, before the items 1–7 ceiling is applied.
 *
 * Most items are charged per occurrence, so this is the rate times the count: four bureau
 * searches on one account are four times R16, and they belong on ONE statement line rather than
 * four identical rows a debtor has to add up themselves.
 *
 * An item the gazette words as a TOTAL for the account cannot exceed what is left of that total
 * however many units are claimed — which only bites while ENFORCE_ITEM_TOTALS is on.
 */
export function itemAmountFor(
  itemId: string,
  quantity: number,
  alreadyChargedUnderItem: number,
  schedule: AnnexureBSchedule = ANNEXURE_B_2026,
): number {
  const item = schedule.items.find((i) => i.id === itemId)
  if (!item || item.amount === null) return 0
  const units = Math.max(1, Math.floor(quantity))
  const asked = roundToCents(item.amount * units)
  if (!item.isTotal || !ENFORCE_ITEM_TOTALS) return asked
  return roundToCents(Math.max(0, Math.min(asked, item.amount - alreadyChargedUnderItem)))
}

export function itemTotalRemaining(
  itemId: string,
  alreadyChargedUnderItem: number,
  schedule: AnnexureBSchedule = ANNEXURE_B_2026,
): number {
  const item = schedule.items.find((i) => i.id === itemId)
  if (!item || item.amount === null) return 0
  if (!item.isTotal || !ENFORCE_ITEM_TOTALS) return item.amount
  return roundToCents(Math.max(0, item.amount - alreadyChargedUnderItem))
}
