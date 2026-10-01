/**
 * THE RECEIPT AND THE NOTICE OF DEFAULT ARE EVENTS, NOT DATES.
 *
 * THE OTHER FOUR STEPS OF THE FIRM'S ARRANGEMENT CHART ARE DATED -- the confirmation off the run,
 * the reminder and the day-of message off each instalment -- and these two cannot be. A dated
 * notice of default goes out to a debtor who paid on time; a dated receipt confirms a payment
 * nobody made. So each is its own workflow, started by the thing that happened.
 *
 * AND THE 48 HOURS ARE A STATE, NOT A TIMER. The firm's own notice: "Payment of the missed
 * {{ptp_amount}} must reach our trust account within 48 hours of the date of this letter. If it
 * does, the arrangement continues on its existing terms." So the arrangement is still LIVE inside
 * that window -- which is not a nicety, because the notice quotes {{ptp_amount}} and {{ptp_date}}
 * and ptpSchedule reads those off the live arrangement. Marked `broken` on the miss, the notice
 * would hold on its own merge fields every time.
 *
 * WHAT THIS HOLDS: the three states, the stamp that measures the window, which transition starts
 * which workflow, the revival, and the order the morning sweep does things in.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-arrangement-events.mjs
 */
import { readFileSync } from 'node:fs'
import { liveArrangement, NO_ARRANGEMENT, nextUnpaid } from '../../src/lib/ptpSchedule.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

const schema = read('../../supabase/schema.sql')
const sweep = read('../../api/_lib/workflow/run.ts')
const expiry = read('../../api/_lib/workflow/promises.ts')
const desk = read('../../src/pages/accounts/AccountDetail.tsx')

/* The LAST definition of each, because schema.sql is append-only and a name also appears in its
   own grant, revoke and comment -- reading the first asserts against a superseded copy. */
function fnAt(name) {
  const at = schema.lastIndexOf(`create or replace function public.${name}(`)
  return at < 0 ? null : schema.slice(at, schema.indexOf('$$;', at) + 3)
}

/* ------------------------------------------------ three states, not two */

/*
 * `defaulted` IS THE 48 HOURS. Asserted on the CHECK rather than on a type, because the type had
 * listed it for months while the database refused it -- PromiseStatus in accountWorkspace and
 * liveArrangement in ptpSchedule were both written for three states, and the column allowed two.
 */
const statusAt = schema.lastIndexOf('promises_to_pay_status_check')
ok('the status check is there to read', statusAt > 0)
ok('...and allows the 48-hour state',
  /check \(status in \('open', 'defaulted', 'kept', 'broken', 'cancelled'\)\)/
    .test(schema.slice(statusAt)))

/*
 * AND THE WINDOW HAS SOMETHING TO BE MEASURED FROM. Without it a defaulted arrangement sits in
 * default for ever, because the expiry has no clock to read.
 */
ok('a defaulted arrangement records when it defaulted',
  /add column if not exists defaulted_at timestamptz/.test(schema))
ok('...not read off resolved_at', !/defaulted_at.*resolved_at|resolved_at as defaulted/.test(schema))

const stamp = fnAt('stamp_promise_default')
ok('the stamp is written by the database', stamp !== null)
ok('...on the way in', /new\.status = 'defaulted' and coalesce\(old\.status, ''\) <> 'defaulted'[\s\S]{0,80}?defaulted_at := now\(\)/.test(stamp ?? ''))
/*
 * CLEARED ONLY ON THE WAY BACK TO `open`. A revived arrangement carrying yesterday's stamp is
 * broken again by the next morning's sweep. A BROKEN one keeps it, because that is the record of
 * when the 48 hours the debtor was given actually began.
 */
ok('...cleared when the arrangement revives', /elsif new\.status = 'open' then[\s\S]{0,60}?defaulted_at := null/.test(stamp ?? ''))
ok('...and a broken one keeps it as the record',
  !/new\.status <> 'defaulted'[\s\S]{0,60}?defaulted_at := null/.test(stamp ?? ''))
/*
 * NOT `update of status`, WHICH IS THE TRAP. The revival changes NEW.status inside an UPDATE whose
 * column list is (due_on, instalments_kept); a `update of status` trigger reads the STATEMENT's
 * columns, not what another trigger did to the row, so it would never fire on a revival.
 */
const stampTrigger = schema.slice(schema.lastIndexOf('create trigger stamp_promise_default'))
ok('the stamp fires on any update, not only on the status column',
  /before insert or update on public\.promises_to_pay/.test(stampTrigger.slice(0, 200)))

