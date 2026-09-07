/**
 * Annexure B to the Regulations under the Debt Collectors Act 114 of 1998.
 *
 * Source: Government Notice R.7207, Government Gazette No. 54273, 6 March 2026, which
 * substituted Annexure B in full and amended regulation 11 from R1023,00 to R1225,00.
 *
 * This is gazetted fact, not house policy, and it is versioned by effective date rather than
 * edited in place. A tariff that is corrected in place silently rewrites history: an account
 * worked in 2025 must keep being calculated on the tariff that applied in 2025, or a statement
 * reissued years later will not match the one the debtor was originally sent. When the next
 * gazette lands, add a new schedule below it — never change these numbers.
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
   * lesser." Note this binds recovery, so it has to be enforced as fees accrue — work done
   * beyond it was never recoverable, and discovering that at settlement is too late.
   */
  /**
   * On the same VAT-exclusive basis as the amounts themselves — the consistent reading of a
   * single gazetted tariff, though the gazette does not spell it out.
   */
  itemsOneToSevenCeiling: number
  /** Item 9: a fee of 10% of the instalment received. */
  receiptFeeRate: number
  /** Item 9: "subject to a maximum amount of R610.00". */
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

/** Newest first, so the schedule in force on a date is the first one that started on or before it. */
export const ANNEXURE_B_SCHEDULES: AnnexureBSchedule[] = [ANNEXURE_B_2026]

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
 * Item 9 on one instalment: 10%, capped at R610.
 *
 * UNCONFIRMED: whether that R610 maximum applies per instalment or in aggregate across the
 * account. The wording carries both readings and the difference is large on a long-running
 * account, so this takes the literal per-instalment reading and the question stays open. Do
 * not treat this as settled.
 */
export function receiptFee(instalment: number, schedule: AnnexureBSchedule = ANNEXURE_B_2026): number {
  return Math.min(instalment * schedule.receiptFeeRate, schedule.receiptFeeMaximum)
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
