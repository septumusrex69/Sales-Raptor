/**
 * THE INDEPENDENT REVIEW OF S20, HELD (Raptor H19 / S20 review, 8 Nov 2026).
 *
 * Held against the LAST definitions in supabase/schema.sql (what staging runs: migrations s20_payment_lines_read_only,
 * s20_review_fixes and s20_review_restatement_grants, mirrored there):
 *  1. Nobody writes money rows directly: account_payments takes only Swordfish history from an Administrator with the
 *     trust account (never an approved Raptor receipt, a correction, cycle_test_on or a restatement link);
 *     payment_allocations, payover_runs and payover_run_lines take no direct write at all.
 *  2. The owner-rights view account_payment_lines is read only, behind a security barrier.
 *  3. The money writes ask capabilities (or Administrator WITH the trust account, where the firm's rule is
 *     Administrator), never the role alone and never with a fail-open `<>`.
 *  4. A correction holds the account row (FOR UPDATE) in propose and approve, and approval re-checks after the lock,
 *     the client's and the firm's figures included.
 *  5. restatement_figures blocks when the engine's figure for the client differs from capital less commission, or an
 *     overpayment would move; the screen shows exactly what approving posts.
 *  6. The nightly close (pg_cron, as postgres, no user) builds runs through payover_cron_caller(), which no API caller
 *     can pass; anon executes none of the money helpers; the finance reads ask finance.view.
 *
 * The behaviour was proved on staging, rolled back: scripts/qa/live/s20-later-receipt-reversal.sql (failures []),
 * and the guard probe in HANDOFF (S20 review).
 *
 * Run: node scripts/qa/check-s20-review.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const schema = read('supabase/schema.sql')
function lastFn(name) {
  const re = new RegExp(`create (or replace )?function public\\.${name}\\(`, 'gi')
  let m; let at = -1
  while ((m = re.exec(schema))) at = m.index
  if (at < 0) return ''
  const tag = /\bas\s+(\$[a-z_]*\$)/i.exec(schema.slice(at))
  if (!tag) return ''
  const start = at + tag.index + tag[0].length
  return schema.slice(at, schema.indexOf(tag[1], start))
}
/* The code alone: comments out, whitespace folded -- so a sentence in a comment can never pass a check. */
const code = (b) => b.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ')
const fn = (name) => code(lastFn(name))
function lastPolicy(name) {
  const re = new RegExp(`(create|alter) policy ${name}\\b[^;]*;`, 'g')
  let m; let last = ''
  while ((m = re.exec(schema))) last = m[0]
  return code(last)
}
const after = (needle) => schema.slice(schema.lastIndexOf(needle))

/* ---- 1. direct writes ---- */
const payIns = lastPolicy('account_payments_insert')
ok('account_payments_insert: an Administrator with the trust account', /current_user_role\(\) = 'Administrator' and public\.has_capability\('finance\.view'\)/.test(payIns))
ok('...Swordfish history only (the import)', /source = 'swordfish'/.test(payIns))
ok('...never an approved receipt that Swordfish did not remit', /\(approved_at is null or coalesce\(paid_over_in_swordfish, false\)\)/.test(payIns))
ok('...never the staging cycle column, a correction link or a restatement', /cycle_test_on is null and corrects_payment_id is null and restatement_id is null/.test(payIns))
ok('...and no longer merely a signed-in caller', !/auth\.uid\(\) is not null/.test(payIns))
for (const p of ['payment_allocations_insert', 'payover_run_lines_insert']) {
  ok(`${p}: nobody (the engine writes it)`, /with check \(false\)/.test(lastPolicy(p)))
}
ok('payover_runs_write: nobody, either way', /using \(false\) with check \(false\)/.test(lastPolicy('payover_runs_write')))
ok('the import says so before it writes, for somebody without the trust account',
  /rows\.account_payments\.length > 0 && !canViewFinance\(currentUser\)/.test(read('src/components/settings/DataImportTab.tsx')))