/* ------------------------------------------------ which event starts which workflow */

/*
 * THE NOTICE OF DEFAULT GOES ON THE MISS, NOT ON THE BREAK. Sent on `broken` it would be offering
 * a debtor 48 hours that had already run out -- and by then the arrangement is no longer live, so
 * {{ptp_amount}} and {{ptp_date}} would be unanswerable and the step would hold instead.
 */
const onDefault = fnAt('workflow_start_on_promise_broken')
ok('the notice of default has a starter', onDefault !== null)
ok('...fired by the arrangement falling into default',
  /new\.status <> 'defaulted' or coalesce\(old\.status, ''\) = 'defaulted'/.test(onDefault ?? ''))
ok('...and it starts the promise_broken workflow',
  /trigger_kind = 'promise_broken'/.test(onDefault ?? ''))
ok('...only where one is published', /v\.state = 'active'/.test(onDefault ?? ''))
/* ONCE PER LIVE RUN. The partial unique index on workflow_runs allows one running run per account
   and version, so a second default on the same arrangement cannot double the notice. */
ok('...and not twice over one arrangement',
  /r\.state in \('running', 'held'\)/.test(onDefault ?? ''))

/*
 * THE RECEIPT GOES ON THE CONFIRMATION, NOT ON THE PAYMENT ROW -- the one decision in this file
 * that is not obvious.
 *
 * The receipt says "Next payment: {{ptp_amount}} on {{ptp_date}}", and nextUnpaid counts forward
 * from instalments_kept. That boundary moves when the collector confirms the instalment, not when
 * the money lands. Started on account_payments, the run could be planned and sent in the minute
 * between the two -- and the receipt would name as NEXT the instalment it was confirming.
 */
const onKept = fnAt('workflow_start_on_instalment_kept')
ok('the receipt has a starter', onKept !== null)
ok('...fired by an instalment being counted',
  /new\.instalments_kept > coalesce\(old\.instalments_kept, 0\)/.test(onKept ?? ''))
/* BOTH WAYS AN INSTALMENT IS CONFIRMED: a recurring arrangement counts one more and stays open, a
   once-off goes straight to `kept`. Written for one, half the book would send no receipt. */
ok('...and by a once-off being kept',
  /new\.status = 'kept' and coalesce\(old\.status, ''\) <> 'kept'/.test(onKept ?? ''))
ok('...starting the payment_received workflow', /trigger_kind = 'payment_received'/.test(onKept ?? ''))
/* NOT ON THE PAYMENTS TABLE, and the check says so rather than trusting the comment. */
ok('...and nothing hangs a workflow off account_payments',
  !/create trigger[\s\S]{0,120}on public\.account_payments[\s\S]{0,120}workflow_start/.test(schema))

/* ------------------------------------------------ and a payment inside the window revives it */

const revive = fnAt('revive_promise_on_payment')
ok('a payment inside the 48 hours revives the arrangement', revive !== null)
ok('...back to its existing terms',
  /new\.status = 'defaulted' and new\.instalments_kept > coalesce\(old\.instalments_kept, 0\)[\s\S]{0,60}?new\.status := 'open'/.test(revive ?? ''))
/*
 * BEFORE, NOT AFTER, so the row the two starters above see is already `open` -- and so the stamp
 * is cleared in the same pass.
 */
const reviveTrigger = schema.slice(schema.lastIndexOf('create trigger revive_promise_on_payment'))
ok('...before the row is written, not after',
  /before update on public\.promises_to_pay/.test(reviveTrigger.slice(0, 200)))
/*
 * AND THE TRIGGER NAMES DECIDE THE ORDER. Postgres fires BEFORE row triggers in NAME order, and
 * `revive` sorts before `stamp`: the revival flips the status and the stamp then clears the date.
 * The other way round, a revived arrangement keeps yesterday's stamp and the sweep breaks it.
 */
ok('...and sorts before the stamp, which is what clears the date',
  'revive_promise_on_payment' < 'stamp_promise_default')

/* ------------------------------------------------ the section 129 stays paused throughout */

/*
 * THE HOLD DOES NOT LIFT ON THE MISS. The firm has just told this debtor they have two days to put
 * it right; resuming there sends them the final notice inside those two days.
 */
const resume = fnAt('workflow_resume_on_promise_broken')
ok('the paused sequence resumes on broken', /new\.status = 'broken'/.test(resume ?? ''))
ok('...and not on default', !/new\.status = 'defaulted'/.test(resume ?? ''))

