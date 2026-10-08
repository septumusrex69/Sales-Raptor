/**
 * THE FIRM'S OWN FORMULAS, AND THE RULES THAT REPORT THEM BROKEN.
 *
 * THE FIRM, having looked at the first imported payment run: "you can build in testing mechanisms
 * and start building in testing mechanisms. For example, A minus B equals C... These formulas are
 * the key and they are the rules about how which we will abide. And they will ensure that
 * everything is done fine. IF ANYTHING TOUCHES A FORMULA, THERE IS A PROBLEM."
 *
 * ------------------------------------------------------------------------------------------------
 * A CHECKER HAS TWO FAILURE MODES AND BOTH ARE HERE
 * ------------------------------------------------------------------------------------------------
 *
 * It can MISS something -- a payment whose figures contradict each other and it says nothing. And
 * it can CRY WOLF -- a violation on a payment where nothing is wrong, which is worse than no
 * check at all, because CLAUDE.md is right that people stop reading a warning that fires when
 * nothing is wrong, and then miss the real one. So every rule below is tested in BOTH directions:
 * silent on the firm's own worked case, and named on exactly one broken figure.
 *
 * THE BASE CASE IS REAL. It is RRC00007 at R2 500 on 5 October 2026, read straight out of
 * `preview_allocation` on staging -- not figures invented to satisfy the rules. The whole point of
 * the exercise was the firm saying "let's try the payment run again, because I don't think that
 * some of these figures are right", so the arithmetic the rules pass has to be the arithmetic the
 * database actually produced.
 *
 * AND ONE CASE IS AN ACCOUNT AT ITS IN DUPLUM CEILING, because that is where the firm's literal
 * "a − b" is not the available figure and a check written to their note alone would fire on
 * correct arithmetic. RRC00005 carries R437,01 of fees against R380 of capital.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-allocation-rules.mjs
 */
import { readFileSync } from 'node:fs'
import {
  allocationOf, cents, checkAllocation, derivedComponent, feesSideTaking, receiptFeeInclusive,
} from '../../src/lib/allocationRules.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
/** The NAMES of the rules that fired, so a break test asserts which one rather than how many. */
const rules = (a) => checkAllocation(a).map((v) => v.rule).sort()

/* ------------------------------------------------------------------ the worked cases, as the
   database produced them. R2 500 on RRC00007: half is R1 250, interest takes R15,32, the receipt
   fee R287,50 and the Annexure B fees R554,89 -- R857,71 in all, so the fees side is UNDER half
   and the roll takes the difference to capital. */
const RRC7 = {
  payment: 2500,
  interestTotal: 15.32, interestCant: 0, interestRetained: 0,
  interestBefore: 15.32, toInterest: 15.32, interestAfter: 0,
  rfTotal: 287.50, rfCant: 0, rfRetained: 0, toReceiptFees: 287.50,
  feesTotal: 554.89, feesCant: 0, feesRetained: 0, toFees: 554.89,
  costsBefore: 554.89, costsAfter: 0, receiptFeeRaised: 287.50,
  capitalBefore: 1230.50, toCapital: 1230.50, capitalAfter: 0,
  commission: 307.63, commissionVat: 46.14, toClient: 876.73, dueToBf: 0,
  /* R2 500 settles the whole account: R15,32 + R287,50 + R554,89 + R1 230,50 = R2 088,21, and the
     R411,79 over is held as a credit rather than paid to the client. */
  excess: 411.79,
  paidToClient: false, commissionRate: 0.25, vatRate: 0.15,
}

/* R600 on RRC00005, which is AT ITS CEILING. R437,01 of fees ran; R57,01 of that can never be
   recovered because the non-capital may not exceed the R380 of capital outstanding. Half of R600
   is R300: interest takes R5,62 and the fees R294,38, so the fees side takes its whole half and
   R85,62 of fees is still outstanding afterwards. */
