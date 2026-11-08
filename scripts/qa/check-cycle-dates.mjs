/**
 * WHICH PAYOVER CYCLE A PAYMENT BELONGS TO (Raptor H19 / S20; Stephan, 8 Nov -- replacing "the approval date
 * decides the cycle", 8 Oct).
 *
 *   "If a payment reflects in the bank account on the 10th, it reflects on the 10th."  -> a trust receipt: BANK date.
 *   "If a PTC is captured on the 10th, it reflects on the 10th, even though it was made 2 months before."
 *                                                                                   -> a PTC: CAPTURE date.
 * Approval still decides WHETHER anything posts; approved after its cycle's run had gone, a payment rides the
 * NEXT OPEN run as a late line, never by editing an approved run. Collections and commission count on the same day.
 *
 * Held against the LAST definitions in schema.sql. The behaviour was probed on staging in a rolled-back
 * transaction (HANDOFF, S20): a receipt banked 20 Sep (September's run sent) landed late on October's open run; one
 * banked 20 Oct on October's run as its own; a PTC paid 1 Sep and captured 12 Nov on November's; an unapproved
 * receipt banked 25 Oct blocked October's run.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-cycle-dates.mjs
 */
import { readFileSync } from 'node:fs'
import { cycleDay } from '../../src/lib/paymentDates.ts'

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
/* Comments stripped and whitespace folded: most of these functions explain at length what they used to do. */
function lastFn(name) {
  const re = new RegExp(`create (or replace )?function public\\.${name}\\(`, 'gi')
  let m; let at = -1
  while ((m = re.exec(schema))) at = m.index
  if (at < 0) return ''
  const tag = /\bas\s+(\$[a-z_]*\$)/i.exec(schema.slice(at))
  if (!tag) return ''
  const start = at + tag.index + tag[0].length
  return schema.slice(at, schema.indexOf(tag[1], start))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ')
}

/* ---- the one rule, and its switch ---- */
const day = lastFn('payment_cycle_day')
ok('payment_cycle_day is defined', day.length > 0)
ok('...a PTC (with the switch on) is its CAPTURE day, captured_on first', /when coalesce\(p\.paid_to_client, false\) and public\.ptc_cycle_on_capture\(\) then coalesce\(p\.captured_on, \(p\.created_at at time zone 'Africa\/Johannesburg'\)::date\)/.test(day))
ok('...anything else its BANK day, in Johannesburg', /else \(p\.received_at at time zone 'Africa\/Johannesburg'\)::date end/.test(day))
ok('...never the approval day', !/allocated_on|approved_at/.test(day))
ok('...and the staging tool\'s column, set by nothing else, wins', /coalesce\(p\.cycle_test_on,/.test(day))
ok('the switch Stephan asked to keep is ON (capture date)', /select true/.test(lastFn('ptc_cycle_on_capture')))
ok('...and ptc_on_next_payover stays OFF: a PTC runs in its capture cycle', /select false/.test(lastFn('ptc_on_next_payover')))
ok('captured_on is the staging clock\'s day at insert', /alter column captured_on set default public\.raptor_today\(\)/.test(schema))
ok('...added WITHOUT a default first, so existing rows are not stamped today', /add column if not exists captured_on date;/.test(schema))
ok('only move_payment_to_cycle writes cycle_test_on', (schema.match(/set cycle_test_on =/g) ?? []).length >= 1
  && /set cycle_test_on = v_at::date/.test(lastFn('move_payment_to_cycle')))

/* ---- own / late / not this run ---- */
const takes = lastFn('payover_run_takes')
ok('payover_run_takes is defined', takes.length > 0)
ok('...own: the day inside the run\'s own window', /when p_day >= p_period_start and p_day <= case when/.test(takes) && /then 'own'/.test(takes))
ok('...late: an earlier cycle whose run is approved, sent or paid', /when p_day < p_period_start/.test(takes)
  && /o\.period_start = c\.own and o\.status in \('approved', 'sent', 'paid'\)/.test(takes))
ok('...or older than the last cycle Raptor builds, with no open run of its own', /c\.own < c\.oldest and not exists/.test(takes))
ok('...and only the NEXT open run: none open in between', /public\.payover_run_is_open\(o\.status\) and o\.period_start > c\.own and o\.period_start < p_period_start/.test(takes))
ok('...then late', /then 'late'/.test(takes))
for (const [fn, call] of [
  ['build_payover_run', 'public.payover_run_takes(p_company, p_period_start, a.paid_to_client, public.payment_cycle_day(p)) is not null'],
  ['refresh_payover_runs', 'public.payover_run_takes(d.company_id, v_cycle, a.paid_to_client, public.payment_cycle_day(p)) is not null'],
  ['close_payover_cycle', 'public.payover_run_takes(d.company_id, v_start, a.paid_to_client, public.payment_cycle_day(p)) is not null'],
  ['payover_buildable', 'public.payover_run_takes(d.company_id, p_period_start, a.paid_to_client, public.payment_cycle_day(p)) is not null'],
]) {
  const b = lastFn(fn)
  ok(`${fn} asks payover_run_takes on the cycle day`, b.includes(call))
  ok(`...and never the approval day`, !/p\.allocated_on/.test(b))
}
const build = lastFn('build_payover_run')
ok('a late claim is written as a late LINE', /= 'late' as is_late/.test(build) && /needs_rate, late \)/.test(build) && /coalesce\(c\.is_late, false\)/.test(build))
ok('...on a run that is still open: an approved run is refused, never edited', /if v_run is not null and not public\.payover_run_is_open\(v_status\) then raise exception/.test(build))
ok('payover_run_payments reports the line\'s own late flag', /coalesce\(l\.late, false\),/.test(lastFn('payover_run_payments')))

