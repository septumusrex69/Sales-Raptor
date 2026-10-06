/**
 * Check the item 9 receipt fee against real statements.
 *
 * Every expected figure below is copied from a Swordfish statement dated 9 September 2026, not
 * worked out by the code under test. Nine accounts across four clients: four Accelerate Fitness
 * accounts that sit under the R610 ceiling and exercise the 10% arithmetic, four Growthpoint
 * accounts and one Agri Saad account that sit on the ceiling.
 *
 * These exist because the fee used to be reached as `receiptFee(x) * 1.15`, which rounds the
 * VAT-exclusive figure to cents and then charges VAT on the rounded number. ACF10043 is the case
 * that exposed it: R1,490.83 -> R149.083 -> R149.08 -> R171.44, where the statement says R171.45.
 *
 *   node scripts/qa/check-fees.mjs
 */
import { readFileSync } from 'node:fs'
import { receiptFeeInclVat, settlementReceiptFee, ANNEXURE_B_2020, ANNEXURE_B_2026 } from '../../src/lib/annexureB.ts'

let failed = 0
let passed = 0
const near = (a, b) => Math.abs(a - b) < 0.005

function check(name, actual, expected) {
  const ok = near(actual, expected)
  if (ok) passed++; else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) console.log(`        expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`)
}