const RRC5 = {
  payment: 600,
  interestTotal: 5.62, interestCant: 0, interestRetained: 0,
  interestBefore: 5.62, toInterest: 5.62, interestAfter: 0,
  rfTotal: 69.00, rfCant: 0, rfRetained: 0, toReceiptFees: 0,
  feesTotal: 437.01, feesCant: 57.01, feesRetained: 0, toFees: 294.38,
  costsBefore: 380.00, costsAfter: 154.62, receiptFeeRaised: 69.00,
  capitalBefore: 380.00, toCapital: 300.00, capitalAfter: 80.00,
  commission: 75.00, commissionVat: 11.25, toClient: 213.75, dueToBf: 0,
  excess: 0,
  paidToClient: false, commissionRate: 0.25, vatRate: 0.15,
}

const of = (base, over = {}) => allocationOf({ ...base, ...over })

/* ================================================================== THE PASSES */
ok('the firm’s worked R2 500 obeys every rule', checkAllocation(of(RRC7)).length === 0)
ok('an account at its in duplum ceiling obeys every rule too', checkAllocation(of(RRC5)).length === 0)

/*
 * AND A PAYMENT THE CLIENT TOOK DIRECTLY, which is the other branch of the last three rules. The
 * firm has the money, so nothing is paid over and what the firm recovered is owed to it instead.
 */
const direct = of(RRC7, {
  paidToClient: true, toClient: 0,
  dueToBf: 15.32 + 287.50 + 554.89 + 307.63,
})
ok('a payment the client took directly obeys every rule', checkAllocation(direct).length === 0)

/*
 * A BANDED CLIENT HAS NO ONE RATE, and the commission rule has to stay quiet rather than guess.
 * finance_commission prices marginal bands like tax brackets; there is no single multiplication
 * to check against, and asserting one would fire on every banded client the firm has.
 */
ok('a banded client’s commission is not second-guessed',
  checkAllocation(of(RRC7, { commissionRate: null, commission: 299.99, toClient: 885.51,
    commissionVat: 45.00 })).length === 0)

/* ================================================================== THE SHAPE OF A COMPONENT */
check('available is the run less the ceiling less what was retained',
  derivedComponent(437.01, 57.01, 0, 294.38).available, 380)
check('after is available less what is taken',
  derivedComponent(437.01, 57.01, 0, 294.38).after, 85.62)
check('the receipt fee is shown including VAT', receiptFeeInclusive(250, 0.15), 287.50)
check('the fees side is the three of them added', feesSideTaking(of(RRC7)), 15.32 + 287.50 + 554.89)

/* ================================================================== THE BREAK TESTS
 *
 * CLAUDE.md's convention, and the reason this file is worth having: after writing a check, break
 * the thing it guards and confirm it fails. A check that passes on broken code is worse than none.
 * Each case below moves ONE figure and asserts the EXACT rule that fires -- a count would pass
 * just as happily if the wrong rule caught it.
 */

/* A. THE FIRM'S FIRST FORMULA. The engine says R15,32 of interest is available; the four figures
      behind it say R20,00 ran with nothing refused and nothing retained. One of the two is wrong
      and the screen must not pick. */
check('A. interest available disagreeing with the run is named',
  rules(of(RRC7, { interestTotal: 20 })),
  ['Interest: available is total, less what the ceiling refuses, less retained'])

/* B. a − b − c = after. R1,21 left on an interest line that was taken in full. */
check('B. interest left over after taking all of it is named',
  rules(of(RRC7, { interestAfter: 1.21 })),
  /* AND THE SECOND NAME IS NOT NOISE. A fees side under half is only right once everything on it
     is settled, and R1,21 of interest outstanding is the thing that is not. One wrong figure
     SHOULD light both: the second is what it means. */
  ['Interest: after is available less what is taken',
    'The fees side only takes less than half once it is settled'])

/* C. NOTHING TAKES MORE THAN IS THERE. This is the double-count: the receipt fee was once charged
      into account_fees AND computed again off the payment, and every balance carrying one was
      overstated by exactly that fee. */
check('C. a fee line taking more than it has is named',
  rules(of(RRC7, { toReceiptFees: 400, toFees: 442.39 })).filter((r) => r.startsWith('Receipt fee')),
  ['Receipt fee: after is negative', 'Receipt fee: cannot take more than is available'])

/* D. THE DERIVED SPLIT HELD AGAINST THE ENGINE'S ONE POOL. `to_costs` is a single number and which
      fee inside it was paid is recorded nowhere, so the two fee lines are a derivation -- this is
      the rule that makes a wrong derivation findable instead of believable. Here the ordering has
      paid R100 of the receipt fee that the pool did not have to give. */
