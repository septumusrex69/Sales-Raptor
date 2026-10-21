/**
 * A HAND-OUT OF EIGHT MUST START EIGHT WORKFLOWS.
 *
 * THE FIRM, having handed over eight accounts and watched nothing happen: "why didn't it send out
 * the workflows now? I handed people over as new handovers, but they didn't go the handover."
 *
 * WHAT WAS THERE. Eight runs, created by the allocation trigger the moment each account landed on
 * a desk — and NOUGHT STEPS under any of them, because dating a step needs the working-day
 * calendar and that lives in the app rather than in SQL. The app's job was to hurry it along, and
 * it only did so for exactly one account:
 *
 *     if (input.mode === 'allocate_and_refer' && placements.length === 1 && input.accessToken)
 *
 * The limit answered a real worry — a five-hundred-account hand-out becoming five hundred calls
 * out of somebody's browser, each sending real email — and it answered it by making the ordinary
 * case zero.
 *
 * THE CAP WAS IN THE WRONG PLACE, which is the firm's own verdict: "there shouldn't be a cap...
 * we could hand over like 1,000 accounts." Nothing may limit how many accounts get a workflow;
 * every one of them must. What has to be bounded is ONE REQUEST, because a serverless function
 * has a wall clock and a single email opens an SMTP connection to the collector's own mailbox.
 *
 * So: no cap on the total, a cap on the time, and a `remaining` count that lets the caller come
 * back for the rest. This holds those three apart, because the easy mistake is to "fix" the cap
 * by raising the number — which is the same bug with a bigger constant in it.
 *
 * Run: node scripts/qa/check-workflow-batch.mjs
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
/* Comments stripped before anything is searched: several assertions below are about what is
   ABSENT, and every one of these files explains at length what it no longer does. */
const stripped = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ')

const run = stripped('api/_lib/workflow/run.ts')
const plan = stripped('api/_lib/workflow/plan.ts')
const promises = stripped('api/_lib/workflow/promises.ts')
const handOut = stripped('src/lib/handOutWrite.ts')
const accountRun = stripped('src/lib/accountRun.ts')
const vercel = JSON.parse(read('vercel.json'))

ok('the runner is readable at all', run.length > 2000)

/* ---------------- no cap on how many accounts ---------------- */

/*
 * THE LINE THE FIRM MET, asserted as an absence. A `length === 1` anywhere near the nudge is the
 * bug returning; so is `length <= N`, which is the same bug with a constant in it.
 */
ok('the hand-out no longer nudges only a single account',
  !/placements\.length === 1/.test(handOut))
/*
 * READ OUT OF THE NUDGE'S OWN `if`, not the whole file -- which is the false positive this check
 * walked into first. `if (placements.length === 0) return result` sits forty lines above and is a
 * perfectly good early return; a pattern loose enough to catch the cap caught that instead, and
 * reported a bug in correct code.
 */
const nudgeIf = (handOut.match(/if \([^)]*nudge[\s\S]{0,40}|if \([^)]*\) \{\s*\n\s*nudgeWorkflows/g) ?? []).join(' ')
  + (handOut.match(/if \([^{]*\)\s*\{\s*nudgeWorkflows[^}]*\}/g) ?? []).join(' ')
  + (handOut.match(/if \([^{]*\)\s*\{[^}]*nudgeWorkflows[^}]*\}/g) ?? []).join(' ')
ok('the nudge s own condition was found', /nudgeWorkflows/.test(nudgeIf))
ok('...and has not grown a numeric cap instead',
  !/placements\.length\s*(<=|<|===)\s*[1-9]/.test(nudgeIf))
/* AND IT STILL ONLY FIRES WHERE THERE IS SOMETHING TO FIRE FOR. `> 0` is not a cap -- it is the
   difference between a hand-out and an empty one, and nudging with no ids is a pointless call. */
ok('...but does nothing when nothing was placed', /placements\.length > 0/.test(handOut))
ok('...and sends every account it placed',
  /nudgeWorkflows\(input\.accessToken, placements\.map\(\(p\) => p\.accountId\)\)/.test(handOut))
/* ONLY ON AN ALLOCATION. A referral leaves the owner in place and starts nothing. */
ok('...only when the accounts actually changed hands',
  /mode === 'allocate_and_refer'/.test(handOut))

/* ---------------- the server takes a list ---------------- */

ok('the runner reads a list of accounts', /accountIds/.test(run))
/* THE SINGLE ID STILL WORKS. Three callers pass one -- the promise modal, the dispute paths and
   the section 129 start -- and breaking them to fix the hand-out would be a poor trade. */
ok('...and still accepts a single one beside it', /body\.accountId === 'string'/.test(run))
ok('...de-duplicated, so one account twice is not two of the budget',
  /new Set\(accounts\)/.test(run))
/* NARROWED WITH `in`, not `eq`: the whole point is more than one. */
ok('the due query narrows to those accounts',
  /query\.in\('workflow_runs\.account_id', accountIds\)/.test(run))
for (const [file, src, fn] of [
  ['plan.ts', plan, 'planUnplannedRuns'], ['plan.ts', plan, 'redateResumedRuns'],
  ['promises.ts', promises, 'expireDefaultedPromises'],
]) {
  ok(`${fn} in ${file} takes the list too`,
    new RegExp(`${fn}[\\s\\S]{0,400}accounts\\?: string\\[\\]`).test(src))
}
ok('...and all three narrow with `in`',
  (plan.match(/query\.in\('account_id', accounts\)/g) ?? []).length === 2
  && /query\.in\('account_id', accounts\)/.test(promises))

