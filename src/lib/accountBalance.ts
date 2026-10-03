/**
 * What a debtor owes, and the statement that shows how.
 *
 * The balance is computed, never stored. That is the whole point: a debtor, a client or the
 * Council for Debt Collectors can ask how a figure was arrived at, and a stored number cannot
 * answer. Every line below traces to a row in one of the three ledgers.
 *
 * The formula, as the business states it and as the migrated book confirms:
 *
 *     balance   = capital handed over
 *               + interest accrued
 *               + fees, including VAT
 *               + the receipt fee on every payment already received
 *               - payments received
 *
 *     settlement = balance + the receipt fee on that balance
 *
 * The fourth line is the one that is easy to miss and impossible to leave out. Item 9 is charged
 * when each instalment arrives, not only at settlement — 10% of the instalment, capped at R610,
 * plus VAT. Checked against Swordfish's own closing figures across 735 migrated accounts:
 * without any receipt fee, **zero** accounts matched; with only the settlement fee, 232; with the
 * per-payment fee as well, 168 of 199 active accounts and 123 of 145 frozen ones agree to the
 * cent.
 *
 * The accounts that still disagree do so for two known reasons, both handled below and both
 * flagged rather than silently absorbed: in duplum, where accrual stops at the ceiling, and
 * write-off, where the account stopped and accrual stopped with it.
 */
import { receiptFeeInclVat, settlementReceiptFee, roundToCents, scheduleFor, type AnnexureBSchedule } from './annexureB.js'
import { accrueToDate, accrualEnd, coveredTo as lastCoveredDay, dayBefore } from './interestAccrual.js'
import { feeLabel } from './feeLabel.js'

export interface LedgerLines {
  /**
   * Every payment received, oldest first. Reversed payments are excluded by the caller.
   *
   * `receiptFeeExclVat` is the receipt fee as Swordfish actually charged it. Where it is given it
   * wins over the computed figure — see receiptFeeOn below for why that is the honest choice.
   */
  payments: {
    /**
     * The payment's own id, so an item 9 fee ROW can be matched to the payment it was raised on.
     * Absent on a projected payment -- repaymentPlan invents those, and an invented payment has no
     * fee row, which is exactly the case the computed figure exists for.
     */
    id?: string
    date: string
    amount: number
    paidToClient?: boolean
    receiptFeeExclVat?: number | null
  }[]
  /** Every fee raised. `inclVat` is what was actually charged. */
  fees: {
    date: string
    /**
     * The full timestamp, where there is one. Two fees raised on the same day are ordered by it —
     * without it they fall back on the order the database handed them over, which is newest
     * first, so a statement showed the second trace of the morning above the first.
     */
    at?: string
    description: string
    exclVat: number
    vat: number
    billed: boolean
    segments?: number
    /**
     * WHICH ANNEXURE B ITEM THIS IS, AND IT IS HERE BECAUSE OF A DOUBLE COUNT.
     *
     * A receipt fee is item 9 and `allocate_payment` writes it into account_fees like any other
     * fee -- so it arrived in this list AND was computed again from the payment by receiptFeeOn.
     * Every balance carrying receipt fees was overstated by exactly those fees: R 209 468,82
     * across 331 accounts on staging, R 13 169,80 on the worst of them. The firm found it on their
     * own test account -- "What is left to take" said R 624,51 of capital left and nothing else,
     * while the summary beside it said R 1 211,01, the difference being R 586,50 of receipt fees
     * counted twice.
     *
     * OPTIONAL, because a caller that synthesises a ledger has no item to give -- and undefined
     * behaves exactly as this did before, which keeps a projection honest rather than silently
     * reclassifying its invented fees.
     */
    annexureItem?: string | null
    /** The payment an item 9 fee was raised on, where it was raised on one. */
    paymentId?: string | null
    /** When the fee was cancelled, where it was. See `feeStands` -- a cancelled fee is usually
        not owed, and there is exactly one exception. */
    cancelledAt?: string | null
    /** What Swordfish called the action. Null on anything Raptor raised. Read only by
        `feeStands`, which is the one place it means anything. */
    legacyName?: string | null
  }[]
  /** Every interest accrual period. */
  interest: { from: string; days: number; amount: number }[]
}

export interface BalanceInput {
  /** Capital as at handover. The account opens here and everything else is movement. */
  capitalHandedOver: number
  handoverDate: string | null
  ledgers: LedgerLines
  /*
   * IN DUPLUM TOOK A SWITCH HERE AND NO LONGER DOES. See the ceiling below: the rule applies to
   * every account, so there is nothing to pass.
   */
  /** An account written off stops accruing on this date. */
  writtenOffAt?: string | null
  vatRate?: number
  /**
   * Annual interest rate as a percentage (24 = 24% a year). With `accrueTo` below, the balance
   * grows every day instead of standing still between monthly postings.
   */
  interestRateAnnual?: number
  /**
   * Accrue interest up to and including this day — today, on a screen. Absent means show the
   * book exactly as posted, which is what a historical statement wants.
   */
  accrueTo?: string | null
}

