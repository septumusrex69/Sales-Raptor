/**
 * BUILDING A PAYOVER RUN, AND TESTING THE LOOP MORE THAN ONCE.
 *
 * THE FIRM asked where the payover report was. It is the remittance advice on the run's own page
 * -- and it was unreachable, because nothing in the app could create a run. `build_payover_run`
 * existed and worked; it was called from ONE place, the Exceptions screen, as a REBUILD after
 * somebody fixed a commission rate. With no run to rebuild, the Payover queue listed nothing, had
 * no button, and the report had nothing to hang off.
 *
 * THEN: "do I need to wait for the 11th or whatever? What can we do to speed up these tests?"
 * No -- the cycle date was never a gate; build takes any period start and has no clock in it at
 * all. What actually stood in the way was three things, and the first two are production bugs that
 * testing merely found first:
 *
 *   1. A VOIDED RUN HELD ITS CYCLE SHUT FOR EVER. Void released everything and sent nothing, and
 *      then UNIQUE (company_id, period_start) kept the empty row in the slot while build refused
 *      it and the delete guard refused to remove it. Pressing Void was the one irreversible action
 *      in the Finance section and nothing said so.
 *   2. THE FIRST RUN COULD NOT BE BUILT AT ALL -- the gap above.
 *   3. A FINISHED RUN COULD NEVER BE RUN AGAIN, which is right for an issued invoice and makes the
 *      approve-email-paid loop a once-per-client-per-cycle affair while the firm is still testing
 *      it.
 *
 * AND ONE TRAP THAT FAILS QUIETLY, which is why it is asserted hardest: a run claims on
 * `account_payments.created_at`, NOT the received date somebody types. Backdating a receipt looks
 * like it worked and still lands in today's cycle, so a test of last month's carry-forward
 * silently tests nothing.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-payover-build.mjs
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
const no = (name, actual) => check(name, actual, false)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')

const sql = read('supabase/schema.sql')
const lib = code('src/lib/payover.ts')
const queue = code('src/pages/finance/FinanceWorkQueue.tsx')

/* schema.sql is append-only: the LAST definition is the live one, and the opening paren keeps
   lastIndexOf off the function's own revoke line and comment. */
function liveBody(name) {
  const at = Math.max(
    sql.lastIndexOf(`create or replace function public.${name}(`),
    sql.lastIndexOf(`create function public.${name}(`),
  )
  if (at < 0) return null
  const end = sql.indexOf('$$;', at)
  return end < 0 ? null : sql.slice(at, end + 3)
}

const build = liveBody('build_payover_run')
const guard = liveBody('protect_payover_run')
const reset = liveBody('reset_payover_run')
const move = liveBody('move_payment_to_cycle')
const buildable = liveBody('payover_buildable')
const staging = liveBody('is_staging_database')

for (const [name, body] of Object.entries({
  build_payover_run: build, protect_payover_run: guard, reset_payover_run: reset,
  move_payment_to_cycle: move, payover_buildable: buildable, is_staging_database: staging,
})) ok(`schema.sql defines ${name}`, typeof body === 'string' && body.length > 80)

/* ---------------- the cycle date is not a gate, and never was ---------------- */

/*
 * THE WHOLE ANSWER TO "DO I NEED TO WAIT FOR THE 11th". Asserted as an ABSENCE, which is the
 * weaker kind of assertion and the right one here: what must stay true is that nothing starts
 * comparing the cycle against today and quietly makes the firm wait a month to test anything.
 */
/*
 * NO TRAILING \b ON THIS ONE. It was written /\b(now\(\)|current_date)\b/ and passed happily with
 * `now()::date` put into the live function: `)` and `:` are both non-word characters, so there is
 * no word boundary between them and the pattern could never match the one spelling it most needed
 * to catch. Found by breaking it, which is the only way that kind of mistake shows up.
 */
no('building a run does not consult today at all',
  /\bnow\(\)|\bcurrent_date\b|\bclock_timestamp\(\)/.test(build ?? ''))
ok('...it takes the cycle it is given', /p_period_start date/.test(build ?? ''))

/* ---------------- 1. a voided run no longer holds its cycle ---------------- */

ok('a void run is cleared rather than refused',
  /if v_run is not null and v_status = 'void' then\s*\n\s*delete from public\.payover_runs where id = v_run;\s*\n\s*v_run := null;/.test(build ?? ''))
/* AND THE DELETE GUARD LETS IT GO, or the clear above raises instead. */
ok('...and the guard allows removing one', /if old\.status = 'void' then return old; end if;/.test(guard ?? ''))
/* THE SLOT IS WHY THIS MATTERS AT ALL. Without the unique constraint a stale void row would be
   harmless; with it, leaving the row is leaving the cycle shut. */
