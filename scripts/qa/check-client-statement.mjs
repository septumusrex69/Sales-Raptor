/**
 * A CLIENT PAYS AGAINST ITS STATEMENT, ANY AMOUNT, OLDEST FIRST; AN ARRANGEMENT IS A SCHEDULE (S7).
 *
 * The firm, 12 Oct: "what if the client pays partially? What if he makes an installment arrangement
 * ... shouldn't we just have a statement?" -- approved 13 Oct. The money rules live in
 * record_client_payment and were proved on staging (a rolled-back probe, see HANDOFF); what this holds
 * is the part that is code here: whether an arrangement is being kept (cumulative, payments since it
 * was made, the 31st in a short month), and that schema.sql records the SQL the way it went live --
 * applied oldest first, more than owed refused, a shortfall paid in part carried at what is still
 * owed, an invoice marked paid only when covered.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-client-statement.mjs
 */
import { readFileSync } from 'node:fs'
import { arrangementStatus, dueDates } from '../../src/lib/clientArrangement.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
check('due once a month on the same day', dueDates('2026-09-15', 3), ['2026-09-15', '2026-10-15', '2026-11-15'])
check('the 31st in a short month is its last day, not the 1st of the next', dueDates('2026-01-31', 3), ['2026-01-31', '2026-02-28', '2026-03-31'])
const arr = { id: 'a', instalment: 1000, firstDue: '2026-09-15', instalments: 3, createdAt: '2026-09-10T08:00:00Z', note: null }
check('before the first date nothing is due and nobody is behind', (() => { const s = arrangementStatus(arr, [], '2026-09-14'); return [s.dueSoFar, s.behind, s.nextDue] })(),
  [0, 0, '2026-09-15'])
check('a missed instalment is behind by it', arrangementStatus(arr, [], '2026-09-20').behind, 1000)
check('paid ahead in month one is not behind in month two', arrangementStatus(arr, [{ amount: 2000, receivedOn: '2026-09-16' }], '2026-10-16').behind, 0)
check('a payment before the arrangement was made does not count towards it',
  arrangementStatus(arr, [{ amount: 1000, receivedOn: '2026-09-01' }], '2026-09-20').behind, 1000)
check('a part instalment leaves the rest behind', arrangementStatus(arr, [{ amount: 400, receivedOn: '2026-09-15' }], '2026-09-20').behind, 600)
check('paid in full is finished', arrangementStatus(arr, [{ amount: 3000, receivedOn: '2026-09-20' }], '2026-09-21').finished, true)

const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const lastFn = (name) => {
  const i = sql.lastIndexOf(`create or replace function public.${name}(`)
  return i < 0 ? '' : sql.slice(i, sql.indexOf('$$;', sql.indexOf('$$', i) + 2))
}
const rec = lastFn('record_client_payment')
check('record_client_payment is in schema.sql', rec.length > 500, true)
check('...applies in the order of client_owed_items, oldest first', /for v_item in select \* from public\.client_owed_items\(p_company\) loop/.test(rec)
  && /order by x\.due_on, x\.label/.test(lastFn('client_owed_items')), true)
check('...refuses more than is owed', /if v_amount > v_owed then\s+raise exception/.test(rec), true)
check('...settles a shortfall only when it is covered', /if v_take >= v_item\.remaining then\s+update public\.payover_runs set settled_direct_receipt_id = v_id/.test(rec), true)
check('...marks an invoice paid only when it is covered', /if v_take >= v_item\.remaining then\s+update public\.client_charges/.test(rec), true)
check('...needs both ticks', /has_capability\('finance\.view'\) and public\.has_capability\('business\.view'\)/.test(rec), true)
const carry = lastFn('carry_what_is_still_owed')
check('a shortfall paid in part is carried at what is still owed', /new\.carried_amount := round\(new\.carried_amount \+ public\.client_run_paid\(v_prev\), 2\)/.test(carry), true)
check('...from the run build_payover_run carries, found the same way', /r\.carried_out_run_id is null\s+and r\.settled_direct_receipt_id is null\s+order by r\.period_start desc limit 1/.test(carry), true)
check('the old one-run entry point records against the client', /return public\.record_client_payment\(v_company/.test(lastFn('record_client_business_receipt')), true)
check('what clients owe, by age, reads the part paid', /round\(-h\.net_payover - public\.client_run_paid\(h\.id\), 2\)/.test(lastFn('ptc_ageing')), true)

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-client-statement: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
