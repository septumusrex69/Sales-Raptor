/**
 * THE PAYOVER RUN, WHICH IS A TAX INVOICE THE MOMENT IT IS APPROVED.
 *
 * WHAT IS HELD HERE AND WHAT IS NOT. The arithmetic is proved in the database against the firm's
 * own Dr CA Roux reconciliation (11 Nov - 10 Dec 2024: due to client 44 824.20, due to BF 2 852.58,
 * VAT 3 013.30, net 38 958.32) in a transaction that rolls back. Re-implementing those sums in
 * JavaScript would create a second opinion about what a client is owed, which is the thing the
 * one-function design exists to prevent. What is held HERE is the set of decisions that would
 * reverse silently while every total still added up -- and on a payover run there are a lot of
 * them, because a wrong run is arithmetically perfect and pays the wrong person.
 *
 * THE SIX THAT FAIL SILENTLY:
 *
 *   - Membership by PAYMENT date rather than CAPTURE date moves money between months. The firm's
 *     own example: dated 27 December, imported 12 January, belongs to January.
 *   - VAT on the TOTAL instead of per line is twelve cents out on one client in one month, and the
 *     invoice then does not add up to its own lines.
 *   - A reversal read as a trust line when it reversed a client-direct payment leaves net_payover
 *     correct and both halves of the invoice wrong.
 *   - An invoice number trusted to be unique because `companies.code` looks unique. It is not:
 *     the index is partial on parent_company_id, so a subsidiary shares its parent's code, and
 *     Adowa really does. Two clients, one number, at five past midnight, unattended.
 *   - A blocker stored rather than computed goes stale in the direction that says the run is ready.
 *   - An approved run that can still be edited is a restated invoice.
 *
 * `schema.sql` IS APPEND-ONLY, so every read below takes the LAST definition.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-payover-runs.mjs
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

const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')

/** The LAST definition of one function, comments stripped. Same trap as the engine check. */
function lastFn(name) {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const end = sql.indexOf('$$;', at)
  return end < 0 ? '' : sql.slice(at, end)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')
}
/** The LAST `create table` block for one table. */
function lastTable(name) {
  const at = sql.lastIndexOf(`create table if not exists public.${name} (`)
  if (at < 0) return ''
  const end = sql.indexOf('\n);', at)
  return end < 0 ? '' : sql.slice(at, end)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')
}

const runs = lastTable('payover_runs')
const lines = lastTable('payover_run_lines')
const cycle = lastFn('payover_cycle_start')
const number = lastFn('payover_invoice_number')
const totals = lastFn('recompute_payover_run')
const build = lastFn('build_payover_run')
const close = lastFn('close_payover_cycle')
const approve = lastFn('approve_payover_run')
const paid = lastFn('mark_payover_run_paid')
const guardRun = lastFn('protect_payover_run')
const guardLines = lastFn('protect_payover_run_lines')

/* PRESENCE BEFORE ANYTHING ELSE, or a deleted function satisfies every negative assertion below. */
ok('the runs table is in the schema', runs.length > 500)
ok('the lines table is in the schema', lines.length > 300)
for (const [name, body] of Object.entries({
  cycle, number, totals, build, close, approve, paid, guardRun, guardLines,
})) ok(`${name} is in the schema`, body.length > 100)

/* ---------------- the cycle ---------------- */

/* THE 11th TO THE 10th, READ IN JOHANNESBURG. A cycle boundary computed in UTC puts every payment
   captured between midnight and 02:00 on the 11th into the wrong month. */
ok('the cycle is read in South African time', /at time zone 'Africa\/Johannesburg'/.test(cycle))
ok('...and turns on the 11th', /extract\(day from d\) >= 11/.test(cycle))
/* STABLE, NOT IMMUTABLE: the conversion reads the timezone database, which gets updated. */
ok('...and is not declared immutable', /\nstable\n/.test(cycle) && !/\nimmutable\n/.test(cycle))
/* A RUN'S PERIOD IS WHAT IT SAYS IT IS. Both ends constrained, so a run cannot be written by hand
   across two months or from the middle of one. */
ok('a run starts on an 11th', /extract\(day from period_start\) = 11/.test(runs))
ok('...and ends the day before the next one', /period_end = \(period_start \+ interval '1 month - 1 day'\)::date/.test(runs))

