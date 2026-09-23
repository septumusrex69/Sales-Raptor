/**
 * THE WORKFLOW STARTS WHEN THE ACCOUNT IS FIRST GIVEN TO SOMEBODY.
 *
 * The firm asked whether a workflow starts for an account typed in by hand as well as one
 * imported. It did not start for either: the runner, the transport, the notifications and the
 * release button were all built, and nothing anywhere created a run. Staging had zero.
 *
 * WHAT THIS GUARDS:
 *
 *   - THREE WRITERS, ONE RULE. `assigned_to` is set by the bulk allocator, the hand-out screen
 *     and the handover import. In the app the rule would have to be remembered in each, and the
 *     one that forgot would be the one nobody tested. In the database it cannot be forgotten.
 *   - A SECOND HANDOVER ON REALLOCATION. The firm: "runs once per account. Reallocation does not
 *     restart it." An account moving between collectors must not introduce the firm to the debtor
 *     twice — and the partial unique index alone would allow it once the first run finished.
 *   - THE CALENDAR COPIED INTO SQL. Dating a step means knowing about Easter and about the Monday
 *     a public holiday moves to. The schema's own note refuses a second copy, so the trigger
 *     creates the run with NO steps and the app — which has workingDays.ts — dates them.
 *   - AND A DAILY SWEEP BEING THE ONLY WAY IN. The handover is an email and an SMS five to ten
 *     minutes later; a once-a-day timer would introduce the firm to the debtor the next dawn.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-allocation-start.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { planRun } from '../../src/lib/workflowRun.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

const schema = read('supabase/schema.sql')
const planner = read('api/_lib/workflow/plan.ts')
const runner = read('api/_lib/workflow/run.ts')
const handOut = read('src/lib/handOutWrite.ts')
const store = read('src/lib/accountRun.ts')

/** One function's text, bounded at its own `end $$;` — a lazy match runs on into the next one. */
function fnText(name) {
  const at = schema.indexOf(`function public.${name}(`)
  if (at < 0) return ''
  const end = schema.indexOf('end $$;', at)
  return end < 0 ? schema.slice(at) : schema.slice(at, end)
}
const startFn = fnText('workflow_start_on_allocation')

/* ------------------------------------------------ it exists, and on the right event */

ok('something starts a run at all', startFn.length > 0)
/*
 * SLICED TO THIS TRIGGER'S OWN STATEMENT. Searched over the whole file, "update of assigned_to"
 * is satisfied by a DIFFERENT trigger that has watched the same column since long before this
 * one -- so the assertion passed with this trigger changed to fire on every update. Found by
 * break-testing: the edit landed on the other trigger and the check stayed green either way.
 */
const startTrigger = (() => {
  const at = schema.lastIndexOf('create trigger workflow_start_on_allocation')
  return at < 0 ? '' : schema.slice(at, schema.indexOf(';', at))
})()
ok('the trigger statement is the thing being read', startTrigger.length > 0)
ok('...on the account table', /on public\.debtor_accounts/.test(startTrigger))
/*
 * ON THE COLUMN, not on every update. `update of assigned_to` is what keeps this off the path of
 * every balance recalculation and every status change on a twenty-three-thousand-row book.
 */
ok('...watching the column that means "given to somebody"',
  /after insert or update of assigned_to/.test(startTrigger))

/* ------------------------------------------------ once, and only the first time */

ok('an account being unallocated starts nothing', /if new\.assigned_to is null then/.test(startFn))
/*
 * THE FIRM'S RULE. An account moving from one collector to another is not a new handover, and the
 * debtor must not be introduced to the firm twice.
 */
ok('a reallocation does not start it again',
  /tg_op = 'UPDATE' and old\.assigned_to is not null/.test(startFn))
/*
 * AND ONCE PER ACCOUNT AND VERSION *EVER*, in any state. The partial unique index on
 * workflow_runs stops a second LIVE run and would happily allow a second once the first finished
 * — which on a reallocation is exactly the case the firm ruled out.
 */
