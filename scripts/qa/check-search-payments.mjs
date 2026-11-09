/**
 * One search for payments: the bar at the top (S21 · Raptor H19). Stephan, 9 Nov: "the search a payment. Like, is it
 * necessary to do it there". Five places to look became one.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-search-payments.mjs
 */
import { readFileSync } from 'node:fs'
import { paymentPath, paymentQuery } from '../../src/lib/globalSearch.ts'
import { parseRandAmount } from '../../src/lib/findPaymentAmount.ts'

let pass = 0
const failures = []
const check = (name, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) pass += 1; else failures.push(`${name}\n    expected ${JSON.stringify(b)}\n    got      ${JSON.stringify(a)}`) }
const ok = (name, v) => check(name, v, true)
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

check('an amount is read as an amount', paymentQuery('R1 500,00', parseRandAmount), { amount: 1500, words: null })
check('...written with a point', paymentQuery('1500.50', parseRandAmount), { amount: 1500.5, words: null })
check('a case number is words', paymentQuery('DRC0001', parseRandAmount), { amount: null, words: 'DRC0001' })
check('a name off the proof of payment is words', paymentQuery('mokoena', parseRandAmount), { amount: null, words: 'mokoena' })
check('two letters ask nothing', paymentQuery('mo', parseRandAmount), null)
check('an ID or phone number is not an amount', paymentQuery('8001015009087', parseRandAmount), null)
check('a payment on an account opens the account (where it can be reversed)', paymentPath({ accountId: 'a1' }), '/accounts/a1')
check('a bank line with no account yet opens suspense', paymentPath({ accountId: null }), '/trust/exceptions#suspense')

const bar = read('src/components/layout/GlobalSearch.tsx')
ok('the top search asks find_payments, only for whoever holds the trust account',
  /const mayFindPayments = can\(currentUser, 'finance\.view'\)/.test(bar) && /findPayments\(\{ amount: pq\.amount/.test(bar))
ok('...and draws them after the book', /\[\.\.\.book, \.\.\.payments, \.\.\.results\]/.test(bar))
ok('the Client ledger has no search box of its own', !/function PaymentSearch/.test(read('src/pages/trust/ClientLedger.tsx')))
ok('Payments in has no History tab', !/payments-tab-history/.test(read('src/pages/finance/FinancePayments.tsx')))
ok('Find a payment is off the Trust menu', !/label: 'Find a payment'/.test(read('src/pages/trust/TrustLayout.tsx')))

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-search-payments: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
