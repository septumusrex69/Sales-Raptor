/**
 * A PROMISE STARTS THE ARRANGEMENT WORKFLOW, AND THE CONFIRMATION GOES OUT ON THE PRESS.
 *
 * THE FIRM, HAVING RECORDED ONE: "I've recorded a promise now on Stella Artwa, but it didn't
 * trigger the workflow and what was necessary for the workflows."
 *
 * THE HALF THAT WORKED HID THE HALF THAT DID NOT, which is why this is worth a file of its own.
 * Recording the promise DID pause the section 129 -- the run went to `held`, the screen changed,
 * something clearly happened. What did not happen is the arrangement's own sequence, because
 * nothing in the system started a `promise_due` workflow at all: `allocated` starts itself in the
 * database and `by_hand` starts from a button, and the other two trigger kinds were vocabulary
 * with nothing behind them. A version could be published against either and would sit for ever.
 *
 * WHAT WOULD BREAK WITHOUT EACH GUARD BELOW, and none of them announces itself:
 *   - no trigger at all: the debtor is never told their arrangement was accepted.
 *   - once per ACCOUNT instead of once per LIVE RUN: a debtor who agrees a second arrangement
 *     months later gets nothing, because the account has "been through it".
 *   - a promise imported as already broken starting a run: a confirmation email for an
 *     arrangement that failed last March.
 *   - no nudge: the run exists with no dates and nothing sent, so the confirmation waits for the
 *     morning sweep -- and the confirmation is an email with an SMS behind it, which a once-a-day
 *     timer cannot express at all.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-promise-starts-workflow.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

const sql = read('../../supabase/schema.sql')
const promises = read('../../src/lib/accountPromises.ts')
const runner = read('../../api/_lib/workflow/run.ts')
const detail = read('../../src/pages/accounts/AccountDetail.tsx')

/*
 * THE LAST DEFINITION IS THE LIVE ONE. schema.sql is append-only, so a function a later migration
 * replaced appears twice and `indexOf` would assert against the superseded copy -- which is how
 * removing `tracing` once failed a check on correct code. The bare name also appears in the
 * grant, the revoke and the comment, so lastIndexOf on the name alone lands on a one-line
 * statement and returns nothing.
 */
function lastFunction(name) {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const end = sql.indexOf('end $$;', at)
  return end < 0 ? sql.slice(at) : sql.slice(at, end)
}

/* ---------- there is a trigger, and it is wired up ---------- */

const fn = lastFunction('workflow_start_on_promise')
ok('a promise has something that starts a workflow', fn.length > 400)
ok('...wired to the promises table', /create trigger promise_starts_workflow/.test(sql))
/* AFTER INSERT, not on update: editing a promise is a correction to what was agreed, not a new
   agreement, and a second confirmation off a fixed typo is a second promise in the inbox. */
ok('...on insert and nothing else',
  /create trigger promise_starts_workflow\s*\n\s*after insert on public\.promises_to_pay/.test(sql))
/* The same shape as the allocation trigger it is modelled on: security definer, search_path
   pinned, and not callable by anybody who happens to find it. */
ok('...running as the definer with its search path pinned',
  /security definer/.test(fn) && /set search_path to 'public'/.test(fn))
ok('...and not callable from outside',
  /revoke all on function public\.workflow_start_on_promise\(\) from public/.test(sql))

/* ---------- which version it starts ---------- */

ok('it starts the published arrangement workflow', /v\.state = 'active'/.test(fn))
ok('...the one that waits for a promise', /v\.trigger_kind = 'promise_due'/.test(fn))
/*
 * THE FIRM'S DAY, NOT THE SERVER'S. The database is not in Johannesburg either, and started_on is
 * what every step of the sequence is counted from.
 */
ok('...dated in the firm’s own day', /now\(\) at time zone 'Africa\/Johannesburg'/.test(fn))
/* Whoever took the promise owns the run, so the sequence is somebody's rather than nobody's. */
ok('...started by whoever took the promise', /new\.created_by/.test(fn))

/* ---------- once per live arrangement, not once per account ever ---------- */

/*
 * THE ONE LINE THAT DELIBERATELY DIFFERS FROM THE ALLOCATION TRIGGER BESIDE IT. A handover happens
 * to an account once; an arrangement happens as often as a debtor makes one. Guarded on any run
 * ever, a debtor who broke an arrangement in March and agreed a new one in August would be sent
 * nothing at all.
 */
ok('a second live run is refused', /r\.state in \('running', 'held'\)/.test(fn))
ok('...rather than any run ever', !/and r\.version_id = v\.id\s*\n\s*\)/.test(fn))
/* And the allocation trigger is NOT changed by this: its own rule is still once per account ever,
   because a handover really does happen once. */
{
  const alloc = lastFunction('workflow_start_on_allocation')
  ok('the handover is still once per account, ever', alloc.length > 200 && !/r\.state in/.test(alloc))
}

