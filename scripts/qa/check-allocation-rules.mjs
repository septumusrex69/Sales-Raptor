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
  allocationOf, checkAllocation, derivedComponent, feesSideTaking, receiptFeeInclusive,
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
const payover = readFileSync(new URL('../../src/lib/payover.ts', import.meta.url), 'utf8')

/* THE FLOOR FIRST. An empty string satisfies every `.includes()` below, which is the vacuous pass
   this suite has been caught by before. */
ok('preview_allocation is in the schema', preview.length > 3000)
ok('payments_awaiting_approval is in the schema', queue.length > 1500)

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
  /order by r\.sk, r\.incurred_at, r\.id/.test(preview))
/* AND THE FEE THIS PAYMENT RAISES SORTS LAST, because it is the newest -- which is why a small
   payment can leave its own receipt fee outstanding. */
ok('the receipt fee this payment raises is paid last', /select 1, '0{8}-/.test(preview))
/* AND THE RECOVERABLE RULE IS THE ENGINE'S. engine_balances gathers the pool with fee_stands() and
   `billed is not false`, and it is that pool to_costs came out of; the money position view's
   plainer reading would make the two buckets fail to add back on an imported Promise to Pay. */
ok('what stands is decided by fee_stands, as the engine decides it',
  /public\.fee_stands\(f\.cancelled_at, f\.legacy_name\)/.test(preview)
  && /f\.billed is not false/.test(preview))
/* AND IN DUPLUM IS SPENT OLDEST-FIRST TOO, or an account at its ceiling shows more fees available
   than the engine will ever pay and the firm's own formula fires on correct arithmetic. */
ok('the in duplum ceiling is attributed to the oldest fees',
  preview.includes('public.in_duplum_cost_room(p_account)')
  && /least\(greatest\(v_room - r\.raised_before, 0\), r\.incl\)/.test(preview))

/* ================================================================== AND THE SCREEN
 *
 * The firm asked for one column a section, expanding to the rest: "the column that you will be
 * showing to us is the interest that we are taking now. But if you click on the interest taking,
 * it expands all of the other columns just to double check."
 */
const screen = readFileSync(
  new URL('../../src/pages/finance/AwaitingApproval.tsx', import.meta.url), 'utf8')
const bare = strip(screen.replace(/\{\/\*[\s\S]*?\*\/\}/g, ''))
ok('the three sections are drawn in the order the money is spent',
  bare.indexOf("key: 'interest'") < bare.indexOf("key: 'receiptFee'")
  && bare.indexOf("key: 'receiptFee'") < bare.indexOf("key: 'fees'")
  && bare.includes("key: 'interest'"))
ok('taking now is the column, and it opens the other four',
  bare.includes('toggleSection(sec.key)') && bare.includes('{sec.label} taking'))
ok('the capital outstanding the firm asked for is on it', bare.includes('Capital outstanding'))
/* "THE RETAINED COLLECTION COMMISSION, JUST CALL THAT COMMISSION" -- the firm's own words. */
ok('the commission column is called Commission',
  bare.includes('>Commission<') && !bare.includes('Retained col. commission'))
/* AND THE RULES ARE RUN ON THE SCREEN, not merely available to it. This is the firm's "if anything
   touches a formula, there is a problem", and a library nothing calls is a library nothing
   protects. */
ok('the screen checks every row against the rules',
  bare.includes('checkAllocation(a)') && bare.includes('awaitingAllocation(r)'))

/*
 * ---------------------------------------------------------------- AND THE GROUP HEADINGS LINE UP
 *
 * "The fees side" and "The capital side" are drawn on a row of their own, spanning the columns
 * underneath them. A span that is one short does not fail, does not warn and does not look broken
 * -- it SHIFTS every heading after it by one column, so the figure under "Commission" is the VAT
 * and the firm reads the wrong number off the right-looking screen. The capital group was written
 * as 6 while it covers 7, because `Due to BF` belongs on that side.
 *
 * COUNTED OUT OF THE SOURCE, both rows, and compared. The fee sections are 1 column collapsed and
 * 5 opened, which is why the span is computed in the component rather than written down -- so the
 * fixed columns either side are what this has to hold.
 */
const thead = bare.slice(bare.indexOf('<thead'), bare.indexOf('</thead>'))
const groupRow = thead.slice(0, thead.indexOf('</tr>'))
const headRow = thead.slice(thead.indexOf('</tr>') + 5)
const bodyRow = bare.slice(bare.indexOf('<tbody'), bare.indexOf('</tbody>'))

/*
 * THE SPANS WRITTEN AS NUMBERS: the blank lead, the capital side, and the blank tail. The fees
 * side is deliberately not one of them -- see below.
 */
const spans = [...groupRow.matchAll(/colSpan=\{(\d+)\}/g)].map((m) => Number(m[1]))
check('three of the four group spans are fixed numbers', spans.length, 3)
/* THE FEES SIDE IS NOT A CONSTANT and must not become one -- it is the only span that changes when
   somebody opens a section, and a number written here would be wrong on the first click. */
ok('the fees side span is computed from what is open',
  /colSpan=\{SECTIONS\.reduce\(/.test(groupRow))

/*
 * THE FIXED COLUMNS ARE EVERYTHING OUTSIDE THE SECTIONS MAP, and finding where that map ends has
 * to be done by MATCHING BRACES rather than by looking for its closing `))}`. The BEFORE map
 * nested inside it closes with the same three characters, so the first one found is the inner one
 * -- which left the "taking" and "after" columns counted as fixed, made the totals come out two
 * too high, and would have had this check reporting a misalignment that was not there.
 */
function mapBody(text, open) {
  const at = text.indexOf(open)
  if (at < 0) return [-1, -1]
  let depth = 0
  for (let i = at; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') { depth -= 1; if (depth === 0) return [at, i + 1] }
  }
  return [at, -1]
}
const [headAt, headEnd] = mapBody(headRow, '{SECTIONS.map(')
const [bodyAt, bodyEnd] = mapBody(bodyRow, '{SECTIONS.map(')
ok('the sections map is found in both rows', headAt > 0 && headEnd > headAt
  && bodyAt > 0 && bodyEnd > bodyAt)

const fixedHead = headRow.slice(0, headAt) + headRow.slice(headEnd)
const fixedCells = (fixedHead.match(/<th\b/g) ?? []).length
/* FOURTEEN: the tick box, the four that say whose payment this is and how much, the seven on the
   capital side, and the two that say what kind of receipt it was and what the debtor typed. */
check('the fixed columns are all there', fixedCells, 14)
check('the lead, the capital side and the tail cover every fixed column',
  spans[0] + spans[1] + spans[2], fixedCells)

/* AND THE BODY AGREES WITH THE HEAD, which is the other half: a cell added to one and not the
   other is the same shift read from the row instead of the heading. */
const fixedBody = bodyRow.slice(0, bodyAt) + bodyRow.slice(bodyEnd)
check('the body has a cell for every fixed column in the head',
  (fixedBody.match(/<td\b/g) ?? []).length, fixedCells)
/* AND EACH SECTION DRAWS THE SAME THREE SHAPES EITHER SIDE: the four behind a taking, the taking,
   and the after. */
check('each section draws the same cells in the head and the body',
  (bodyRow.slice(bodyAt, bodyEnd).match(/<td\b/g) ?? []).length,
  (headRow.slice(headAt, headEnd).match(/<th\b/g) ?? []).length)
check('and there are four figures behind a taking',
  (bare.match(/\{ label: '[a-z ]+', of: \(c\) => c\./g) ?? []).length, 4)

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