/* No screen writes a run, its lines or a split directly. */
for (const f of ['src/lib/payover.ts', 'src/pages/finance/RunDetail.tsx', 'src/pages/finance/FinanceWorkQueue.tsx']) {
  ok(`${f} does not write payover_runs / lines / allocations directly`,
    !/from\('(payover_runs|payover_run_lines|payment_allocations)'\)\s*\.(insert|update|upsert|delete)/.test(read(f)))
}
const fsc = lastPolicy('finance_setting_changes_insert')
ok('the settings log: with the trust account, and only as yourself', /has_capability\('finance\.view'\)/.test(fsc) && /changed_by = \(select auth\.uid\(\)\)/.test(fsc))
const grants = code(after('s20_review_restatement_grants'))
ok('the correction tables: no write grant for anon or a signed-in user',
  /revoke all on public\.payment_restatements, public\.payment_restatement_events from anon, authenticated/.test(grants)
  && /grant select on public\.payment_restatements, public\.payment_restatement_events to authenticated;/.test(grants))

/* ---- 2. the view ---- */
const view = code(after('s20_payment_lines_read_only'))
ok('account_payment_lines: every write privilege revoked', /revoke insert, update, delete, truncate, references, trigger on public\.account_payment_lines from authenticated, anon, service_role/.test(view))
ok('...behind a security barrier', /alter view public\.account_payment_lines set \(security_barrier = true\)/.test(view))

/* ---- 3. capabilities, not the role ---- */
const CAPS = [
  ['reallocate_account', /if not \(public\.has_capability\('finance\.view'\) and \(public\.has_capability\('payment\.reverse'\) or public\.has_capability\('payment\.move'\) or public\.has_capability\('payment\.approve'\)\)\) then raise exception/],
  ['mark_client_charge_paid', /if not \(public\.has_capability\('finance\.view'\) and public\.has_capability\('payover\.pay'\)\) then raise exception/],
  ['raise_client_charge', /if not \(public\.has_capability\('finance\.view'\) and public\.has_capability\('payover\.approve'\)\) then raise exception/],
  ['cancel_client_charge', /if not \(public\.has_capability\('finance\.view'\) and public\.has_capability\('payover\.approve'\)\) then raise exception/],
]
for (const [n, re] of CAPS) {
  ok(`${n} asks its capability with the trust account`, re.test(fn(n)))
  ok(`...and not the role`, !/current_user_role\(\)/.test(fn(n)))
}
for (const n of ['credit_fee', 'discard_import_batch']) {
  ok(`${n}: an Administrator (the firm's rule) WITH the trust account`,
    /if public\.current_user_role\(\) is distinct from 'Administrator' or not public\.has_capability\('finance\.view'\) then raise exception/.test(fn(n)))
}
ok('set_trust_opening_balance: no fail-open <> on the role', /current_user_role\(\) is distinct from 'Administrator'/.test(fn('set_trust_opening_balance'))
  && !/current_user_role\(\) <> /.test(fn('set_trust_opening_balance')))
ok('bring_forward_client_balances: an Administrator with the trust account', /current_user_role\(\) is distinct from 'Administrator'[\s\S]{0,80}finance\.view|finance\.view[\s\S]{0,80}current_user_role\(\) is distinct from 'Administrator'/.test(fn('bring_forward_client_balances')))

/* ---- 4. one correction at a time ---- */
const propose = fn('propose_restatement')
ok('propose_restatement holds the account row before it looks', /perform 1 from public\.debtor_accounts d join public\.account_payments p on p\.id = d\.id|perform 1 from public\.debtor_accounts d join public\.account_payments p on p\.account_id = d\.id where p\.id = p_payment for update of d/.test(propose)
  && propose.indexOf('for update of d') < propose.indexOf("status = 'proposed'"))
const approve = fn('approve_restatement')
const lockAt = approve.indexOf('perform 1 from public.debtor_accounts where id = r.account_id for update')
ok('approve_restatement holds the account row', lockAt > 0)
ok('...and works the figures out again AFTER the lock', lockAt > 0 && approve.indexOf('restatement_figures(', lockAt) > lockAt)
ok('...holding the client\'s and the firm\'s figures to what was proposed, not just capital',
  /\(f ->> 'client_correction'\) is distinct from \(r\.figures ->> 'client_correction'\)/.test(approve)
  && /\(f ->> 'firm_correction'\) is distinct from \(r\.figures ->> 'firm_correction'\)/.test(approve))

/* ---- 5. what the engine posts ---- */
const figs = fn('restatement_figures')
ok('restatement_figures sums the engine\'s own figure for the client (to_client; a PTC\'s due_to_bf)',
  /v_engine := v_engine \+ case when \(e ->> 'ptc'\)::boolean then -\(d ->> 'due_to_bf'\)::numeric else \(d ->> 'to_client'\)::numeric end/.test(figs))
