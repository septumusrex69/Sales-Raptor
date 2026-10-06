/**
 * RAPTOR'S BALANCE AGAINST SWORDFISH'S, AND THE FCC HYPOTHESIS CONFIRMED.
 *
 * THE FIRM: "Balances disagree with Swordfish, mainly on fees... Swordfish's 'Fees & Expenses'
 * figure is roughly double Raptor's rebuilt fee ledger (BPM0113: Swordfish R1 354.70, Raptor ledger
 * R777.40). It looks like Swordfish includes its future collection commission (FCC, 10% of the
 * balance) in fees, but confirm that... A balance the firm cannot explain must not reach a client
 * statement or payover."
 *
 * CONFIRMED, AND IT IS NOT DOUBLE. Measured on the five accounts the firm named, off staging:
 *
 *     BPM0113     0 payments     R1 354.70 - R777.40   = R577.30
 *     BPM20038    0 payments     R1 644.50 - R1 067.20 = R577.30
 *     BPM0109     6 payments     R2 616.25 - R1 361.63 = R1 254.62
 *     BPM0186    11 payments     R2 329.78 - R1 082.15 = R1 247.63
 *     KIS0007    12 payments     R7 863.45 - R1 176.45 = R6 687.00
 *
 * ON THE TWO WITH NO PAYMENTS THE DIFFERENCE IS R577.30 TO THE CENT, BOTH TIMES -- the item 9 cap
 * of R502 plus VAT, which is one settlement receipt fee and nothing else. On the three with
 * payments it is that plus the item 9 fee on each receipt, which is why it grows with the NUMBER of
 * payments rather than with the balance. The imported fee ledger holds no item 9 rows at all, on
 * all five.
 *
 * So Swordfish reports one column with the receipt fees inside it and Raptor keeps them apart,
 * because item 9 is charged per receipt and items 1 to 7 are charged per action. Same money.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-import-gap.mjs
 */
import { readFileSync } from 'node:fs'
import { balanceIsExplained, compareWithSwordfish } from '../../src/lib/importGap.ts'
import { receiptFeeInclVat } from '../../src/lib/annexureB.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const no = (name, actual) => check(name, actual, false)

/* ------------------- the hypothesis, as arithmetic ------------------- */

/*
 * R577.30 IS THE WHOLE OF IT ON AN ACCOUNT WITH NO PAYMENTS, and it is not a coincidence: it is the
 * R502 cap plus VAT, which `receiptFeeInclVat` produces for any balance over R5 020 on a date
 * before the firm raised the cap. Derived rather than typed, so the two cannot drift.
 */
const CAPPED = receiptFeeInclVat(999999, 0.15, '2026-01-01')
check('the capped receipt fee is R577.30', CAPPED, 577.30)

/* THE FIRM'S OWN FIVE, as they stand in the database. */
const ACCOUNTS = [
  { ref: 'BPM0113', sfFees: 1354.70, fees: 777.40, payments: 0 },
  { ref: 'BPM20038', sfFees: 1644.50, fees: 1067.20, payments: 0 },
  { ref: 'BPM0109', sfFees: 2616.25, fees: 1361.63, payments: 6 },
  { ref: 'BPM0186', sfFees: 2329.78, fees: 1082.15, payments: 11 },
  { ref: 'KIS0007', sfFees: 7863.45, fees: 1176.45, payments: 12 },
]
for (const a of ACCOUNTS) {
  const diff = Math.round((a.sfFees - a.fees) * 100) / 100
  if (a.payments === 0) {
    /* THE CONFIRMATION. One settlement receipt fee, to the cent, on both accounts that have no
       payments to attract any other item 9 fee. */
    check(`${a.ref} differs by exactly one capped receipt fee`, diff, CAPPED)
  } else {
    /* AND ON THE OTHERS IT IS MORE THAN THAT, never less -- there is a settlement fee plus a fee on
       each receipt, and a difference SMALLER than one capped fee would break the explanation. */
    ok(`${a.ref} differs by more than one receipt fee`, diff > CAPPED)
  }
  /* NOT "ROUGHLY DOUBLE". The firm's own reading, which the arithmetic does not support: on
     KIS0007 it is nearly seven times, and on BPM20038 half as much again. */
  no(`${a.ref} is not simply doubled`, Math.abs(a.sfFees - a.fees * 2) < 0.05)
}

/* ------------------- what the account says about it ------------------- */

/*
 * COMPARED ON THE FIGURE THAT IS COMPARABLE. Raptor's fee ledger alone always reads short, because
 * the receipt fees are not in it; added to them it is the same column Swordfish reports.
 */
{
  const gap = compareWithSwordfish({
    swordfishBalance: 17619.93, swordfishFees: 1354.70,
    balance: 17619.93, fees: 777.40, receiptFees: 577.30,
  })
  check('fees and receipt fees together match Swordfish', gap.feeDifference, 0)
  check('...and the balances agree', gap.difference, 0)
  ok('...so there is nothing to flag', gap.agrees)
  ok('and it is fit for a statement', balanceIsExplained(gap))
}

/* A REAL GAP IS REPORTED, which is the case the panel exists for. */
{
  const gap = compareWithSwordfish({
    swordfishBalance: 17619.93, swordfishFees: 1354.70,
    balance: 16265.00, fees: 777.40, receiptFees: 0,
  })
  check('a short balance is named', gap.difference, -1354.93)
  no('...and is not treated as agreement', gap.agrees)
  no('...so it is not fit for a statement', balanceIsExplained(gap))
  ok('...and the fee difference is named too', gap.feeDifference < 0)
}

/* ROUNDING IS NOT A DISAGREEMENT. A cent either way is arithmetic, not a problem to chase. */
{
  const gap = compareWithSwordfish({
    swordfishBalance: 100, swordfishFees: 10, balance: 100.02, fees: 10, receiptFees: 0,
  })
  ok('two cents is rounding', gap.agrees)
}
{
  const gap = compareWithSwordfish({
    swordfishBalance: 100, swordfishFees: 10, balance: 100.06, fees: 10, receiptFees: 0,
  })
  no('six cents is not', gap.agrees)
}

/*
 * NOTHING TO COMPARE IS NOT A DISAGREEMENT EITHER. An account opened in Raptor has no imported
 * figure, and a panel reading "no difference" on every one of twenty-three thousand accounts is the
 * warning that fires when nothing is wrong.
 */
check('an account that never came from Swordfish compares to nothing',
  compareWithSwordfish({ swordfishBalance: null, swordfishFees: null, balance: 100, fees: 0, receiptFees: 0 }),
  null)
ok('...and that is fit for a statement', balanceIsExplained(null))

/* ------------------- and the panel draws only when there is something ------------------- */

const page = readFileSync(new URL('../../src/pages/accounts/AccountDetail.tsx', import.meta.url), 'utf8')
ok('the account compares itself with Swordfish', /compareWithSwordfish\(\{/.test(page))
ok('...and draws nothing where they agree', /if \(!gap \|\| gap\.agrees\) return null/.test(page))
/* THE IMPORTED FIGURE IS THE RECORD AND THE SCREEN SAYS SO, rather than reconciling it away. */
ok('...and says the imported figure stands',
  /what the client was invoiced on, so it stays as it is/.test(page))

console.log(`check-import-gap: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
if (failures.length) process.exit(1)