ok('one run per client per cycle is still the rule',
  /payover_runs_one_per_client_per_cycle|unique \(company_id, period_start\)/i.test(sql))
/* AND AN ISSUED INVOICE IS EXACTLY AS UNTOUCHABLE AS IT WAS. */
ok('an approved, sent or paid run is still refused by build',
  /not public\.payover_run_is_open\(v_status\) then\s*\n\s*raise exception 'The % run for this client is already %/.test(build ?? ''))
ok('...and still cannot be deleted', /an invoice is not deleted/.test(guard ?? ''))
ok('...and still cannot go back to being a working document',
  /it cannot go back to being a working document/.test(guard ?? ''))

/* ---------------- 2. which database is this ---------------- */

/*
 * SQL CANNOT TELL ON ITS OWN -- both projects' databases are called postgres and carry no project
 * ref -- so the answer is a row, and the point is that nothing in the app can write it.
 */
ok('there is a deployment row', /create table if not exists public\.deployment/.test(sql))
ok('...which defaults to production', /kind text not null default 'production'/.test(sql))
ok('...readable by somebody signed in', /create policy deployment_select on public\.deployment/.test(sql))
/* NO WRITE POLICY AND THE GRANTS REVOKED -- the same reasoning as the ledgers, which is what makes
   the financial records immutable rather than merely un-edited. */
ok('...and writable by nobody', /revoke insert, update, delete on public\.deployment from authenticated, anon/.test(sql))
no('...with no write policy to let an Administrator past',
  /create policy \w+ on public\.deployment\s*\n?\s*for (insert|update|delete|all)/.test(sql))
/*
 * AND THE LINE THAT WOULD SET IT TO STAGING IS NOT IN THIS FILE. schema.sql is applied to every
 * database including production; a 'staging' in here would make production a test database, which
 * is the exact mistake the row exists to prevent. It is run by hand against staging alone.
 */
no('schema.sql never declares a database to be staging',
  /(insert into|update)\s+public\.deployment[\s\S]{0,120}'staging'/.test(sql))

/* ---------------- 3. the two test controls, and both locks on each ---------------- */

/*
 * EACH GATED, AND THE TWO ARE SPELLED DIFFERENTLY ON PURPOSE.
 *
 * move_payment_to_cycle asks has_capability('payment.move') -- it is one of the capabilities the
 * settings screen offers, and a role spelled out in its body would mean granting somebody
 * payment.move ticked a box and changed nothing.
 *
 * reset_payover_run is NOT a capability anybody can be granted: it throws a client's finished run
 * away so the same test can be run again, and it exists only on staging. There is nothing to grant,
 * so it keeps the role test -- in the SAFE `is distinct from` form, for the reason
 * check-silent-triggers records at length: with no session current_user_role() is NULL, `null <>
 * 'Administrator'` is NULL, and `if NULL then` does not run.
 */
const GATES = {
  reset_payover_run: /current_user_role\(\) is distinct from 'Administrator'/,
  move_payment_to_cycle: /not public\.has_capability\('payment\.move'\)/,
}
for (const [name, body] of [['reset_payover_run', reset], ['move_payment_to_cycle', move]]) {
  ok(`${name} is gated`, GATES[name].test(body ?? ''))
  /* NEITHER MAY USE THE FAIL-OPEN COMPARISON. `<>` against a NULL role yields NULL and the guard
     is skipped for exactly the caller that should be refused hardest. */
  no(`...without the fail-open comparison`, /current_user_role\(\)\s*<>/.test(body ?? ''))
  /* THE LOCK THAT MATTERS. A browser guard decides whether to draw a button; this is the boundary,
     and it reads a row the app cannot write. */
  ok(`...and refuses unless the DATABASE says staging`,
    /if not public\.is_staging_database\(\) then/.test(body ?? ''))
  ok(`...saying which it is rather than failing obscurely`,
    /this is not the staging database/.test(body ?? ''))
}

/* THE RESET IS NOT AN EDIT. It removes the run so the next build starts from nothing -- the
   payover's own rule is that a correction is a negative line in the NEXT run. */
ok('the reset releases every allocation',
  /update public\.payment_allocations set payover_run_id = null where payover_run_id = p_run/.test(reset ?? ''))
ok('...and the carried reversals with them',
  /reversal_carried_run_id = null where reversal_carried_run_id = p_run/.test(reset ?? ''))
/* AND THE BANK DEBIT GOES BACK, or a payment out stays matched to a run that no longer exists and
   the next test cannot reconcile it again. */
ok('...and the bank debit goes back on the unreconciled list',
  /update public\.bank_statement_lines\s*\n\s*set payover_run_id = null, status = 'unallocated'/.test(reset ?? ''))
ok('...and the run itself goes, so the cycle is free',
  /delete from public\.payover_runs where id = p_run/.test(reset ?? ''))

/*
 * THE TRIGGER'S EXCEPTION IS NARROW, AND IT IS TWO LOCKS RATHER THAN ONE: staging, AND the run
 * named by reset_payover_run in a transaction-local setting. An ordinary statement running at the
 * same moment cannot inherit it, and production refuses even when the setting is set by hand.
 */
ok('the delete exception names the run it is for',
  /current_setting\('raptor\.reset_run', true\), ''\) = old\.id::text/.test(guard ?? ''))
