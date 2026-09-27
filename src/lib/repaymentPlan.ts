/**
 * WHAT R500 A MONTH ACTUALLY DOES TO A DEBT, MONTH BY MONTH.
 *
 * THE FIRM ASKED FOR THIS TO SIT BESIDE THE PROMISE TO PAY: "the guy owes 10 000 rand, he wants to
 * pay 500 rand a month, take into account interest... how long will it take him? In a world where
 * no fees accumulate. However, the receipt fee is still applicable."
 *
 * IT IS A CONVERSATION ON THE PHONE, AND THE ANSWER IS USUALLY WORSE THAN THE DEBTOR THINKS. At
 * 2% a month on ten thousand rand, R200 of that R500 is interest before anything touches the debt,
 * and the Annexure B item 9 receipt fee takes R57.50 more -- so R500 a month pays off R242.50 a
 * month, not R500, and what the debtor imagines is twenty months is nearer forty. A collector who
 * can say that out loud, with the month it settles, is negotiating with the facts.
 *
 * IT IS A PROJECTION, NEVER A SECOND OPINION ABOUT THE MONEY. Every period runs through
 * computeBalance -- the same function behind the statement the debtor is holding -- by POSTING each
 * period's interest into a projected ledger and asking again. So in duplum binds here exactly as
 * it binds there, the receipt fee is the one Annexure B prices, and the settlement figure on the
 * last line is the settlement figure the account would quote that day. An amortisation formula
 * written out here would be a different answer to the same question, and the one on the screen
 * would be the one nobody could check.
 *
 * WHAT IT ASSUMES, AND THE FIRM CHOSE IT: no further collection fees. No call, no email, no SMS,
 * no trace is charged over the life of the arrangement. That is not how a working account behaves,
 * and it is the right assumption for this screen anyway -- the alternative is a quotation that
 * moves every time somebody picks up the phone. `assumption` below says so in words, because the
 * number goes to a debtor.
 *
 * Pure: no database, no clock of its own. Dates are 'YYYY-MM-DD'.
 */
import { computeBalance, type BalanceInput } from './accountBalance.js'
import { nextDueDate, type Recurring } from './arrangements.js'
import { roundToCents } from './annexureB.js'
import { SLOW_PAYING_FROM } from './ptpSchedule.js'

/** One instalment, and what it does. */
export interface RepaymentRow {
  /** 1-based, as the firm counts instalments. */
  no: number
  dueOn: string
  /** What the debtor pays. Equal to the offer on every row but the last, which settles. */
  amount: number
  /**
   * Interest CHARGED over the period ending on this date -- what the debtor actually pays, not
   * what accrued. The two differ once in duplum binds: past the ceiling interest still accrues and
   * none of it is recoverable, and a schedule that totalled the gross figure would tell a debtor
   * they are paying fifty thousand rand of interest they will never be asked for.
   *
   * DERIVED FROM THE BALANCE rather than read off the accrual, which is what makes it the charged
   * figure: it is how much the debt grew over the period, and the cap is already inside that.
   */
  interest: number
  /** Annexure B item 9 on this payment, VAT included, and likewise capped where the ceiling bites. */
  receiptFee: number
  /**
   * What this payment actually takes off the debt: the amount less the interest and the receipt
   * fee. NEGATIVE where the payment does not even cover them, which is the number that explains a
   * balance going nowhere better than any sentence.
   */
  offDebt: number
  /** What is owed after it, settlement fee excluded. Zero on the final row. */
  balanceAfter: number
  /** Set on the row where the in duplum ceiling first stopped the debt growing. */
  cappedBy?: 'in duplum'
}

export type RepaymentOutcome =
  /** It clears, and `rows` ends with the settlement. */
  | 'settles'
  /**
   * It never clears: a full payment leaves the debt no smaller, so no number of them will. Only
   * reachable with in duplum off -- with it on, the debt stops growing at the ceiling and any
   * payment above its own receipt fee gets there eventually, however long that takes.
   */
  | 'never'
  /**
   * It does not finish: either a once-off that leaves a balance behind, or an arrangement still
   * running at the end of the horizon. Both are the same answer to the debtor -- "this does not
   * clear the account" -- and `leftOwing` is what is still on it.
   */
  | 'not_within'

