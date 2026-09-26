/**
 * A PAUSE MOVES WHAT IS STILL TO COME, AND MOVES IT IN THE RUN'S OWN UNIT.
 *
 * THE FIRM'S SENTENCE, off the mockup they drew of the workflow pane: "Completed notices are
 * preserved; upcoming dates recalculated." Until this, only the first half was true —
 * workflow_resume_account set the run running again and touched no step, because the working-day
 * calendar it would need lives in the app and not in the database.
 *
 * WHAT THAT WOULD HAVE COST. A section 129 paused on day 1 for six weeks resumes with its
 * reminder still dated five weeks ago, and `due_on <= today` fires FOUR notices at once on the
 * morning after the promise broke — the reminder, the final notice and both its SMSs, to a
 * debtor who has just been told the firm is proceeding. That is the opposite of what the pause
 * was for, and the exact failure mode the runner's "overdue still sends" rule is built to have.
 *
 * AND WHY IT IS HONEST AT ALL, WHICH IS NOT A GENERAL LICENCE. Every notice after the demand
 * asserts that a period has ELAPSED — "the period given in our Section 129 notice has ended",
 * "you were given 20 business days" — so a pause only ever makes those sentences MORE true. The
 * firm chose the opposite for tracing: there they start again, because wrong contact details mean
 * the notices may never have arrived.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-workflow-hold-clock.mjs
 */
import { readFileSync } from 'node:fs'
import { heldDays, movedOn } from '../../src/lib/workflowHold.ts'
import { landsOn } from '../../src/lib/workflowBuilder.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

const plan = read('../../api/_lib/workflow/plan.ts')
const runner = read('../../api/_lib/workflow/run.ts')

/* ------------------------------------------------ how long a pause is */

/* The firm's own case, seeded on BF-TEST-018: held 3 September to 16 September. */
const REAL = [{ startedOn: '2026-09-03', endedOn: '2026-09-16' }]

/*
 * COUNTED IN THE RUN'S OWN UNIT, AND THE TWO ARE NOT THE SAME NUMBER. Thirteen calendar days is
 * nine working ones. Counted in calendar days and added to a business-day chart, every remaining
 * step would land four days late — the same class of error as reading a business day number as a
 * calendar one, which cost this codebase a fortnight once already.
 */
check('a pause is nine working days', heldDays(REAL, 'business'), 9)
check('...and thirteen calendar ones', heldDays(REAL, 'calendar'), 13)

/*
 * ONLY PAUSES THAT HAVE ENDED COUNT. A run still held is not sending anything, so there is
 * nothing to re-date — and counting an open pause would move the dates a little further every day
 * it stayed open, which on a screen reads as a sequence running away from you.
 */
check('a pause still on moves nothing yet',
  heldDays([{ startedOn: '2026-09-03', endedOn: null }], 'business'), 0)
/* A pause that started and ended on one day moves nothing, which is right: nothing was missed. */
check('a pause inside one day moves nothing',
  heldDays([{ startedOn: '2026-09-03', endedOn: '2026-09-03' }], 'business'), 0)
/* Two pauses add up. A run held by a promise and later by a dispute lost both. */
check('two pauses add up', heldDays([
  { startedOn: '2026-09-03', endedOn: '2026-09-16' },
  { startedOn: '2026-10-01', endedOn: '2026-10-08' },
], 'business'), 14)
/* Read defensively: a run never held is the ordinary case, on most of the book. */
check('a run never paused loses nothing', heldDays([], 'business'), 0)

/* ------------------------------------------------ where a step lands after it */

/*
 * THE PAUSE IS APPLIED TO THE DATE, NOT TO THE DAY NUMBER, and the difference matters: day 12 is
 * day 12 whatever has happened to the account. Folded into the day number, a step's place on the
 * firm's chart and the delay it suffered would become one number, and nobody could answer "what
 * day of the sequence is this" — which is the question the whole chart is written in.
 */
const lost = heldDays(REAL, 'business')
check('the reminder moves from the 9th to the 22nd',
  movedOn(landsOn('2026-09-01', 7, 'business'), lost, 'business'), '2026-09-22')
check('...the final notice from the 16th to the 30th',
  movedOn(landsOn('2026-09-01', 12, 'business'), lost, 'business'), '2026-09-30')
/* And the far end moves by the same nine days, not by more: a pause is a pause, not a rate. */
check('...and the summons by the same nine working days',
  movedOn(landsOn('2026-09-01', 49, 'business'), lost, 'business'), '2026-11-20')

/* Nothing lost, nothing moved -- the ordinary case must cost nothing. */
check('a step on a run never paused stays where it was',
  movedOn('2026-10-05', 0, 'business'), '2026-10-05')

/* ------------------------------------------------ and it actually runs */

/*
 * ASSERTED ON THE RUNNER BECAUSE THE ORDER IS THE WHOLE POINT. Re-dating after the due steps are
 * picked is re-dating nothing: the four notices have already gone.
 */
ok('the runner re-dates what a pause pushed back', /redateResumedRuns\(admin, accountId\)/.test(runner))
const redateAt = runner.indexOf('redateResumedRuns(admin, accountId)')
const dueAt = runner.indexOf("lte('due_on'")
ok('...and the due steps are read at all', dueAt > 0)
ok('...after the re-dating, never before', redateAt > 0 && redateAt < dueAt)
/* Said in the answer, because a pause moving dates is a thing somebody will be asked about. */
ok('...and says how many moved', /redated: redated\.reduce/.test(runner))

/*
 * ONLY WHAT HAS NOT GONE. A step that was SENT keeps its date for ever: it is the record of a
 * notice that reached a debtor, and moving it would be rewriting the file an attorney reads
 * eighteen months later. Cancelled steps are left for the same reason.
 */
ok('only steps that have not gone are moved',
  /step\.state !== 'pending' && step\.state !== 'held'/.test(plan))
/*
 * IDEMPOTENT, which is what lets it live in the sweep at all. Every date is computed from the
 * run's start, the step's day number and the total of its closed holds -- three things that do
 * not change between two passes -- so the second pass writes nothing. The resume happens in a
 * database trigger the app never sees, so there is no moment to hook other than the next pass.
 */
ok('...and a step already on the right date is left alone', /if \(should === step\.due_on\) continue/.test(plan))
ok('a run that was never paused is skipped entirely', /if \(lost <= 0\) continue/.test(plan))

/*
 * AND A RUN DATED AFTER IT WAS ALREADY PAUSED STARTS BEHIND. Rare but real: a section 129 begun,
 * held by a promise the same afternoon, and the sweep reaching it the next morning.
 */
ok('a run planned while already paused is dated behind', /movedOn\(s\.dueOn, lost, unit\)/.test(plan))

/*
 * THE CALENDAR STAYS IN ONE PLACE. The SQL records WHEN a run was held and does no arithmetic at
 * all, because workingDays.ts is the only thing that knows about Heritage Day -- a second
 * working-day calendar in the database would be the one that is wrong in the year nobody checks.
 */
const schema = read('../../supabase/schema.sql')
const resume = schema.slice(schema.lastIndexOf('create or replace function public.workflow_resume_account('))
ok('the database still does no day arithmetic',
  !/add_working_days|business_days|interval '1 day'/.test(resume.slice(0, 1600)))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-workflow-hold-clock: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
