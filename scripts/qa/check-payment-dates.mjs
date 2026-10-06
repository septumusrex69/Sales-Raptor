/**
 * TWO DATES ON A PAYMENT, AND IMPORTED MONEY IS NOT WAITING FOR APPROVAL.
 *
 * THE FIRM, looking at ninety imported receipts in the approval queue with "Approve all 90" over
 * R297 506,84 on it: "I imported some stuff from Swordfish and it shows me payment schedules to
 * approve. It shouldn't do that. If the payments come from Swordfish, they're already in there and
 * they've already been approved... except for the ones that doesn't fall in the next payment run.
 * If we import, for example, today, the entire Swordfish book, then from the 11th September until
 * today would not have been processed. It should go into a state of needing to be approved."
 *
 * AND: "it's important to capture the payment date and basically the allocation date of a payment.
 * For example, if a payment was made a PTC, let's say on the 5th of September and only processed
 * today, it will only be processed with this import date... or if a payment was in suspense, it was
 * made on the 5th of September, it missed the first payment run in which it was supposed to be. So
 * it should be running in the payment run."
 *
 * WHAT THIS GUARDS:
 *
 * 1. THE RUN CLAIMS ON THE ALLOCATION DATE. created_at was standing in for it, and for an imported
 *    book created_at is the day of the IMPORT for every receipt in it -- so the whole payment
 *    history would have been claimed by the current cycle and the clients paid a second time.
 * 2. NOTHING MOVES created_at ANY MORE. It is the audit trail. move_payment_to_cycle used to
 *    rewrite it, because it was the column that decided the cycle; now there is a column that
 *    means what it says.
 * 3. MONEY SWORDFISH PAID OVER IS REFUSED BY approve_payment, BEFORE THE SPLIT. Approving splits
 *    the receipt, raises a trust creditor for the client and makes it claimable -- so the guard is
 *    worthless if it sits after the split.
 * 4. THE CUT-OFF IS A DATE SOMEBODY STATES. Raptor cannot know when Swordfish last paid its
 *    clients. The default is the firm's own worked example and nothing more.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-payment-dates.mjs
 */
import { readFileSync } from 'node:fs'
import { cycleStartOn, settledThroughDefault } from '../../src/lib/trustCycles.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (Object.is(actual, expected)) pass += 1
  else failures.push(`${name}\n    expected ${expected}\n    got      ${actual}`)
}
const ok = (name, actual) => check(name, actual, true)

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const sql = read('supabase/schema.sql')
/* THE LAST DEFINITION. schema.sql is append-only, so indexOf reads the superseded copy -- the trap
   CLAUDE.md names and that check-allocation-start was caught by. */
function fn(name) {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const end = sql.indexOf('end $$;', at)
  return end < 0 ? sql.slice(at) : sql.slice(at, end)
}

/* ------------------------------------------ 1. the cycle a date falls in -------------------- */

check('the 6th is in the cycle that opened on the 11th last month',
  cycleStartOn('2026-10-06'), '2026-09-11')
check('the 20th is in the one that opened this month', cycleStartOn('2026-09-20'), '2026-09-11')
/* THE 11th ITSELF OPENS A CYCLE. Off by one here is a day of collections in the wrong month. */
check('the 11th opens its own cycle', cycleStartOn('2026-09-11'), '2026-09-11')
check('the 10th is still the previous one', cycleStartOn('2026-09-10'), '2026-08-11')
/* JANUARY STEPS BACK A YEAR, which `new Date(y, m-1, ...)` gets right and string surgery does not. */
check('January steps back into last year', cycleStartOn('2026-01-05'), '2025-12-11')
check('March does not land on 31 February', cycleStartOn('2026-03-01'), '2026-02-11')

/* ------------------------------------------ 2. where the old books stop --------------------- */

/*
 * THE FIRM'S OWN WORKED EXAMPLE, to the day. Import on 6 October and everything up to 10 September
 * is history; the 11th onwards needs a decision.
 */
check('importing on 6 October settles through 10 September',
  settledThroughDefault('2026-10-06'), '2026-09-10')
check('...and on the 11th it is the same answer',
  settledThroughDefault('2026-09-11'), '2026-09-10')
check('...while the 10th is a month earlier',
  settledThroughDefault('2026-09-10'), '2026-08-10')
check('a January import reaches back into December',
  settledThroughDefault('2026-01-05'), '2025-12-10')

const imp = read('src/lib/swordfishImport.ts')
/*
 * ASKED, NOT INFERRED. The firm said in the same breath "I don't know. We'll have to figure that
 * out", and this is the single most consequential number in the migration: too early and clients
 * are paid twice, too late and a month of collections is never remitted. So it is an option with a
 * default, never something worked out from the data.
 */
ok('the import takes the cut-off as an option', /settledThrough\?: string/.test(imp))
ok('...defaulted rather than required',
  /options\.settledThrough \?\? settledThroughDefault\(today\)/.test(imp))
/* ON OR BEFORE, because the cut-off is the last day of a cycle Swordfish paid: a receipt dated
   that very day is inside it. */
ok('a receipt on the cut-off day is history',
  /paid_over_in_swordfish: when <= settledThrough/.test(imp))
ok('...and one after it is left for a person',
  /approved_at: when <= settledThrough \? `\$\{when\}T00:00:00Z` : null/.test(imp))
/* IT SAYS WHERE THE LINE FELL. Both answers import cleanly and the difference only shows up as a
   client paid twice or a month never remitted, so it cannot be left to be noticed. */
ok('the import reports the split', /are treated as already paid over in Swordfish/.test(imp))
ok('...and warns when nothing is left to approve', /Nothing was left to approve/.test(imp))
ok('...and when everything is', /the whole payment history will/.test(imp))