export interface BalanceBreakdown {
  capital: number
  interest: number
  fees: number
  /** Item 9 charged as each instalment arrived. */
  receiptFees: number
  /**
   * VAT contained in the fees and receipt fees above, so a statement can say how much of what it
   * shows is tax. Capital and interest carry none: we did not sell the debtor anything and
   * interest is not a supply. It is a component OF the figures above, never added to them.
   */
  vat: number
  payments: number
  /** What is owed today, before any settlement quotation. */
  balance: number
  /** Item 9 on the balance: what settling in full today would add. */
  settlementFee: number
  /** What it would cost to settle in full today. */
  settlement: number
  /** Set where a rule stopped the balance growing, so the number can be explained. */
  cappedBy?: 'in duplum' | 'written off'
  /** How much interest and fees the cap withheld. Nonzero only when `cappedBy` is set. */
  withheld: number
  /**
   * WHICH SIDE OF THE CEILING THE WITHHOLDING FELL ON, and the firm chose it.
   *
   * THE FIRM: "because interest doesn't charge VAT, it would be beneficial for us if the interest
   * continues to run, and if the interest runs, it takes interest rather than the Annexure B fees.
   * So the Annexure B fees is pushed out and the interest comes in... interest precedes Annexure B
   * fees in an in duplum scenario."
   *
   * THE CEILING IS A FIXED SUM AND THE ONLY QUESTION IS WHAT FILLS IT. A rand of Annexure B fee is
   * 87 cents to the firm and 13 to SARS; a rand of interest carries no VAT and is a whole rand. In
   * duplum caps the AGGREGATE of non-capital and says nothing about which component gives way, so
   * taking the interest first and letting the fees be the thing pushed out is the firm's to decide
   * -- and it is worth 13% of whatever the ceiling holds.
   *
   * REPORTED RATHER THAN NETTED OFF `fees`. What was CHARGED is a fact about the account and the
   * money panel's own vocabulary already separates charged from recoverable -- "charged / taken /
   * left / cannot take". These two say which bucket the "cannot take" belongs to.
   */
  withheldFees: number
  withheldInterest: number
  /**
   * Interest since the last posted accrual, computed to `accrueTo` and already included in
   * `interest` above. Kept separate so a statement can label the line as still running rather
   * than present it as charged.
   */
  interestAccruing: number
  /** Calendar days the accruing figure covers. Zero when nothing is accruing. */
  interestAccruingDays: number
  /** First day of the open period, for the statement line. */
  interestAccruingFrom: string | null
}

/**
 * The balance, with every component kept separate.
 *
 * Nothing is netted before it is returned: a statement has to show the receipt fees and the
 * payments as different things, and a caller that only wants the total can add them up.
 */
/**
 * TELLING A RECEIPT FEE FROM A COST, ONCE.
 *
 * ITEM 9 IS A FEE ROW LIKE ANY OTHER. `allocate_payment` writes it into account_fees when a
 * payment is split, so it arrives in `ledgers.fees` -- and `receiptFeeOn` then computed the very
 * same fee a second time off the payment. Both were added to the balance. The firm found it by
 * reading two panels on one screen: "What is left to take" said R 624,51 of capital and nothing
 * else outstanding, while the summary beside it said the balance was R 1 211,01. The difference
 * was R 586,50 -- their receipt fees, counted twice.
 *
 * THE ROW WINS WHERE THERE IS ONE, which is `receiptFeeOn`'s own rule stated at the level above
 * it: what was actually charged beats what would be computed. The computed figure is left for the
 * payments that carry no row -- a projected instalment in the repayment calculator, and any
 * migrated payment whose fee never became a row.
 *
 * READ ONCE AND SHARED, because computeBalance and buildStatement have to agree about this or the
 * statement's lines stop adding up to the figure at its foot -- which is the one thing a statement
 * may never do.
 */
/**
 * DOES A CANCELLED FEE STILL COUNT?
 *
 * THE FIRM, ON THE REVERSAL: "I agree when you reverse a payment that the receipt fee is removed."
 * So a cancelled fee comes off the balance. `reverse_payment_allocation` cancels the item 9 fee
 * on a reversed receipt, and until now `computeBalance` kept charging for it -- the debtor would
 * have gone on owing the receipt fee for a payment that had been taken back off their account.
 *
 * AND THERE IS EXACTLY ONE EXCEPTION, WHICH IS ALSO THE FIRM'S. "For the PTPs, there should be a
 * charge. You should charge that, keep that. If the guy breaks the promise to pay, he breaks it.
 * If he makes it again, he makes it again. But it's still an action and a consultation and
 * something that needs to be captured, and we're allowed and permissible to charge this."
 *
 * THEY ARE RIGHT AND THE DATA SHOWS WHY. 647 of the 846 cancelled fees on the book are Promise to
 * Pay rows -- 82% of every PTP row there is -- and the reasons on them are "Replaced by New PTP"
 * (433), "Failed PTP cancelled to activate Follow Up PTP", "Cancelled due to RTP", "Account
 * written off". Not one of those says the charge was withdrawn. They say the ARRANGEMENT ended,
 * which is the ordinary life of a promise to pay and exactly the case the firm describes. The
 * import wrote Swordfish's whole action log into account_fees, so the arrangement's cancellation
 * landed in the fee's cancelled_at column, and reading it as a fee cancellation would take
 * R 8 802,11 off 118 accounts for work that was genuinely done.
 *
 * SO IT IS NARROW ON PURPOSE: an imported Promise to Pay, and nothing else. The other 199 -- calls,
 * SMSs, letters, consultations, cancelled with "cancel", "wrong", "." -- are a collector undoing an
 * action they logged by mistake, and those come off, as does every cancellation Raptor makes
 * itself. That is R 51,75 across 67 accounts.
 *
 * TWO CASINGS ON THE BOOK, 'Promise to Pay' and 'Promise To Pay', so the comparison is folded --
 * matching one of them and not the other is a quiet R 13 difference nobody would ever find.
 *
 * THE TIDIER FIX IS THE FIRM'S TO AUTHORISE AND IS NOT THIS. Clearing cancelled_at on those 647
 * imported rows would make the rule "cancelled means cancelled" with no exception -- but it is a
 * correction to imported history, which CLAUDE.md says is decided case by case and never swept by
 * a migration. This reads the data differently; it does not change it.
 */
