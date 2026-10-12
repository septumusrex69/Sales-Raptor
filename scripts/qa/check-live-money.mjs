/**
 * NO SCREEN TOTAL COUNTS MONEY THAT DOES NOT STAND (prompt 11, URGENT).
 *
 * KLR/1006, staging, 12 Oct: the R1 100 received 3 Jul was reversed to Needs an account on 10 Jul and
 * placed on MPG/3003. The database was right -- capital R5 300, no allocations, the R126.50 receipt
 * fee cancelled -- and the account page was wrong in every total: the reversal's rejected COPY was
 * read as a live payment, so the statement listed "Payment received R1 100" and its receipt fee,
 * Collected said R1 100 · 2 payments, and To settle today was R973.50 short. That figure goes on a
 * statement of account and a settlement quote.
 *
 * WHAT THIS HOLDS: a payment with reversed_at or rejected_at, or a fee with cancelled_at, is in no
 * total -- the balance (and so the statement, Collected and To settle today), the ledger totals,
 * and the Collected count -- and both ledger fetches drop rejected receipts before anything reads them.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-live-money.mjs
 */
import { readFileSync } from 'node:fs'
import { balanceInputFor } from '../../src/lib/balanceInput.ts'
import { buildStatement, computeBalance } from '../../src/lib/accountBalance.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

/* KLR/1006 as the screen would have read it: the reversed original, its rejected copy, the
   cancelled receipt fee on the original, and one live fee. */
const ledgers = {
  payments: [
    { id: 'orig', receivedAt: '2026-07-02T22:00:00Z', amount: 1100, paidToClient: false, reversedAt: '2026-07-10T15:48:47Z', receiptFeeLegacy: null },
    { id: 'copy', receivedAt: '2026-07-02T22:00:00Z', amount: 1100, paidToClient: false, reversedAt: null, rejectedAt: '2026-07-10T15:48:47Z', receiptFeeLegacy: null },
  ],
  fees: [
    { incurredAt: '2026-07-02T22:00:00Z', description: 'Receipt of instalment', amountExclVat: 110, vatAmount: 16.5, billed: true, segments: 1,
      annexureItem: '9', paymentId: 'orig', cancelledAt: '2026-07-10T15:48:47Z', legacyName: null },
    { incurredAt: '2026-07-05T10:00:00Z', description: 'Letter', amountExclVat: 100, vatAmount: 15, billed: true, segments: 1,
      annexureItem: '1', paymentId: null, cancelledAt: null, legacyName: null },
  ],
  accruals: [],
}
const input = balanceInputFor({
  account: { capitalHandedOver: 5300, handoverDate: '2026-04-01', interestRateAnnual: 0, status: 'Active', lastActionAt: null },
  ledgers, today: '2026-08-10', writtenOff: () => false,
})
const b = computeBalance(input)
check('a reversed payment and its rejected copy collect nothing', b.payments, 0)
check('...the cancelled receipt fee is not owed, the live fee is', b.balance, 5415)
const st = buildStatement(input)
ok('the statement lists neither payment', !st.lines.some((l) => l.kind === 'payment'))
check('...and ends on the balance', st.lines[st.lines.length - 1]?.balance, 5415)

/* The fetches drop rejected receipts before anything totals them. */
const book = read('src/lib/accountBook.ts')
ok('the account ledger asks for rejected_at and drops those rows',
  /reversal_reason,receipt_fee_legacy,rejected_at'\)/.test(book) && /const live = \(\(payments \?\? \[\]\) as any\[\]\)\.filter\(\(r\) => !r\.rejected_at\)/.test(book))
ok('...as does the ledger for a page of accounts',
  /receipt_fee_legacy,rejected_at'\)/.test(book) && /if \(r\.rejected_at\) continue/.test(book))
ok('the ledger total counts live money only', /paid: live\.filter\(\(r\) => !r\.reversed_at\)/.test(book))
ok('the balance input leaves out reversed and rejected', /\.filter\(\(p\) => !p\.reversedAt && !p\.rejectedAt\)/.test(read('src/lib/balanceInput.ts')))
ok('Collected counts the payments that stand', /const livePayments = \(ledgers\?\.payments \?\? \[\]\)\.filter\(\(p\) => !p\.reversedAt\)\.length/.test(read('src/pages/accounts/AccountDetail.tsx')))

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-live-money: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