ok('...and neither does a run that has already finished',
  /not exists \([\s\S]{0,200}?from public\.workflow_runs r[\s\S]{0,120}?r\.account_id = new\.id and r\.version_id = v\.id/.test(startFn))
ok('...which is asked without a state, so a finished run still counts',
  !/not exists \([\s\S]{0,300}?r\.state/.test(startFn))

/* Drafts are being argued about; only a published version runs on a real account. */
ok('only an active version starts', /v\.state = 'active'/.test(startFn))
ok('...and only one that waits for an allocation', /v\.trigger_kind = 'allocated'/.test(startFn))
/*
 * EVERY such version, not "the" one. Two workflows may both start on allocation the day the firm
 * writes a second, and picking one arbitrarily is how a workflow silently never runs.
 */
ok('...every one of them, not the first found', /insert into public\.workflow_runs[\s\S]{0,400}?select new\.id, v\.id/.test(startFn))

/* THE FIRM'S DAY. The database is UTC and the firm is ahead of it; started_on is what every
   step's date is counted from, so a run started at midnight must not be dated yesterday. */
ok('the run is dated in the firm’s own day', /Africa\/Johannesburg/.test(startFn))
/* Whether a workflow starts cannot depend on who did the allocating. */
ok('it does not depend on who allocated', /security definer/.test(startFn))
ok('...and is still pinned to the public schema', /set search_path to 'public'/.test(startFn))

/* ------------------------------------------------ the calendar stays in one place */

/*
 * THE TRIGGER DATES NOTHING. Working days, Easter and the Monday a holiday moves to live in
 * workingDays.ts, and the schema's own note on workflow_run_steps refuses a second copy in SQL.
 * So the run arrives with no steps and the app fills them in.
 */
ok('the trigger inserts no steps', !/insert into public\.workflow_run_steps/.test(startFn))
ok('...and says so, because a run with no steps looks broken otherwise',
  /without steps|no steps/i.test(schema.slice(Math.max(0, schema.indexOf('workflow_start_on_allocation') - 2500),
    schema.indexOf('workflow_start_on_allocation'))))

ok('the planner exists', planner.length > 0)
ok('...and dates through the one calendar there is', /planRun\(\{/.test(planner))
ok('...reading the version’s own unit', /day_unit/.test(planner))
/*
 * A RUN WITH NO STEPS IS NOT A FINISHED RUN. `isFinished` is false for an empty one, deliberately
 * — which is what lets "unplanned" be a state the planner can find rather than a guess.
 */
check('an empty run is not mistaken for a finished one',
  planRun({ nodes: [], dayUnit: 'calendar', startedOn: '2026-09-23' }), [])
ok('the planner looks for runs with no steps', /workflow_run_steps \?\? \[\]\)\s*as unknown\[\]\)\.length === 0/.test(planner))
/*
 * AND A WORKFLOW WITH NOTHING IN IT FINISHES rather than being re-read by every sweep for ever
 * and reading on the account as a workflow that started and never does anything.
 */
ok('a workflow with no steps is finished, not retried for ever',
  /no steps in it[\s\S]{0,80}?Marked finished|state: 'finished'/.test(planner))
/* Two planners racing -- the app nudging while the cron sweeps -- is refused by the database
   rather than left to be found at month end. */
ok('a double plan is refused rather than doubled', /duplicate key/i.test(planner))

/* The dates are right, run rather than read: the handover is same-day, then the day after. */
const dated = planRun({
  nodes: [
    { id: 'a', day: 0, ordinal: 0, needsRelease: false, statutory: false },
    { id: 'b', day: 0, ordinal: 1, needsRelease: false, statutory: false },
    { id: 'c', day: 1, ordinal: 2, needsRelease: false, statutory: false },
  ],
  dayUnit: 'calendar',
  startedOn: '2026-09-23',
})
check('the handover is dated the day it starts, then the day after',
  dated.map((s) => s.dueOn), ['2026-09-23', '2026-09-23', '2026-09-24'])

/* ------------------------------------------------ and it does not wait for the morning */

ok('the runner dates what is unplanned before it sends', /planUnplannedRuns\(admin, accountId\)/.test(runner))
/*
 * SO PLANNING AND SENDING ARE ONE PASS on a handover: the run is created, dated and sent in the
 * same call, which is what makes "email then SMS minutes later" possible at all.
 */
const planAt = runner.indexOf('planUnplannedRuns')
const sendAt = runner.indexOf('runOneStep(admin, step, today)')
ok('both halves are there', planAt > 0 && sendAt > 0)
ok('...and it plans before it sends', planAt < sendAt)

/*
 * TWO CALLERS, AND THE NARROWER ONE IS THE PERSON. The timer proves itself with CRON_SECRET and
 * sweeps the book; a signed-in user must name ONE account, so nudging their own allocation
 * cannot set the floor's sends going.
 */
ok('the timer still sweeps with its secret', /CRON_SECRET/.test(runner))
ok('a person must prove a session instead', /requireCaller\(req, admin\)/.test(runner))
ok('...and must name an account', /Only the timer sweeps the whole book/.test(runner))
ok('...which narrows the work to that account',
  /query\.eq\('workflow_runs\.account_id', accountId\)/.test(runner))

/* ------------------------------------------------ the nudge */

ok('the app can ask for its own account now', /export function nudgeWorkflows/.test(store))
ok('...and it is the hand-out that asks', /nudgeWorkflows\(input\.accessToken, placements\[0\]\.accountId\)/.test(handOut))
/*
 * ONE ACCOUNT, NOT A BATCH. A hand-out of five hundred would be five hundred calls out of a
 * browser, each sending real email. A batch waits for the sweep, which is what the sweep is for.
 */
ok('...only for a single account', /placements\.length === 1/.test(handOut))
/*
 * AND IT NEVER FAILS THE HAND-OUT. The accounts ARE allocated and the run IS created by the
 * trigger; a slow send must not make the hand-out look like it went wrong.
 */
ok('the nudge is not awaited', !/await nudgeWorkflows/.test(handOut))
ok('...and swallows its own errors', /\.catch\(\(\) => \{/.test(store))

/* ------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-allocation-start: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