export function feeStands(fee: { cancelledAt?: string | null; legacyName?: string | null }): boolean {
  if (!fee.cancelledAt) return true
  return (fee.legacyName ?? '').trim().toLowerCase() === 'promise to pay'
}

/**
 * THE SYSTEMS WHOSE FEES ARE THE ONLY RECORD OF THE WORK.
 *
 * THE FIRM, looking at an account where every call had a charge line under it: "still showing the
 * charges on the notes is not necessary." They had said it once before, of the workflow notes --
 * "don't have to say about the charges in the notes", quoted in accountSms -- and this is the
 * other half of the same instruction.
 *
 * WHY IT IS A LIST OF SYSTEMS AND NOT A FLAG ON THE SCREEN. Every place Raptor charges something
 * writes a note in the same function, in the firm's words: accountCalls writes "Called 011 592
 * 0520", accountSms writes the message, accountPromises writes the arrangement, accountTrace
 * writes what came back. The fee beside those is the machine's half of an action already on the
 * timeline, so the row says nothing a collector did not just read one line up -- which is what the
 * firm is looking at and what they are right about.
 *
 * AN IMPORTED FEE HAS NO SUCH NOTE. The export carried 59 215 fees and 1 523 notes, so on a
 * migrated account the fee ledger IS the contact history: "Letter sent, 12/03/2021" exists as a
 * fee row and nowhere else. Dropped, six years of work would leave the timeline and the account
 * would read as though nothing had ever been done on it.
 *
 * SO IT IS NOT A MATTER OF TASTE, IT IS WHETHER ANYTHING ELSE SAYS IT HAPPENED. `source` already
 * answers that -- it is written by the importer and by chargeEngine, and the finance health report
 * already leans on it to tell an inherited fault from ours. A second legacy system is one entry
 * here; check-timeline holds the list against the importer.
 *
 * UNATTRIBUTED COUNTS AS OURS. The column's table default is 'action' and nothing writes it
 * deliberately. A row we cannot vouch for is still on the statement and still under the Annexure B
 * ceiling, where money belongs; drawing it here on the chance it might be history is how the
 * firm's complaint comes back.
 */
export const IMPORTED_FEE_SOURCES: readonly string[] = ['swordfish']

/**
 * Is this fee the account's only record of the action behind it?
 *
 * The timeline draws a fee line only where the answer is yes. Nothing else uses it: the statement,
 * the transaction list and the fee ceiling show every fee regardless, because they are about money
 * and this one question is about the story.
 */
export function feeIsTheOnlyRecord(fee: { source?: string | null }): boolean {
  return IMPORTED_FEE_SOURCES.includes(fee.source ?? '')
}

function splitFeeLedger(ledgers: LedgerLines) {
  /*
   * FILTERED HERE AND NOWHERE ELSE, because computeBalance and buildStatement both read this and
   * they have to agree -- a statement whose lines do not add up to the figure at its foot is the
   * one thing a statement may never do.
   */
  const live = ledgers.fees.filter(feeStands)
  const receiptRows = live.filter((f) => f.annexureItem === '9')
  const costRows = live.filter((f) => f.annexureItem !== '9')
  /*
   * Which payments already have their fee as a row, so it is not computed for them as well.
   *
   * FROM EVERY ITEM 9 ROW, CANCELLED ONES INCLUDED, and that is the half that is easy to get
   * wrong. A cancelled receipt fee is not owed -- so it is out of `receiptRows` above -- but it
   * still MEANS this payment's fee was raised as a row. Built from the live rows only, a cancelled
   * receipt fee would drop out of the total and `receiptFeeOn` would immediately compute the same
   * fee back off the payment: the reversal would take a fee off and put it straight back on, and
   * the two halves would look correct read separately.
   */
  const covered = new Set(
    ledgers.fees.filter((f) => f.annexureItem === '9')
      .map((f) => f.paymentId).filter((id): id is string => !!id),
  )
  return { receiptRows, costRows, covered }
}

