/**
 * Check the balance engine's arithmetic.
 *
 * The formula itself was verified against 735 migrated accounts in SQL. What that cannot catch
 * is a transcription error between the query that proved it and the TypeScript the app runs —
 * so these are the cases where the two could silently disagree, each with an answer worked out
 * by hand rather than by the code under test.
 *
 *   node scripts/qa/check-balance.mjs
 */
import { computeBalance, buildStatement } from '../../src/lib/accountBalance.ts'

let failed = 0
const near = (a, b) => Math.abs(a - b) < 0.005

function check(name, actual, expected) {
  const ok = near(actual, expected)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) console.log(`        expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`)
}

const empty = { payments: [], fees: [], interest: [] }

/* An account with nothing on it owes its capital, and settling adds 10% + VAT. */
{
  const b = computeBalance({ capitalHandedOver: 1000, handoverDate: '2026-01-01', ledgers: empty })
  check('bare account: balance is the capital', b.balance, 1000)
  check('bare account: settlement fee is 10% + VAT', b.settlementFee, 115)
  check('bare account: settlement', b.settlement, 1115)
}

/*
 * The receipt fee is priced on the schedule in force the DAY THE PAYMENT ARRIVED, not today.
 * A R6,100 instalment is exactly at the 2026 maximum of R610 and well past the 2020 one of R509,
 * so the same payment costs different amounts either side of 6 March 2026. Getting this wrong
 * would be invisible on small payments and wrong on every large one.
 */
{
  const before = computeBalance({
    capitalHandedOver: 0, handoverDate: '2025-01-01',
    ledgers: { ...empty, payments: [{ date: '2025-11-29', amount: 6100 }] },
  })
  check('payment in 2025 caps at the R509 maximum', before.receiptFees, 585.35)

  const after = computeBalance({
    capitalHandedOver: 0, handoverDate: '2026-01-01',
    ledgers: { ...empty, payments: [{ date: '2026-04-28', amount: 6100 }] },
  })
  check('the same payment in 2026 caps at R610', after.receiptFees, 701.5)

  const small = computeBalance({
    capitalHandedOver: 0, handoverDate: '2026-01-01',
    ledgers: { ...empty, payments: [{ date: '2026-04-28', amount: 1000 }] },
  })
  check('a payment under the cap is 10% + VAT', small.receiptFees, 115)
}

/* Unbilled actions are history, not money: an action past the ceiling must not reach a balance. */
{
  const b = computeBalance({
    capitalHandedOver: 1000, handoverDate: '2026-01-01',
    ledgers: {
      ...empty,
      fees: [
        { date: '2026-02-01', description: 'Phone Call', exclVat: 25, vat: 3.75, billed: true },
        { date: '2026-02-02', description: 'Phone Call', exclVat: 0, vat: 0, billed: false },
      ],
    },
  })
  check('only charged fees reach the balance', b.fees, 28.75)
}

/*
 * In duplum: non-capital may not exceed the capital handed over. Here interest alone is double
 * the capital, so half of it is withheld and the balance stops at twice capital.
 */
{
  const b = computeBalance({
    capitalHandedOver: 1000, handoverDate: '2024-01-01', inDuplum: true,
    ledgers: { ...empty, interest: [{ from: '2024-06-01', days: 30, amount: 2000 }] },
  })
  check('in duplum: balance stops at twice the capital', b.balance, 2000)
  check('in duplum: the excess is reported, not hidden', b.withheld, 1000)
}

/* A written-off account stops accruing on the day it stopped. */
{
  const b = computeBalance({
    capitalHandedOver: 1000, handoverDate: '2024-01-01', writtenOffAt: '2024-06-30',
    ledgers: {
      ...empty,
      interest: [
        { from: '2024-06-01', days: 30, amount: 100 },
        { from: '2024-07-01', days: 30, amount: 100 },
      ],
    },
  })
  check('write-off: interest after the date is excluded', b.interest, 100)
  check('write-off: the excluded amount is reported', b.withheld, 100)
}

/*
 * The statement has to end where the balance says it does. If these ever disagree, one of the
 * two is lying to a debtor — and the statement is the document they are entitled to.
 */
{
  const input = {
    capitalHandedOver: 5000, handoverDate: '2026-01-01',
    ledgers: {
      payments: [{ date: '2026-03-01', amount: 1000 }, { date: '2026-05-01', amount: 500 }],
      fees: [
        { date: '2026-02-01', description: 'Letter', exclVat: 25, vat: 3.75, billed: true },
        { date: '2026-04-01', description: 'SMS', exclVat: 3.5, vat: 0.53, billed: true },
        { date: '2026-04-02', description: 'Phone Call', exclVat: 0, vat: 0, billed: false },
      ],
      interest: [{ from: '2026-02-01', days: 28, amount: 200 }],
    },
  }
  const s = buildStatement(input)
  const last = s.lines[s.lines.length - 1]
  check('the statement ends at the balance', last.balance, s.breakdown.balance)

  const debits = s.lines.reduce((t, l) => t + l.debit, 0)
  const credits = s.lines.reduce((t, l) => t + l.credit, 0)
  check('debits less credits equal the balance', debits - credits, s.breakdown.balance)

  const payments = s.lines.filter((l) => l.kind === 'payment').length
  const receiptFees = s.lines.filter((l) => l.kind === 'receipt-fee').length
  check('every payment carries its receipt fee line', receiptFees, payments)

  const dates = s.lines.map((l) => l.date)
  check('lines are in date order', [...dates].sort().join() === dates.join() ? 1 : 0, 1)
}

console.log(failed === 0 ? '\nAll checks passed.\n' : `\n${failed} check(s) failed.\n`)
process.exit(failed ? 1 : 0)