ok('...and asks the database whether this is staging as well',
  /if public\.is_staging_database\(\)\s*\n\s*and coalesce\(current_setting\('raptor\.reset_run'/.test(guard ?? ''))
ok('...and reset_payover_run is the only thing that sets it',
  /perform set_config\('raptor\.reset_run', p_run::text, true\);/.test(reset ?? ''))
check('...which it does exactly once, in that one function',
  (sql.match(/set_config\('raptor\.reset_run'/g) ?? []).length, 1)

/* ---------------- the trap that fails quietly ---------------- */

/*
 * A RUN CLAIMS ON THE ALLOCATION DATE, NOT ON THE RECEIVED DATE AND NO LONGER ON created_at.
 * This is the one a reader will get wrong, and the reason move_payment_to_cycle exists at all:
 * backdating a receipt looks like it worked and changes nothing about which invoice it lands on.
 *
 * IT USED TO BE created_at, AND THAT WAS A STAND-IN THAT BROKE ON THE FIRST IMPORT. created_at is
 * when the ROW was written, which for an imported book is the day of the import for every receipt
 * in it -- so the whole of Swordfish's payment history would have been claimed by the current
 * cycle and every client paid a second time. THE FIRM: "it's important to capture the payment date
 * and basically the allocation date of a payment... if a payment was in suspense, it was made on
 * the 5th of September, it missed the first payment run in which it was supposed to be. So it
 * should be running in the payment run."
 */
ok('a run claims a cycle by the date the payment was allocated',
  /and p\.allocated_on <= case when a\.paid_to_client\s+then public\.payover_ptc_until\(v_end\) else v_end end\s*\n\s*and \(p\.allocated_on >= p_period_start/.test(build ?? ''))
no('...not by the date somebody typed on it',
  /received_at >= p_period_start/.test(build ?? ''))
no('...and not by when the row happened to be written',
  /p\.created_at >= v_from/.test(build ?? ''))
/* MONEY SWORDFISH ALREADY REMITTED IS NEVER CLAIMED, which is the other half of the same fix. */
ok('...and never money Swordfish already paid over',
  /and not p\.paid_over_in_swordfish/.test(build ?? ''))
ok('moving a payment moves that, which is the only thing that works',
  /update public\.account_payments set allocated_on = v_at::date where id = p_payment/.test(move ?? ''))
/* AND LEAVES created_at ALONE. It is the audit trail; a testing control that edits it leaves no
   way to tell a moved receipt from one captured that day. */
no('...without editing the audit trail',
  /set created_at = v_at/.test(move ?? ''))
/* NOON, so no timezone edge pushes it into the neighbouring cycle. */
ok('...landing mid-cycle at noon rather than on a boundary',
  /\(p_period_start \+ 15\)::timestamp \+ time '12:00'/.test(move ?? ''))
ok('...and it lets go of any open run, or the payment lands in neither cycle',
  /update public\.payment_allocations set payover_run_id = null where payment_id = p_payment/.test(move ?? ''))

/* AN INVOICED PAYMENT DOES NOT MOVE, on staging or anywhere. Its figures are on a remittance a
   client has had, which is what the negative-line rule exists to protect. */
ok('a payment on an issued invoice refuses to move',
  /r\.status in \('approved', 'sent', 'paid'\)/.test(move ?? ''))
ok('...and says which run to reset first', /Reset that run first/.test(move ?? ''))
/* A CYCLE STARTS ON THE 11th. A free date here would put a payment in a window no run ever asks
   for, and it would simply never appear again. */
ok('a cycle start that is not the 11th is refused',
  /A cycle starts on the 11th/.test(move ?? ''))

/* ---------------- nothing new is reachable by a stranger ---------------- */

for (const fn of [
  'reset_payover_run(uuid)', 'move_payment_to_cycle(uuid, date)',
  'payover_buildable(date)', 'is_staging_database()',
]) ok(`${fn} is revoked from anon`,
  sql.includes(`revoke execute on function public.${fn} from public, anon`))

/* ---------------- the browser side ---------------- */

ok('the library can build a run', /export async function buildRun\(/.test(lib))
ok('...list what is worth building', /export async function fetchBuildable\(/.test(lib))
ok('...reset a finished one', /export async function resetRun\(/.test(lib))
ok('...move a payment between cycles', /export async function movePaymentToCycle\(/.test(lib))
ok('the RPCs are the ones the database has',
  ['build_payover_run', 'payover_buildable', 'reset_payover_run', 'move_payment_to_cycle',
    'is_staging_database'].every((r) => lib.includes(`.rpc('${r}'`)))
/* DEFAULTS TO NO on any failure -- the direction an unknown has to fail in, the same way round as
   isTestAccount. A thrown error here would otherwise draw the test controls on production. */
ok('an unanswerable "is this staging" reads as no',
  /if \(error\) return false\s*\n\s*return data === true/.test(lib))

/* ---------------- the queue can finally make one ---------------- */

/* THE RUNS NOW BUILD THEMSELVES (the firm, 8 Oct: "I don't even have to say go and build a run"):
   the queue refreshes them on opening, and the box survives only as a staging test control. */
ok('the queue builds its own runs on opening', /await refreshRuns\(\)/.test(queue))
ok('...so there is no Build a run button', !/Build a run/.test(queue))
ok('...the box is staging-only', /\{staging && \(\s*<button type="button" onClick=\{\(\) => setBuilding\(true\)\}/.test(queue))
const refresh = liveBody('refresh_payover_runs') ?? ''
ok('refresh builds this cycle and the last', /foreach v_cycle in array array\[v_last, v_open\]/.test(refresh))
ok('...never touching an approved, sent, paid or voided run',
  /and not public\.payover_run_is_open\(status\)\) then\s+continue;/.test(refresh))
ok('...and is Administrator only', /current_user_role\(\) is distinct from 'Administrator'/.test(refresh))
const approveRun = liveBody('approve_payover_run') ?? ''
ok('a run cannot be approved before its cycle has closed without a reason -- on staging too',
  /if v_end >= \(now\(\) at time zone 'Africa\/Johannesburg'\)::date and nullif\(btrim\(coalesce\(v_early, ''\)\), ''\) is null then\s+raise exception/.test(approveRun)
  && !/is_staging_database/.test(approveRun))
const early = liveBody('approve_payover_run_early') ?? ''
ok('approving early demands a real reason and keeps who gave it',
  /length\(btrim\(coalesce\(p_reason, ''\)\)\) < 10/.test(early) && /early_by = auth\.uid\(\)/.test(early)
  && /perform public\.approve_payover_run\(p_run\)/.test(early))
const buildLive = liveBody('build_payover_run') ?? ''
ok('money processed after an early approval rides the next run, not none',
  /or exists \(select 1 from public\.payover_runs e\s+where e\.company_id = p_company\s+and e\.status in \('approved', 'sent', 'paid'\)\s+and p\.allocated_on between e\.period_start\s+and case when a\.paid_to_client\s+then public\.payover_ptc_until\(e\.period_end\) else e\.period_end end\)/.test(buildLive))
ok('...and refresh looks for it', /p\.allocated_on between e\.period_start\s+and case when a\.paid_to_client\s+then public\.payover_ptc_until\(e\.period_end\) else e\.period_end end/.test(refresh))
ok('...opening a box that asks which cycle', /function BuildRunModal\(/.test(queue))
ok('...defaulting to the one running now', /useState\(cycle\.periodStart\)/.test(queue))
/* FORWARD AS WELL AS BACK, which is not a mistake: nothing waits for a period to end, and
   building next cycle's run is how you check where a payment captured today actually lands. */
ok('...offering cycles either side of it', /for \(let i = 1; i >= -6; i--\)/.test(queue))
ok('...and saying the cycle need not have ended', /It does not have to have ended/.test(queue))

/*
 * THE RESET IS DRAWN ONLY ON STAGING AND ONLY FOR A FINISHED RUN. An open run is rebuilt, which is
 * an ordinary thing to do and needs no test control at all.
 */
ok('the reset is offered only where the database says staging',
  /staging && r\.runId && r\.runStatus && !\['needs_review', 'ready'\]\.includes\(r\.runStatus\)/.test(queue))
ok('...and an open run is rebuilt instead', /\{r\.runId \? 'Rebuild' : 'Build'\}/.test(queue))

console.log(`\ncheck-payover-build: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