/* `check` compares MONEY and prints it with toFixed; a true/false assertion needs its own. */
function holds(name, condition, why) {
  if (condition) passed++; else failed++
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`)
  if (!condition && why) console.log(`        ${why}`)
}

// ---- Settlement receipt fee (Swordfish: "Final collection commission") ----
// balance immediately before the FCC row -> the FCC the statement charged.
const STATEMENTS = [
  ['ACF10043 Macdougall', 1490.83, 171.45],
  ['ACF10044 Mogashoa', 1908.25, 219.45],
  ['ACF10085 Nkumanda', 2813.36, 323.54],
  ['ACF10001 Ndlovu', 4317.39, 496.50],
  ['GPS3/10103 Coutries', 9472.40, 701.50],
  ['GPS4/10053 Mosala', 15923.60, 701.50],
  ['GPS4/20019 Mokgobu', 28586.33, 701.50],
  ['GPS4/10080 Sekwadila', 31682.02, 701.50],
  ['AID20001 Kiewietsvlei', 252606.36, 701.50],
]
/*
 * THE DAY THE STATEMENTS WERE RUN. Required now rather than defaulted: a fee reached with no date
 * is today's cap applied to a receipt from another year, which is CLAUDE.md's rule about reading a
 * fee on the ACTION's date broken from the other end.
 */
const STATEMENT_DAY = '2026-09-09'
for (const [ref, balance, expected] of STATEMENTS) {
  check(`${ref}: settlement fee on R${balance.toFixed(2)}`,
    settlementReceiptFee(balance, 0.15, STATEMENT_DAY), expected)
}

// ---- Receipt fee actually posted when a payment arrives ----
// Round payments hide the double-rounding, because 10% of them is already exact to the cent.
// They are here so a future change cannot break the ordinary case while fixing the odd one.
for (const [paid, expected] of [[100, 11.50], [200, 23], [500, 57.50], [795, 91.43], [1000, 115], [5000, 575]]) {
  check(`payment of R${paid} attracts R${expected.toFixed(2)}`,
    receiptFeeInclVat(paid, 0.15, STATEMENT_DAY), expected)
}

// The regression itself: an odd payment, where 10% lands on a fraction of a cent.
check('an odd payment rounds once, not twice', receiptFeeInclVat(1490.83, 0.15, STATEMENT_DAY), 171.45)

// ---- The ceiling, and which schedule applies ----
check('a big payment tops out at R610 + VAT', receiptFeeInclVat(15000, 0.15, '2026-09-09'), 701.50)
check('zero pays nothing', receiptFeeInclVat(0, 0.15, STATEMENT_DAY), 0)

/*
 * THE CAP MOVES ON ITS OWN DATE, AND IT IS THE 7th OF APRIL.
 *
 * The 2026 gazette is dated 6 March; the firm applied the new cap from 7 April, and
 * `annexure_b_tariffs` -- which is what allocate_payment actually charges on -- says so. The app
 * said 6 March, so for a month the two halves of Raptor priced the same receipt differently: a
 * payment of R10 000 on 20 March was capped at R610 by the preview and at R502 by the engine.
 */
check('the day before the firm raised it', receiptFeeInclVat(15000, 0.15, '2026-04-06'), 577.30)
check('the day they did', receiptFeeInclVat(15000, 0.15, '2026-04-07'), 701.50)
check('the gazette date itself is still the old cap', receiptFeeInclVat(15000, 0.15, '2026-03-06'), 577.30)

/*
 * R502, AND THIS REVERSES A DECISION. THE FIRM HAS TO SAY WHICH WAY IT GOES.
 *
 * 9 Sep 2026: Swordfish charged R577.30 on all sixteen capped payments on AID20001 -- a maximum of
 * R502 excluding VAT, not the gazette's R509 -- and kept doing so until May 2026.
 *
 * 10 Sep 2026, recorded here: "The business confirmed R502 was captured incorrectly on their side:
 * the gazette says R509 and Swordfish is wrong." History was protected a different way, by letting
 * the RECORDED commission on each payment win over the computed one.
 *
 * 6 Oct 2026, after the first test import, the firm again: "The annexure_b_tariffs table (used by
 * allocate_payment) has R502 until 2026-04-06 and R610 from 2026-04-07, which matches what
 * Swordfish charged... Make the app read the same as-charged caps and dates as the database."
 *
 * THE INSTRUCTION IS RIGHT WHICHEVER FIGURE IS. `annexure_b_tariffs` is what allocate_payment
 * charges on, so while the two disagreed, Raptor's engine and Raptor's statement priced the same
 * receipt differently -- and that is a defect on any reading of the gazette. So the app now follows
 * the table. WHICH NUMBER BELONGS IN THE TABLE IS STILL THE FIRM'S TO SAY: if R509 is right, it is
 * one row in annexure_b_tariffs and one entry in RECEIPT_FEE_CAPS, changed together, and this
 * expectation with them.
 */
check('a capped payment is the R502 the firm charged', receiptFeeInclVat(7000, 0.15, '2025-06-01'), 577.30)
console.log('      NOTE  R502 is the as-charged cap, which reverses the 10 Sep reading of the gazette (R509).')

/* ---------------------------------------------------------------------------------------------
 * AND NOTHING MAY DEFAULT TO A DATE AGAIN
 * ------------------------------------------------------------------------------------------- */

/*
 * THE FIRM, BY NAME: "receiptFee() defaults to the 2026 schedule when given no date... never
 * default to a schedule without a date."
 *
 * A DEFAULT PARAMETER STILL TYPECHECKS, which is why this is read out of the source rather than
 * exercised: putting `= new Date()` back on the cap compiles, every caller keeps working, and a
 * 2019 receipt is silently priced on today's gazette. That is CLAUDE.md's own rule about reading a
 * fee on the ACTION's date, broken from the far end and invisible.
 */
const src = readFileSync(new URL('../../src/lib/annexureB.ts', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
for (const fn of ['receiptFeeCapOn', 'receiptFee', 'receiptFeeInclVat', 'settlementReceiptFee']) {
  const at = src.indexOf(`export function ${fn}(`)
  holds(`${fn} is in the file`, at >= 0, `got ${at}`)
  const signature = at < 0 ? '' : src.slice(at, src.indexOf(')', at) + 1)
  /* A defaulted DATE is the one this forbids. `vatRate = 0.15` is a rate, not a clock, and a
     wrong VAT rate is wrong the same way on every date. */
  holds(`${fn} never defaults its date`,
    !/(onDate|date)[^,)]*=\s*(new Date|ANNEXURE_B)/.test(signature), `in ${signature}`)
}
/* AND THE SCHEDULE OBJECTS NO LONGER CARRY A CAP AT ALL -- one source, which is the whole point. */
holds('the cap is not on the schedule any more',
  !/receiptFeeMaximum\s*[:?]/.test(src), 'receiptFeeMaximum is back on AnnexureBSchedule')

/*
 * THE LINE run-all.mjs READS. A file that prints no count is counted as ZERO in the
 * headline and is indistinguishable from a healthy one -- a review of this suite found 20
 * files silent that way, about 800 assertion sites reported as nothing.
 */
if (failed === 0) console.log(`${passed} passed, 0 failed`)
console.log(failed ? `\n${failed} failed` : '\nall checks pass')
process.exit(failed ? 1 : 0)