check('D. two fee lines that do not add back to the pool are named',
  rules(of(RRC7, { rfTotal: 387.50, toReceiptFees: 387.50, toFees: 454.89 })),
  [
    /* The derivation left R100 of Annexure B fees unpaid to pay a receipt fee the pool did not
       have, so the fees side also reads as under half with something still outstanding. */
    'The fees side only takes less than half once it is settled',
    'The receipt fee and the fees are the costs pool, split',
    'What is left on the two fee lines is what is left on the pool',
  ])

/* E. THE WHOLE PAYMENT IS ACCOUNTED FOR. A rand that paid nothing and is not held as a credit has
      gone missing between the debtor and the client -- the one failure on this screen nobody could
      reconstruct afterwards. */
check('E. a payment that does not add back is named',
  rules(of(RRC7, { excess: 410.79 })),
  ['Client, firm and SARS add back to the payment', 'The payment is fully accounted for'])

/* F. FIFTY-FIFTY, THE UPPER HALF. The firm: "it's 50-50 unless the fees are less than 50% of the
      payment." On RRC00005 the fees side already takes its whole R300; taking R301 is taking from
      capital's half. */
check('F. a fees side over half is named',
  rules(of(RRC5, { toFees: 295.38, costsAfter: 153.62, toCapital: 299, capitalAfter: 81,
    commission: 74.75, commissionVat: 11.21, toClient: 213.04 })),
  /* The rand the fees side took came out of capital's half, so capital is a rand short of it --
     which is the same error read from the other side, and the pair is the whole story. */
  ['Capital takes at least its half', 'The fees side never takes more than half'])

/* G. FIFTY-FIFTY, THE LOWER HALF. Under half is only right once there is nothing left on the fees
      side to pay. Here R100 of Annexure B fees is outstanding and the roll went to capital anyway
      -- the roll going the wrong way, which is a debtor's fees left unpaid while the client is
      paid early. */
check('G. a fees side under half with fees still outstanding is named',
  rules(of(RRC7, { feesTotal: 654.89, costsBefore: 654.89, costsAfter: 100 })),
  ['The fees side only takes less than half once it is settled'])

/* H. CAPITAL NEVER TAKES LESS THAN ITS OWN HALF. The roll only ever moves money TOWARDS capital. */
check('H. capital short of its half is named',
  rules(of(RRC5, { toCapital: 200, capitalAfter: 180, commission: 50, commissionVat: 7.50,
    toClient: 142.50, excess: 100 })),
  ['Capital takes at least its half'])

/* I. CAPITAL OUTSTANDING IS WHAT IT WAS LESS WHAT WAS TAKEN -- the line item the firm found
      missing, and the one subtraction on it. */
check('I. capital outstanding that does not come down by what was taken is named',
  rules(of(RRC7, { capitalAfter: 50, excess: 461.79 })).filter((r) => r.startsWith('Capital')),
  ['Capital outstanding is what it was less what was taken'])

/* J. COMMISSION IS ON CAPITAL AND ON NOTHING ELSE. Priced on the whole receipt instead, the client
      is charged for the firm recovering its OWN fees. */
check('J. commission priced on more than capital is named',
  rules(of(RRC7, { commission: 625, commissionVat: 93.75, toClient: 511.75 })),
  ['Commission is the rate on capital recovered'])

/* K. VAT IS THE RATE ON THE COMMISSION. */
check('K. VAT that is not the rate on the commission is named',
  rules(of(RRC7, { commissionVat: 50, toClient: 872.87 })),
  ['VAT is the rate on the commission'])

/* L. THE CLIENT IS PAID CAPITAL LESS COMMISSION AND ITS VAT. */
check('L. a client paid the wrong figure is named',
  rules(of(RRC7, { toClient: 900 })),
  ['Client, firm and SARS add back to the payment',
    'The client is paid capital less commission and its VAT'])

/* M. AND NOTHING IS OWED BY A CLIENT ON MONEY THE FIRM RECEIVED. due_to_bf on an ordinary receipt
      is a set-off invoiced on money the firm already has -- billed twice. */
check('M. a set-off on money the firm received is named',
  rules(of(RRC7, { dueToBf: 877.71 })),
  ['Nothing is owed by the client on money the firm received'])

