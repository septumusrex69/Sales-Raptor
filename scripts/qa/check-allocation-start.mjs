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
/*
 * COMMENTS STRIPPED, for the assertions below that are about what is ABSENT.
 *
 * handOutWrite.ts now EXPLAINS the `placements.length === 1` it used to carry -- the firm handed
 * over eight accounts and got nothing, and the comment says so -- which means a check asserting
 * the line is gone was reading the story of its removal and reporting the bug as still present.
 * The same trap this codebase has met in check-field-widths and check-client-mandate.
 */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ')

const schema = read('supabase/schema.sql')
const planner = read('api/_lib/workflow/plan.ts')
const runner = read('api/_lib/workflow/run.ts')
const handOut = code('src/lib/handOutWrite.ts')
const store = read('src/lib/accountRun.ts')

/**
 * One function's text, bounded at its own `end $$;` — a lazy match runs on into the next one.
 *
 * THE LAST DEFINITION, NOT THE FIRST, and this check was reading the first. schema.sql is
 * APPEND-ONLY, so a function a later migration replaced appears in the file twice and `indexOf`
 * lands on the copy that is no longer live — which is how a guard can be added, applied to the
 * database, mirrored into the file, and asserted against the superseded body that never had it.
 * CLAUDE.md names this exact failure; it caught it once on removing `tracing` from the exit list
 * and it was sitting here unfixed.
 *
 * ANCHORED ON `create or replace function`, not on the bare name: the name also appears in the
 * function's own `comment on function`, in grants and in revokes, so a plain lastIndexOf lands on
 * a one-line statement and returns nothing — which fails OPEN, because every regex below would
 * then be tested against an empty string.
 */
