/**
 * A CLIENT PAYS WHAT IT OWES INTO THE BUSINESS ACCOUNT, MATCHED TO ITS PAYOVER (the firm, 10 Oct:
 * "that's paid to our business account, not to the trust account. So we would have to match it").
 *
 * Held here:
 *   1. it is recorded against an approved run below nil, for the whole shortfall, once, not in the
 *      future, with a reference, by somebody with both the trust and the business ticks;
 *   2. the run is then settled: never carried into a later payover (the builder and the cycle close
 *      both leave it out), off "What clients owe us, by age", and if it had been carried into a run
 *      still being checked, that run is rebuilt without it -- and if into one already approved, it
 *      refuses, because the debt was already taken;
 *   3. one trust entry, the client's, clears the minus the PTC left with no money behind it -- and
 *      the trust's cash view treats it like the PTC it pays off; the record is append-only;
 *   4. the run page offers it, the runs list says "Paid to us", the client's ledger names it.
 *
 * Proved live on staging (scripts/qa/live/staging-clock-sim.sql, run_direct): after it, the trust
 * reconciles to R0.00 at the end of cycle 3 with nothing stranded.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-client-business-receipt.mjs
 */
import { readFileSync } from 'node:fs'
import { ledgerByPayover } from '../../src/lib/clientLedger.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').replace(/^\s*\/\/.*$/gm, '')

const sql = read('supabase/schema.sql')
const lastFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const m = /\bas \$(\w*)\$([\s\S]*?)\$\1\$/.exec(sql.slice(at))
  return strip(m?.[2] ?? '')
}

/* ---------- 1. who, what, when ---------- */

const rec = lastFn('record_client_business_receipt')
ok('both ticks', /if not \(public\.has_capability\('finance\.view'\) and public\.has_capability\('business\.view'\)\) then/.test(rec))
ok('an approved run only', /if v_run\.status not in \('approved', 'sent', 'paid'\) then\s+raise exception/.test(rec))
ok('below nil only', /if coalesce\(v_run\.net_payover, 0\) >= 0 then\s+raise exception/.test(rec))
ok('once', /if v_run\.settled_direct_receipt_id is not null then\s+raise exception/.test(rec)
  && /create unique index if not exists client_business_receipts_one_per_run\s+on public\.client_business_receipts \(payover_run_id\)/.test(sql))
ok('the whole shortfall, to the cent', /round\(p_amount, 2\) <> round\(-v_run\.net_payover, 2\) then\s+raise exception/.test(rec))
ok('not in the future, on the firm\'s clock', /p_received_on > public\.raptor_today\(\) then\s+raise exception/.test(rec))
ok('with a reference', /if v_ref is null then\s+raise exception/.test(rec))

/* ---------- 2. settled means not carried, not owed ---------- */

ok('it marks the run settled', /update public\.payover_runs set settled_direct_receipt_id = v_id where id = p_run;/.test(rec))
ok('the builder does not carry a settled shortfall',
  /and r\.carried_out_run_id is null\s+and r\.settled_direct_receipt_id is null\s+order by r\.period_start desc limit 1;/.test(lastFn('build_payover_run')))
ok('...nor does the cycle close look for it',
  /and r\.carried_out_run_id is null\s+and r\.settled_direct_receipt_id is null\s+and r\.period_start < v_start/.test(lastFn('close_payover_cycle')))
ok('...and it is not owed by age',
  /r\.carried_out_run_id is null\s+and r\.settled_direct_receipt_id is null/.test(lastFn('ptc_ageing')))
const refuseAt = rec.indexOf("raise exception 'That shortfall was already taken off %")
const insertAt = rec.indexOf('insert into public.client_business_receipts')
ok('already taken off an approved payover: refused, before anything is written', refuseAt > 0 && refuseAt < insertAt)
ok('carried into a run still being checked: that run is rebuilt without it',
  /if v_into\.id is not null then\s+perform public\.build_payover_run\(v_into\.company_id, v_into\.period_start\);/.test(rec))

/* ---------- 3. the ledger ---------- */

ok('one trust entry, the client\'s, clearing the minus',
  /insert into public\.trust_creditor_entries \(party, company_id, amount, reason, payover_run_id, created_by\)\s+values \('client', v_run\.company_id, round\(p_amount, 2\),\s+'Paid to the business account against '/.test(rec))
ok('...and no firm entry in trust (the money is in the business account)', !/values \('firm'/.test(rec))
ok('the trust\'s cash view treats it like the PTC it pays off',
  /coalesce\(a\.paid_to_client, false\) or x\.reason like 'Paid to the business account%' as ptc/.test(lastFn('trust_cash_by_cycle')))
ok('the record cannot be changed or removed',
  /create or replace trigger client_business_receipts_frozen\s+before update or delete on public\.client_business_receipts/.test(sql))
ok('Clear staging empties it with the runs it points at',
  /'ate table public\.client_business_receipts, public\.payover_run_sends/.test(lastFn('clear_staging')))

/* ---------- 4. the screens ---------- */

const ledger = lastFn('client_ledger')
ok('the client ledger names it', /when e\.reason like 'Paid to the business account%' then 'paid_direct'/.test(ledger))
const rows = ledgerByPayover([
  { on: '2026-08-11', sortAt: '2026-08-11T10:00:00Z', kind: 'paid_direct', description: 'x', reference: 'PO-SMB-2608', caseNumber: null, amount: 2176.18, balance: 0, runId: 'r1', chargeId: null },
], [{ id: 'r1', invoiceNumber: 'PO-SMB-2608', periodStart: '2026-07-11', periodEnd: '2026-08-10', status: 'sent' }])
check('...as its own line, in the firm\'s words', rows.map((r) => r.label), ['Paid to our business account against PO-SMB-2608'])
const page = strip(read('src/pages/finance/RunDetail.tsx'))
ok('the run page offers it on a run below nil', /\{run\.net_payover < 0 && \(\s+<ClientPaidUs run=\{run\} receipt=\{receipt\}/.test(page))
ok('...only with both ticks and an approved run', /const may = canViewFinance\(currentUser\) && canViewBusiness\(currentUser\)/.test(page)
  && /!\['approved', 'sent', 'paid'\]\.includes\(run\.status\)/.test(page))
ok('...the amount is the shortfall, not typed', /recordClientPayment\(\{ runId: run\.id, amount: owed,/.test(page))
const queue = strip(read('src/pages/finance/FinanceWorkQueue.tsx'))
ok('the runs list says Paid to us', /r\.netPayover < 0 && settled\.has\(r\.runId\) \?/.test(queue) && /Paid to us/.test(queue))

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-client-business-receipt: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
