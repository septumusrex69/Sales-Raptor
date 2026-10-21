/**
 * THE TRUST OVERVIEW SHOWS ONLY MONEY IN THE ACCOUNT NOW, AND WHAT NEEDS DOING (S7).
 *
 * The firm, 13 Oct, at "Earlier collections ... R12 167.54" for cycles paid out months before: "which
 * is not applicable to any money that's currently in the trust." On the firm's own screen that day
 * (R25 750 accounted for): four cycles' gross firm shares and a -R40 982.05 drawings line. Held here:
 * the same R25 750, regrouped -- clients only where their money is still in, the firm as one line net
 * of what it drew, debtors -- adding to exactly the figure "accounted for" reads; and Needs doing
 * lists each job with where it is done, the shortfall first and red, and nothing when there is nothing.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-trust-overview.mjs
 */
import { currentHoldings, todoItems } from '../../src/lib/trustOverview.ts'
import { accountedFromCash } from '../../src/lib/trustUnaccounted.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const cyc = (start, forClients, forFirm, firmOther = 0, forDebtors = 0, isOpen = false) => ({ periodStart: start, periodEnd: start, paysOn: start, isOpen,
  forClients, forFirm, firmSetOff: 0, firmOther, forDebtors, unplaced: 0, total: 0 })
/* The firm's screen, 13 Oct. */
const cash = [
  cyc('2026-05-11', 356.25, 11811.29), cyc('2026-06-11', 748.12, 15435.24), cyc('2026-07-11', 0, 12631.15),
  cyc('2026-08-11', 13873.56, 11473.21, -40982.05, 403.23), cyc('2026-09-11', 0, 0, 0, 0, true),
]
const h = currentHoldings({ cash, firm: { drawable: 0, waiting: 11473.21 }, kept: 0, label: (c) => c.periodStart, payDay: (d) => d })
check('only cycles whose clients\' money is still in, the firm once, the debtors once', h.map((x) => [x.key, x.amount]),
  [['clients-2026-05-11', 356.25], ['clients-2026-06-11', 748.12], ['clients-2026-08-11', 13873.56], ['firm', 10368.84], ['debtors', 403.23]])
check('a cycle paid out is not listed at all', h.some((x) => x.key === 'clients-2026-07-11'), false)
check('...and the open cycle with nothing in it neither', h.some((x) => x.key === 'clients-2026-09-11'), false)
check('the lines add to exactly what "accounted for" reads', Math.round(h.reduce((t, x) => t + x.amount, 0) * 100) / 100, accountedFromCash(cash))
check('...which is R25 750.00', accountedFromCash(cash), 25750)
check('the firm line says what may be drawn and what waits', /R 0\.00 may be drawn now, R 11 473\.21 waits for its clients/.test(h.find((x) => x.key === 'firm').what), true)
const kept = currentHoldings({ cash: [cyc('2026-08-11', 0, 0, 0, 500)], firm: null, kept: 120, label: () => '', payDay: (d) => d })
check('overpayments kept are their own line, taken out of the debtors\'', kept.map((x) => [x.key, x.amount]), [['debtors', 380], ['kept', 120]])

const base = { notAccounted: 0, suspense: { count: 0, amount: 0 }, linesToAllocate: 0, overpaymentsToDecide: 0, overduePayovers: [],
  paymentsOut: { ready: 0, readyAmount: 0, pending: 0 }, clientsOwe: { count: 0, total: 0 }, firmDrawable: 0 }
check('nothing to do is nothing listed', todoItems(base), [])
const t = todoItems({ ...base, notAccounted: -1000, suspense: { count: 2, amount: 788.4 }, linesToAllocate: 1, overpaymentsToDecide: 1,
  paymentsOut: { ready: 2, readyAmount: 13426.07, pending: 3 }, clientsOwe: { count: 1, total: 3090.66 }, firmDrawable: 12543.05 })
check('every job, the shortfall first and red', t.map((x) => [x.key, x.tone]),
  [['unaccounted', 'bad'], ['suspense', 'warn'], ['lines', 'warn'], ['overpay', 'warn'], ['payout', 'info'], ['draw', 'info'], ['owe', 'info']])
check('...each opening where it is done', t.map((x) => x.to),
  ['/trust/unaccounted', '/trust/exceptions#suspense', '/trust/exceptions#lines', '/trust/exceptions#overpayments', '/trust/payments-out', '/trust/payments-out?draw=1', '/trust/clients'])
check('...in words', [t[0].label, t[1].label, t[4].detail], ['R 1 000.00 not accounted for', '2 receipts in suspense', 'R 13 426.07 in the bank file · 3 pending.'])
check('money in the bank with no owner is a warning, not a shortfall', todoItems({ ...base, notAccounted: 50 })[0].tone, 'warn')

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-trust-overview: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