function fnText(name) {
  const at = schema.lastIndexOf(`create or replace function public.${name}(`)
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

/* ------------------------------------------------ and not on an account it would lie to */

/*
 * AN IMPORTED ACCOUNT IS NOT A NEW HANDOVER.
 *
 * THE FIRM, looking at BPM0109 after the first test import -- an account frozen since 19 July that
 * had just been sent a Handover email and a Handover SMS: "files imported from Swordfish shouldn't
 * receive handover SMSs and stuff ... if it's imported from Swordfish, no handover SMSs. New
 * handovers, SMSs and letters, handover."
 *
 * A handover notice tells a debtor their account has just been placed with this firm, which on a
 * file the firm has had for years is not true -- and on an SMS the debtor is charged for it under
 * item 1(c). On the real book this would have fired on every account that came across.
 */
ok('an imported account starts nothing', /if new\.imported_at is not null then\s*\n\s*return new;/.test(startFn))
/*
 * AND NOT ON ONE NOBODY MAY CHASE. BPM0109 was frozen as well as imported, and an imported freeze
 * never went through hold_account -- so there was no workflow_run_holds row to pause what started
 * afterwards. The firm's own rule about queues, applied to the thing that leaves the building.
 */
ok('an account outside the Active book starts nothing',
  /if new\.book <> 'active' then\s*\n\s*return new;/.test(startFn))
/*
 * READ OFF THE DERIVED COLUMN, not re-derived here. `book` is the one generated column; a second
 * copy of the case expression in this trigger is the drift CLAUDE.md names, and the failure would
 * be a notice going out to an account the list shows as frozen.
 */
ok('...reading the derived book rather than the status', !/new\.status ~~\*/.test(startFn))

/*
 * BOTH BEFORE THE INSERT, which is the half an assertion on presence alone does not get: a guard
 * written after the run has already been created stops nothing.
 *
 * PRESENCE FIRST, THEN ORDER -- asserted above, compared here. `indexOf` returns -1 for something
 * absent, and -1 is less than every real index, so an order-only assertion passes vacuously the
 * moment the guard it orders is deleted. The house has been caught by exactly this.
 */
const insertAt = startFn.indexOf('insert into public.workflow_runs')
const importGuardAt = startFn.indexOf('new.imported_at is not null')
const bookGuardAt = startFn.indexOf("new.book <> 'active'")
ok('the run is actually created somewhere in here', insertAt > 0)
ok('the imported guard runs before the run is created',
  importGuardAt > 0 && importGuardAt < insertAt)
ok('...and so does the book guard', bookGuardAt > 0 && bookGuardAt < insertAt)

/*
 * AND THE SCREEN SAYS SO. A guard that silently does nothing is a screen somebody reads as broken:
 * a collector allocates an imported account, opens Workflows, finds it empty, and starts one by
 * hand -- which sends the debtor the notice the guard exists to prevent.
 *
 * THE WHOLE CHAIN, because the middle of it fails silently. `imported_at` has to be in the mapper
 * (a column in the table, in the type and in `select('*')` but missing from the hand-written mapper
 * reads as undefined for ever and nothing throws -- diary_capacity sat in that state for months),
 * then passed to the pane, then drawn.
 */
const book = read('src/lib/accountBook.ts')
const panel = read('src/components/collections/WorkflowRunPanel.tsx')
const detail = read('src/pages/accounts/AccountDetail.tsx')
ok('the mapper carries imported_at', /importedAt: r\.imported_at/.test(book))
ok('...and the account type declares it', /importedAt: string \| null/.test(book))
ok('...the account page hands it to the pane', /importedAt=\{account\.importedAt\}/.test(detail))
ok('...and the pane says why nothing ran', /came across from Swordfish/.test(panel))
/* NOT THE DECIDER. The rule is the database's; a browser that could suppress a handover itself
   would be a second place the rule lives, and the two would drift. */
ok('...without the browser deciding anything', !/importedAt[\s\S]{0,200}?startWorkflow|importedAt && .{0,40}offers =/.test(panel))

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
/* raptor_today() IS the firm's day (Africa/Johannesburg) -- and on staging, the staging clock's
   (prompt 10). check-staging-clock holds what it is. */
ok('the run is dated in the firm’s own day', /public\.raptor_today\(\)/.test(startFn))
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

ok('the runner dates what is unplanned before it sends', /planUnplannedRuns\(admin, accountIds\)/.test(runner))
/*
 * SO PLANNING AND SENDING ARE ONE PASS on a handover: the run is created, dated and sent in the
 * same call, which is what makes "email then SMS minutes later" possible at all.
 */
const planAt = runner.indexOf('planUnplannedRuns')
const sendAt = runner.indexOf('runOneStep(admin, step, today,')
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
/* `in`, NOT `eq`, SINCE THE HAND-OUT NAMES ALL OF THEM. The narrowing is the same rule -- the
   caller says which accounts it is talking about and only the timer may say "all of them" -- and
   what changed is that a hand-out of eight is eight names rather than a reason to nudge nothing.
   See check-workflow-batch. */
ok('...which narrows the work to those accounts',
  /query\.in\('workflow_runs\.account_id', accountIds\)/.test(runner))

/* ------------------------------------------------ the nudge */

ok('the app can ask for its own account now', /export function nudgeWorkflows/.test(store))
ok('...and it is the hand-out that asks',
  /nudgeWorkflows\(input\.accessToken, placements\.map\(\(p\) => p\.accountId\)\)/.test(handOut))
/*
 * EVERY ACCOUNT IT PLACED, AND THIS ASSERTION USED TO SAY THE OPPOSITE.
 *
 * It read `placements.length === 1` and called that correct: "a hand-out of five hundred would be
 * five hundred calls out of a browser, each sending real email." The worry was real; the answer
 * was not. THE FIRM handed over EIGHT and got eight runs with no steps in any of them -- "I
 * handed people over as new handovers, but they didn't go the handover."
 *
 * The cap moved to where it belongs: one REQUEST is bounded by a clock, no number of accounts is
 * bounded at all, and the browser comes back while work is left. check-workflow-batch holds that
 * whole bargain; what is held here is that the hand-out hands over all of them.
 */
ok('...for every account it placed, not one of them', /placements\.length > 0/.test(handOut))
ok('...and no longer only for a single one', !/placements\.length === 1/.test(handOut))
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
