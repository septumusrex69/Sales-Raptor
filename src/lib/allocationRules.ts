/**
 * THE FORMULAS A PAYMENT MUST OBEY, WRITTEN DOWN SO SOMETHING CAN CHECK THEM.
 *
 * THE FIRM, having looked at the first imported payment run: "you can build in testing mechanisms
 * and start building in testing mechanisms. For example, A minus B equals C... These formulas are
 * the key and they are the rules about how which we will abide. And they will ensure that
 * everything is done fine. IF ANYTHING TOUCHES A FORMULA, THERE IS A PROBLEM."
 *
 * That is exactly the right instinct and this file is it. Every rule below is a sentence about one
 * allocation that must be true whatever the amounts are, and each one is NAMED -- because a screen
 * that says "the figures do not balance" is a screen nobody can act on, and one that says
 * "interest after should be available less taking: 15.49 - 15.49 = 0.00, got 1.21" is a screen
 * that tells somebody where to look.
 *
 * ------------------------------------------------------------------------------------------------
 * THE SHAPE THE FIRM DREW
 * ------------------------------------------------------------------------------------------------
 *
 * A payment has two sides. The firm: "first we will handle the fees section and then we will handle
 * the capital section. It's 50-50 unless the fees are less than 50% of the payment, then the rest
 * is allocated to the capital."
 *
 *   THE FEES SIDE, in strict order: INTEREST first, then the RECEIPT FEE (item 9, 10% plus VAT),
 *   then the ANNEXURE B FEES.
 *   THE CAPITAL SIDE: half the payment, plus whatever the fees side could not spend.
 *
 * And each of the three fees-side lines carries the same five figures, which the firm wrote out by
 * hand:
 *
 *   a        total run          everything of this kind ever raised on the account
 *   b        retained           what earlier payments already took
 *   a - b    available          what is there to take now
 *   c        taking now         what THIS payment takes -- the column on the screen
 *   a-b-c    after              what is left once this payment has gone through
 *
 * PURE: no database, no clock, no rounding of its own. It checks figures somebody else computed,
 * which is the only way it can disagree with them.
 */

/** One of the three lines on the fees side, as the firm drew it. */
export interface Component {
  /** a — everything of this kind ever raised on the account. */
  total: number
  /**
   * WHAT THE CEILING REFUSES, which is the one figure the firm's note did not have and the book
   * needs.
   *
   * In duplum (NCA s103(5)) stops interest, fees and costs together exceeding the capital
   * outstanding. On an account at the ceiling some of what RAN can never be RECOVERED -- RRC00005
   * carries R437.01 of fees against R380 of capital -- so "total run" and "available to take" are
   * genuinely different numbers, and the difference is this.
   *
   * Nought on every account that is not at its ceiling, which is nearly all of them.
   */
  cannotTake: number
  /** b — what earlier payments already took. */
  retained: number
  /** a − cannot take − b — what is there to take. */
  available: number
  /** c — what this payment takes. The figure the screen leads with. */
  taking: number
  /** a − b − c — what is left afterwards. */
  after: number
}

/** A whole allocation, as the preview or the ledger reports it. */
export interface Allocation {
  payment: number
  interest: Component
  /** Item 9. VAT-INCLUSIVE throughout -- see `receiptFeeInclusive` below. */
  receiptFee: Component
  /** Everything else on the tariff. VAT-inclusive, like the debtor's own statement. */
  fees: Component
  /*
   * THE ENGINE'S OWN COSTS FIGURE, EITHER SIDE, AND THE REASON THE TWO FEE BUCKETS CAN BE CHECKED
   * AT ALL.
   *
   * `to_costs` is ONE pool in the engine -- interest, then costs, and costs are a single number.
   * Which fee inside it a payment paid is recorded nowhere, so the receipt-fee and Annexure B
   * lines above are a DERIVATION (oldest fee first, the ordering account_money_position uses).
   * A derivation that only ever agrees with itself is worth nothing, so these two carry the
   * engine's figure for the pool as a whole and the rules hold the buckets up against it.
   */
  costsBefore: number
  costsAfter: number
  /** The receipt fee THIS payment raises, including VAT -- it joins the pool before it is paid. */
  receiptFeeRaised: number
  capitalBefore: number
  toCapital: number
  capitalAfter: number
  commission: number
  commissionVat: number
  toClient: number
  dueToBf: number
  excess: number
  /** True where the debtor paid the CLIENT directly, so nothing is paid over. */
  paidToClient: boolean
  /** Null where the client has no rate: commission is then unknown rather than nought. */
  commissionRate: number | null
  vatRate: number
}