/* ---------- history sends nobody an email ---------- */

/*
 * A PROMISE RECORDED AS ALREADY KEPT OR ALREADY BROKEN is somebody writing down what happened --
 * an import, a correction -- and it must not put a confirmation in a debtor's inbox for an
 * arrangement that failed last March.
 */
ok('a promise that is not live starts nothing', /if new\.status <> 'open' then/.test(fn))

/* ---------- and the confirmation goes on the press ---------- */

/*
 * THE RUN IS CREATED WITH NO DATES AND NOTHING SENT -- that is what the allocation trigger does
 * too, and why nudgeWorkflows exists. Left to the sweep, an arrangement agreed at ten o'clock is
 * confirmed the following dawn.
 */
ok('recording a promise nudges the runner', /nudgeWorkflows\(input\.accessToken, input\.accountId\)/.test(promises))
/* AFTER the fee and the timeline note: everything above is the firm's own record of what was
   agreed, and a confirmation sent against a promise whose note then failed is a message the
   account cannot account for. */
ok('...after the record of it is complete',
  promises.indexOf('nudgeWorkflows(') > promises.indexOf('await addNote('))
/* OPTIONAL, so a check or an import can record a promise with no session and leave the sending to
   the sweep -- and its absence never fails the promise. */
ok('...and its absence does not fail the promise', /if \(input\.accessToken\) nudgeWorkflows/.test(promises))
ok('the account screen passes its session', /accessToken: session\?\.access_token \?\? null/.test(detail))

/* ---------- a missing cron secret is not a pass ---------- */

/*
 * THIS READ `!cronSecret || ...`, so an environment with CRON_SECRET unset treated EVERY caller as
 * the timer: an unauthenticated POST would date and send every due step on the whole book. The
 * secret is unset on the deployment today, which made it a live hole rather than a theoretical
 * one -- and the fallback was the wrong way round. An unconfigured environment should refuse more.
 */
ok('the timer is only the timer when the secret is actually set',
  /const isCron = Boolean\(cronSecret\) && req\.headers\.authorization === `Bearer \$\{cronSecret\}`/.test(runner))
ok('...never true merely because nothing is configured', !/const isCron = !cronSecret/.test(runner))
/* Without it the app's own nudge still works, because it carries a session and names one account:
   the sweep stops, which is visible and mendable, and the handover and the arrangement do not. */
ok('a session still nudges one account', /if \(!accountId\) \{/.test(runner))
ok('...and is told what is missing when the sweep cannot run',
  /The timer cannot sweep the book until CRON_SECRET is set/.test(runner))

/* ---------- the version it starts would actually send something ---------- */

/*
 * VERSION 1 WAS A SKELETON: four nodes, no templates, seeded to demonstrate the pause-and-resume
 * scenarios before the firm had written any arrangement wording. Started on a promise it would
 * have created four review steps and put nothing in front of the debtor -- which reads on screen
 * exactly like a workflow that is working.
 */
const publish = sql.slice(sql.lastIndexOf('THE ARRANGEMENT WORKFLOW GETS THE WORDING'))
ok('the arrangement workflow is published with the firm’s own wording', publish.length > 1000)
ok('...the confirmation email', /seed_key = 'email-ptp-confirmed-individual'/.test(publish)
  && /seed_key = 'email-ptp-confirmed-company'/.test(publish))
ok('...and the SMS behind it', /seed_key = 'sms-ptp-confirmed-individual'/.test(publish)
  && /seed_key = 'sms-ptp-confirmed-company'/.test(publish))
/* THE EMAIL FIRST AND THE SMS BEHIND IT, which is the firm's rule for every sequence they have
   drawn and what pairs the two rows into one step of their chart. */
ok('...the SMS following the email', /0, 1, 'sms', false, 7, false/.test(publish))
ok('...and the email leading it', /0, 0, 'email', false, null, false/.test(publish))
/* PUBLISHED, or a promise starts nothing: the trigger only looks at active versions. */
ok('...and it is published', /set state = 'active', published_at = now\(\) where id = v_draft/.test(publish))
/* THE SKELETON IS ARCHIVED, NOT DELETED: runs of it exist and a run points at the version it
   followed, which is the question an attorney asks eighteen months later. */
ok('...with the skeleton archived rather than deleted', /set state = 'archived'/.test(publish))
/*
 * AND IT REFUSES TO PUBLISH A VERSION THAT WOULD SEND NOTHING, which is the exact fault version 1
 * had. A guard in the migration rather than a comment about it.
 */
ok('a message node with no template is refused',
  /A message node has no template, so this version would send nothing/.test(publish))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-promise-starts-workflow: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