/*
 * MEMBERSHIP IS BY THE DATE THE PAYMENT WAS ALLOCATED. The firm: a payment dated 27 December but
 * processed on 12 January belongs to the January cycle, because the day it was PROCESSED is the one
 * that decides where the money goes out. Both the build and the close have to agree, and both are
 * checked in one loop -- written on different columns, a month's money moves between them and every
 * total still reconciles, so nothing anywhere reports it.
 *
 * IT USED TO BE created_at, WHICH BROKE ON THE FIRST IMPORT: created_at is when the ROW was
 * written, which for an imported book is the day of the import for every receipt in it. THE FIRM:
 * "it's important to capture the payment date and basically the allocation date of a payment...
 * if a payment was in suspense, it was made on the 5th of September, it missed the first payment
 * run in which it was supposed to be. So it should be running in the payment run."
 */
for (const [name, body] of Object.entries({ build, close })) {
  ok(`${name} selects by the date the payment was allocated`,
    /p\.allocated_on >=/.test(body) && /p\.allocated_on <=/.test(body))
  ok(`...and never money Swordfish already paid over`, /not p\.paid_over_in_swordfish/.test(body))
  check(`...and never by when it was received`, (body.match(/p\.received_at/g) ?? []), [])
  check(`...nor by when the row happened to be written`, (body.match(/p\.created_at/g) ?? []), [])
  /* R23,6m of invented money sits in the same table as money somebody paid. */
  ok(`...and leaves the demo money out`, /not p\.is_demo/.test(body))
}

/* ---------------- the invoice number ---------------- */

ok('the number is PO-code-YYMM', /'PO-' \|\| coalesce\(v_code, 'NOCODE'\) \|\| '-' \|\| to_char\(p_period_end, 'YYMM'\)/.test(number))
/*
 * AND IT IS GENERATED AGAINST WHAT IS ALREADY TAKEN. companies.code is unique only among top-level
 * clients -- the index is partial on parent_company_id -- so a subsidiary shares its parent's code
 * and is paid over separately. Trusted, the second insert dies at 00:05 on the 11th unattended.
 */
ok('...and steps past a number already in use',
  /while exists \(select 1 from public\.payover_runs where invoice_number = v_try\)/.test(number))
ok('...with the table refusing a duplicate whatever the generator does',
  /constraint payover_runs_invoice_number_unique unique \(invoice_number\)/.test(runs))
/* ONE RUN PER CLIENT PER CYCLE: two runs for one month is a client invoiced twice. */
ok('one run per client per cycle',
  /constraint payover_runs_one_per_client_per_cycle unique \(company_id, period_start\)/.test(runs))
/* AND AN ALLOCATION APPEARS ONCE IN IT: twice is the same money paid over twice. */
ok('...and an allocation appears once in a run',
  /constraint payover_run_lines_once_per_run unique \(run_id, allocation_id\)/.test(lines))

/* ---------------- the totals ---------------- */

ok('due to client is capital less commission',
  /due_to_client = t\.trust_capital - t\.trust_commission/.test(totals))
ok('due to BF is the fees taken plus commission on client-direct payments',
  /due_to_bf = t\.ptc_fees \+ t\.ptc_commission/.test(totals))
/*
 * NET = due to client - due to BF - commission VAT, plus anything carried in. The firm's own
 * Dr Roux figures: 44 824.20 - 2 852.58 - 3 013.30 = 38 958.32.
 */
ok('net payover is the client money less the firm and the VAT',
  /net_payover = \(t\.trust_capital - t\.trust_commission\)\s*\n\s*- \(t\.ptc_fees \+ t\.ptc_commission\)\s*\n\s*- t\.commission_vat\s*\n\s*\+ t\.carried_in/.test(totals))
/*
 * VAT IS SUMMED PER LINE, NEVER TAKEN ON THE TOTAL -- the firm's decision 5, so the lines add up
 * to the invoice. On Dr Roux the two differ by twelve cents, on one client, in one month.
 */
ok('VAT is the sum of the lines', /sum\(l\.commission_vat\)/.test(totals))
/*
 * WHICH MEANS THE TOTALS DO NOT KNOW THE VAT RATE AT ALL. Stated as the absence of a rate rather
 * than as the absence of one particular multiplication: the first version of this assertion looked
 * for `round(... commission ... * 0.15)`, and the break test walked straight through it because a
 * nested bracket broke the match. A function that cannot see a rate cannot apply one.
 */
check('...and the totals never see a VAT rate to apply',
  (totals.match(/0\.15|vat_rate|v_vat|\* *\.15/g) ?? []), [])
