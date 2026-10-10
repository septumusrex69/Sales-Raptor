/*
 * THE TRUST OVERVIEW, SPLIT: THE BANK, AND THE PTCs (10 Oct).
 *
 * The firm: "Everything that's in the trust, this is what it's for ... Now you've incorporated PTCs
 * in this, and I don't think that's the right thing to do. We should report on that separately."
 * Holds: what is accounted for is the money in the bank (no PTC entry, a paid payover's kept-back
 * money is the firm's); the PTCs are their own section, set off / short per payover; the age
 * analysis buckets from the payover date that invoiced it; and each payover's collections are
 * counted from the payments and held against the runs.
 *
 * Staging, 10 Oct: the bank money by cycle came to R16 567.38 -- the ledger (-R10 088.87) plus the
 * R26 656.25 of PTCs, to the cent -- and both payovers agreed with their runs.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-trust-split.mjs
 */
import { readFileSync } from 'node:fs'
import { ageAnalysis, ageBucket } from '../../src/lib/ptcAgeing.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const schema = read('supabase/schema.sql')
function last(name) {
  const i = schema.lastIndexOf(`create or replace function public.${name}(`)
  if (i < 0) return ''
  const body = schema.indexOf('as $$', i)
  return schema.slice(i, schema.indexOf('$$;', body + 5)).replace(/--[^\n]*/g, '').replace(/\s+/g, ' ')
}

/* ---- the age analysis ---- */
check('before the payover date it is not yet invoiced', ageBucket('2026-11-11', '2026-10-10'), 'not_yet')
check('on the payover date it is current', ageBucket('2026-11-11', '2026-11-11'), 'current')
check('30 days on, still current', ageBucket('2026-10-11', '2026-11-10'), 'current')
check('31 days on, 31-60', ageBucket('2026-10-11', '2026-11-11'), 'd31')
check('61 days on, 61-90', ageBucket('2026-08-11', '2026-10-11'), 'd61')
check('91 days on, 90+', ageBucket('2026-07-11', '2026-10-10'), 'd91')
const a = ageAnalysis([
  { companyId: 'j', client: 'Jacaranda', owed: 12493.75, since: '2026-10-11', runId: 'r1', invoiceNumber: 'PO-JCP-2609', invoiced: true },
  { companyId: 'l', client: 'Lowveld', owed: 14162.50, since: '2026-11-11', runId: 'r2', invoiceNumber: 'PO-LGR-2610', invoiced: false },
  { companyId: 'j', client: 'Jacaranda', owed: 100, since: '2026-08-01', runId: 'r3', invoiceNumber: null, invoiced: true },
], '2026-11-05')
check('Lowveld, invoiced on 11 Nov, is not yet invoiced on 5 Nov', a.rows[0]?.buckets.not_yet, 14162.5)
check('one row a client, the biggest debt first', a.rows.map((r) => r.client), ['Lowveld', 'Jacaranda'])
check('...a client\'s debts spread across their buckets', a.rows[1]?.buckets, { not_yet: 0, current: 12493.75, d31: 0, d61: 0, d91: 100 })
check('the total is every debt once', a.total, 26756.25)
check('...and the columns add up to it', Object.values(a.totals).reduce((s, v) => s + v, 0), 26756.25)

/* ---- the database functions ---- */
const cash = last('trust_cash_by_cycle')
ok('trust_cash_by_cycle is found', cash.length > 500)
ok('...leaves a PTC\'s entry out of the clients\' money', /filter \(where party = 'client' and not ptc and not run_paid\)/.test(cash))
ok('...and reads what a PAID payover kept back as the firm\'s', /filter \(where party = 'client' and not ptc and run_paid\), 0\) as kept_back/.test(cash)
  && /round\(a\.firm_earned \+ a\.kept_back, 2\)/.test(cash))
ok('...a reversal is placed on the run it was carried into', /when x\.reason like 'Payment reversed:%' then a\.reversal_carried_run_id/.test(cash))
const byRun = last('ptc_by_run')
ok('ptc_by_run: short is what the run nets below nil, at most what is owed', /least\(o\.owed, greatest\(0, -r\.net_payover\)\)/.test(byRun))
ok('...and set off is the rest', /round\(o\.owed - least\(o\.owed, greatest\(0, -r\.net_payover\)\), 2\)/.test(byRun))
const ageing = last('ptc_ageing')
ok('ptc_ageing walks a carried shortfall back to the payover that first invoiced it',
  /with recursive/.test(ageing) && /join public\.payover_runs p on p\.carried_out_run_id = b\.cur/.test(ageing))
const tie = last('collections_by_payover')
ok('collections_by_payover counts a claimed payment on the run that carries it',
  /from public\.payment_allocations a join public\.payover_runs r on r\.id = a\.payover_run_id where a\.payment_id = p\.id/.test(tie))
ok('...and an unclaimed PTC on the next 11th after it was captured',
  /when extract\(day from p\.allocated_on\) >= 11 then interval '1 month'/.test(tie))
for (const fn of ['trust_cash_by_cycle', 'ptc_by_run', 'ptc_ageing', 'collections_by_payover']) {
  ok(`${fn} is for finance.view only`, /public\.has_capability\('finance\.view'\)/.test(last(fn)))
  ok(`...and revoked from public and anon`, schema.includes(`revoke all on function public.${fn}() from public, anon;`))
}

/* ---- the page ---- */
const page = read('src/pages/trust/TrustOverview.tsx')
ok('the overview reads the bank money by cycle', /fetchTrustCashByCycle\(\)/.test(page))
const order = ['What is in the trust account', 'Paid straight to clients (PTCs)', 'What clients owe us, by age', 'Each payover, checked']
const at = order.map((h) => page.indexOf(h))
ok('the four sections are all there', at.every((i) => i > 0))
ok('...in the order the firm reads them: the bank, the PTCs, the ages, the check', at.every((i, k) => k === 0 || at[k - 1] < i))
ok('the old "owed back by clients" line is gone from the bank list', !/Less: owed back by clients/.test(page))

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-trust-split: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