export function computeBalance(input: BalanceInput): BalanceBreakdown {
  const { capitalHandedOver: capital, ledgers, vatRate = 0.15 } = input
  const stopAt = input.writtenOffAt ?? null

  const within = (date: string) => !stopAt || date <= stopAt

  const interest = roundToCents(
    ledgers.interest.filter((i) => within(i.from)).reduce((t, i) => t + i.amount, 0),
  )
  const { receiptRows, costRows, covered } = splitFeeLedger(ledgers)
  /* `fees` IS ITEMS 1-7 ONLY now, which is what the account's own "What is left to take" panel
     has always called it. Item 9 is counted below, once. */
  const chargedFees = costRows.filter((f) => within(f.date))
  const fees = roundToCents(chargedFees.reduce((t, f) => t + f.exclVat + f.vat, 0))
  const feeVat = roundToCents(chargedFees.reduce((t, f) => t + f.vat, 0))
  const payments = roundToCents(ledgers.payments.reduce((t, p) => t + p.amount, 0))

  const receiptFees = roundToCents(
    /* What was actually charged... */
    receiptRows.filter((f) => within(f.date)).reduce((t, f) => t + f.exclVat + f.vat, 0)
    /* ...plus the computed figure for the payments that carry no row of their own. */
    + ledgers.payments.reduce(
      (t, p) => t + (p.id && covered.has(p.id) ? 0 : receiptFeeOn(p, vatRate)), 0,
    ),
  )

  /*
   * EVERY MOVEMENT, DATED, for the open period to run over.
   *
   * It used to be handed one number -- capital + interest + fees + receiptFees - payments -- which
   * is the balance TODAY, not the balance the period opened on. That was harmless while the open
   * period was the handful of days since the last monthly posting. It is not harmless now that the
   * period can start at the handover: see openAccrual.
   *
   * A payment and the receipt fee it attracts are ONE movement because they are one day: the net of
   * them is what the balance actually did. The computed half is only for payments carrying no item 9
   * row of their own -- the same `covered` set the totals above use, so the fee cannot be counted
   * here and there.
   */
  const movements: { date: string; amount: number }[] = [
    ...chargedFees.map((f) => ({ date: f.date, amount: f.exclVat + f.vat })),
    ...receiptRows.filter((f) => within(f.date))
      .map((f) => ({ date: f.date, amount: f.exclVat + f.vat })),
    ...ledgers.payments.map((p) => ({
      date: p.date,
      amount: -p.amount + (p.id && covered.has(p.id) ? 0 : receiptFeeOn(p, vatRate)),
    })),
  ]

  // Interest between the last posted accrual (or the handover) and today. Computed, never written:
  // see interestAccrual.ts for why a daily figure does not need a daily row.
  const open = openAccrual(input, roundToCents(capital + interest), movements)

  const nonCapital = interest + open.amount + fees + receiptFees
  let cappedBy: BalanceBreakdown['cappedBy']
  let withheld = 0

  /*
   * IN DUPLUM, AND IT IS NOT A SETTING.
   *
   * Non-capital may not exceed the capital outstanding when the debt was handed over. The ceiling
   * is fixed there and never recalculated as the balance falls (§5).
   *
   * ------------------------------------------------------------------------------------------
   * IT USED TO BE GATED ON A COLUMN THAT ANSWERS A DIFFERENT QUESTION
   * ------------------------------------------------------------------------------------------
   *
   * THE FIRM, looking at RRC00005: "in duplum is still not working here." It was not, and the
   * reason is the oldest fault in this codebase -- a column standing in for an answer.
   *
   * `debtor_accounts.in_duplum` is Swordfish's "In Duplum" column, Yes or No, and in Swordfish it
   * means THIS ACCOUNT HAS REACHED THE CEILING. It was read here as "this account is SUBJECT to
   * the rule", which is a different question -- and one whose answer is yes on every account.
   * So every account Raptor created carried `false`, no ceiling engaged, and RRC00005 sat R61,91
   * past its own with nothing on the screen saying so. The ceiling itself was sitting in
   * `in_duplum_ceiling` beside it, correctly set to the R380 capital, used by nothing.
   *
   * WORSE THAN NOT CAPPING: THE NOTICE AND THE SCREEN DISAGREED. `api/_lib/workflow/step.ts`
   * passed `inDuplum: true` unconditionally, because whoever wrote it knew the rule has no
   * exception -- so a section 129 on that account quoted R760,00 while the account page beside it
   * said R821,91. Two figures for one debt, and the one the debtor was holding was the other one.
   *
   * AND THE RULE REALLY HAS NO EXCEPTION. In duplum at COMMON LAW binds every debt there is:
   * arrear interest stops at the capital outstanding whatever the agreement was. NCA s103(5) is
   * the wider version -- interest, initiation and service fees, collection costs and default
   * charges, in aggregate -- and it binds credit agreements. Raptor applies the wider one to
   * everything. On a debt the NCA does not reach that under-recovers rather than over-recovers,
   * which is an error the firm can correct case by case; the other direction is money taken from a
   * debtor that a taxing master would order back.
   *
   * THE READING STAYS DERIVED. Whether an account HAS reached the ceiling is `cappedBy` below,
   * computed from the figures rather than read off a flag -- which is what the pills and the
   * filter have always claimed to mean ("non-capital has reached the capital handed over").
   */
  let recoverableNonCapital = nonCapital
  /*
   * AND WHEN IT BINDS, INTEREST IS WHAT FILLS THE CEILING FIRST.
   *
   * THE FIRM: "because interest doesn't charge VAT, it would be beneficial for us if the interest
   * continues to run, and if the interest runs, it takes interest rather than the Annexure B fees.
   * So the Annexure B fees is pushed out and the interest comes in. The more interest there is, the
   * more money we make... interest precedes Annexure B fees in an in duplum scenario."
   *
   * THE TOTAL DOES NOT MOVE. The ceiling is the capital either way; what changes is the COMPOSITION
   * of what fills it, and that is worth the VAT. A rand of Annexure B fee is 87 cents to the firm
   * and 13 to SARS; a rand of interest carries none. On a capped account every rand of fee that
   * interest displaces is 13 cents the firm keeps instead of remitting.
   *
   * IT IS THE FIRM'S TO CHOOSE. NCA s103(5) caps the aggregate of interest, fees and costs; it is
   * silent on which of them gives way, so appropriating the ceiling to interest first is a
   * commercial decision rather than a reading of the statute. They have made it.
   *
   * AND THE CEILING IS STILL MEASURED INCLUDING VAT, which the firm settled in the same breath:
   * "whether or not there's VAT or not, in duplum reached is in duplum reached." The VAT question
   * was whether to carve it out of the MEASUREMENT; the answer is no. What it buys is the order.
   */
  let withheldFees = 0
  let withheldInterest = 0
  if (nonCapital > capital) {
    recoverableNonCapital = capital
    withheld = roundToCents(nonCapital - capital)
    /* INTEREST TAKES WHAT IT CAN, up to the whole ceiling where interest alone exceeds it -- and
       the fees are what is left over, which may be nothing at all. */
    const allInterest = roundToCents(interest + open.amount)
    const interestKept = Math.min(allInterest, capital)
    withheldInterest = roundToCents(allInterest - interestKept)
    withheldFees = roundToCents(withheld - withheldInterest)
    cappedBy = 'in duplum'
  } else if (stopAt) {
    cappedBy = 'written off'
    withheld = roundToCents(
      ledgers.interest.filter((i) => !within(i.from)).reduce((t, i) => t + i.amount, 0)
      /* THE SAME FILTER, or "withheld" counts fees the balance above it has already dropped and
         the account explains itself with a figure that is not in it. */
      + ledgers.fees.filter((f) => feeStands(f) && !within(f.date))
        .reduce((t, f) => t + f.exclVat + f.vat, 0),
    )
  }

  const balance = roundToCents(capital + recoverableNonCapital - payments)

  /*
   * The receipt fee on a settlement is a FEE, so in duplum binds it like every other fee.
   *
   * It used to be worked out on the capped balance and then added to it, which quietly put the
   * settlement figure above the ceiling the cap had just enforced — the rule applied to the
   * balance and then abandoned one line later. Once non-capital has reached the capital there is
   * no headroom left, so the fee for settling is nil: the debtor pays the ceiling and no more.
   * Where the cap is close but not yet reached, only the part of the fee that still fits is
   * charged.
   */
  const headroom = Math.max(0, roundToCents(capital - recoverableNonCapital))
  const settlementFee = balance > 0 ? Math.min(settlementReceiptFee(balance, vatRate), headroom) : 0

  // The VAT already inside `fees` and `receiptFees`. A receipt fee is charged VAT-inclusive, so
  // its tax is the inclusive amount less the amount it grossed up from — not the amount times
  // the rate, which would overstate it by the rate squared.
  const receiptFeeVat = roundToCents(receiptFees - receiptFees / (1 + vatRate))

  return {
    capital,
    interest: roundToCents(interest + open.amount),
    fees,
    receiptFees,
    vat: roundToCents(feeVat + receiptFeeVat),
    payments,
    balance,
    settlementFee,
    settlement: roundToCents(balance + settlementFee),
    cappedBy,
    withheld,
    withheldFees,
    withheldInterest,
    interestAccruing: open.amount,
    interestAccruingDays: open.days,
    interestAccruingFrom: open.from,
  }
}