/*
 * THE SIDE OF THE INVOICE IS `paid_to_client`, NOT `line_kind`. A reversal reverses a trust payment
 * or a client-direct one and must reduce the total its original increased; read off the kind, every
 * reversal lands on the trust side and net_payover still balances while both halves are wrong.
 */
check('every total is split by which side actually paid',
  (totals.match(/l\.paid_to_client/g) ?? []).length, 6)
ok('...and the column is on the line to be read',
  /paid_to_client boolean not null default false/.test(lines))
/* A CARRIED LINE IS NOT A PAYMENT and does not borrow payment_amount -- a shortfall shown in a
   column headed "paid" is a line a client queries. */
ok('a carried shortfall has a column of its own',
  /carried_amount/.test(totals) && /add column if not exists carried_amount numeric/.test(sql))
/* AND THE TOTALS ONLY EVER MOVE ON A DRAFT. */
/*
 * AND ONLY WHILE THE RUN IS STILL A WORKING DOCUMENT. 'draft' became two values -- needs_review
 * and ready -- and every test for it now goes through payover_run_is_open, so the next rung the
 * firm adds to the ladder is one edit rather than nine.
 */
ok('the totals are only recomputed while the run is open',
  /where r\.id = p_run and public\.payover_run_is_open\(r\.status\)/.test(totals))

/* ---------------- what stops approval ---------------- */

/* COMPUTED, NEVER STORED: each one stops being true when somebody fixes it, and a stale flag fails
   in the direction that says the run is ready. Same reasoning as finance_exceptions being a view. */
const blockers = sql.slice(sql.lastIndexOf('create or replace function public.payover_run_blockers('))
  .split('$$;')[0]
ok('the blockers are computed', blockers.length > 200)
for (const kind of ['needs_rate', 'excess_credit', 'no_client_code']) {
  ok(`...and report ${kind}`, new RegExp(`'${kind}'`).test(blockers))
}
/* APPROVAL ASKS THEM RATHER THAN DECIDING FOR ITSELF, and refuses LOUDLY: the run is not going out
   today and somebody has to know why. */
ok('approving asks the blockers', /from public\.payover_run_blockers\(p_run\) b/.test(approve))
ok('...and refuses with the reason in the sentence',
  /raise exception 'This run cannot be approved yet: %', v_why/.test(approve))
ok('...and only from an open run', /if not public\.payover_run_is_open\(v_status\) then/.test(approve))
/* THE EFT REFERENCE IS WHAT RECONCILES THE INVOICE TO THE BANK, so it is required. */
ok('marking a run paid requires the EFT reference',
  /if nullif\(btrim\(coalesce\(p_reference, ''\)\), ''\) is null then\s*\n\s*raise exception/.test(paid))

/* ---------------- and then it is an invoice ---------------- */

/*
 * RAISES RATHER THAN REVERTS, unlike the cut-over guard: the hazard there was somebody saving an
 * unrelated form, and the hazard here is somebody editing an invoice a client has been paid on.
 */
