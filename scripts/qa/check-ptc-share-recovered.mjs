/**
 * THE FIRM'S PTC SHARE, RECOVERED BY SET-OFF, IS THE FIRM'S IN THE LEDGER AND CAN BE TRANSFERRED
 * (the firm, 10 Oct: "when a PTC debt is taken off a later payment, the firm's share should stay in
 * the trust. And it should be able to be transferred to the business account").
 *
 * Held here: when a run is approved, ONE firm entry for the PTC share it recovered --
 *   PTC debt on approved runs, less what this run still leaves short (read as PTC debt first),
 *   less what was already credited or paid into the business account.
 * And the Trust overview, which already read that money as the firm's, does not count it twice.
 *
 * Proved live on staging (scripts/qa/live/staging-clock-sim.sql): R2 176.18 credited on PO-SMB-2609,
 * transferred with the BF fees, the trust at exactly R0.00 after cycle 3; with the client paying into
 * the business account instead, nothing is credited and the trust is still R0.00.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-ptc-share-recovered.mjs
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
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
const sql = read('supabase/schema.sql')
const lastFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const m = /\bas \$(\w*)\$([\s\S]*?)\$\1\$/.exec(sql.slice(at))
  return strip(m?.[2] ?? '')
}

const trig = lastFn('trust_creditors_on_run')
const approvalAt = trig.indexOf("if public.payover_run_is_open(old.status) and not public.payover_run_is_open(new.status)")
const shareAt = trig.indexOf('select coalesce(-sum(e.amount), 0) into v_ptc_debt')
const paidAt = trig.indexOf('if old.paid_at is null and new.paid_at is not null')
ok('it is written when the run is approved, not when it is paid', approvalAt >= 0 && shareAt > approvalAt && shareAt < paidAt)
ok('the PTC debt is what the client was debited for PTCs on approved runs',
  /from public\.trust_creditor_entries e\s+join public\.payment_allocations a on a\.id = e\.allocation_id\s+join public\.payover_runs r on r\.id = a\.payover_run_id\s+where e\.party = 'client' and e\.company_id = new\.company_id and a\.paid_to_client\s+and r\.status in \('approved', 'sent', 'paid'\);/.test(trig))
ok('...less what was already credited, or paid into the business account',
  /e\.party = 'firm' and e\.reason like 'PTC share recovered%'\)\s+or \(e\.party = 'client' and e\.reason like 'Paid to the business account%'\)/.test(trig))
ok('...and less what this run still leaves short, read as PTC debt first',
  /v_now := round\(greatest\(v_ptc_debt - greatest\(-coalesce\(new\.net_payover, 0\), 0\), 0\) - v_recovered, 2\);/.test(trig))
ok('one firm entry for the difference, named by the run',
  /values \('firm', new\.company_id, v_now,\s+case when v_now > 0 then 'PTC share recovered from payover '/.test(trig))
ok('...a reversed PTC takes back a share already credited', /'PTC share recovered, taken back \(a PTC was reversed\), on '/.test(trig))
ok('...and nothing is written when there is nothing to say', /if v_now <> 0 then/.test(trig))
const cash = lastFn('trust_cash_by_cycle')
ok('the Trust overview does not count it twice',
  /party = 'firm' and not from_receipt\s+and coalesce\(reason, ''\) not like 'PTC share recovered%'/.test(cash))

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-ptc-share-recovered: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