/**
 * The open interest period, or nothing.
 *
 * Nothing is the answer more often than not: an account with no rate, an account already written
 * off (accrual stopped when it did), a caller reprinting a historical statement, or a book that
 * is already current. Each of those has to produce a real zero rather than an accidental one, so
 * they are all decided here in one place.
 *
 * WHERE THE CLOCK STARTS WHEN NOTHING HAS BEEN POSTED: THE HANDOVER DATE. The firm: "normally,
 * interest starts occurring from the date of handover." An imported account continues from its last
 * posted accrual, because that history already ran; an account Raptor captured itself has no posted
 * accrual and never will until a payment posts one, so `covered` falls back to the day BEFORE the
 * handover and the first accruing day is the handover itself.
 *
 * THIS WAS LEFT UNBUILT FOR ONE REASON AND THE REASON IS NOW ANSWERED. The blocker was arithmetic,
 * not policy: this function used to be handed a single closing balance with every fee and payment
 * already folded into it, so accruing sixteen months from the handover would have charged interest
 * from day one on a fee raised in month eight and never given back the months after a payment. So
 * the balance is no longer handed over as one number. The posted base comes in, every fee and
 * payment comes in DATED, and whatever falls on or before the anchor joins the opening balance
 * while the rest is handed to the engine as movements on their own days. The reading is the one
 * that cannot overcharge a debtor: money bears interest from the day it is owed and stops on the
 * day it is paid.
 *
 * WHAT THIS CHANGES: 23 039 of the 23 774 live accounts on staging have no posted accrual, every
 * one of them has a handover date and a rate, and every one of them was standing still. Only three
 * of those are imported -- the other 23 036 are accounts Raptor captured or seeded itself, which is
 * to say every account the firm opens from here on.
 *
 * `interest_from` IS DELIBERATELY NOT READ. See rule 2 in interestAccrual.ts: it records what the
 * client told us about their own book, and using it as a start date would have Raptor recompute
 * interest the client already charged and already folded into the capital.
 */
