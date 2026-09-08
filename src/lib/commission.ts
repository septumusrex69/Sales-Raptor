/**
 * Commission rates, computed from the client's mandate rather than typed at handover.
 *
 * Every mandate we hold writes its scale the same way — "R0 < R25,000" then "R25,001 +" — so
 * the bands are half-open on the capital handed over and the boundary rand belongs to the
 * *lower* band. An account handed over at exactly R25,000.00 is 25%, not 22.5%. That is a real
 * distinction on a real account, so it is encoded literally instead of rounded to the nearest
 * band.
 *
 * Why compute it at all: checked against their signed mandates, ABSTO (19 accounts) and Agri
 * Saad (4) are perfect, and Growthpoint is wrong on 60 of 285. The difference is not diligence,
 * it is size — the rule is applied by hand, and a hand holds up over twenty accounts and not
 * over two hundred and eighty-five. Computing it moves the failure from silent to visible.
 */

/** Ordered ascending. `upTo` is the inclusive maximum capital for the band; null means "and above". */
export interface CommissionBand {
  upTo: number | null
  rate: number
}

export interface CommissionSchedule {
  /** Where the bands come from, e.g. "Signed mandate, 30 April 2024". Shown wherever a rate is explained. */
  source: string
  bands: CommissionBand[]
}

/**
 * The rate the mandate calls for on capital handed over.
 *
 * Returns undefined only if the schedule is empty — a well-formed schedule always ends in a
 * null-`upTo` band, so every amount lands somewhere.
 */
export function rateForCapital(capital: number, schedule: CommissionSchedule): number | undefined {
  for (const band of schedule.bands) {
    if (band.upTo === null || capital <= band.upTo) return band.rate
  }
  return schedule.bands[schedule.bands.length - 1]?.rate
}

export interface RateCheck {
  /** What the mandate says. */
  expected: number
  /** What is actually stamped on the account. */
  actual: number
  agrees: boolean
  /** Positive when the client is being billed more than the mandate allows. */
  differenceInPoints: number
}

/**
 * Compare a stamped rate against the mandate.
 *
 * Deliberately does not "correct" anything. A rate that departs from the mandate may be a
 * keying error or may be a later negotiation nobody wrote into this file, and the two are
 * indistinguishable from here — so this reports, and a person decides. Existing accounts keep
 * the rate they were billed at; the check exists so that new ones cannot drift the same way.
 */
export function checkRate(capital: number, actual: number, schedule: CommissionSchedule): RateCheck | undefined {
  const expected = rateForCapital(capital, schedule)
  if (expected === undefined) return undefined
  // Rates are stored as fractions with at most three decimals (0.225). Compare in basis points
  // so 0.225 vs 0.22499999999999998 doesn't read as a discrepancy.
  const agrees = Math.round(expected * 10000) === Math.round(actual * 10000)
  return { expected, actual, agrees, differenceInPoints: (actual - expected) * 100 }
}