export interface RepaymentPlan {
  outcome: RepaymentOutcome
  rows: RepaymentRow[]
  /** The day the final payment falls. Null unless it settles. */
  settlesOn: string | null
  /** Everything the debtor hands over, including the final settlement. */
  totalPaid: number
  totalInterest: number
  totalReceiptFees: number
  /** What is still owed at the end of the horizon. Zero where it settles. */
  leftOwing: number
  /**
   * WHETHER INTEREST IS ACTUALLY RUNNING ON THIS ACCOUNT, and it is here because a zero has two
   * meanings. An account with no rate, or none posted to accrue from, produces a schedule with no
   * interest in it -- which is correct, and reads exactly like a schedule where the interest was
   * forgotten. A quotation that silently omits interest is one the debtor is entitled to hold the
   * firm to.
   */
  interestRunning: boolean
  /**
   * THE FLOOR BELOW WHICH THE DEBT CERTAINLY DOES NOT FALL, because the payment cannot clear the
   * interest and its own receipt fee. Null where the offer already settles.
   *
   * NOT A COUNTER-OFFER -- see minimumInstalment for why an amount sitting on this line can still
   * take three hundred years. What to ask for instead comes from instalmentToSettleIn.
   */
  minimumInstalment: number | null
  /** True once the arrangement runs to seven instalments or more -- see readsAsSlowPaying. */
  readsAsSlowPaying: boolean
  /** Whether the in duplum ceiling was reached anywhere in the projection. */
  hitInDuplum: boolean
  /**
   * THE INSTALMENT DOES NOT COVER WHAT THE ACCOUNT CHARGES: a full period left the debt no smaller.
   *
   * SEPARATE FROM THE OUTCOME because in duplum makes them different questions. Without the cap
   * this is the same thing as `never`. With it, the debt climbs to the ceiling and then falls --
   * so the arrangement does finish, long after anybody cares, and the useful sentence is not "it
   * never settles" but "this payment does not cover the interest".
   */
  belowTheInterest: boolean
  /** The sentence that has to go beside the figures. */
  assumption: string
}

/**
 * HOW FAR THIS IS WILLING TO WALK.
 *
 * TEN YEARS OF MONTHLY PAYMENTS. Past that the answer to a debtor is not a date, it is "this offer
 * does not work", and walking a thousand periods to produce a number nobody would quote is a loop
 * with no stopping rule anybody would defend. Weekly arrangements are shorter in time and the same
 * in rows, which is the point of counting instalments rather than months.
 */
export const MAX_INSTALMENTS = 120

export const NO_FURTHER_FEES =
  'Assumes no further collection fees are raised on the account: no calls, emails, SMSs or traces '
  + 'are charged over the life of the arrangement. Interest and the receipt fee on each payment '
  + 'are included.'

export interface RepaymentInput {
  /**
   * The account exactly as the statement sees it, MINUS accrueTo -- this supplies its own, once
   * per period. Passed whole for the reason mergeValuesFor takes FirmSettings whole: a list of
   * fields here is a list to fall behind.
   */
  account: Omit<BalanceInput, 'accrueTo'>
  /** What the debtor is offering, per instalment. */
  instalment: number
  /** When the first one falls, and how they repeat. Same shape the arrangement itself uses. */
  schedule: Recurring
  /** Stop here. Defaults to MAX_INSTALMENTS; lowered in checks so a hopeless case runs quickly. */
  maxInstalments?: number
}

/**
 * THE FLOOR BELOW WHICH A PAYMENT CANNOT POSSIBLY WORK.
 *
 * A payment has to clear the period's interest AND its own receipt fee before a cent reaches the
 * debt. The fee is 10% of the payment plus VAT, so it scales with the offer:
 *
 *     x  >  interest + x * rate * (1 + vat)      =>      x  >  interest / (1 - rate * (1 + vat))
 *
 * IT IS A FLOOR AND NOT A COUNTER-OFFER, and the difference matters on a telephone. Interest is
 * pro-rated by days in the calendar month, so a period running into February charges more than a
 * flat twelfth -- a payment sitting exactly on this line falls a few rand a month in most months
 * and stalls in a short one. On a R10 200 debt at 24% the floor is R231, and R232 takes three
 * hundred years. Quoting either as "what you would need to pay" would be true and useless.
 *
 * SO WHAT IT IS FOR IS THE OTHER DIRECTION: below this the debt CERTAINLY does not fall, which is
 * the one thing worth saying about an offer this small. The number a collector should actually ask
 * for comes from instalmentToSettleIn -- "six payments would be R2 020" -- which is an answer.
 *
 * ROUNDED UP TO THE RAND, because it is read out loud: "R225.42" invites an offer of R225.
 */