function openAccrual(
  input: BalanceInput,
  /** Capital plus every posted accrual: what the account owed before anything below moved it. */
  postedBase: number,
  /** Every fee as a debit and every payment as a credit, each on its own day. */
  movements: { date: string; amount: number }[],
): { amount: number; days: number; from: string | null } {
  const none = { amount: 0, days: 0, from: null }
  if (!input.accrueTo || input.writtenOffAt) return none
  const covered = lastCoveredDay(input.ledgers.interest)
    ?? (input.handoverDate ? dayBefore(input.handoverDate) : null)
  /* Still nothing to run from: an account with neither a posted accrual nor a handover date has no
     day the firm can point at as the one the debt became theirs, and inventing one -- today, the
     day the row was created -- would charge a debtor for days nobody can evidence. */
  if (!covered) return none

  /* The anchor splits the ledger in two. On or before it, the money is part of what the period
     opens on; after it, the money lands during the period and the engine has to see the day. */
  let opening = postedBase
  const inside: typeof movements = []
  for (const m of movements) {
    if (m.date <= covered) opening += m.amount
    else inside.push(m)
  }

  const open = accrueToDate({
    openingBalance: roundToCents(opening),
    annualRate: input.interestRateAnnual ?? 0,
    coveredTo: covered,
    asAt: input.accrueTo,
    movements: inside,
  })
  return open ? { amount: open.amount, days: open.days, from: open.from } : none
}

/**
 * The receipt fee on one payment, VAT included.
 *
 * Two sources, and the recorded one wins. Item 9 is 10% of the instalment capped by the schedule
 * in force the day it arrived — a payment taken in 2024 carries the R509 maximum, not today's
 * R610 — and that is what Raptor charges on anything it takes in itself.
 *
 * But the migrated book was not charged by Raptor. Swordfish billed those debtors at a maximum of
 * R502 from December 2023 until the end of March 2026, seven rand under the gazetted figure,
 * because the number was entered wrong. Recomputing history from the gazette would produce a
 * balance the debtor was never billed and the client has never seen. So where the export tells us
 * what was actually charged, that figure stands; the computed one is for payments taken from here
 * on, and for the older export, which did not carry a commission at all.
 */
function receiptFeeOn(
  p: { date: string; amount: number; receiptFeeExclVat?: number | null },
  vatRate: number,
  schedule?: AnnexureBSchedule,
): number {
  // A recorded commission is already exact to the cent excluding VAT, so grossing it up rounds
  // once. The computed branch goes through receiptFeeInclVat for the same reason: rounding the
  // exclusive figure first and charging VAT on the rounded number costs a cent on any payment
  // whose ten percent lands on a fraction.
  if (p.receiptFeeExclVat != null) return roundToCents(p.receiptFeeExclVat * (1 + vatRate))
  return receiptFeeInclVat(p.amount, vatRate, schedule ?? scheduleFor(p.date))
}

export type StatementKind =
  | 'handover'
  | 'interest'
  /** Interest since the last posting, computed to today and not yet charged. */
  | 'interest-accruing'
  | 'fee'
  /**
   * AN ACTION THAT EARNED NOTHING, and it is on the statement on purpose.
   *
   * THE FIRM: "it stops charging things... the last one was charged the 13th of September but a
   * lot of things happened after that, now I can't see them. I don't know how we're going to
   * report on that. Maybe we put it there and we have a zero charge that reflects on the
   * statement."
   *
   * THEY ARE RIGHT AND THIS USED TO BE DROPPED. Past the Annexure B ceiling every further action
   * is free -- recoverableFee trims the fee that crosses the line and everything after it earns
   * nothing -- and the row IS written, at nought, with `billed` false. The statement then skipped
   * it, on the reasoning that it "belongs in the account's activity, not on a statement of what is
   * owed". Which is true about the BALANCE and wrong about the statement: this is the page a
   * client reads to see what has been done, and a firm that emails a debtor eleven times after the
   * ceiling and shows a client nothing after 13 September looks like a firm that stopped working.
   */
  | 'fee-no-charge'
  | 'receipt-fee'
  | 'payment'

export interface StatementLine {
  date: string
  kind: StatementKind
  description: string
  /** Increases what is owed. */
  debit: number
  /** Reduces what is owed. */
  credit: number
  /** What is owed after this line. */
  balance: number
}

