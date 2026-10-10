/*
 * A PTC GOES ON THE NEXT PAYOVER (10 Oct) -- BUILT, AND SWITCHED OFF UNTIL THE SWORDFISH PARALLEL RUN
 * IS DONE (the firm, the same day). Everything below holds the rule's machinery; the switch section
 * holds that it is off, so runs match Swordfish's while the two are compared.
 *
 * The firm: "if an invoice is captured on the 15th of October ... the client will be invoiced on the
 * 11th of November" -- not on 11 December, where a PTC landed while it waited out the payover delay
 * like trust money. Read back from the LAST definitions in schema.sql (it is append-only; an earlier
 * copy is superseded): build_payover_run and refresh_payover_runs claim a PTC up to the day before
 * the run's payover date, a later open run leaves it to an earlier one, an earlier run takes back one
 * a later run took, trust money keeps its own cycle, and the client ledger groups by the run that
 * claimed each payment. Probed on staging (rolled back): a 15-Oct PTC went on the 11-Sep run, the
 * 11-Oct run built after it left it, and rebuilding the earlier run took it back.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-ptc-next-payover.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')

/* The LAST `create or replace function public.<name>(` and its body, comments stripped. */
function last(name) {
  const i = schema.lastIndexOf(`create or replace function public.${name}(`)
  if (i < 0) return ''
  const body = schema.indexOf('as $$', i)
  const end = schema.indexOf('$$;', body + 5)
  return schema.slice(i, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ')
}

const build = last('build_payover_run')
const refresh = last('refresh_payover_runs')
const ledger = last('client_ledger')
ok('build_payover_run is found', build.length > 1000)
ok('refresh_payover_runs is found', refresh.length > 500)

const PTC_WINDOW = 'p.allocated_on <= case when a.paid_to_client then public.payover_ptc_until(v_end) else v_end end'
ok('a run claims a PTC up to the day before ITS payover date, trust money to its own cycle end', build.includes(PTC_WINDOW))
ok('...and the refresh finds the client on the same window, or no run is built for it', refresh.includes(PTC_WINDOW))
ok('a PTC late for an approved run is judged on that run\'s PTC window too',
  build.includes('and case when a.paid_to_client then public.payover_ptc_until(e.period_end) else e.period_end end'))
ok('a later run leaves a PTC an earlier OPEN run is due to carry',
  /and not \(a\.paid_to_client and exists \( select 1 from public\.payover_runs e where e\.company_id = p_company and e\.period_start < p_period_start and public\.payover_run_is_open\(e\.status\) and p\.allocated_on <= public\.payover_ptc_until\(e\.period_end\)\)\)/.test(build))
ok('an earlier run takes back a PTC a later open run took',
  /with freed as \( update public\.payment_allocations a set payover_run_id = null .*l\.period_start > p_period_start and public\.payover_run_is_open\(l\.status\) and a\.paid_to_client/.test(build))
ok('...and the later run\'s figures are redone', /perform public\.recompute_payover_run\(x\) from unnest\(v_later\)/.test(build))
const freed = build.indexOf('with freed as')
const claimed = build.indexOf('with claimed as')
ok('both steps are there', freed > 0 && claimed > 0)
ok('...the freeing before the claiming, or the claim misses it', freed < claimed)

/* SWITCHED OFF WHILE THE FIRM TESTS AGAINST SWORDFISH (10 Oct: "move it back into the normal run
   ... Once we've imported correctly and everything's fine, we'll make that change"). The rule is
   kept behind one switch; while it answers false, a PTC's last capture day is its cycle's own end. */
const sw = last('ptc_on_next_payover')
const until = last('payover_ptc_until')
ok('the switch exists', sw.length > 0)
ok('...and is OFF during the parallel run', /as \$\$ select false \$\$/.test(schema.slice(schema.lastIndexOf('create or replace function public.ptc_on_next_payover('))))
ok('off, a PTC\'s last day is its own cycle\'s end; on, the day before the payover',
  /select case when public\.ptc_on_next_payover\(\) then public\.payover_pays_on\(p_period_end\) - 1 else p_period_end end/.test(until))
ok('collections_by_payover reads the same switch', /when p\.paid_to_client and public\.ptc_on_next_payover\(\)/.test(last('collections_by_payover')))
ok('the client ledger names the run that claimed the payment',
  ledger.includes("coalesce(e.payover_run_id, case when e.reason like 'Payment reversed:%' then pa.reversal_carried_run_id else pa.payover_run_id end)"))

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-ptc-next-payover: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