/* ---- the run waits for what is dated in it ---- */
const blockers = lastFn('payover_run_blockers')
ok('a run is blocked by a receipt dated in its cycle that nobody approved', /select 'awaiting_approval'/.test(blockers)
  && /p\.approved_at is null and p\.rejected_at is null and p\.reversed_at is null and p\.suspended_at is null/.test(blockers)
  && /public\.payment_cycle_day\(p\) between r\.period_start and r\.period_end/.test(blockers))

/* ---- collections and commission on the same day ---- */
ok('collector_performance counts on the cycle day', /public\.payment_counts_at\(p\) >= p_from and public\.payment_counts_at\(p\) < p_to/.test(lastFn('collector_performance')))
ok('collector_daily too, and its day is the cycle day', /public\.payment_cycle_day\(p\) as on_day/.test(lastFn('collector_daily'))
  && /public\.payment_counts_at\(p\) >= p_from/.test(lastFn('collector_daily')))
const counts = lastFn('payment_counts_at')
ok('payment_counts_at is received_at for a bank receipt and the cycle day otherwise', /then p\.received_at else \(public\.payment_cycle_day\(p\)::timestamp/.test(counts))
const comm = lastFn('clerk_commission_lines')
ok('commission counts on the cycle day, a trust receipt once approved', /case when coalesce\(p\.paid_to_client, false\) or p\.approved_at is not null then public\.payment_cycle_day\(p\) end as counts_on/.test(comm))
ok('...a PTC in the period of its capture day', /coalesce\(p\.paid_to_client, false\) and public\.payment_cycle_day\(p\) <= p_to/.test(comm))
ok('...and still credits whoever held the account at approval for a trust receipt (S18, kept)', /else coalesce\(p\.approved_at, p\.received_at\) end as counts_at/.test(comm))
const ts = read('src/lib/clerkCommission.ts')
ok('the browser\'s commission reads a PTC\'s capture day too', /if \(p\.paidToClient\) return p\.countsOn \?\? p\.receivedOn/.test(ts)
  && /const ptcDay = countsOnOf\(p\) \?\? p\.receivedOn/.test(ts))

/* ---- the browser's copy of the rule ---- */
check('a trust receipt banked at Johannesburg midnight on 10 Nov is in the cycle ending 10 Nov', cycleDay({ received_at: '2026-11-09T22:00:00Z', created_at: '2026-11-12T08:00:00Z', allocated_on: '2026-11-12', approved_at: null }), '2026-11-10')
check('a PTC paid two months ago and captured on 10 Nov reflects on 10 Nov', cycleDay({ received_at: '2026-09-09T22:00:00Z', created_at: '2026-11-10T08:00:00Z', captured_on: '2026-11-10', allocated_on: null, approved_at: null, paid_to_client: true }), '2026-11-10')

/* ---- the words ---- */
ok('the import preview no longer says matched receipts are split immediately', !/split immediately/.test(read('src/pages/finance/BankImportCard.tsx')))
ok('...it says they wait for approval and belong to their statement date\'s cycle',
  /wait in the approval\s+queue/.test(read('src/pages/finance/BankImportCard.tsx')) && /payover cycle of its date on this statement/.test(read('src/pages/finance/BankImportCard.tsx')))
ok('the remittance names a late line as received and approved', /lateLineNote\(/.test(read('src/lib/remittanceAdvice.ts')))

console.log(`\ncheck-cycle-dates: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