/** One rule, and what it found. */
export interface Violation {
  rule: string
  /** The arithmetic, written out, so somebody can see which half is wrong. */
  detail: string
}

/**
 * A CENT OF TOLERANCE, AND NOT MORE.
 *
 * Every figure here is rounded to the cent by the engine, and a chain of three roundings can land
 * a cent either way -- half A and half B are rounded separately and the odd cent is given to half
 * B precisely so the two add back. So an exact comparison would report a cent that is not an
 * error, and a looser one would miss the only size of error that matters: a cent a day across
 * 19 912 accounts is a reconciliation nobody can close.
 */
export const CENT = 0.005

const near = (a: number, b: number) => Math.abs(a - b) <= CENT
const money = (n: number) => n.toFixed(2)

/**
 * THE RECEIPT FEE IS SHOWN INCLUDING VAT, which is a correction rather than a preference.
 *
 * THE FIRM: "this receipt fee that's shown should be inclusive of that." The rate is 10% EXCLUDING
 * VAT -- "the receipt fee, which is the 10% excluding VAT" -- and then VAT is added, so the figure
 * the debtor is actually charged and the figure the split actually spends is the inclusive one.
 * The screen was showing the exclusive figure beside inclusive costs, which is two units in one
 * row.
 */
export function receiptFeeInclusive(excl: number, vatRate: number): number {
  return Math.round((excl + excl * vatRate) * 100) / 100
}

/** The three lines of the fees side, in the order they are paid. */
export function feesSideOf(a: Allocation): Component[] {
  return [a.interest, a.receiptFee, a.fees]
}

/** What the whole fees side takes. */
export function feesSideTaking(a: Allocation): number {
  return feesSideOf(a).reduce((n, c) => n + c.taking, 0)
}

/**
 * A COMPONENT WHOSE AVAILABLE AND AFTER ARE THE FIRM'S OWN SUBTRACTION.
 *
 * Used for the two fee buckets, where the engine has no per-bucket figure to offer -- it keeps one
 * pool. The rules above then hold the two derived lines up against that pool, which is the check
 * that can actually fail.
 */
export function derivedComponent(
  total: number, cannotTake: number, retained: number, taking: number,
): Component {
  const available = total - cannotTake - retained
  return { total, cannotTake, retained, available, taking, after: available - taking }
}

/** Everything the engine reports about one payment, flat, as the preview row carries it. */
export interface AllocationFigures {
  payment: number
  /* Interest. `available` and `after` are the ENGINE'S, not a subtraction -- see below. */
  interestTotal: number
  interestCant: number
  interestRetained: number
  interestBefore: number
  toInterest: number
  interestAfter: number
  /* The item 9 receipt fee. */
  rfTotal: number
  rfCant: number
  rfRetained: number
  toReceiptFees: number
  /* The rest of the tariff. */
  feesTotal: number
  feesCant: number
  feesRetained: number
  toFees: number
  /* The pool the two of them are a split of. */
  costsBefore: number
  costsAfter: number
  receiptFeeRaised: number
  capitalBefore: number
  toCapital: number
  capitalAfter: number
  commission: number
  commissionVat: number
  toClient: number
  dueToBf: number
  excess: number
  paidToClient: boolean
  commissionRate: number | null
  vatRate: number
}

/**
 * ASSEMBLE ONE, FROM WHAT THE ENGINE REPORTS AND NOTHING ELSE.
 *
 * THE INTEREST LINE TAKES THE ENGINE'S OWN `available` AND `after` rather than subtracting, and
 * that is the whole point of having this function: `interest_before` is what engine_balances says
 * is there to take and `interest_after` is what it says is left, both arrived at a completely
 * different way from `total - cannot take - retained`. So the firm's first formula is a real
 * comparison on that line -- two independent calculations of one number -- and a change to either
 * side is reported rather than absorbed.
 *
 * THE TWO FEE LINES HAVE TO BE DERIVED, because the engine keeps one pool and does not split it.
 * They are checked instead against the pool, which the rules above do.
 */
