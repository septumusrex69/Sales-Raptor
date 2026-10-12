/**
 * "NOT ACCOUNTED FOR", EVERY ITEM IN ONE LIST (S7).
 *
 * The firm, 12 Oct: "If I click on that, it should show me everything." What this holds: the items
 * add up to the overview's figure or a remainder line says how far they do not; a payment marked paid
 * and not yet on a statement RAISES the figure (the bank still holds it -- the overview used to call
 * that "in the bank, not yet in the books", which is backwards); an unallocated receipt raises it and
 * an unexplained debit lowers it; confirmed payments out are not listed; the overview's figure opens
 * the list; and the overview and the list read "accounted for" from one function.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-trust-unaccounted.mjs
 */
import { readFileSync } from 'node:fs'
import { accountedFromCash, unaccountedItems } from '../../src/lib/trustUnaccounted.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const out = (kind, id, amount, confirmed = false) => ({ kind, id, payee: `Payee ${id}`, amount, reference: null,
  paidAt: '2026-08-11T09:00:00Z', paidReference: `BF ${id}`, confirmed, statementDate: confirmed ? '2026-08-12' : null,
  accountId: null, caseNumber: kind === 'payover' ? `PO-${id}` : null })

/* STAGING, 12 OCT, TO THE CENT: three payovers and two refunds marked paid, none on a statement. */
const staging = [
  out('payover', 'KLR-2607', 4451.47), out('payover', 'HTH-2607', 4538.60), out('payover', 'SBB-2607', 2343.10),
  out('refund', 'R1', 1925.47), out('refund', 'R2', 1000),
  /* Confirmed on the statement: already out of the bank, nothing to explain. */
  out('payover', 'KLR-2606', 4775.05, true),
]
const s = unaccountedItems({ notAccounted: 14258.64, lines: [], awaiting: null, paidOut: staging, openingSet: true })
check('staging\'s R14 258.64 is fully explained by what was marked paid and not yet on a statement', [s.explained, s.remainder], [14258.64, 0])
check('...one line each, confirmed ones left out', s.items.length, 5)
check('...in their own group, biggest first', s.items.map((i) => [i.group, i.amount]),
  [['paid_out', 4538.6], ['paid_out', 4451.47], ['paid_out', 2343.1], ['paid_out', 1925.47], ['paid_out', 1000]])
check('...a payover opens its run', s.items[0].action, { label: 'Open the run', to: '/trust/runs/HTH-2607' })
check('...a refund goes to Payments to make', s.items[3].action.to, '/trust/payments-out')
check('...and names how it was marked paid', s.items[0].detail, 'Payover, marked paid on BF HTH-2607')

/* A STATEMENT LINE: a receipt raises the figure, a debit lowers it; awaiting raises it. */
const line = (id, amount, description) => ({ id, txnDate: '2026-08-05', amount, description, direction: amount < 0 ? 'debit' : 'credit',
  reference: null, bankAccount: '1', bankAccountLabel: null })
const m = unaccountedItems({
  notAccounted: 500 - 57.5 + 800 + 10, openingSet: true, paidOut: [],
  lines: [line('a', 500, 'CAPITEC T NGUBANE'), line('b', -57.5, '##BANK CHARGE')],
  awaiting: { amount: 800, payments: 2 },
})
check('lines and approvals add up, signed by their effect', m.items.filter((i) => i.group !== 'unexplained').map((i) => i.amount), [500, -57.5, 800])
check('...what they do not explain is its own line', m.items.at(-1), {
  key: 'remainder', group: 'unexplained', date: null, title: 'The bank holds more than the items explain',
  detail: 'Money in the account that no record here gives an owner', amount: 10,
  action: { label: 'Open the trust ledger', to: '/trust/ledger' },
})
check('...a receipt is placed, a charge booked', m.items.slice(0, 2).map((i) => i.action.label), ['Place it', 'Book as a bank charge'])
check('...approvals go to Payments in', m.items[2].action.to, '/trust/payments')
check('the items always add up to the figure, remainder included', Math.round(m.items.reduce((t, i) => t + i.amount, 0) * 100) / 100, 1252.5)
const noOpening = unaccountedItems({ notAccounted: -20, lines: [], awaiting: null, paidOut: [], openingSet: false })
check('with no opening balance the remainder says so, and where to capture it', [noOpening.items[0].detail, noOpening.items[0].action.to],
  ['No opening balance is captured, so the bank figure is only the statements imported so far', '/trust/settings'])
check('nothing to explain is an empty list', unaccountedItems({ notAccounted: 0, lines: [], awaiting: { amount: 0, payments: 0 }, paidOut: [], openingSet: true }).items, [])
check('accounted for adds clients, firm, firm\'s other and debtors', accountedFromCash([
  { forClients: 356.25, forFirm: 11811.29, firmOther: 0, forDebtors: 0 },
  { forClients: 14118.85, forFirm: 12631.15, firmOther: -78.85, forDebtors: 1000 },
]), 39838.69)

const ov = readFileSync(new URL('../../src/pages/trust/TrustOverview.tsx', import.meta.url), 'utf8')
check('the overview\'s figure opens the list', /to="\/trust\/unaccounted" data-testid="open-unaccounted"/.test(ov), true)
check('...and reads accounted for from the same function', /const accounted = accountedFromCash\(cash\)/.test(ov), true)
check('...and no longer calls marked-paid money "in the bank, not yet in the books"', /'In the bank, not yet in the books'/.test(ov), false)
const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
check('the list has its address under Trust', /path="unaccounted" element=\{<TrustUnaccounted \/>\}/.test(app), true)

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-trust-unaccounted: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