export interface Statement {
  lines: StatementLine[]
  breakdown: BalanceBreakdown
  /** Set where a rule stopped the balance growing partway down the statement. */
  note?: string
}

/**
 * Every movement on the account, in date order, with a running balance.
 *
 * This is the document a debtor is entitled to and a client asks for: the opening capital, then
 * every fee, every accrual and every payment as its own dated line, ending at what is owed. A
 * statement that showed only totals would be a claim; this is the working.
 *
 * A payment carries two lines, not one — the payment itself and the receipt fee it attracted —
 * because they are different transactions with different payers, and netting them would hide a
 * fee the debtor is entitled to see charged.
 */
export function buildStatement(input: BalanceInput, schedule?: AnnexureBSchedule): Statement {
  const { capitalHandedOver: capital, ledgers, vatRate = 0.15 } = input
  const breakdown = computeBalance(input)
  const stopAt = input.writtenOffAt ?? null
  /* THE SAME SPLIT THE BALANCE USED. The statement printed the item 9 ROW as an ordinary fee and
     then printed the computed receipt fee under the payment as well -- the same fee on two lines,
     and a running balance that ended at the doubled figure. */
  const { receiptRows, costRows, covered } = splitFeeLedger(ledgers)

  type Pending = Omit<StatementLine, 'balance'> & { at?: string }
  const pending: Pending[] = []

  if (input.handoverDate) {
    pending.push({
      date: input.handoverDate,
      kind: 'handover',
      description: 'Capital handed over',
      debit: capital,
      credit: 0,
    })
  }

  /*
   * Dated at the END of the period it covers, and labelled with that period.
   *
   * Interest is earned across a stretch of days and posted once at the close of it, which is
   * where Swordfish puts it: ACF10044's R36.88 for August sits on 31 August on the statement the
   * debtor was sent. Dating it at the start put the same money a month earlier and sorted it
   * above the fees it had actually accrued on, so a reissued statement did not match the
   * original — and the day count on its own said nothing about which days were meant.
   *
   * The count is Swordfish's exclusive offset, not a number of days: 1 September for 6 covers to
   * the 7th, seven days. Printing it as "6 days" was reading that field as if it meant what it
   * says. `accrualEnd` holds the convention.
   */
  for (const i of ledgers.interest) {
    if (stopAt && i.from > stopAt) continue
    if (i.amount === 0) continue
    const to = accrualEnd(i.from, i.days)
    pending.push({
      date: to,
      kind: 'interest',
      description: `Interest, ${periodLabel(i.from, to)}`,
      debit: i.amount,
      credit: 0,
    })
  }

  // The open period, dated today and marked as still running. It is the last debit on the
  // statement by construction: nothing can be dated after the day it is accrued to.
  if (breakdown.interestAccruing > 0 && input.accrueTo) {
    const from = breakdown.interestAccruingFrom
    pending.push({
      date: input.accrueTo,
      kind: 'interest-accruing',
      // Pull the statement on the 7th and this reads "1 to 7 September": the days since the last
      // posting are on the page, named, rather than left for the reader to work out from a count.
      description: from
        ? `Interest, ${periodLabel(from, input.accrueTo)} — still accruing`
        : 'Interest — still accruing',
      debit: breakdown.interestAccruing,
      credit: 0,
    })
  }

  for (const f of costRows) {
    if (stopAt && f.date > stopAt) continue
    /*
     * AN ACTION PAST THE CEILING IS SHOWN AT NOUGHT RATHER THAN DROPPED. See `fee-no-charge`: the
     * work happened and the client is entitled to see it, even though it earned nothing. It adds
     * no debit, so the running balance does not move -- which is the honest picture, and the
     * ceiling line below explains the run of them rather than leaving a column of zeros to be
     * puzzled over.
     */
    /*
     * THE AMOUNT DECIDES IT, NOT `billed`.
     *
     * computeBalance above sums every fee's exclVat + vat without consulting the flag, which is
     * CORRECT under the imported-history rule: Swordfish's figures are what the client was
     * invoiced on, so a migrated row carrying money is money owed whatever else it says. Keying
     * the line off `billed` instead would draw a row at nought whose amount the balance had
     * already counted -- a statement whose lines do not add up to the figure at the bottom, which
     * is the one thing a statement may never be.
     *
     * FOUND BY WRITING THE OPPOSITE and watching "debits less credits equal the balance" fail.
     */
    const charged = roundToCents(f.exclVat + f.vat)
    pending.push({
      date: f.date,
      kind: charged > 0 ? 'fee' : 'fee-no-charge',
      at: f.at,
      description: feeLabel(f.description, f.segments),
      debit: charged,
      credit: 0,
    })
  }

  /*
   * THE FEE THAT WAS ACTUALLY RAISED, dated as the ledger dates it and described in its own words
   * -- "Receipt of instalment", which is what the firm's engine writes. It is a `receipt-fee` line
   * rather than a `fee` line so it still sorts under the payment that produced it.
   */
  for (const f of receiptRows) {
    if (stopAt && f.date > stopAt) continue
    const charged = roundToCents(f.exclVat + f.vat)
    if (charged <= 0) continue
    pending.push({
      date: f.date,
      kind: 'receipt-fee',
      at: f.at,
      description: feeLabel(f.description, f.segments),
      debit: charged,
      credit: 0,
    })
  }

  for (const p of ledgers.payments) {
    pending.push({
      date: p.date,
      kind: 'payment',
      description: p.paidToClient ? 'Payment received by client' : 'Payment received',
      debit: 0,
      credit: p.amount,
    })
    /* ONLY WHERE NO ROW COVERS IT -- see splitFeeLedger. A payment whose fee is already a row
       above would otherwise be charged for it twice on one page. */
    if (p.id && covered.has(p.id)) continue
    const fee = receiptFeeOn(p, vatRate, schedule)
    if (fee > 0) {
      pending.push({
        date: p.date,
        kind: 'receipt-fee',
        description: 'Receipt fee on payment',
        debit: fee,
        credit: 0,
      })
    }
  }

  /*
   * Date order, and within a date a fixed order of kinds. Two lines on the same day have no
   * inherent sequence, and letting them fall out in whatever order the ledgers were read in
   * would make the running balance jitter between one rendering and the next — the same
   * statement, reissued, showing different intermediate figures.
   */
  const rank: Record<StatementKind, number> = {
    /* A no-charge action sits with the fees, because that is what it would have been. */
    handover: 0, interest: 1, 'interest-accruing': 1, fee: 2, 'fee-no-charge': 2, payment: 3, 'receipt-fee': 4,
  }
  /*
   * Day, then kind, then the clock.
   *
   * Kind stays ahead of the clock deliberately: a payment and the receipt fee it produces share a
   * date and the fee has no time of its own, so ranking keeps them in the order that reads
   * correctly. The timestamp only breaks ties BETWEEN the same kind on the same day — which is
   * where two traces taken ten minutes apart were coming out backwards, because the fee ledger is
   * fetched newest-first and a stable sort kept it that way.
   */
  /*
   * AND THE HANDOVER OPENS IT, WHATEVER ITS DATE.
   *
   * THE FIRM: "it looks funny, like and disorganized. Things should happen chronologically, and it
   * didn't happen here." On the account they were reading, two payments dated 28 September sat
   * ABOVE "Capital handed over" on the 29th -- correct by date and nonsense to read, because the
   * statement opened with money coming off a debt that did not exist yet and a running balance
   * that went four thousand rand negative before the first debit.
   *
   * THE HANDOVER IS NOT A MOVEMENT, IT IS THE OPENING BALANCE. Every statement starts from what
   * was owed when the account arrived, and sorting it among the movements by date is what let a
   * back-dated payment get above it. It cannot be reached by an earlier line now.
   *
   * THE UNDERLYING DATA IS STILL WRONG WHERE THIS HAPPENS, and it is refused at the door rather
   * than tidied here -- record_manual_payment will not take a payment dated before the handover.
   * This is about how a statement reads; that is about what may be recorded.
   */
  const opening = (k: StatementKind) => (k === 'handover' ? 0 : 1)
  pending.sort((a, b) =>
    opening(a.kind) - opening(b.kind)
    || a.date.localeCompare(b.date)
    || rank[a.kind] - rank[b.kind]
    || (a.at ?? a.date).localeCompare(b.at ?? b.date))

  let running = 0
  const lines: StatementLine[] = pending.map(({ at: _at, ...l }) => {
    running = roundToCents(running + l.debit - l.credit)
    return { ...l, balance: running }
  })

  return {
    lines,
    breakdown,
    /*
     * AND IT NAMES WHICH CHARGE GAVE WAY, now that the firm has decided it: "interest precedes
     * Annexure B fees in an in duplum scenario", because interest carries no VAT. "Interest and
     * fees stopped" was true of the total and said nothing about the composition -- which is the
     * half worth 13% of the ceiling.
     */
    note: breakdown.cappedBy === 'in duplum'
      ? `At the in duplum ceiling. Interest takes it first, so ${money(breakdown.withheldFees)} of `
        + `Annexure B fees is not recoverable`
        + `${breakdown.withheldInterest > 0 ? `, and ${money(breakdown.withheldInterest)} of interest with it` : ''}`
        + `${breakdown.settlementFee === 0 ? ', and the receipt fee on a settlement falls away too' : ''}.`
      : breakdown.cappedBy === 'written off'
        ? `The account was written off on ${stopAt}. ${money(breakdown.withheld)} of later interest and fees is excluded.`
        : undefined,
  }
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * The period an interest line covers, as "1 to 7 September", or "20 July to 2 August" where it
 * crosses a month, or just "7 September" for a single day.
 *
 * No year: the date column beside it carries one, and a period long enough to span a new year
 * still reads unambiguously against it.
 */
function periodLabel(from: string, to: string): string {
  const day = (iso: string) => Number(iso.slice(8, 10))
  const month = (iso: string) => MONTH_NAMES[Number(iso.slice(5, 7)) - 1]
  if (from >= to) return `${day(to)} ${month(to)}`
  if (from.slice(0, 7) === to.slice(0, 7)) return `${day(from)} to ${day(to)} ${month(to)}`
  return `${day(from)} ${month(from)} to ${day(to)} ${month(to)}`
}

const money = (n: number) => `R${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
