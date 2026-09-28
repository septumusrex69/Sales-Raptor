/**
 * THE TEST CLOCK, AND THE THREE THINGS THAT KEEP IT OFF A REAL DEBTOR.
 *
 * THE FIRM ASKED TO WATCH A SEQUENCE HAPPEN: "everything go out one minute after the other... two
 * minutes where everything happens... and I will tick received or not received."
 *
 * WHAT IS BEING GUARDED IS NOT THE FEATURE, IT IS THE BLAST RADIUS. This endpoint rewrites the
 * dates on statutory notices, and the failure it must never have is not "the test did not run" --
 * it is a section 129 on a real debtor going out five weeks early because somebody pointed a
 * preview build at production. So the locks are checked harder than the arithmetic:
 *
 *   1. STAGING ONLY, decided by the Supabase URL the deployment is pointed at.
 *   2. A TEST ACCOUNT ONLY, by the numbering the firm already uses.
 *   3. AND AGAIN IN THE DATABASE, where no client can talk its way past it -- granted to no role
 *      but service_role, and refusing a non-test account itself.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-test-clock.mjs
 */
import { readFileSync } from 'node:fs'
import {
  isTestAccount, isStagingDatabase, daysToNextStep, shiftBack, daysBetween,
  STAGING_PROJECT_REF, TEST_ACCOUNT_PREFIX,
} from '../../src/lib/testClock.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
/* Comments off: every file below explains why production is refused, and a grep for the production
   ref cannot tell the explanation from a use of it. */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')

/* ---------------- lock one: staging only ---------------- */

check('staging is the project the firm works in', STAGING_PROJECT_REF, 'kvkajxpremantdkhmjvb')
ok('the staging database is allowed',
  isStagingDatabase(`https://${STAGING_PROJECT_REF}.supabase.co`))
/*
 * PRODUCTION IS REFUSED BY NAME. qcvesjzoiznrvunjrqpv is the project carrying real client money --
 * CLAUDE.md's environment table -- and this assertion is the one that would have to fail before a
 * test clock could reach a real debtor.
 */
ok('production is refused', !isStagingDatabase('https://qcvesjzoiznrvunjrqpv.supabase.co'))
/* AND SO IS ANYTHING ELSE. An unconfigured environment refuses MORE, not less -- the same way
   round as run.ts's CRON_SECRET, and for the same reason. */
ok('...and so is an unset URL', !isStagingDatabase(undefined) && !isStagingDatabase(''))
ok('...and something that is not a URL at all', !isStagingDatabase('kvkajxpremantdkhmjvb'))
/*
 * READ OFF THE HOST, NOT SEARCHED FOR IN THE STRING. A URL that merely CONTAINS the staging ref --
 * a proxy, a query string, a host that ends with it -- is not the staging database, and an
 * `includes` here would have accepted every one of them.
 */
ok('...and a production URL that merely mentions staging',
  !isStagingDatabase(`https://qcvesjzoiznrvunjrqpv.supabase.co/?ref=${STAGING_PROJECT_REF}`))
ok('...and a lookalike host', !isStagingDatabase(`https://evil-${STAGING_PROJECT_REF}.supabase.co`))

/* ---------------- lock two: test accounts only ---------------- */

check('the firm’s own test numbering', TEST_ACCOUNT_PREFIX, 'BF-TEST')
ok('a test account is allowed', isTestAccount('BF-TEST-028'))
ok('a real account is refused', !isTestAccount('LDT-00341'))
/* NULL IS NOT A TEST ACCOUNT. An account with no number is the one case where "unknown" could be
   read as "fine", and it is the case a missing mapper produces. */
ok('...and so is an account with no number', !isTestAccount(null) && !isTestAccount(undefined))
/* A PREFIX, NOT A SUBSTRING: a debtor's own reference containing the words must not open this. */
ok('...and so is a number that only contains it', !isTestAccount('ACC-BF-TEST-1'))

/* ---------------- lock three: the database refuses it again ---------------- */

const sql = read('supabase/schema.sql')
const fnAt = sql.lastIndexOf('create or replace function public.workflow_test_advance(')
ok('the database has the test-clock function', fnAt > 0)
const fn = fnAt > 0 ? sql.slice(fnAt, sql.indexOf('$$;', fnAt)) : ''
/* THE LOCK THAT ACTUALLY HOLDS. The two above are checks a client could one day be talked past;
   this is the ledgers' rule applied to the calendar. */
ok('...which refuses a real account itself', /v_number not like 'BF-TEST%'/.test(fn))
ok('...loudly, rather than by doing nothing', /raise exception[\s\S]{0,120}?is a real account/.test(fn))
/* AND IT IS NOT REACHABLE BY A SIGNED-IN PERSON. Only the service_role client behind the endpoint
   can call it, so a leaked button is not a way in either. */
const grants = sql.slice(fnAt)
ok('...and no signed-in caller may run it',
  /revoke all on function public\.workflow_test_advance\(uuid, integer\) from authenticated;/.test(grants)
  && !/grant execute on function public\.workflow_test_advance/.test(grants))
/*
 * A SENT STEP DOES NOT MOVE, here as everywhere in this codebase: its date is the record of a
 * notice that reached a debtor. This is the one line of the function that keeps that true.
 */
