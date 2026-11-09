/**
 * The Client ledger's rules (S21 · Raptor H19): which runs have left the trust account, filed by client. Stephan, 9
 * Nov: "The moment that a pay overrun has been approved and paid, then it should go into the client ledger ... you can
 * search a client ... Then you click on the client ... all the historical payovers."
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-paid-over-ledger.mjs
 */
import { readFileSync } from 'node:fs'
import { clientPayovers, isPaidOver, ledgerClients, matchesClient } from '../../src/lib/paidOverLedger.ts'

let pass = 0
const failures = []
const check = (name, a, b) => { if (Object.is(a, b)) pass += 1; else failures.push(`${name}\n    expected ${JSON.stringify(b)}\n    got      ${JSON.stringify(a)}`) }
const ok = (name, v) => check(name, v, true)
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

const run = (runId, companyId, client, status, netPayover, periodStart, paidAt = null, sentAt = null) => ({
  runId, companyId, client, clientCode: client.slice(0, 3).toUpperCase(), invoiceNumber: `PO-${runId}`, periodStart,
  periodEnd: periodStart.replace(/-11$/, '-10'), payments: 3, trustCapital: 0, ptcSetOff: 0, netPayover, exceptions: 0,
  status, nextStep: '', approvedAt: null, sentAt, paidAt, eftReference: null,
})
const rows = [
  run('1', 'a', 'Alpha Props', 'paid', 1200, '2026-08-11', '2026-10-11T08:00:00Z'),
  run('2', 'a', 'Alpha Props', 'paid', 800, '2026-09-11', '2026-11-11T08:00:00Z'),
  run('3', 'a', 'Alpha Props', 'ready', 500, '2026-10-11'),
  run('4', 'b', 'Beta Body Corp', 'sent', -50, '2026-09-11', null, '2026-11-11T09:00:00Z'),
  run('5', 'c', 'Gamma', 'approved', 900, '2026-09-11'),
]
const settled = new Set()
check('a paid run has left the trust account', isPaidOver(rows[0], settled), true)
check('...a ready one has not -- it is on Payover runs', isPaidOver(rows[2], settled), false)
check('...an approved one waiting to be paid has not', isPaidOver(rows[4], settled), false)
check('...a run below nil whose advice went is finished', isPaidOver(rows[3], settled), true)
check('...as is one approved below nil that the client settled', isPaidOver(run('6', 'd', 'Delta', 'approved', -10, '2026-09-11'), new Set(['6'])), true)
const clients = ledgerClients(rows, settled)
check('one row per client with something paid over', clients.map((c) => c.client).join('|'), 'Alpha Props|Beta Body Corp')
check('...counting only the finished payovers', clients[0].payovers, 2)
check('...adding what they carried', clients[0].paidOver, 2000)
check('...last paid on the latest', clients[0].lastPaid, '2026-11-11')
check('...on the firm\'s calendar: 22:30 UTC on the 11th is the 12th in Johannesburg',
  ledgerClients([run('9', 'z', 'Zeta', 'paid', 10, '2026-08-11', '2026-09-11T22:30:00Z')], settled)[0].lastPaid, '2026-09-12')
check('a client\'s payovers, newest cycle first', clientPayovers(rows, settled, 'a').map((r) => r.runId).join(','), '2,1')
check('a client is found by name', matchesClient(clients[0], 'alpha'), true)
check('...or by code', matchesClient(clients[1], 'bet'), true)
check('...and not by somebody else\'s', matchesClient(clients[1], 'alpha'), false)

const queue = read('src/pages/finance/FinanceWorkQueue.tsx')
ok('Payover runs lets go of exactly what the ledger takes (one rule)', /const isFinal = \(r: WorkQueueRow\) => isPaidOver\(r, settled\)/.test(queue))
const page = read('src/pages/trust/ClientLedger.tsx')
ok('the ledger lists clients from the same rule', /ledgerClients\(rows, settled\)/.test(page))
ok('...a payover opens as the run, with its payments and the advice that was sent', /to=\{`\/trust\/runs\/\$\{r\.runId\}`\}/.test(page))
ok('...and a payment can be searched there', /<PaymentSearch \/>/.test(page) && /findPayments\(/.test(page))
ok('it is on the Trust menu, after Payover runs', /to: '\/trust\/client-ledger', label: 'Client ledger'/.test(read('src/pages/trust/TrustLayout.tsx'))
  && read('src/pages/trust/TrustLayout.tsx').indexOf("label: 'Client ledger'") > read('src/pages/trust/TrustLayout.tsx').indexOf("label: 'Payover runs'"))

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-paid-over-ledger: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