export function allocationOf(f: AllocationFigures): Allocation {
  return {
    payment: f.payment,
    interest: {
      total: f.interestTotal,
      cannotTake: f.interestCant,
      retained: f.interestRetained,
      available: f.interestBefore,
      taking: f.toInterest,
      after: f.interestAfter,
    },
    receiptFee: derivedComponent(f.rfTotal, f.rfCant, f.rfRetained, f.toReceiptFees),
    fees: derivedComponent(f.feesTotal, f.feesCant, f.feesRetained, f.toFees),
    costsBefore: f.costsBefore,
    costsAfter: f.costsAfter,
    receiptFeeRaised: f.receiptFeeRaised,
    capitalBefore: f.capitalBefore,
    toCapital: f.toCapital,
    capitalAfter: f.capitalAfter,
    commission: f.commission,
    commissionVat: f.commissionVat,
    toClient: f.toClient,
    dueToBf: f.dueToBf,
    excess: f.excess,
    paidToClient: f.paidToClient,
    commissionRate: f.commissionRate,
    vatRate: f.vatRate,
  }
}

/**
 * EVERY RULE, RUN OVER ONE ALLOCATION.
 *
 * Returns what is WRONG, so an empty array is the pass. Nothing here throws: an allocation that
 * breaks a rule is a thing to show somebody, not a reason to take the screen down -- the money
 * has already arrived either way.
 */