ok('...blocks when it differs from capital less commission', /if round\(v_engine, 2\) <> round\(v_client, 2\) and v_blocked is null then v_blocked :=/.test(figs))
ok('...blocks an overpayment that would move (no phantom blocker on a run)', /if \(d ->> 'excess_credit'\)::numeric <> 0 and v_blocked is null then v_blocked :=/.test(figs))
ok('...and hands the engine figure to the screen', /'client_engine', round\(v_engine, 2\)/.test(figs))
const page = read('src/pages/trust/BackdatedPayments.tsx')
ok('the screen shows what approving posts, with the engine figure', /data-testid="backdated-what-posts"/.test(page) && /f\.client_engine/.test(page))
ok('the calculator\'s placeholder rows carry their own source, not \'manual\'', /'restatement placeholder', 'restatement',/.test(fn('restatement_compute'))
  && !/'restatement placeholder', 'manual'/.test(fn('restatement_compute')))

/* ---- 6. the nightly close, anon, the finance reads ---- */
const cron = fn('payover_cron_caller')
ok('payover_cron_caller: no user, and the database\'s own session', /select auth\.uid\(\) is null and session_user in \('postgres', 'supabase_admin'\)/.test(cron))
ok('...not callable from the API', /revoke all on function public\.payover_cron_caller\(\) from public, anon, authenticated/.test(code(schema)))
for (const n of ['build_payover_run', 'recompute_payover_run']) {
  ok(`${n} lets finance or the nightly close in, nobody else`, /if not public\.has_capability\('finance\.view'\) and not public\.payover_cron_caller\(\) then raise exception/.test(fn(n)))
}
ok('payover_run_blockers: finance or the nightly close', /\) b where public\.has_capability\('finance\.view'\) or public\.payover_cron_caller\(\)/.test(fn('payover_run_blockers')))
const mo = fn('account_money_out')
ok('account_money_out: staff and the server (the debtor statement), never anon', (mo.match(/and public\.money_reader\(\)/g) ?? []).length === 3)
ok('...money_reader is a profile, the service role or the close', /exists \(select 1 from public\.profiles where id = auth\.uid\(\)\) or coalesce\(current_setting\('role', true\), ''\) = 'service_role' or public\.payover_cron_caller\(\)/.test(fn('money_reader')))
ok('restatement_preview needs finance', /if not \(public\.may_approve_payment\(\) and public\.has_capability\('finance\.view'\)\) then/.test(fn('restatement_preview')))
ok('backdated_payments needs finance', /where public\.may_approve_payment\(\) and public\.has_capability\('finance\.view'\)/.test(fn('backdated_payments')))
const flat = code(schema)
for (const [f, args] of [['close_payover_cycle', 'date'], ['recompute_payover_run', 'uuid']]) {
  ok(`${f} is not callable from the API`, new RegExp(`revoke execute on function public\\.${f}\\(${args}\\) from public, anon, authenticated`).test(flat))
}
for (const f of ['payment_is_invoiced', 'allocation_is_invoiced', 'finance_held', 'profile_has_finance', 'finance_split',
  'finance_commission', 'in_duplum_cost_room', 'in_duplum_reached', 'account_charge_basis']) {
  ok(`anon does not execute ${f}`, new RegExp(`revoke execute on function public\\.${f}\\([^)]*\\) from public, anon;`).test(flat))
}
const day = fn('payment_cycle_day')
ok('payment_cycle_day: the staging tool\'s date on staging only', /case when p\.cycle_test_on is not null and exists \(select 1 from public\.deployment where kind = 'staging'\) then p\.cycle_test_on end/.test(day))
ok('payment_counts_at goes through payment_cycle_day', /public\.payment_cycle_day\(p\)/.test(fn('payment_counts_at')) && !/cycle_test_on/.test(fn('payment_counts_at')))

/* ---- the schema file still builds: the S10 copy of discard_import_batch had lost its end $$; ---- */
ok('discard_import_batch (S10 copy) is closed before the next section',
  /'clients', v_clients\);\nend \$\$;\n-- \(S20 review: this `end \$\$;` was missing/.test(schema))

if (failures.length) {
  console.log(`check-s20-review: ${pass} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-s20-review: ${pass} passed, 0 failed`)