/* N. AND THE SAME, THE OTHER WAY ROUND: a client who took the money directly being paid over. */
check('N. a payover on money the client already has is named',
  rules({ ...direct, toClient: 876.73 }),
  ['Nothing is paid over on money the client already has'])

/* O. NO FIGURE ON THIS SCREEN IS NEGATIVE. A negative retained is a reversal counted twice. */
check('O. a negative figure is named',
  rules(of(RRC7, { interestRetained: -5, interestTotal: 10.32 })),
  ['Interest: retained is negative'])

/* ================================================================== AND THE SQL BEHIND IT
 *
 * The four figures the rules subtract come out of `preview_allocation`, so a column dropped there
 * reads as `undefined` in the mapper and as 0,00 on the screen -- CLAUDE.md's own warning, and the
 * reason this is asserted here rather than trusted. An expansion of all-noughts looks like an
 * account with no history rather than like a bug.
 */
const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
function lastFn(name) {
  const at = Math.max(
    sql.lastIndexOf(`create or replace function public.${name}(`),
    sql.lastIndexOf(`create function public.${name}(`),
  )
  if (at < 0) return ''
  const end = sql.indexOf('\nend $$;', at)
  const sqlEnd = sql.indexOf('\n$$;', at)
  const stop = end >= 0 && (sqlEnd < 0 || end < sqlEnd) ? end : sqlEnd
  return stop < 0 ? sql.slice(at) : sql.slice(at, stop)
}
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')
const preview = strip(lastFn('preview_allocation'))
const queue = strip(lastFn('payments_awaiting_approval'))
/*
 * AND THE SPLIT ITSELF IS ITS OWN FUNCTION NOW, because allocate_payment has to write the same
 * answer onto the posted allocation. Two copies of that arithmetic would mean the approval screen
 * promising the firm one thing and the ledger recording another, found at month end -- the same
 * failure applyAccountFilters exists to prevent, applied to money.
 */
const feeSplit = strip(lastFn('fee_split'))
const payover = readFileSync(new URL('../../src/lib/payover.ts', import.meta.url), 'utf8')

/* THE FLOOR FIRST. An empty string satisfies every `.includes()` below, which is the vacuous pass
   this suite has been caught by before. */
ok('preview_allocation is in the schema', preview.length > 3000)
ok('payments_awaiting_approval is in the schema', queue.length > 1500)
ok('fee_split is in the schema', feeSplit.length > 1200)

/* EVERY ONE OF THE THREE SECTIONS, THROUGH ALL FOUR PLACES IT HAS TO BE NAMED: the preview's
   return type, the queue's return type, the queue's select list, and the hand-written mapper. */
const COLUMNS = [
  'interest_total', 'interest_cant', 'interest_retained',
  'rf_total', 'rf_cant', 'rf_retained', 'to_receipt_fees',
  'fees_total', 'fees_cant', 'fees_retained', 'to_fees',
  'costs_before', 'costs_after',
]
const missing = COLUMNS.filter((c) => !preview.includes(c))
check('every fee-section column is in preview_allocation', missing, [])
const notPassed = COLUMNS.filter((c) => !queue.includes(`pv.${c}`) || !queue.includes(`${c} numeric`))
check('and every one is passed through the approval queue', notPassed, [])
const CAMEL = {
  interest_total: 'interestTotal', interest_cant: 'interestCant',
  interest_retained: 'interestRetained',
  rf_total: 'rfTotal', rf_cant: 'rfCant', rf_retained: 'rfRetained',
  to_receipt_fees: 'toReceiptFees',
  fees_total: 'feesTotal', fees_cant: 'feesCant', fees_retained: 'feesRetained',
  to_fees: 'toFees', costs_before: 'costsBefore', costs_after: 'costsAfter',
}
const notMapped = COLUMNS.filter((c) => !payover.includes(`${CAMEL[c]}: Number(r.${c}`))
check('and every one is read by the row mapper', notMapped, [])

/* AND THE TWO RATES, which the commission rules cannot be written without. A rule that has to
   assume the rate it is checking against is not a rule. */
ok('the commission rate reaches the browser', queue.includes('commission_rate numeric')
  && payover.includes('commissionRate: r.commission_rate == null ? null'))