export function checkAllocation(a: Allocation): Violation[] {
  const out: Violation[] = []
  const say = (rule: string, detail: string) => out.push({ rule, detail })

  /* ---------------------------------------------------------------- each component on its own */
  const named: [string, Component][] = [
    ['Interest', a.interest], ['Receipt fee', a.receiptFee], ['Fees', a.fees],
  ]
  for (const [name, c] of named) {
    /*
     * a − cannot take − b = available. The firm's own first formula, with the ceiling in it.
     *
     * They wrote "a − b", and that is right on every account not at its in duplum ceiling. On one
     * that is, part of what ran can never be recovered, and leaving it out would make this rule
     * fire on correct arithmetic -- which is the fastest way to teach somebody to ignore it.
     */
    if (!near(c.available, c.total - c.cannotTake - c.retained)) {
      say(`${name}: available is total, less what the ceiling refuses, less retained`,
        `${money(c.total)} − ${money(c.cannotTake)} − ${money(c.retained)} = `
        + `${money(c.total - c.cannotTake - c.retained)}, got ${money(c.available)}`)
    }
    /* a − b − c = after. */
    if (!near(c.after, c.available - c.taking)) {
      say(`${name}: after is available less what is taken`,
        `${money(c.available)} − ${money(c.taking)} = ${money(c.available - c.taking)}, got ${money(c.after)}`)
    }
    /*
     * AND NOTHING TAKES MORE THAN IS THERE. This is the rule that catches a double-count: the
     * receipt fee was once charged into account_fees AND computed again from the payment, and
     * every balance carrying one was overstated by exactly that fee.
     */
    if (c.taking > c.available + CENT) {
      say(`${name}: cannot take more than is available`,
        `taking ${money(c.taking)} of ${money(c.available)}`)
    }
    for (const [label, n] of Object.entries(c)) {
      if (n < -CENT) say(`${name}: ${label} is negative`, money(n))
    }
  }

  /*
   * ---------------------------------------------------------------- the buckets against the pool
   *
   * THE TWO FEE BUCKETS ARE THE ENGINE'S ONE POOL, SPLIT. This is the rule that makes the split
   * honest rather than decorative: the receipt fee and the Annexure B fees are derived from an
   * ordering, and if that ordering is wrong these will not add back to what the engine actually
   * had to spend and actually spent.
   *
   * THE RAISED RECEIPT FEE IS ON THE AVAILABLE SIDE AND NOT THE BEFORE SIDE, which is not a fudge:
   * the engine's `costs_before` is the pool as it stood BEFORE this payment, and finance_split
   * adds the fee this payment raises to it precisely so the payment can pay it. So what is
   * available to this payment is the one plus the other.
   */
  const bucketsAvailable = a.receiptFee.available + a.fees.available
  if (!near(bucketsAvailable, a.costsBefore + a.receiptFeeRaised)) {
    say('The receipt fee and the fees are the costs pool, split',
      `${money(a.receiptFee.available)} + ${money(a.fees.available)} = ${money(bucketsAvailable)}, `
      + `pool is ${money(a.costsBefore)} + ${money(a.receiptFeeRaised)} raised `
      + `= ${money(a.costsBefore + a.receiptFeeRaised)}`)
  }
  const bucketsAfter = a.receiptFee.after + a.fees.after
  if (!near(bucketsAfter, a.costsAfter)) {
    say('What is left on the two fee lines is what is left on the pool',
      `${money(a.receiptFee.after)} + ${money(a.fees.after)} = ${money(bucketsAfter)}, `
      + `pool leaves ${money(a.costsAfter)}`)
  }
  const bucketsTaking = a.receiptFee.taking + a.fees.taking
  if (!near(bucketsTaking, a.costsBefore + a.receiptFeeRaised - a.costsAfter)) {
    say('What the two fee lines take is what the pool paid',
      `${money(a.receiptFee.taking)} + ${money(a.fees.taking)} = ${money(bucketsTaking)}, `
      + `pool paid ${money(a.costsBefore + a.receiptFeeRaised - a.costsAfter)}`)
  }

  /* ---------------------------------------------------------------- the two sides of the payment */
  /*
   * THE WHOLE PAYMENT IS ACCOUNTED FOR. Every rand either paid something or is held as a credit;
   * a payment that does not add back is money that has gone missing between the debtor and the
   * client, which is the one failure on this screen nobody could reconstruct afterwards.
   */
  const side = feesSideTaking(a)
  if (!near(side + a.toCapital + a.excess, a.payment)) {
    say('The payment is fully accounted for',
      `${money(side)} fees + ${money(a.toCapital)} capital + ${money(a.excess)} credit = `
      + `${money(side + a.toCapital + a.excess)}, payment is ${money(a.payment)}`)
  }

  /*
   * FIFTY-FIFTY, UNLESS THE FEES SIDE RAN OUT OF THINGS TO PAY.
   *
   * THE FIRM: "it's 50-50 unless the fees are less than 50% of the payment, then the rest is
   * allocated to the capital." So the fees side never takes MORE than half -- that is the half it
   * is given -- and where it takes less, everything it could have paid must be settled. A fees
   * side under half with something still outstanding on it is the roll going the wrong way.
   */
  const half = Math.round((a.payment / 2) * 100) / 100
  if (side > half + CENT) {
    say('The fees side never takes more than half',
      `fees side ${money(side)} of a payment of ${money(a.payment)} (half is ${money(half)})`)
  }
  if (side < half - CENT) {
    const unpaid = feesSideOf(a).filter((c) => c.after > CENT)
    if (unpaid.length > 0) {
      say('The fees side only takes less than half once it is settled',
        `fees side ${money(side)} of ${money(half)} with ${money(unpaid.reduce((n, c) => n + c.after, 0))} still outstanding`)
    }
  }
  /* AND CAPITAL NEVER TAKES LESS THAN ITS OWN HALF. The roll only ever moves money TOWARDS it. */
  const otherHalf = Math.round((a.payment - half) * 100) / 100
  if (a.capitalBefore > CENT && a.toCapital < Math.min(otherHalf, a.capitalBefore) - CENT) {
    say('Capital takes at least its half',
      `capital took ${money(a.toCapital)} of a half worth ${money(otherHalf)}`)
  }

  /* ---------------------------------------------------------------- capital */
  if (!near(a.capitalAfter, a.capitalBefore - a.toCapital)) {
    say('Capital outstanding is what it was less what was taken',
      `${money(a.capitalBefore)} − ${money(a.toCapital)} = ${money(a.capitalBefore - a.toCapital)}, `
      + `got ${money(a.capitalAfter)}`)
  }
  if (a.toCapital > a.capitalBefore + CENT) {
    say('Capital cannot take more than is outstanding',
      `taking ${money(a.toCapital)} of ${money(a.capitalBefore)}`)
  }

  /* ---------------------------------------------------------------- commission, and whose money */
  /*
   * COMMISSION IS ON CAPITAL AND ON NOTHING ELSE. Interest and Annexure B fees are the firm's in
   * full; the client's share is capital less the firm's cut of it. A commission computed on the
   * whole receipt would charge the client for recovering the firm's own fees.
   */
  if (a.commissionRate !== null
    && !near(a.commission, Math.round(a.toCapital * a.commissionRate * 100) / 100)) {
    say('Commission is the rate on capital recovered',
      `${money(a.toCapital)} × ${(a.commissionRate * 100).toFixed(2)}% = `
      + `${money(a.toCapital * a.commissionRate)}, got ${money(a.commission)}`)
  }
  if (!near(a.commissionVat, Math.round(a.commission * a.vatRate * 100) / 100)) {
    say('VAT is the rate on the commission',
      `${money(a.commission)} × ${(a.vatRate * 100).toFixed(0)}% = ${money(a.commission * a.vatRate)}, `
      + `got ${money(a.commissionVat)}`)
  }

  if (a.paidToClient) {
    /*
     * THE DEBTOR PAID THE CLIENT. Nothing is paid over -- the client already has the money -- and
     * what the firm recovered is owed to it by the client instead.
     */
    if (!near(a.toClient, 0)) {
      say('Nothing is paid over on money the client already has', `to client ${money(a.toClient)}`)
    }
    if (!near(a.dueToBf, side + a.commission)) {
      say('What the client owes the firm is what the firm recovered',
        `${money(side)} + ${money(a.commission)} = ${money(side + a.commission)}, got ${money(a.dueToBf)}`)
    }
  } else {
    if (!near(a.toClient, a.toCapital - a.commission - a.commissionVat)) {
      say('The client is paid capital less commission and its VAT',
        `${money(a.toCapital)} − ${money(a.commission)} − ${money(a.commissionVat)} = `
        + `${money(a.toCapital - a.commission - a.commissionVat)}, got ${money(a.toClient)}`)
    }
    if (!near(a.dueToBf, 0)) {
      say('Nothing is owed by the client on money the firm received',
        `due to BF ${money(a.dueToBf)}`)
    }
  }

  /*
   * AND THE CASH CLOSES, WHERE THERE IS CASH.
   *
   * On a receipt the firm banked: what is paid over to the client, what the firm keeps and the VAT
   * that belongs to SARS are the whole payment, less anything held as a credit. This is the rule
   * the others exist to make findable -- if it fails and nothing else does, a rounding has
   * drifted; if it fails alongside something else, that something else is the cause.
   *
   * ON MONEY THE CLIENT TOOK DIRECTLY THERE IS NO CASH IN THE FIRM TO CLOSE, and the rule is
   * ABSENT rather than rewritten. The client has the whole payment; what the firm recovered is a
   * set-off, and `dueToBf` is tied to it by the rule just above. Written for that branch as well,
   * every form of the sum reduces to "the fees side plus capital is the payment" -- which the
   * accounting rule at the top already says -- so it would be a rule that cannot fail, and a rule
   * that cannot fail teaches people the rest of them do not bite either. (The first version of
   * this did exactly that, badly: it added the client's share of capital to the VAT and compared
   * the result to the payment, which was wrong in that branch on correct figures.)
   */
  if (!a.paidToClient) {
    const accounted = a.toClient + side + a.commission + a.commissionVat
    if (!near(accounted, a.payment - a.excess)) {
      say('Client, firm and SARS add back to the payment',
        `${money(a.toClient)} to client + ${money(side)} fees + ${money(a.commission)} commission `
        + `+ ${money(a.commissionVat)} VAT = ${money(accounted)}, `
        + `against ${money(a.payment - a.excess)} applied`)
    }
  }

  return out
}