export function minimumInstalment(
  balance: number, annualRatePct: number, vatRate = 0.15, receiptFeeRate = 0.10,
): number {
  if (!(balance > 0) || !(annualRatePct > 0)) return 0
  const monthlyInterest = balance * (annualRatePct / 100) / 12
  const share = 1 - receiptFeeRate * (1 + vatRate)
  if (share <= 0) return Infinity
  return Math.ceil(monthlyInterest / share)
}

/**
 * Walk the arrangement forward, one instalment at a time.
 *
 * THE LOOP IS THE WHOLE ALGORITHM AND IT IS DELIBERATELY DULL: ask the balance what is owed on the
 * instalment date, decide whether the offer settles it, and if not POST that period's interest and
 * record the payment. Posting is what makes the next period compound off the right number --
 * openAccrual runs the open period on ONE opening balance, so a projection that simply moved
 * `accrueTo` further out would charge every future month's interest on the closing balance.
 */
export function repaymentPlan(input: RepaymentInput): RepaymentPlan {
  const cap = Math.max(1, Math.min(input.maxInstalments ?? MAX_INSTALMENTS, MAX_INSTALMENTS))
  const vatRate = input.account.vatRate ?? 0.15
  const offer = roundToCents(input.instalment)

  /* A projected ledger of our own, so nothing here can write on the account's. */
  const ledger = {
    payments: [...input.account.ledgers.payments],
    fees: [...input.account.ledgers.fees],
    interest: [...input.account.ledgers.interest],
  }
  const at = (accrueTo: string | null) =>
    computeBalance({ ...input.account, ledgers: ledger, accrueTo })

  /*
   * WHERE THE ACCOUNT STANDS BEFORE ANY OF THIS, with no accrual asked for -- the posted position,
   * which is the last figure the debtor was actually shown. Every row's charged interest is
   * measured against the row before it, and this is what the first row is measured against.
   */
  const posted = at(null)
  const opening = at(input.schedule.dueOn)
  const floor = minimumInstalment(
    posted.balance, input.account.interestRateAnnual ?? 0, vatRate,
  )
  /*
   * IS INTEREST RUNNING AT ALL? Asked of the balance rather than of the rate, because a rate is not
   * enough: openAccrual needs a posted accrual to run from, and an account with none accrues
   * nothing however high the rate on it is. Both are real zeros and a screen must not present
   * either as a computed one.
   */
  const interestRunning = opening.balance > posted.balance
    || (opening.interestAccruing > 0 && (input.account.interestRateAnnual ?? 0) > 0)

  const rows: RepaymentRow[] = []
  let hitInDuplum = false
  let belowTheInterest = false
  let due: Recurring = input.schedule
  let outcome: RepaymentOutcome = 'not_within'
  let leftOwing = 0
  /* The position after the previous payment. The first period runs from the posted position. */
  let previous = posted

  for (let no = 1; no <= cap; no += 1) {
    const dueOn = due.dueOn
    const before = at(dueOn)
    if (before.cappedBy === 'in duplum') hitInDuplum = true

    /*
     * THE INTEREST THIS PERIOD CHARGED, which is how much the debt GREW over it. Taken this way
     * rather than off `interestAccruing` because in duplum withholds: past the ceiling the accrual
     * still computes and none of it is recoverable, and totalling the gross figure would quote a
     * debtor fifty thousand rand of interest nobody will ever ask them for.
     */
    const interest = roundToCents(before.balance - previous.balance)

    /*
     * DOES THIS PAYMENT FINISH IT? Against the SETTLEMENT figure, not the balance: settling costs
     * the balance plus item 9 on it, and a final instalment that paid only the balance would leave
     * the debtor a receipt fee short and the account open on a few rand.
     */
    const settles = before.settlement <= offer
    const amount = roundToCents(settles ? before.settlement : offer)

    if (settles) {
      rows.push({
        no,
        dueOn,
        amount,
        interest,
        receiptFee: roundToCents(before.settlementFee),
        offDebt: roundToCents(amount - interest - before.settlementFee),
        balanceAfter: 0,
        ...(before.cappedBy === 'in duplum' ? { cappedBy: 'in duplum' as const } : {}),
      })
      outcome = 'settles'
      leftOwing = 0
      break
    }

    /*
     * POST THE PERIOD AND TAKE THE PAYMENT, in that order. `interestAccruingDays` counts BOTH ends
     * of the open period; a posted row's `days` is exclusive, so that `from + days` is the last day
     * covered. One less, or every projected period would cover a day into the next and the whole
     * schedule would drift forward. Asserted in check-repayment-plan.
     */
    if (before.interestAccruing > 0 && before.interestAccruingFrom) {
      ledger.interest.push({
        from: before.interestAccruingFrom,
        days: Math.max(0, before.interestAccruingDays - 1),
        amount: before.interestAccruing,
      })
    }
    ledger.payments.push({ date: dueOn, amount: offer })
    const after = at(dueOn)

    /*
     * AND THE RECEIPT FEE THIS PAYMENT ACTUALLY ATTRACTED, derived the same way as the interest:
     * the debt moved by the fee less the payment, so the fee is what is left when the payment is
     * added back. Item 9 is a FEE, so in duplum binds it too -- computed alongside instead, a
     * schedule at the ceiling would show a fee the debtor is not charged.
     */
    const receiptFee = roundToCents(after.balance - before.balance + offer)

    rows.push({
      no,
      dueOn,
      amount,
      interest,
      receiptFee,
      offDebt: roundToCents(amount - interest - receiptFee),
      balanceAfter: roundToCents(after.balance),
      ...(before.cappedBy === 'in duplum' ? { cappedBy: 'in duplum' as const } : {}),
    })

    /*
     * NOTHING IS MOVING, MEASURED PERIOD TO PERIOD AND NOT WITHIN ONE.
     *
     * COMPARED AGAINST WHERE THE LAST PAYMENT LEFT IT, which is the comparison that means anything.
     * Every payment reduces the balance at the instant it lands -- R100 against a R11.50 fee takes
     * R88.50 off, whatever the debt is -- so a test taken inside the period says the arrangement is
     * working while the next month's interest quietly puts more back than the payment took off.
     * That was the first version of this line, and it reported "R100 a month settles it" on a debt
     * growing by two hundred rand a month.
     *
     * ONE PERIOD IS ENOUGH TO DECIDE IT: a debt that grew over a full instalment grows faster over
     * the next, because there is more of it and the payment has not changed.
     *
     * Only reachable with in duplum off -- with it on the debt stops growing at the ceiling and any
     * payment above its own receipt fee gets there in the end, which is what the horizon is for.
     */
    if (after.balance >= previous.balance) {
      /*
       * THE REASON IS ALWAYS WORTH RECORDING, THE VERDICT IS NOT ALWAYS "NEVER".
       *
       * WITHOUT IN DUPLUM THE DEBT GROWS FOR EVER and there is nothing more to walk. WITH IT the
       * growth is bounded: the debt climbs to the ceiling, interest stops there, and every payment
       * above its own receipt fee then chips away at it -- so it does settle, sixteen years later.
       * Calling that "never" would be a lie a debtor could disprove by paying, and pretending it is
       * a working arrangement would be the worse one. So the walk continues and the horizon
       * answers, while `belowTheInterest` carries the fact a collector actually needs: this payment
       * does not cover what the account charges.
       */
      belowTheInterest = true
      if (!input.account.inDuplum) {
        outcome = 'never'
        leftOwing = roundToCents(after.balance)
        break
      }
    }

    leftOwing = roundToCents(after.balance)
    previous = after

    const next = nextDueDate(due)
    if (!next) {
      /* A once-off offer that does not settle is one payment and a balance left over. */
      outcome = 'not_within'
      break
    }
    due = { ...due, dueOn: next }
  }

  return {
    outcome,
    rows,
    settlesOn: outcome === 'settles' ? (rows[rows.length - 1]?.dueOn ?? null) : null,
    totalPaid: roundToCents(rows.reduce((t, r) => t + r.amount, 0)),
    totalInterest: roundToCents(rows.reduce((t, r) => t + r.interest, 0)),
    totalReceiptFees: roundToCents(rows.reduce((t, r) => t + r.receiptFee, 0)),
    leftOwing: outcome === 'settles' ? 0 : leftOwing,
    interestRunning,
    minimumInstalment: outcome === 'settles' ? null : floor,
    /* The firm's own letters tell the debtor this, so the collector agreeing to it should see it:
       "an arrangement that takes more than six instalments to settle the account is reported as
       slow paying, which every credit provider who assesses you can see." */
    readsAsSlowPaying: rows.length >= SLOW_PAYING_FROM,
    hitInDuplum,
    belowTheInterest,
    assumption: NO_FURTHER_FEES,
  }
}

