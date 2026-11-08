/**
 * A PAYMENT'S THREE DATES (S19; Stephan, 7 Nov: "the paid, captured, and processed data for the payments ...
 * accessible, but it doesn't have to be in your face"), and the PTC date that is no longer assumed.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-payment-three-dates.mjs
 */
import { readFileSync } from 'node:fs'
import { capturedLate, cycleDay, lateLineNote, paymentDates } from '../../src/lib/paymentDates.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, v) => check(name, v, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

/* A PTC paid 3 Jul (stored 22:00 on the 2nd, Johannesburg midnight), captured 28 Jul, approved 29 Jul. */
const ptc = paymentDates({ received_at: '2026-07-02T22:00:00Z', created_at: '2026-07-28T09:15:00Z', allocated_on: '2026-07-29', approved_at: '2026-07-29T10:00:00Z', paid_to_client: true })
check('three dates, in order (S20: Approved, not Processed)', ptc.map((d) => d.label), ['Paid', 'Captured', 'Approved'])
check('paid is the Johannesburg day, not the UTC one', ptc[0].day, '2026-07-03')
check('captured is the day it went into Raptor', ptc[1].day, '2026-07-28')
check('approved is allocated_on', ptc[2].day, '2026-07-29')
ok('a PTC says the date is the debtor paying the client', /paid the client/.test(ptc[0].note))
ok('captured three weeks after paying is worth a second look', capturedLate(ptc))

const waiting = paymentDates({ received_at: '2026-11-05T22:00:00Z', created_at: '2026-11-06T07:00:00Z', allocated_on: null, approved_at: null })
check('not yet approved: no approved date', waiting[2].day, null)
check('...and it says so', waiting[2].note, 'Waiting for approval')
ok('captured the next morning is not late', !capturedLate(waiting))
check('an older row with approved_at only still has an approved day',
  paymentDates({ received_at: null, created_at: null, allocated_on: null, approved_at: '2026-03-01T21:30:00Z' })[2].day, '2026-03-01')

/* S20: WHICH DATE PUTS IT IN A CYCLE (Stephan, 8 Nov): a trust receipt's bank date, a PTC's capture date. */
check('a PTC\'s cycle date is its CAPTURE date, not the day the debtor paid', ptc.filter((d) => d.decidesCycle).map((d) => d.label), ['Captured'])
check('...and cycleDay agrees', cycleDay({ received_at: '2026-07-02T22:00:00Z', created_at: '2026-07-28T09:15:00Z', allocated_on: '2026-07-29', approved_at: null, paid_to_client: true }), '2026-07-28')
check('...captured_on wins over created_at (the staging clock\'s day)', cycleDay({ received_at: '2026-07-02T22:00:00Z', created_at: '2026-07-28T09:15:00Z', captured_on: '2026-08-10', allocated_on: null, approved_at: null, paid_to_client: true }), '2026-08-10')
check('a trust receipt\'s cycle date is its BANK date', waiting.filter((d) => d.decidesCycle).map((d) => d.label), ['Paid'])
check('...the Johannesburg day of it', cycleDay({ received_at: '2026-11-09T22:00:00Z', created_at: '2026-11-12T07:00:00Z', allocated_on: '2026-11-12', approved_at: null }), '2026-11-10')
check('the approval date never decides a cycle', [...ptc, ...waiting].filter((d) => d.label === 'Approved' && d.decidesCycle).length, 0)
check('a late line says received and approved', lateLineNote({ paidToClient: false, receivedOn: '2026-09-20', capturedOn: '2026-11-12', approvedOn: '2026-11-12' }, (d) => d),
  'Late: received 2026-09-20, approved 2026-11-12')
check('...and a late PTC says captured', lateLineNote({ paidToClient: true, receivedOn: '2026-07-03', capturedOn: '2026-09-02', approvedOn: '2026-11-12' }, (d) => d),
  'Late: captured 2026-09-02, approved 2026-11-12')

/* THE PTC DATE STARTS EMPTY AND IS REQUIRED. */
const modal = read('src/pages/finance/RecordPaymentModal.tsx')
ok('the PTC date has its own state, starting empty', /const \[ptcOn, setPtcOn\] = useState\(''\)/.test(modal))
ok('...and a PTC records on it', /const receivedOn = paidToClient \? ptcOn : trustOn/.test(modal))
ok('nothing is ready without a date', /const ready = [^;]*!!receivedOn/.test(modal))
ok('no PTC date defaults to today', !/useState\(today\)[^\n]*\n[^\n]*ptc/i.test(modal) && !/setPtcOn\(today\)/.test(modal))

/* BOTH PLACES PAYMENTS ARE LISTED OFFER THE DATES. */
ok('the account\'s payments offer the three dates', /<PaymentDates paymentId=\{p\.id\} \/>/.test(read('src/components/accounts/AccountPaymentsList.tsx')))
ok('Payments in\'s History offers them too', /<PaymentDates paymentId=\{r\.paymentId\} \/>/.test(read('src/pages/finance/CheckPayments.tsx')))

console.log(`check-payment-three-dates: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
if (failures.length) process.exit(1)
