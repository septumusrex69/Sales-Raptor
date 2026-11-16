/**
 * What the trust account is made of, and what is ready to go (S21 · Raptor H19). Stephan, 9 Nov, on a layout he
 * liked: "what's in the account ... client portion, our portion ... the client share, which would be the payover for
 * example the last 2 months ... And then our share ... and then at the bottom all the other discrepancies".
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-trust-composition.mjs
 */
import { readFileSync } from 'node:fs'
import {
  clientShareByCycle, compositionWidths, firmShareByCycle, readyForPayover, trustComposition,
} from '../../src/lib/trustComposition.ts'
import { accountedFromCash } from '../../src/lib/trustUnaccounted.ts'

let pass = 0
const failures = []
const check = (name, a, b) => { if (Object.is(a, b)) pass += 1; else failures.push(`${name}\n    expected ${JSON.stringify(b)}\n    got      ${JSON.stringify(a)}`) }
const ok = (name, v) => check(name, v, true)

/* Two cycles, as on any day after the 11th: a closed one waiting for its pay day and the open one filling up. */
const cycle = (start, end, paysOn, isOpen, forClients, forFirm, firmOther, forDebtors) =>
  ({ periodStart: start, periodEnd: end, paysOn, isOpen, forClients, forFirm, firmSetOff: 0, firmOther, forDebtors, unplaced: 0, total: 0 })
const cash = [
  cycle('2026-09-11', '2026-10-10', '2026-11-11', false, 125000, 30000.5, -150.25, 400),
  cycle('2026-10-11', '2026-11-10', '2026-12-11', true, 42800, 9000, 0, 0),
]
const c = trustComposition(cash, 2500)
check('client funds are every cycle\'s', c.clientFunds, 167800)
check('the firm\'s share is earned plus bank items', c.firmShare, 38850.25)
check('debtor credits', c.debtorCredits, 400)
check('other holdings is what Swordfish still pays', c.otherHoldings, 2500)
/* THE BAR ADDS TO ACCOUNTED FOR: one arithmetic, read two ways. */
check('the four parts add to Accounted for, exactly', c.total, accountedFromCash(cash, 2500))
check('ready for payover is closed cycles only -- the open one is still collecting', readyForPayover(cash), 125000)
const clients = clientShareByCycle(cash)
check('the client share lists each cycle, newest first', clients.map((r) => r.periodStart).join(','), '2026-10-11,2026-09-11')
check('...a cycle with nothing for clients is left out', clientShareByCycle([cycle('2026-08-11', '2026-09-10', '2026-10-11', false, 0, 10, 0, 0)]).length, 0)
const firm = firmShareByCycle(cash)
check('our share per cycle', firm[1]?.amount, 29850.25)
check('...broken into earned and the rest', `${firm[1]?.earned}|${firm[1]?.other}`, '30000.5|-150.25')
const w = compositionWidths(c)
ok(`the bar's widths add to about 100 (${w.clients + w.firm + w.debtors + w.other})`, Math.abs(w.clients + w.firm + w.debtors + w.other - 100) < 0.5)
check('a firm short after charges draws as nothing, not a negative bar', compositionWidths({ clientFunds: 10, firmShare: -5, debtorCredits: 0, otherHoldings: 0, total: 5 }).firm, 0)

const page = readFileSync(new URL('../../src/pages/trust/TrustOverview.tsx', import.meta.url), 'utf8')
ok('the overview draws the composition from the same cycles', /trustComposition\(cash, swordfishLeft\(swordfish\)\)/.test(page))
ok('...ready for payover beside the three figures, opening the runs', /data-testid="ready-for-payover"/.test(page) && /<Figure label="Ready for payover"/.test(page))
ok('...then the client share and our share', page.indexOf('data-testid="client-share"') > 0 && page.indexOf('data-testid="firm-share"') > page.indexOf('data-testid="client-share"'))
ok('...then what needs attention, below them', page.indexOf('Needs attention') > page.indexOf('data-testid="firm-share"'))

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-trust-composition: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