/**
 * WHAT THEY WOULD HAVE TO PAY TO CLEAR IT IN N INSTALMENTS.
 *
 * THE OTHER HALF OF THE CONVERSATION. "R500 a month takes you thirty-one months" is the answer to
 * what the debtor offered; "six payments would be R1 850" is the answer to what the firm wants,
 * and a collector needs both in front of them to negotiate rather than merely report.
 *
 * SIX IS THE NUMBER THAT MATTERS, because the firm's own letters tell the debtor that an
 * arrangement running longer than six instalments is reported to the bureaus as slow paying.
 *
 * FOUND BY BISECTION rather than by algebra, and that is the point: the amount is whatever makes
 * the SAME projection land on n rows, so it cannot drift from the schedule drawn beside it. The
 * search is over whole rand -- the figure is read out over a telephone -- and it is bounded, so a
 * debt no instalment can clear inside n returns null rather than looping.
 */
export function instalmentToSettleIn(
  input: Omit<RepaymentInput, 'instalment'>, instalments: number,
): number | null {
  const n = Math.max(1, Math.floor(instalments))
  const settlesIn = (rand: number) => {
    const p = repaymentPlan({ ...input, instalment: rand, maxInstalments: n })
    return p.outcome === 'settles' && p.rows.length <= n
  }
  /* The whole debt in one payment is an upper bound on any n, and cheap to establish. */
  let hi = Math.ceil(repaymentPlan({ ...input, instalment: 0, maxInstalments: 1 }).leftOwing * 1.5) + 1
  if (hi <= 1 || !settlesIn(hi)) return null
  let lo = 1
  /* At most ~25 iterations to the rand on any debt this firm collects. */
  for (let i = 0; i < 40 && lo < hi; i += 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (mid <= lo) break
    if (settlesIn(mid)) hi = mid
    else lo = mid
  }
  return hi
}

