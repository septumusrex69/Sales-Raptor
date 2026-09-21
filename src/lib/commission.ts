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

/**
 * What is wrong with a scale somebody is typing, in the order they would meet it.
 *
 * THE FIRM: "it can either be a fixed commission rate or a sliding scale ... accounts between
 * zero rand and a hundred thousand rand is on a specific commission, then the next tier, then the
 * next tier, and then above the last tier would be another one."
 *
 * THREE WAYS A SCALE IS WRONG AND ONLY ONE OF THEM IS OBVIOUS:
 *
 *   - NO TOP BAND. rateForCapital falls through every band and an account above the last
 *     boundary gets the last band's rate anyway — right by luck, and wrong the day somebody
 *     reorders them. "And above" has to be written down.
 *   - BOUNDARIES OUT OF ORDER. The bands are read in order and the first that fits wins, so
 *     100000 before 25000 means every account under R100k is billed at the first band's rate and
 *     the R25k band is never reached at all. Nothing fails; the invoices are simply wrong.
 *   - A RATE AS A PERCENTAGE. Commission is a FRACTION everywhere in Raptor — 0.3 is thirty
 *     percent — and 30 typed in here is three thousand percent. CompanyDetail already carries a
 *     comment saying this is what made one account read as 2300%.
 */
export function scheduleProblems(bands: CommissionBand[]): string[] {
  const problems: string[] = []
  if (bands.length === 0) return ['A sliding scale needs at least one tier.']

  const tops = bands.filter((b) => b.upTo === null)
  if (tops.length === 0) {
    problems.push('The last tier has no upper limit to it. Leave the amount empty on the final '
      + 'tier to mean "and above", or an account over the top boundary is priced by accident.')
  }
  if (tops.length > 1) problems.push('Only the last tier may be "and above".')
  if (tops.length === 1 && bands[bands.length - 1].upTo !== null) {
    problems.push('The "and above" tier has to be the last one.')
  }

  const bounded = bands.filter((b) => b.upTo !== null).map((b) => b.upTo as number)
  for (let i = 1; i < bounded.length; i += 1) {
    if (bounded[i] <= bounded[i - 1]) {
      problems.push('The tiers have to climb: each upper limit above the one before it.')
      break
    }
  }
  if (bounded.some((n) => n <= 0)) problems.push('A tier cannot end at nought or below.')

  for (const b of bands) {
    if (!Number.isFinite(b.rate) || b.rate <= 0) {
      problems.push('Every tier needs a commission rate.')
      break
    }
    if (b.rate > 1) {
      problems.push('Commission is a fraction, not a percentage \u2014 0.3 is thirty percent. '
        + 'A rate above 1 would bill the client many times the debt.')
      break
    }
  }
  return problems
}