ok('the VAT rate reaches the browser', queue.includes('vat_rate numeric')
  && payover.includes('vatRate: Number(r.vat_rate'))

/*
 * THE SPLIT OF to_costs IS OLDEST FEE FIRST, the same ordering account_money_position uses. Two
 * orderings for one question is how the approval screen and the money position end up disagreeing
 * about which fee a payment paid.
 */
ok('the costs pool is split oldest fee first',
  /order by date\(r\.incurred_at\), r\.sk, r\.incurred_at, r\.id/.test(feeSplit))
/*
 * AND THE FEE THIS PAYMENT RAISES IS DATED THE DAY THE MONEY ARRIVED, not forced last.
 *
 * THE FIRST VERSION FORCED IT LAST, on the reasoning that it is the newest fee on the account --
 * and allocate_payment is the proof that was wrong: it inserts the item 9 row with
 * `incurred_at = v_pay.received_at`, the day the money was banked. So on a receipt banked on the
 * 12th and captured on the 29th the preview paid that fee last while the posting paid it in the
 * middle, the two disagreeing on exactly the payment somebody was already querying. `sk` now only
 * breaks the tie WITHIN the day, which is still right: the receipt fee is raised at the moment of
 * receipt, after whatever else was charged that day.
 */
ok('the receipt fee this payment raises is dated the day the money arrived',
  /coalesce\(p_new_fee_day, current_date\)::timestamptz/.test(feeSplit)
  && /select 1, '0{8}-/.test(feeSplit))
/* AND THE RECOVERABLE RULE IS THE ENGINE'S. engine_balances gathers the pool with fee_stands() and
   `billed is not false`, and it is that pool to_costs came out of; the money position view's
   plainer reading would make the two buckets fail to add back on an imported Promise to Pay. */
ok('what stands is decided by fee_stands, as the engine decides it',
  /public\.fee_stands\(f\.cancelled_at, f\.legacy_name\)/.test(feeSplit)
  && /f\.billed is not false/.test(feeSplit))
/* AND IN DUPLUM IS SPENT OLDEST-FIRST TOO, or an account at its ceiling shows more fees available
   than the engine will ever pay and the firm's own formula fires on correct arithmetic. */
ok('the in duplum ceiling is attributed to the oldest fees',
  feeSplit.includes('public.in_duplum_cost_room(p_account, p_interest_pending)')
  && /least\(greatest\(\(select mm from room\) - r\.raised_before, 0\), r\.incl\)/.test(feeSplit))
/*
 * AND BOTH THE SCREEN AND THE LEDGER ASK IT. This is the assertion that makes the shared function
 * worth having: either caller gathering the split itself would be the drift the sharing prevents.
 */
const allocate = strip(lastFn('allocate_payment'))
ok('allocate_payment is in the schema', allocate.length > 2000)
ok('the preview and the posting both ask fee_split',
  /public\.fee_split\(\s*p_account, p_exclude_payment/.test(preview)
  && /public\.fee_split\(\s*v_acct\.id, p_payment_id/.test(allocate))
/*
 * AND THE POSTING WRITES THE ANSWER RATHER THAN NOUGHT.
 *
 * `to_receipt_fee` and `to_fees` have been columns on payment_allocations since it was built and
 * allocate_payment passed literal `0, 0` for them -- so every payment the firm would ever have
 * approved recorded no answer at all to "did this pay its own receipt fee?", which is the one
 * question the three-way split exists to answer.
 */
ok('the posted allocation carries the split rather than zeroes',
  /k\.to_receipt_fees, k\.to_fees/.test(allocate) && !/\n\s*0, 0,\n/.test(allocate))
/* AND THE FIVE FIGURES BEHIND EACH LINE, so a payment can be checked next year against the book as
   it stood THEN rather than against one that has moved. */
const POSTED = ['interest_total', 'interest_cant', 'interest_retained', 'interest_before',
  'interest_after', 'rf_total', 'rf_cant', 'rf_retained', 'fees_total', 'fees_cant',
  'fees_retained', 'costs_before', 'costs_after']
check('the posted allocation stores what it was computed against',
  POSTED.filter((c) => !allocate.includes(c)), [])
/* AND THE AUDIT LIST HANDS ALL OF IT BACK, or the administrator cannot re-run a single formula. */
const posted = strip(lastFn('payments_posted'))
ok('payments_posted is in the schema', posted.length > 1500)
check('and every stored figure reaches the audit list',
  POSTED.filter((c) => !posted.includes(c)), [])
/* THE LEDGER'S OWN TOTALS COME WITH THEM, which is a different question from what the allocation
   says: an allocation can be internally perfect and sit on an account whose rows say otherwise. */
ok('the audit list also reads what the account itself adds up to',
  posted.includes('fees_raised') && posted.includes('interest_posted')
  && posted.includes('payments_banked'))
/* AND IT IS THE ADMINISTRATOR'S ALONE. This is security definer, so the guard has to be in the
   query -- row-level security does not apply to it. */
ok('the audit list is Administrator only',
  /public\.current_user_role\(\) = 'Administrator'/.test(posted))

/* ================================================================== AND THE SCREENS
 *
 * The firm asked for one column a section, expanding to the rest: "the column that you will be
 * showing to us is the interest that we are taking now. But if you click on the interest taking,
 * it expands all of the other columns just to double check."
 *
 * AND IT IS DRAWN BY ONE COMPONENT NOW, because two screens show these figures: the approval queue,
 * where the payment has not happened, and the administrator's check, where it has. CLAUDE.md's rule
 * about the same figures on two screens applies to the drawing as much as to the arithmetic --
 * written out twice, the queue and the audit list would quietly disagree about what a payment paid,
 * and the audit list is the one somebody would believe.
 */
const read = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8')
const bare = (t) => strip(t.replace(/\{\/\*[\s\S]*?\*\/\}/g, ''))
const sections = bare(read('components/finance/FeeSections.tsx'))
const queueScreen = bare(read('pages/finance/AwaitingApproval.tsx'))
const checkScreen = bare(read('pages/finance/CheckPayments.tsx'))

ok('the fee sections are one component', sections.length > 1500)
ok('the three sections are drawn in the order the money is spent',
  sections.includes("key: 'interest'")
  && sections.indexOf("key: 'interest'") < sections.indexOf("key: 'receiptFee'")
  && sections.indexOf("key: 'receiptFee'") < sections.indexOf("key: 'fees'"))
ok('taking now is the column, and it opens the other four',
  sections.includes('onToggle(sec.key)') && sections.includes('{sec.label} taking'))
check('and there are four figures behind a taking',
  (sections.match(/\{ label: '[a-z ]+', of: \(c\) => c\./g) ?? []).length, 4)
/* THE CEILING AMONG THEM, or the expansion does not add up on an in duplum account and the firm's
   own formula looks broken on correct arithmetic. */
ok('the ceiling is one of them', /label: 'ceiling refuses'/.test(sections))

/* AND BOTH SCREENS DRAW IT RATHER THAN THEIR OWN. A screen that kept a local copy would pass every
   assertion above while showing something else. */
/*
 * THE TWO SCREENS NO LONGER CARRY THE SAME NUMBER OF FIXED COLUMNS, so the count is stated per
 * screen rather than once. The approval queue gained a CLIENT column at the firm's asking -- the
 * queue mixes every client and every figure to the right of the payment is about one the row did
 * not name. The Check screen is about one receipt somebody has already chosen, so it does not.
 *
 * THE INVARIANT THAT MATTERS IS UNCHANGED AND IS THE NEXT ASSERTION: whatever the count, the three
 * fixed group spans must add up to it. That is what catches a heading shifted one column left, and
 * it is what caught the stale `colSpan={5}` when the client column went in.
 */
/*
 * THE APPROVAL QUEUE NO LONGER OPENS THE SECTIONS IN ITS TABLE. The firm's redesign made a row one
 * line of answers -- about three thousand payments a month -- and the four figures behind each fee
 * line moved into the breakdown drawer. They are still the SHARED definitions, which is what this
 * holds: the drawer draws SECTIONS and BEFORE, and keeps no copy of either.
 */
ok('the approval queue draws the shared fee definitions in its drawer',
  /import \{ BEFORE, SECTIONS \} from '\.\.\/\.\.\/components\/finance\/FeeSections'/.test(queueScreen)
  && /SECTIONS\.map\(/.test(queueScreen) && /BEFORE\.map\(/.test(queueScreen))
ok('...and keeps no copy of its own',
  !/\{ key: 'receiptFee'/.test(queueScreen) && !/label: 'ceiling refuses', of/.test(queueScreen))
/*
 * AND ITS GROUP HEADINGS STILL LINE UP -- the same failure as below, in a new table: a span one
 * short shifts every heading after it, so "To client" sits over the commission VAT. The group row
 * is the pinned lead plus six groups; the column row is two pinned cells plus one <Th> a column.
 */
{
  const thead = queueScreen.slice(queueScreen.indexOf('<thead'), queueScreen.indexOf('</thead>'))
  const groupRow = thead.slice(0, thead.indexOf('</tr>'))
  const headRow = thead.slice(thead.indexOf('</tr>') + 5)
  const lead = [...groupRow.matchAll(/colSpan=\{(\d+)\}/g)].map((m) => Number(m[1]))
  const groups = [...groupRow.matchAll(/<GroupHead span=\{(\d+)\}(?: note="[^"]*")?>([^<]+)</g)].map((m) => [m[2], Number(m[1])])
  check('the approval queue: the six column groups, in the order the money is spent',
    groups.map(([n]) => n), ['Payment', 'Interest and fees', 'Capital', 'Commission', 'Final split', 'Review'])
  const cols = (headRow.match(/<th\b/g) ?? []).length + (headRow.match(/<Th\b/g) ?? []).length
  check('the approval queue: the group spans cover every column',
    lead.reduce((a, b) => a + b, 0) + groups.reduce((a, [, n]) => a + n, 0), cols)
  /* AND THE BODY HAS A CELL FOR EACH: two pinned <td>s and one <Td> a column. */
  const tbody = queueScreen.slice(queueScreen.indexOf('<tbody'), queueScreen.indexOf('</tbody>'))
  check('the approval queue: every row has a cell under every heading',
    (tbody.match(/<td\b/g) ?? []).length + (tbody.match(/<Td\b/g) ?? []).length, cols)
}
for (const [name, screen, fixedExpected] of [
  ['the check screen', checkScreen, 14],
]) {
  ok(`${name} draws the shared sections`,
    /FeeHeadCells opened=/.test(screen) && /FeeBodyCells a=/.test(screen))
  ok(`${name} keeps no copy of its own`,
    !/\{ key: 'receiptFee'/.test(screen) && !/label: 'ceiling refuses'/.test(screen))
  /*
   * AND THE GROUP HEADINGS LINE UP. "The fees side" and "The capital side" span the columns
   * underneath them. A span one short does not fail, does not warn and does not look broken -- it
   * SHIFTS every heading after it by one column, so the figure under "Commission" is the VAT and
   * the firm reads the wrong number off the right-looking screen. The capital group was written as
   * 6 while it covers 7, because `Due to BF` belongs on that side.
   */
  const thead = screen.slice(screen.indexOf('<thead'), screen.indexOf('</thead>'))
  const groupRow = thead.slice(0, thead.indexOf('</tr>'))
  const headRow = thead.slice(thead.indexOf('</tr>') + 5)
  const spans = [...groupRow.matchAll(/colSpan=\{(\d+)\}/g)].map((m) => Number(m[1]))
  check(`${name}: three of the four group spans are fixed numbers`, spans.length, 3)
  /* THE FEES SIDE IS NOT A CONSTANT and must not become one -- it is the only span that changes
     when somebody opens a section, and a number written here would be wrong on the first click. */
  ok(`${name}: the fees side span is computed from what is open`,
    /colSpan=\{feeColumns\(opened\)\}/.test(groupRow))
  /* FOURTEEN FIXED COLUMNS either side of the three sections, and the body must have a cell for
     each: one added to the head and not the row is the same shift read from the other end. */
  const fixedCells = (headRow.match(/<th\b/g) ?? []).length
  check(`${name}: the fixed columns are all there`, fixedCells, fixedExpected)
  check(`${name}: the lead, the capital side and the tail cover every fixed column`,
    spans[0] + spans[1] + spans[2], fixedCells)
}
/*
 * AND THE OPENED RECEIPT IS DRAWN OUTSIDE THE TABLE, which a screenshot settled.
 *
 * It was a panel in a `colSpan` cell, which takes the TABLE's width -- and this table is wider
 * than the window: fifteen columns before anybody opens a fee section, and five more each time
 * they do. So the third of its three columns, headed "Whether it holds", was drawn off the
 * right-hand edge: the verdict, which is the entire point of the screen, was the part you had to
 * scroll sideways to read. Asserted because putting it back inside the table is the obvious thing
 * to do and it fails silently -- the panel renders, every figure is in the DOM, and the one that
 * matters is off-screen.
 */
ok('the opened receipt is drawn outside the scrolling table',
  /data-check-panel/.test(checkScreen)
  && !/colSpan=\{span\}/.test(checkScreen)
  && checkScreen.indexOf('data-check-panel') > checkScreen.indexOf('</table>'))

/* AND THE RULES ARE RUN ON BOTH, not merely available to them. This is the firm's "if anything
   touches a formula, there is a problem", and a library nothing calls is a library nothing
   protects. */
/* The queue goes through paymentsQueue.checkedRow, which runs checkAllocation over the engine's
   figures -- the same rules, one call away. */
ok('the approval queue checks every row against the rules',
  queueScreen.includes('checkedRow(r, awaitingAllocation(r)')
  && /const problems = checkAllocation\(a\)/.test(read('lib/paymentsQueue.ts')))
ok('the check screen checks every posted row against the rules',
  checkScreen.includes('checkAllocation(a)') && checkScreen.includes('postedAllocation(r)'))
/*
 * AND AN ALLOCATION POSTED BEFORE THE FIGURES EXISTED IS NOT CALLED WRONG.
 *
 * A v1-5050 row has nought in the two fee-split columns and null in the thirteen before-figures,
 * so every formula that subtracts one of them would fire -- a screen of red on payments that were
 * correct when they were made. "We did not record that then" and "that does not add up" are
 * different sentences, and the firm must not be shown the second when the first is true.
 */
ok('an allocation posted before the figures existed is shown rather than checked',
  /beforeTheRecord \? \[\] : checkAllocation\(a\)/.test(checkScreen))
ok('and what makes it so is a missing column, not a version string',
  /beforeTheRecord: r\.costs_before == null/.test(payover))
/* THE CAPITAL OUTSTANDING THE FIRM FOUND MISSING, on both. */
ok('capital outstanding is on both screens',
  queueScreen.includes('Capital outstanding') && checkScreen.includes('Capital outstanding'))
/* "THE RETAINED COLLECTION COMMISSION, JUST CALL THAT COMMISSION" -- the firm's own words. */
ok('the commission column is called Commission',
  queueScreen.includes('>Commission<') && !queueScreen.includes('Retained col. commission'))
/*
 * AND THE CHECK SCREEN CHANGES NOTHING. Financial records are immutable once a payment has been
 * processed -- the four ledgers have no update or delete policy and Postgres refuses -- so a
 * button on this screen could only ever be a button that fails. Asserted because the temptation to
 * add "fix it" next to a flagged row is exactly what somebody would do next.
 */
check('the check screen writes nothing',
  ['supabase.from', 'supabase.rpc', '.update(', '.insert(', '.delete(']
    .filter((w) => checkScreen.includes(w)), [])

/* HALF A CENT ROUNDS UP, AS THE DATABASE ROUNDS IT. RAP-124119 (8 Oct): 463.50 × 15% is 69.525,
   the engine wrote 69.53, and the check said 69.52 because the float is 69.52499999999999. */
check('the firm\'s one-cent case: 463.50 at 15% is 69.53', cents(463.5 * 0.15), 69.53)
check('...a negative half cent rounds away from nought, as Postgres does', cents(-0.125), -0.13)
check('...and an ordinary figure is untouched', cents(1250 * 0.2), 250)

if (failures.length > 0) {
  console.error(`\n${failures.length} failed, ${pass} passed\n`)
  for (const f of failures) console.error(`  ✗ ${f}\n`)
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
The firm's own formulas, held in both directions: silent on the two worked cases the database
actually produced, and naming exactly the rule that broke on each of fifteen single wrong figures.
The derived split of the one costs pool is held against the pool itself, which is the only thing
that can tell a wrong ordering from a right one -- and the in duplum ceiling is in the subtraction,
because without it the firm's literal "a minus b" fires on correct arithmetic.`)