ok('an approved run refuses an edit to its figures',
  /raise exception 'Payover run % is %; its figures are an issued invoice/.test(guardRun))
ok('...refuses to go back to a working document',
  /if public\.payover_run_is_open\(new\.status\) then\s*\n\s*raise exception/.test(guardRun))
ok('...and refuses to be deleted', /an invoice is not deleted/.test(guardRun))
ok('...before the row is written', /before update or delete on public\.payover_runs/.test(sql))
/* THE LINES WITH IT: a frozen total over editable lines is a total that no longer describes them. */
ok('and its lines are frozen too', /its lines are an issued invoice/.test(guardLines))
ok('...on insert as well as update and delete',
  /before insert or update or delete on public\.payover_run_lines/.test(sql))
/* REBUILDING ONE IS REFUSED AT THE SOURCE, not merely by the trigger underneath. */
ok('an approved run cannot be rebuilt',
  /if v_run is not null and not public\.payover_run_is_open\(v_status\) then\s*\n\s*raise exception/.test(build))
/*
 * A REBUILD RELEASES BEFORE IT CLAIMS, or a second build appends to the first.
 *
 * PRESENCE ASSERTED BEFORE ORDER. CLAUDE.md names this trap and the break test caught it here:
 * `indexOf` returns -1 for a line that has been deleted, and -1 is less than everything, so an
 * order-only assertion passes vacuously on exactly the code it exists to refuse.
 */
const releaseAt = build.indexOf('set payover_run_id = null where payover_run_id = v_run')
const claimAt = build.indexOf('with claimed as')
ok('a rebuild lets go of what it held', releaseAt > 0)
ok('...and claims again afterwards', claimAt > 0)
ok('...in that order', releaseAt > 0 && claimAt > 0 && releaseAt < claimAt)

/* ---------------- a reversal after the invoice went out ---------------- */

/* THE FIRM'S DECISION 6: never edited in the run that went out -- a negative line in the next one.
   Negated at BUILD time so a remittance advice prints the line exactly as it is stored. */
ok('a reversal already invoiced becomes a negative line',
  /'reversal', c\.paid_to_client,\s*\n\s*-coalesce\(c\.payment_amount, 0\), -c\.to_interest/.test(build))
ok('...only once', /a\.reversal_carried_run_id is null/.test(build))
ok('...and only where its own run was invoiced',
  /r\.status in \('approved', 'sent', 'paid'\)/.test(build))
/* A SHORTFALL OPENS THE NEXT RUN, from the most recent INVOICED run rather than merely last month:
   a month with no run must not swallow the carry. */
ok('a negative net is carried forward', /'carried', v_prev\.net_payover/.test(build))
ok('...from the most recent invoiced run', /order by r\.period_start desc limit 1/.test(build))
ok('...and is carried once', /r\.carried_out_run_id is null/.test(build))

/* ---------------- the cycle closes itself ---------------- */

/* YESTERDAY'S CYCLE, which on the 11th is the one that just closed. Read off `now()` it would
   build the cycle that started five minutes earlier -- an empty run for every client. */
ok('the close defaults to the cycle that just ended',
  /public\.payover_cycle_start\(public\.raptor_now\(\) - interval '1 day'\)/.test(close))
/* 00:05 IN JOHANNESBURG IS 22:05 UTC ON THE 10th. The server is UTC and South Africa has no
   daylight saving, so the schedule reads like the wrong day and is the right instant. */
ok('it is scheduled', /cron\.schedule\(\s*\n\s*'close-payover-cycle',\s*\n\s*'5 22 10 \* \*'/.test(sql))
/* A CLIENT WHO COLLECTED NOTHING CAN STILL BE OWED A CORRECTION. Three reasons to build a run, and
   a close that only looked at this cycle's allocations would drop the other two silently. */
check('three things earn a client a run', (close.match(/\n    union\n/g) ?? []).length, 2)
/* ONE CLIENT ALREADY INVOICED MUST NOT STOP THE REST. */
ok('an already-invoiced client is skipped rather than fatal', /continue;/.test(close))

/* ---------------- administrator only, and a ledger ---------------- */

/*
 * THE FIRM: "The Finance section is Administrator only. Sales representatives never see the
 * payment split." A run is the commission earned on a client's whole book.
 *
 * THIS ASSERTS THE POLICIES, AND POLICIES ARE ONLY ONE OF THE TWO LAYERS. An audit found nine of
 * the fifteen finance RPCs were `security definer` with no role check -- and a definer function
 * runs as the owner, so every policy asserted below is bypassed the moment somebody calls one.
 * The section READ as locked down here while `preview_allocation` would hand the payment split to
 * anybody who asked, including `anon`.
 *
 * SO THE FUNCTION LAYER IS HELD SEPARATELY, in check-finance-is-administrator-only.mjs. Nothing
 * below is wrong; it is simply not the whole guarantee, and this note is here so the next person
 * reading it does not conclude that it is. THAT IS THE GENERAL SHAPE WORTH WATCHING FOR: a check
 * that is true about one enforcement layer and silent about the one carrying the weight.
 */
for (const t of ['payover_runs', 'payover_run_lines']) {
  ok(`${t} is readable by administrators only`,
    new RegExp(`create policy ${t}_read on public\\.${t}\\s*\\n\\s*for select to authenticated using \\(public\\.current_user_role\\(\\) = 'Administrator'\\)`).test(sql))
}
/*
 * AND THE LINES ARE A LEDGER: select and insert, with update and delete denied by OMISSION, which
 * is how the four money tables are already protected. check-financial-immutability.mjs holds that
 * set; this asserts the shape here as well, because the protection is something NOT written down.
 */
const clean = sql.replace(/--.*$/gm, '')
for (const verb of ['update', 'delete']) {
  check(`nothing may ${verb} a run's lines through a policy`,
    (clean.match(new RegExp(`create policy[^;]*on public\\.payover_run_lines\\s+for ${verb}`, 'g')) ?? []), [])
}

console.log(`\ncheck-payover-runs: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