/* ------------------------------------------------ something has to end 48 hours */

/*
 * A PAYMENT IS AN EVENT AND THE CLOCK RUNNING OUT IS NOT, so the other half of the firm's sentence
 * needs a thing that wakes up. The morning sweep already does.
 */
ok('the sweep ends the windows that have run out',
  /const expired = await expireDefaultedPromises\(admin, accountIds\)/.test(sweep))
/*
 * BEFORE THE RE-DATING, AND THAT IS THE LOAD-BEARING HALF. Breaking a promise resumes the paused
 * section 129; redateResumedRuns then moves whatever had not gone by the working days the hold
 * lasted. Run after it, the next morning's sweep finds four notices overdue and sends them at
 * once -- the exact failure the pause exists to prevent.
 */
const atExpire = sweep.indexOf('expireDefaultedPromises(admin')
const atRedate = sweep.indexOf('redateResumedRuns(admin')
ok('...and the re-dating is there to be ordered against', atRedate > 0)
ok('...with the expiry first', atExpire > 0 && atExpire < atRedate)
/* REPORTED, because "whose 48 hours ran out on Tuesday" is asked long afterwards. */
ok('...and says how many ended', /expired: expired\.length/.test(sweep))

check('the window is the firm’s own 48 hours', /const WINDOW_HOURS = (\d+)/.exec(expiry)?.[1], '48')
/* CALENDAR HOURS. A debtor counts 48 hours off a wall clock; read as working hours it would
   quietly become most of a week. */
ok('...counted in calendar hours', /WINDOW_HOURS \* 3600_000/.test(expiry))
/*
 * AND THE WRITE IS GUARDED ON `defaulted` A SECOND TIME. A payment arriving between the read and
 * the write revives the arrangement, and a blind update would break it again -- which is the one
 * case the whole window exists to protect.
 */
ok('a payment landing mid-sweep is not overwritten',
  /\.update\(\{ status: 'broken'[\s\S]{0,120}?\.eq\('status', 'defaulted'\)/.test(expiry))
/* A DEFAULTED ROW WITH NO STAMP HAS NO WINDOW TO HAVE RUN OUT OF, and must not be broken on the
   strength of a column nobody set. */
ok('...and one that was never stamped is left alone', /\.lt\('defaulted_at', cutoff\)/.test(expiry))

/* ------------------------------------------------ what a collector presses */

/*
 * THE MISS IS A PRESS, AND IT IS THE PRESS THAT SENDS THE NOTICE. "Broken" set `broken` directly,
 * which would now skip the 48 hours the firm's own letter promises and resume the section 129 the
 * same afternoon.
 */
ok('a missed payment sets the arrangement to default',
  /resolvePromise\(p\.id, 'defaulted', userId\)/.test(desk))
ok('...in the firm’s words', /Payment missed/.test(desk))
ok('...and the old straight-to-broken press is gone',
  !/onClick=\{\(\) => run\(\(\) => resolvePromise\(p\.id, 'broken', userId\)\)\}[\s\S]{0,200}?Broken\s*\n/.test(desk))
/* THE WINDOW IS ON THE ROW WHILE IT RUNS, because it is the whole of what a collector ringing this
   debtor has to offer. */
ok('the row says the 48 hours are running', /within 48 hours puts it back on its existing terms/.test(desk))
ok('...and can be ended by hand', /Break it now/.test(desk))

/* ------------------------------------------------ and the arithmetic behind the notices */

/*
 * THE POINT OF ALL OF IT, IN TWO ASSERTIONS. A defaulted arrangement still answers the notice's
 * merge fields; a broken one does not, which is why the miss must not go straight to broken.
 */
const ARRANGED = {
  amount: 2500, dueOn: '2026-11-16', arrangement: 'monthly', dayOfMonth: 16,
  onLastDay: false, dayOfWeek: null, instalmentsKept: 1, totalPromised: 7500,
}
const defaulted = liveArrangement([{ ...ARRANGED, status: 'defaulted', createdAt: '2026-10-01' }])
ok('a defaulted arrangement is still a live one', defaulted !== NO_ARRANGEMENT)
check('...so the notice can quote the instalment that was missed',
  nextUnpaid(defaulted)?.dueOn, '2026-11-16')
const broken = liveArrangement([{ ...ARRANGED, status: 'broken', createdAt: '2026-10-01' }])
check('...while a broken one answers nothing', nextUnpaid(broken), null)

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-arrangement-events: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
