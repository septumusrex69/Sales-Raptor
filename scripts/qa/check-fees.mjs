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
import { receiptFeeInclVat, settlementReceiptFee, ANNEXURE_B_2020, ANNEXURE_B_2026 } from '../../src/lib/annexureB.ts'

let failed = 0
const near = (a, b) => Math.abs(a - b) < 0.005

function check(name, actual, expected) {
  const ok = near(actual, expected)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) console.log(`        expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`)
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
for (const [ref, balance, expected] of STATEMENTS) {
  check(`${ref}: settlement fee on R${balance.toFixed(2)}`, settlementReceiptFee(balance), expected)
}

// ---- Receipt fee actually posted when a payment arrives ----
// Round payments hide the double-rounding, because 10% of them is already exact to the cent.
// They are here so a future change cannot break the ordinary case while fixing the odd one.
for (const [paid, expected] of [[100, 11.50], [200, 23], [500, 57.50], [795, 91.43], [1000, 115], [5000, 575]]) {
  check(`payment of R${paid} attracts R${expected.toFixed(2)}`, receiptFeeInclVat(paid), expected)
}

// The regression itself: an odd payment, where 10% lands on a fraction of a cent.
check('an odd payment rounds once, not twice', receiptFeeInclVat(1490.83), 171.45)

// ---- The ceiling, and which schedule applies ----
check('a big payment tops out at R610 + VAT', receiptFeeInclVat(15000, 0.15, ANNEXURE_B_2026), 701.50)
check('zero pays nothing', receiptFeeInclVat(0), 0)

/*
 * PENDING CONFIRMATION, 9 September 2026.
 *
 * Swordfish charged R577.30 on all sixteen capped payments on AID20001, which is a maximum of
 * R502 excluding VAT, not the R509 this schedule carries. It kept doing so until May 2026, two
 * months after the R610 schedule took effect on 6 March.
 *
 * The financial manager has seen the same R502 problem from her side and believes it was billed
 * incorrectly, which points at R509 being right and Swordfish being wrong. That is not yet
 * confirmed in writing, so nothing here has been changed. If R502 turns out to be the gazetted
 * figure, `ANNEXURE_B_2020.receiptFeeMaximum` and this expectation both move together.
 */
check('a big payment under the 2020 schedule tops out at R509 + VAT', receiptFeeInclVat(7000, 0.15, ANNEXURE_B_2020), 585.35)
console.log('      NOTE  Swordfish charged R577.30 here (a R502 maximum). Pending written confirmation.')

console.log(failed ? `\n${failed} failed` : '\nall checks pass')
process.exit(failed ? 1 : 0)
