/**
 * THE CLIENT PAGE'S TWO RINGS (S8, 18 Oct): outcomes with the recovery rate, withdrawn left out; and
 * the active accounts by where they stand.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-client-outcomes.mjs
 */
import { readFileSync } from 'node:fs'
import { outcomeRing, positionRing } from '../../src/lib/clientOutcomes.ts'

let pass = 0
const failures = []
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }
const check = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want))

const r = outcomeRing([
  { outcome: 'recovered', accounts: 3, capital: 30000, collected: 30000 },
  { outcome: 'active', accounts: 5, capital: 50000, collected: 5000 },
  { outcome: 'closed', accounts: 2, capital: 20000, collected: 0 },
])
check('three slices in the firm\'s order, with shares', r.slices.map((s) => [s.key, s.accounts, s.pct]), [['recovered', 3, 30], ['active', 5, 50], ['closed', 2, 20]])
check('...and the recovery rate: collected over capital', r.recoveryRate, 35)
check('nothing handed over: no rate', outcomeRing([]).recoveryRate, null)
check('the active ones by rung, busiest first', positionRing([
  { status: 'Active', subStatus: 'Tracing' }, { status: 'Active', subStatus: null }, { status: 'Active', subStatus: null },
]).map((p) => [p.label, p.accounts, p.pct]), [['In progress', 2, 67], ['Tracing', 1, 33]])

const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const fn = sql.slice(sql.lastIndexOf('create or replace function public.client_account_outcomes('))
const body = fn.slice(0, fn.indexOf('$$;'))
ok('withdrawn accounts are left out of the counts and the rate', /a\.ended_as is distinct from 'withdrawn'/.test(body))
ok('recovered is paid up or settled', /when a\.ended_as in \('paid_up', 'settled'\) then 'recovered'/.test(body))
ok('collected leaves reversals and rejections out', /p\.reversed_at is null and p\.rejected_at is null/.test(body))
ok('a client is counted with its sub-accounts', /coalesce\(c\.parent_company_id, c\.id\) = p_client/.test(body))
ok('...as the caller', /security invoker/.test(fn.slice(0, 300)))

if (failures.length) { console.error(`check-client-outcomes: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`); process.exit(1) }
console.log(`check-client-outcomes: ${pass} passed, 0 failed`)