ok('...and a sent step is never moved', /s\.state in \('pending', 'held'\)/.test(fn))
/* THE RUN MOVES WITH ITS STEPS, or the first pause-and-resume in a test re-dates everything from
   the original start and silently undoes the compression -- redateResumedRuns computes a step's
   date from started_on plus its day number. */
ok('...while the run itself moves with them', /set started_on = started_on - p_days/.test(fn))

/* ---------------- the jump: one tick is one event ---------------- */

const TODAY = '2026-09-28'
/*
 * THE NEXT EVENT, WHATEVER IT IS. The firm chose this over one day at a time so the quiet gap
 * between day 20 and day 39 of a section 129 costs nobody twenty minutes of waiting.
 */
check('the jump lands on the soonest step', daysToNextStep(TODAY, ['2026-10-09', '2026-10-01']), 3)
/* ZERO WHERE SOMETHING IS ALREADY DUE -- not a failure: the pass has work to do without moving
   anything, and moving would then skip a step the firm never saw go out. */
check('nothing moves when a step is already due', daysToNextStep(TODAY, ['2026-09-28', '2026-10-01']), 0)
check('...or overdue', daysToNextStep(TODAY, ['2026-09-01']), 0)
/* ZERO WHERE THERE IS NOTHING LEFT, which reads as "nothing to move forward to" rather than as an
   error: a sequence that has finished is the ordinary end of a test. */
check('nothing moves when nothing is left', daysToNextStep(TODAY, []), 0)

/*
 * AND THE SHAPE OF THE REST OF THE SEQUENCE SURVIVES. Every remaining step moves by the SAME
 * number of days, so the gaps between them are untouched and only the starting point changes --
 * which is what makes the test a test of the sequence rather than of a flattened version of it.
 */
{
  const steps = ['2026-10-01', '2026-10-09', '2026-11-05']
  const jump = daysToNextStep(TODAY, steps)
  const after = steps.map((d) => shiftBack(d, jump))
  check('the next step lands on today', after[0], TODAY)
  check('...and the gap to the one after it is unchanged',
    daysBetween(after[0], after[1]), daysBetween(steps[0], steps[1]))
  check('...and the gap after that too',
    daysBetween(after[1], after[2]), daysBetween(steps[1], steps[2]))
}

/* ---------------- the endpoint wires the three together ---------------- */

const api = code('api/_lib/workflow/advance.ts')
ok('the endpoint refuses a production database', /isStagingDatabase\(process\.env\.VITE_SUPABASE_URL\)/.test(api))
ok('...and refuses a real account', /isTestAccount\(account\?\.account_number/.test(api))
ok('...and moves the account through the database function',
  /\.rpc\('workflow_test_advance'/.test(api))
/*
 * AND THEN RUNS THE ORDINARY PASS, which is the whole point: after the dates move, what happens is
 * the same function the six o'clock cron calls. A test path that sent messages its own way would
 * be a test of the test path.
 */
ok('...then hands over to the ordinary daily pass', /await run\(req, res\)/.test(api))
/* NO CRON PATH. A test clock is never a timer and never sweeps: there is deliberately no secret
   here that widens it to the book. */
ok('...with no secret that widens it to the book', !/CRON_SECRET/.test(api))
/* ORDER: the database is checked before anything else, including who is asking -- what makes this
   safe is which database it is, and nothing about the caller changes that. */
/* MEASURED INSIDE THE HANDLER, not across the file: both names appear in the import block at the
   top, in the order the linter sorts them, which has nothing to do with the order they run in. */
const handler = api.slice(api.indexOf('export default async function handler('))
const atStaging = handler.indexOf('isStagingDatabase')
const atCaller = handler.indexOf('requireCaller')
ok('the database is checked before the caller',
  atStaging > 0 && atCaller > 0 && atStaging < atCaller)

/* AND IT COSTS NO SERVERLESS FUNCTION. Vercel's Hobby plan counts FILES: the router already
   existed, so a fourth action is free where a fourth file would not have been. */
const router = code('api/workflow/[action].ts')
ok('it is an action on the existing router', /run, release, start, advance,/.test(router))

/* ---------------- and the screen never offers what the server would refuse ---------------- */

const panel = code('src/components/collections/TestClockPanel.tsx')
ok('the panel draws nothing on a real account', /if \(!isTestAccount\(accountNumber\)\) return null/.test(panel))
/* THE SAME PREDICATE, not a second copy of the rule: written twice they drift, and the half that
   drifts is the one that offers the button. */
ok('...by the same predicate the server uses', /from '\.\.\/\.\.\/lib\/testClock\.ts'/.test(panel))
/* TWO MINUTES, THE FIRM'S OWN NUMBER. */
ok('the beat is two minutes', /window\.setInterval\([\s\S]{0,60}?120_000\)/.test(panel))
/* IT STOPS ITSELF ON A REFUSAL: a real account and a production database are facts about where you
   are, not failures to retry, and beating on would be hundreds of refusals an hour. */
ok('...and it stops itself when refused', /if \(!result\.ok\)[\s\S]{0,200}?setRunning\(false\)/.test(panel))
/* AND THE COST IS ON THE SCREEN. The firm chose real sends knowing each SMS segment is billed. */
ok('...and says the messages are real', /sent for real/.test(panel))

console.log(`\ncheck-test-clock: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