/*
 * AND A SESSION STILL MAY NOT SWEEP THE BOOK. This is the security line the single-id version was
 * really holding, and it survives the widening: only the timer, proving itself with CRON_SECRET,
 * may act on accounts it was not given. A signed-in user naming their own hand-out is not the
 * same thing as one setting the whole floor's sends going.
 */
ok('a caller with no accounts named is refused', /accountIds\.length === 0/.test(run))
ok('...unless it is the timer', /const isCron = Boolean\(cronSecret\)/.test(run))
/* AND A MISSING SECRET IS NOT A PASS -- `Boolean(cronSecret) &&`, never `!cronSecret ||`. */
ok('...and an unset secret refuses more, not less',
  !/!cronSecret \|\|/.test(run))

/* ---------------- the cap is on TIME, and it reports what is left ---------------- */

/*
 * THE REPLACEMENT FOR THE CAP, and the assertion that stops somebody "simplifying" it away. A
 * function killed at maxDuration returns a 504 with nothing to show: the steps it sent are sent,
 * and the caller is told nothing at all. Stopping itself early is what turns that into "come back
 * for the rest".
 */
ok('one pass is bounded by a clock', /const BUDGET_MS = /.test(run))
ok('...checked BEFORE each step, not after', /if \(Date\.now\(\) - startedAt > budgetMs\)/.test(run))
ok('...and what it did not reach is counted', /left \+= 1/.test(run))
ok('...and reported', /remaining: left/.test(run))

/*
 * THE BUDGET SITS INSIDE THE FUNCTION'S OWN LIMIT, with room for one generous send. Read out of
 * vercel.json rather than repeated here, because the two drifting apart is exactly how a pass
 * ends in a 504: the budget would be a promise about a clock that had already stopped.
 */
const maxDuration = vercel.functions?.['api/**/*.ts']?.maxDuration
/*
 * READ, NOT PINNED. This used to assert the number was exactly 60, which was the Hobby ceiling --
 * and when the firm moved to Pro and the mail sweep was given five minutes to get round fifty
 * mailboxes, the assertion failed on a change that made every number here safer. What matters is
 * the relationship below: the budget stops the pass well inside whatever the function is allowed.
 */
ok('vercel.json gives the function room to send', Number.isFinite(maxDuration) && maxDuration >= 60)
const budgetMs = Number((read('api/_lib/workflow/run.ts').match(/const BUDGET_MS = ([\d_]+)/) ?? [])[1]?.replace(/_/g, ''))
ok('the budget was actually found', Number.isFinite(budgetMs) && budgetMs > 0)
ok('...and stops well inside the function s limit', budgetMs < maxDuration * 1000)
/* A QUARTER SPARE, at least. Planning and re-dating have already spent some of the function's
   life before the first send, and a single SMTP send can take seconds on its own. */
ok('...with room for the work either side of the sending',
  budgetMs <= maxDuration * 1000 * 0.8)

/* ---------------- and the browser comes back for the rest ---------------- */

ok('the nudge takes one account or many', /accountIds: string \| string\[\]/.test(accountRun))
ok('...and posts them as a list', /body: JSON\.stringify\(\{ accountIds \}\)/.test(accountRun))
ok('...and calls again while work is left', /if \(!body\.remaining\) return/.test(accountRun))

/*
 * THE TWO GUARDS ON THAT LOOP, and both are about a browser rather than a server. A pass that
 * reports work left and then does none of it -- a mailbox that will not authenticate, a provider
 * refusing everything -- would otherwise spin for ever on somebody's iPad.
 */
ok('the loop gives up when nothing moves', /quiet >= 2/.test(accountRun))
ok('...counting a held step as movement, because it was looked at',
  /body\.sent \?\? 0\) \+ \(body\.held \?\? 0\)/.test(accountRun))
ok('...and has a ceiling on passes as well', /MAX_PASSES/.test(accountRun))
/* A CEILING ON PASSES IS NOT A CAP ON ACCOUNTS. Each pass does as much as it can, so twenty-five
   passes is twenty-five budgets of work -- not twenty-five accounts. Asserted because the two
   read alike and only one of them is the bug the firm reported. */
const maxPasses = Number((accountRun.match(/MAX_PASSES = (\d+)/) ?? [])[1])
ok('...which is generous enough not to be a cap in disguise', maxPasses >= 10)

/* AND A FAILED REQUEST STOPS IT RATHER THAN RETRYING FOR EVER. */
ok('a refused pass ends the loop', /if \(!res\.ok\) return/.test(accountRun))

/* ---------------- the sweep is still the backstop ---------------- */

/*
 * NONE OF THIS REPLACES THE TIMER. Whoever closes their iPad mid-hand-out leaves the rest to the
 * overnight sweep, and that is the correct behaviour rather than a gap -- it is what lets the
 * nudge be fire-and-forget in the first place.
 */
ok('the daily sweep still exists',
  (vercel.crons ?? []).some((c) => c.path === '/api/workflow/run'))
ok('...and still sends overdue steps, not only today s', /\.lte\('due_on', today\)/.test(run))

console.log(`\ncheck-workflow-batch: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