/*
 * AND THE SCREEN ASKS FOR IT. An option with a default that no screen offers is a default, not a
 * question -- and this is the one number in the migration nobody can check afterwards by looking
 * at the data, because both answers import cleanly.
 */
const tab = read('src/components/settings/DataImportTab.tsx')
ok('the import screen asks when Swordfish last paid over',
  /Swordfish has paid clients over up to and including/.test(tab))
ok('...as a date somebody can change', /type="date"[\s\S]{0,200}?value=\{settledThrough\}/.test(tab))
ok('...passed into the plan', /settledThrough,/.test(tab))
/* CHANGING IT THROWS THE PLAN AWAY, or the figures on screen are the previous answer's. */
ok('...and re-reads the plan when it changes',
  /setSettledThrough\(e\.target\.value\); setPlan\(null\)/.test(tab))

/* ------------------------------------------ 3. the run claims on the allocation date -------- */

const build = fn('build_payover_run')
ok('the run function was found', build.length > 2000)
ok('a run claims on the allocation date', /and p\.allocated_on >= p_period_start/.test(build))
ok('...bounded by the cycle it is for', /and p\.allocated_on <= v_end/.test(build))
/*
 * AND NOT ON created_at ANY MORE. Left in beside the new clause it would be an AND that quietly
 * excluded everything imported, which reads as "the run is empty" rather than as a bug.
 */
ok('...and no longer on created_at', !/p\.created_at >= v_from/.test(build))
ok('...with the dead timezone bounds gone', !/v_from timestamptz/.test(build))
/* MONEY SWORDFISH PAID OVER IS NEVER CLAIMED, said out loud beside the dates. */
ok('a run never claims money Swordfish paid over',
  /and not p\.paid_over_in_swordfish/.test(build))

/* ------------------------------------------ 4. approval sets it, and only approval ---------- */

const approve = fn('approve_payment')
ok('approving sets the allocation date',
  /allocated_on = \(now\(\) at time zone 'Africa\/Johannesburg'\)::date/.test(approve))
/* THE FIRM'S DAY. The database is UTC and Johannesburg is ahead of it, so around midnight the two
   disagree about which cycle a receipt falls in. */
ok('...on the firm’s clock', /Africa\/Johannesburg/.test(approve))
/* AND THE RECEIVED DATE IS NEVER TOUCHED: it is what the debtor did, and the other is what we did. */
ok('...without moving the received date', !/set .{0,40}received_at/.test(approve))

/*
 * THE REFUSAL COMES BEFORE THE SPLIT.
 *
 * PRESENCE FIRST, THEN ORDER. indexOf returns -1 and -1 is less than every real index, so an
 * order-only assertion passes vacuously the moment the guard it orders is deleted.
 */
const refusalAt = approve.indexOf('v_pay.paid_over_in_swordfish')
const splitAt = approve.indexOf('allocate_payment')
ok('approving refuses money Swordfish already paid over', refusalAt > 0)
ok('...and the split is in there to be guarded', splitAt > 0)
ok('...with the refusal before it', refusalAt > 0 && refusalAt < splitAt)

/* ------------------------------------------ 5. the audit trail stops moving ----------------- */

const move = fn('move_payment_to_cycle')
ok('moving a payment between cycles was found', move.length > 800)
ok('...moves the allocation date', /set allocated_on = v_at::date/.test(move))
/*
 * AND NOT created_at. It was honest about doing so, because created_at was what the run claimed on
 * -- but it is the audit trail, and a testing control that edits the audit trail leaves no way to
 * tell a moved receipt from one captured that day.
 */
ok('...and no longer rewrites created_at', !/set created_at = v_at/.test(move))

/* ------------------------------------------ 6. the bands agree with the runs ---------------- */

/*
 * ONE COLUMN DECIDES THE CYCLE, EVERYWHERE. The trust overview's bands and the payover runs are
 * the same money read twice; while one reads created_at and the other allocated_on they disagree
 * about which month a receipt is in, and the firm's own screen contradicts their own invoice.
 */
const cycleFn = (() => {
  const at = sql.lastIndexOf('create or replace function public.trust_by_cycle(')
  const a = sql.indexOf('as $$', at) + 5
  return sql.slice(a, sql.indexOf('$$', a))
})()
ok('the trust bands bucket on the allocation date too',
  /payover_cycle_start\(coalesce\(p\.allocated_on::timestamptz, p\.created_at\)\)/.test(cycleFn))
ok('...for an allocation as well as a payment',
  /payover_cycle_start\(coalesce\(ap\.allocated_on::timestamptz, ap\.created_at\)\)/.test(cycleFn))

/* ------------------------------------------ 7. the columns exist and say what they mean ----- */

ok('the allocation date is a column', /add column if not exists allocated_on date/.test(sql))
ok('...and so is the Swordfish settlement flag',
  /add column if not exists paid_over_in_swordfish boolean not null default false/.test(sql))
/* COMMENTED IN THE DATABASE, because the next person to read this table will read it there. */
ok('the allocation date explains itself in the database',
  /comment on column public\.account_payments\.allocated_on/.test(sql))
ok('...and so does the settlement flag',
  /comment on column public\.account_payments\.paid_over_in_swordfish/.test(sql))
/* ALREADY-APPROVED RECEIPTS GET ONE, so the column is true of the whole table from the day it
   exists rather than only of what happens next -- or the first run built after this migration
   silently claims nothing. */
ok('existing approvals were given an allocation date',
  /set allocated_on = \(coalesce\(approved_at, created_at\) at time zone 'Africa\/Johannesburg'\)::date/.test(sql))

console.log(`check-payment-dates: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
if (failures.length) process.exit(1)