/**
 * WHAT THE SAME DEBT COSTS AT DIFFERENT SPEEDS, AND WHAT PAYING FASTER SAVES.
 *
 * THE FIRM: "show how it would look like in, for example, settling this in three or four
 * instalments and stuff like that... six instalments, three instalments... so that we can negotiate
 * and the people can see how fast they would pay it off and how much they would save -- kind of as
 * a motivational thing that they pay more faster."
 *
 * IT IS THE ARGUMENT, NOT THE ARITHMETIC. A debtor offering R500 a month hears "thirty-one
 * payments" as a fact about the calendar. What changes the conversation is the second number:
 * those thirty-one payments cost R15 267, and six payments cost R12 119 -- so paying faster is
 * worth THREE THOUSAND RAND to them, not to the firm. That is a reason to stretch, and nobody has
 * ever been able to put it in front of them.
 *
 * MEASURED AGAINST WHAT THEY THEMSELVES OFFERED, which is the only honest baseline. Against the
 * slowest option on the table it would be a number the firm chose; against their own offer it is
 * the difference between what they said and what is being suggested.
 *
 * ONLY FASTER THAN THE OFFER. Showing a debtor who offered six payments what twelve would cost is
 * showing them how to pay less each month and more in all, which is not the conversation -- and
 * an option that "saves" a negative amount reads as an invitation.
 *
 * EVERY ROW IS THE SAME PROJECTION, bisected to the rand by instalmentToSettleIn, so the ladder
 * and the schedule drawn beside it cannot disagree about what a month costs.
 */
export interface SettlementOption {
  /** How many payments it takes. 1 is settling in full. */
  instalments: number
  /** What each one would be. The last may be smaller; this is the regular amount. */
  each: number
  totalPaid: number
  /** Interest plus receipt fees: what the debt costs over and above itself. */
  totalCost: number
  /** What choosing this over their own offer saves them. Always positive. */
  saving: number
}

export function settlementLadder(
  input: Omit<RepaymentInput, 'instalment'>,
  offer: RepaymentPlan,
  counts: number[] = [1, 3, 6, 12],
): SettlementOption[] {
  /* Nothing to compare against: an offer that does not settle has no total to be measured. */
  if (offer.outcome !== 'settles' || offer.rows.length === 0) return []
  const out: SettlementOption[] = []
  for (const n of counts) {
    /* STRICTLY FASTER. Equal is their own offer said back to them, and slower is advice to pay
       more in total. */
    if (n >= offer.rows.length) continue
    const each = instalmentToSettleIn(input, n)
    if (each === null) continue
    const plan = repaymentPlan({ ...input, instalment: each, maxInstalments: n })
    if (plan.outcome !== 'settles') continue
    out.push({
      instalments: plan.rows.length,
      each,
      totalPaid: plan.totalPaid,
      totalCost: roundToCents(plan.totalInterest + plan.totalReceiptFees),
      /* Clamped at nought rather than allowed negative: a faster arrangement cannot cost more, and
         if rounding ever made it look like it did, "saves -R0.02" is not a sentence to put in
         front of somebody being asked for money. */
      saving: Math.max(0, roundToCents(offer.totalPaid - plan.totalPaid)),
    })
  }
  return out
}
