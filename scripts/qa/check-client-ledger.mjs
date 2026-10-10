/*
 * THE CLIENT'S LEDGER, ONE LINE A PAYOVER (clientLedger.ts).
 *
 * The firm, 10 Oct: not a line per PTC -- "there's one payover. This was the payover date, and
 * according to this payover, there is a credit or a debit balance", then the invoice as its own
 * line. This holds: payments fold into the run whose period covers their day; a set-off naming a
 * run folds into it; a payover paid, a charge and an invoice each keep their own line; money after
 * the last run is one "not on a payover yet" line for its cycle; a void run takes nothing; and the
 * regrouped balance closes on the database's own closing figure.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-client-ledger.mjs
 */
import { readFileSync } from 'node:fs'
import { ledgerByPayover, cycleOf } from '../../src/lib/clientLedger.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const e = (on, kind, amount, extra = {}) =>
  ({ on, kind, amount, description: kind, reference: null, caseNumber: 'RAP-1', balance: 0, runId: null, chargeId: null, ...extra })

const runs = [
  { id: 'r9', invoiceNumber: 'PO-LGR-2609', periodStart: '2026-08-11', periodEnd: '2026-09-10', status: 'paid' },
  { id: 'r10', invoiceNumber: 'PO-LGR-2610', periodStart: '2026-09-11', periodEnd: '2026-10-10', status: 'approved' },
  { id: 'rv', invoiceNumber: 'PO-LGR-2610V', periodStart: '2026-09-11', periodEnd: '2026-10-10', status: 'void' },
]
const entries = [
  e('2026-08-20', 'held', 1000),
  e('2026-09-02', 'held', 500),
  e('2026-09-20', 'payover_paid', -1500, { runId: 'r9', reference: 'PO-LGR-2609' }),
  e('2026-10-01', 'owed', -1287.5),
  e('2026-10-05', 'owed', -3862.5),
  e('2026-10-10', 'reversal', -100),
  e('2026-10-09', 'set_off', -50, { runId: 'r10' }),
  e('2026-10-08', 'invoice_raised', -230, { reference: 'INV-7', chargeId: 'c1', description: 'Withdrawal fee' }),
  e('2026-10-15', 'held', 300),
  e('2026-10-20', 'charge_pending', -40, { chargeId: 'c2', description: 'Tracing fee' }),
]
// The database's closing balance is the plain sum in its own order.
const dbClosing = Math.round(entries.reduce((s, x) => s + x.amount, 0) * 100) / 100
const rows = ledgerByPayover(entries, runs)
const by = (key) => rows.find((r) => r.key === key)

ok('the earlier payover is one line', !!by('run:r9'))
check('...carrying both payments of its period', by('run:r9')?.lines.length, 2)
check('...credited R1 500', by('run:r9')?.amount, 1500)
check('...dated the last day of its period', by('run:r9')?.on, '2026-09-10')
ok('...named by its run and period', /PO-LGR-2609 · 11 Aug 2026 – 10 Sep 2026/.test(by('run:r9')?.label ?? ''))
check('...and says where it stands', by('run:r9')?.state, 'Paid')

const r10 = by('run:r10')
ok('the PTCs of the October cycle are ONE line, not one each', !!r10)
check('...holding both PTCs, the reversal and the set-off naming the run', r10?.lines.map((l) => l.kind).sort(), ['owed', 'owed', 'reversal', 'set_off'])
check('...debited their sum', r10?.amount, -5300)
ok('a void run takes nothing', !by('run:rv'))

const paid = rows.find((r) => r.lines[0]?.kind === 'payover_paid')
ok('a payover PAID is a line of its own', !!paid && paid.lines.length === 1)
ok('...naming the payover', /Payover PO-LGR-2609 paid to the client/.test(paid?.label ?? ''))
ok('...after the payover it pays', rows.indexOf(paid) > rows.indexOf(by('run:r9')))

const inv = rows.find((r) => r.lines[0]?.kind === 'invoice_raised')
ok('an invoice is a line of its own', !!inv && inv.lines.length === 1)
ok('...with its number and what it was for', /Invoice INV-7: Withdrawal fee/.test(inv?.label ?? ''))
const charge = rows.find((r) => r.lines[0]?.kind === 'charge_pending')
check('a charge waiting for a payover is a line of its own, and says so', charge?.state, 'Comes off the next payover')

const open = by('open:2026-10-11')
ok('money after the last run is one line for its cycle', !!open && open.lines.length === 1)
check('...saying it is not on a payover yet', open?.state, 'Not on a payover yet')

check('the regrouped ledger closes on the database\'s closing balance', rows[rows.length - 1].balance, dbClosing)
check('every line is in exactly one row', rows.reduce((s, r) => s + r.lines.length, 0), entries.length)
ok('rows are in date order', rows.every((r, i) => i === 0 || rows[i - 1].on <= r.on))

check('the cycle of the 10th is the one that ends on it', cycleOf('2026-10-10'), { start: '2026-09-11', end: '2026-10-10' })
check('the cycle of the 11th starts on it', cycleOf('2026-10-11'), { start: '2026-10-11', end: '2026-11-10' })
check('a January day before the 11th is December\'s cycle', cycleOf('2027-01-05'), { start: '2026-12-11', end: '2027-01-10' })

const panel = read('src/components/companies/ClientAccountPanel.tsx')
ok('the panel draws the grouped rows', /ledgerByPayover\(entries, runs\)/.test(panel))
ok('...with Debit and Credit columns', />Debit</.test(panel) && />Credit</.test(panel))
ok('...and no Account column on the payover line (the account is in the detail)', !/>Account<\/th>/.test(panel))

const detail = read('src/pages/companies/CompanyDetail.tsx')
const pIdx = detail.indexOf("id: 'Payovers' as const")
const aIdx = detail.indexOf("id: 'Account' as const")
ok('both tabs exist', pIdx > 0 && aIdx > 0)
ok('the Account tab sits to the right of Payovers', aIdx > pIdx)

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-client-ledger: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
