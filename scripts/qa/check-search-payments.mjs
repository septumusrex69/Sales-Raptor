/**
 * Payments are found on Trust, not in the bar at the top (Raptor H19, 18 Nov). The firm: "it will make the results
 * endless ... keep the search bar for accounts names and so on and under the trust we add the search for payments."
 *
 * This reverses S21 (9 Nov), which had made the top bar the one place to find a payment. The other two places S21
 * closed -- the Client ledger's own box and Payments in's History tab -- stay closed: Find a payment is the one place.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-search-payments.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const check = (name, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) pass += 1; else failures.push(`${name}\n    expected ${JSON.stringify(b)}\n    got      ${JSON.stringify(a)}`) }
const ok = (name, v) => check(name, v, true)
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

const bar = read('src/components/layout/GlobalSearch.tsx')
ok('the top search does not ask find_payments', !/findPayments/.test(bar))
ok('...and does not offer payments in its placeholder', !/payments, amounts/.test(bar))
ok('...and still searches the book (accounts, tickets, requests)', /supabase\.rpc\('global_search'/.test(bar))
ok('Find a payment is on the Trust menu', /\{ to: '\/trust\/find', label: 'Find a payment'/.test(read('src/pages/trust/TrustLayout.tsx')))
ok('...and its route opens', /<Route path="find" element=\{<FindPayment \/>\}/.test(read('src/App.tsx')))
ok('the Client ledger has no search box of its own', !/function PaymentSearch/.test(read('src/pages/trust/ClientLedger.tsx')))
ok('Payments in has no History tab', !/payments-tab-history/.test(read('src/pages/finance/FinancePayments.tsx')))

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-search-payments: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
