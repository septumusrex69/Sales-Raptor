/**
 * WHEN a workflow step falls due.
 *
 * THIS IS THE HALF OF A WORKFLOW THAT GOES WRONG SILENTLY. What a step says is read by the
 * attorney before it ever goes out; when it falls is arithmetic, and arithmetic that is wrong is
 * wrong on every account in the book at once. Nobody reads a date on a notice and thinks "that is
 * three days early" — they read it, and three months later a magistrate does.
 *
 * Five ways it goes wrong, four of them taken straight from the firm's own 160-day chart:
 *
 *   - counting a STATUTORY period in calendar days. "20 business days" counted as 20 days is a
 *     shortened statutory period on every file, and the only place it surfaces is court.
 *   - rotating a clerk on a DAY COUNT. Day 40 lands mid-month, sometimes days before the 5th,
 *     which is when the debit orders that clerk spent a month arranging actually run. The clerk
 *     who did the work does not get the collection.
 *   - a date that lands on a Sunday. A debtor's deadline does not move because the office is
 *     shut; a thing a PERSON has to do cannot happen on a day nobody is there. Same arithmetic,
 *     opposite answers.
 *   - "the 31st" of a thirty-day month rolling over into the next one, so a rotation skips a
 *     month every February and nobody notices until February.
 *   - a file that leaves the spine on day 52 coming back at day 1, re-issuing statutory notices
 *     that have already gone out.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-workflow-schedule.mjs
 */
import {
  ROTATION_DAY_OF_MONTH, ROTATION_MONTHS, calendarDaysBetween, daysInMonth, dueDate,
  monthEndsGiven, resumeDate, rotationDate, rotationSchedule, spineDay,
} from '../../src/lib/workflowSchedule.ts'
import { isWorkingDay } from '../../src/lib/workingDays.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/* ---------- the three ways of saying when ---------- */

check('a calendar offset is just days',
  dueDate('2026-09-18', { kind: 'calendar_days', days: 10 }), '2026-09-28')
check('...and day 0 is the day itself',
  dueDate('2026-09-18', { kind: 'calendar_days', days: 0 }), '2026-09-18')
check('...crossing a month end', dueDate('2026-09-28', { kind: 'calendar_days', days: 7 }), '2026-10-05')
check('...and a year end', dueDate('2026-12-28', { kind: 'calendar_days', days: 7 }), '2027-01-04')

/*
 * THE STATUTORY CLOCK IS NOT THE DEBTOR'S CLOCK. "Intention to list — 20 business days" counted
 * as twenty calendar days is a listing served four weeks early on every file.
 */
check('a business offset skips the weekend',
  dueDate('2026-09-18', { kind: 'business_days', days: 1 }), '2026-09-21')
/* 24 September is Heritage Day, which the whole of Raptor's pace arithmetic already knows. */
check('...and a public holiday', dueDate('2026-09-23', { kind: 'business_days', days: 1 }), '2026-09-25')
const twenty = dueDate('2026-09-18', { kind: 'business_days', days: 20 })
ok(`twenty business days is well past twenty calendar days (${twenty})`,
  twenty > dueDate('2026-09-18', { kind: 'calendar_days', days: 20 }))
/* Zero business days means "the first day anybody is here", which is what a Saturday resolves to. */
check('zero business days from a Saturday is the Monday',
  dueDate('2026-09-19', { kind: 'business_days', days: 0 }), '2026-09-21')

check('a day of the month lands on that day',
  dueDate('2026-09-18', { kind: 'month_day', day: 5, monthsAhead: 2 }), '2026-11-05')
check('...in the anchor’s own month where no months are added',
  dueDate('2026-09-18', { kind: 'month_day', day: 5, monthsAhead: 0 }), '2026-09-05')
check('...crossing the year', dueDate('2026-11-18', { kind: 'month_day', day: 5, monthsAhead: 3 }), '2027-02-05')
/*
 * CLAMPED, NOT ROLLED OVER. "The 31st" of a thirty-day month is the 30th. Rolling over would make
 * a monthly step skip a month every February, which is a bug that hides for eleven months a year.
 */
check('the 31st of a short month is its last day',
  dueDate('2026-01-15', { kind: 'month_day', day: 31, monthsAhead: 1 }), '2026-02-28')
check('...and of a leap February', dueDate('2028-01-15', { kind: 'month_day', day: 31, monthsAhead: 1 }), '2028-02-29')
check('February 2028 really has 29 days', daysInMonth(2028, 2), 29)
check('...and 2026 has 28', daysInMonth(2026, 2), 28)

/* ---------- a deadline and a task are not the same date ---------- */

/*
 * SAME ARITHMETIC, OPPOSITE ANSWERS. A debtor given seven days to settle is not given nine
 * because the seventh fell on a Saturday — their clock runs. A thing a PERSON has to do cannot
 * happen on a day nobody is there. Defaulting either way for both is wrong half the time.
 */
check('a debtor’s deadline stays where it falls',
  dueDate('2026-09-16', { kind: 'calendar_days', days: 3 }), '2026-09-19')
check('...even asked explicitly to keep it',
  dueDate('2026-09-16', { kind: 'calendar_days', days: 3 }, 'keep'), '2026-09-19')
check('a job for a person moves to the next working day',
  dueDate('2026-09-16', { kind: 'calendar_days', days: 3 }, 'forward'), '2026-09-21')
check('...and over a public holiday too',
  dueDate('2026-09-23', { kind: 'calendar_days', days: 1 }, 'forward'), '2026-09-25')
check('...while a date already on a working day does not move',
  dueDate('2026-09-16', { kind: 'calendar_days', days: 1 }, 'forward'), '2026-09-17')

/* ---------- the firm's rotation rule ---------- */

/*
 * THE FIRM'S OWN EXAMPLE, VERBATIM: "today is the 18th of September, so they get to the 5th of
 * October, the 5th of November, then it is reallocated to the next clerk."
 */
check('the rule is the 5th', ROTATION_DAY_OF_MONTH, 5)
check('...two months on', ROTATION_MONTHS, 2)
check('an account taken on 18 September rotates on 5 November',
  rotationDate('2026-09-18'), '2026-11-05')
check('...having been given exactly the two month-ends the firm means',
  monthEndsGiven('2026-09-18', rotationDate('2026-09-18')), ['2026-10-05', '2026-11-05'])

/*
 * IT IS NOT A DAY COUNT, which is the correction the firm made to their own chart. Day 40 from
 * 18 September is 28 October — before the 5 November month-end, so the clerk who spent October
 * arranging the debit orders hands the file over days before they run.
 */
const day40 = dueDate('2026-09-18', { kind: 'calendar_days', days: 40 })
check('...where a forty-day rotation would have fallen', day40, '2026-10-28')
ok('...which is before the month-end that clerk worked towards', day40 < '2026-11-05')
check('...and would have given them one month-end, not two',
  monthEndsGiven('2026-09-18', day40), ['2026-10-05'])

/*
 * ROTATION IS A THING A PERSON DOES, so it never lands on a day nobody is in — and this case is
 * worth more than it looks. An account taken on 14 February 2026 rotates on 5 April, which is
 * Easter Sunday that year; the Monday after it is Family Day. So the answer is the TUESDAY, and
 * getting there means the rule consulted the public-holiday calendar rather than just asking
 * whether it was a weekend. This check was first written expecting the Monday, which is what a
 * weekend-only rule would have given.
 */
ok('5 April 2026 is not a working day', !isWorkingDay('2026-04-05'))
ok('...and neither is the Monday after it, which is Family Day', !isWorkingDay('2026-04-06'))
check('a rotation landing on Easter Sunday moves past Family Day too',
  rotationDate('2026-02-14'), '2026-04-07')
check('...and one falling on a working day stays put', rotationDate('2026-07-18'), '2026-09-07')

/*
 * EXACTLY TWO, EVERY TIME, and the rule that gets there is one line: the 5th in the month the
 * account arrived does not count, because you did not have that month.
 *
 * An account allocated on the 3rd of October reaches the 5th of October two days later, and
 * nobody would call that a month-end the clerk was given. One allocated on the 18th of September
 * reaches the 5th of October with seventeen days to work it, and the firm's own example counts
 * it. A cut-off day would also separate those two and would be a third number for a floor to
 * remember; the month the account arrived in is already on the file.
 */
check('an account taken on the 3rd still rotates on the 5th two months on',
  rotationDate('2026-10-03'), '2026-12-07')
check('...but the 5th in the month it arrived is not one of its month-ends',
  monthEndsGiven('2026-10-03', rotationDate('2026-10-03')), ['2026-11-05', '2026-12-05'])
check('...while a mid-month account keeps the very next 5th',
  monthEndsGiven('2026-09-18', rotationDate('2026-09-18')), ['2026-10-05', '2026-11-05'])
/* The day of allocation itself is never counted, and the rotation day always is. */
check('an account taken ON a 5th does not count that day',
  monthEndsGiven('2026-09-05', '2026-11-05'), ['2026-10-05', '2026-11-05'])
check('nothing is given where rotation is not after allocation',
  monthEndsGiven('2026-09-18', '2026-09-18'), [])

/*
 * ASSERTED FOR EVERY ALLOCATION DATE IN A YEAR, not for the two the firm happened to name.
 *
 * "Exactly two" is the whole promise of the rule, and a promise that holds on two examples is not
 * a promise. This is the check that would have caught the version before it, which gave three to
 * anything allocated in the first four days of a month — a case that never comes up while you are
 * testing with today's date.
 */
const wrong = []
for (let d = new Date(Date.UTC(2026, 0, 1)); d < new Date(Date.UTC(2027, 0, 1)); d.setUTCDate(d.getUTCDate() + 1)) {
  const day = d.toISOString().slice(0, 10)
  const given = monthEndsGiven(day, rotationDate(day))
  if (given.length !== 2) wrong.push(`${day} -> ${given.length}`)
}
check(`every allocation date in 2026 gives exactly two month-ends (${wrong.slice(0, 4).join(', ')})`,
  wrong, [])
/* And every one of them is genuinely after the day the account arrived. */
const early = []
for (let d = new Date(Date.UTC(2026, 0, 1)); d < new Date(Date.UTC(2027, 0, 1)); d.setUTCDate(d.getUTCDate() + 1)) {
  const day = d.toISOString().slice(0, 10)
  for (const m of monthEndsGiven(day, rotationDate(day))) if (m <= day) early.push(`${day} -> ${m}`)
}
check('...none of them before the account arrived', early, [])

/* ---------- the chain, and what it does to the length of the workflow ---------- */

/*
 * EACH CLERK'S TWO MONTH-ENDS ARE COUNTED FROM THE DAY THEY GOT IT.
 *
 * This is asserted as the dates themselves rather than as "chained, not jumped", which is what it
 * said first. There is no difference to assert: 5th of M+2, M+4, M+6 is the same list either way
 * while the rotation day is the 5th, because moving a 5th forward off a weekend never leaves its
 * own month. Break-testing the chain by replacing it with fixed jumps left this check green,
 * which is how the claim was found to be untestable rather than merely untested.
 */
const chain = rotationSchedule('2026-09-18', 4)
check('four rotations from a September handover',
  chain, ['2026-11-05', '2027-01-05', '2027-03-05', '2027-05-05'])
/* Every clerk in the chain gets two, not just the first. */
const handovers = ['2026-09-18', ...chain.slice(0, -1)]
check('every clerk in the chain gets two month-ends',
  handovers.map((from, i) => monthEndsGiven(from, chain[i]).length), [2, 2, 2, 2])

/*
 * AND SO THE 160-DAY WORKFLOW IS NOT 160 DAYS ANY MORE. Four clerks at two month-ends each is
 * about two hundred and thirty days from handover to closure. That is a consequence of the firm's
 * own correction rather than a fault, but it is a number their clients have been told, so it is
 * asserted here rather than left to be discovered on the first file that reaches the end.
 */
const length = calendarDaysBetween('2026-09-18', chain[chain.length - 1])
ok(`the fourth rotation is far past day 160 (${length})`, length > 200)
ok('...and the chart’s own day-40 rotation is nowhere near the first one',
  calendarDaysBetween('2026-09-18', chain[0]) > 40)

/* ---------- where a file is on the spine ---------- */

check('the spine starts at nought', spineDay({ startedOn: '2026-09-18', asAt: '2026-09-18' }), 0)
check('...and counts calendar days', spineDay({ startedOn: '2026-09-18', asAt: '2026-11-07' }), 50)
/*
 * "A FILE THAT LEAVES THE SPINE ON DAY 52 RETURNS TO IT ON DAY 52 — NEVER AT DAY 1", and the
 * chart adds that an arrangement PAUSES the notice sequence. So the days spent on the arrangement
 * are not spine days: a file that sat on a kept arrangement for sixty days comes back where it
 * left, not sixty days further on with two statutory notices skipped.
 */
check('days spent paused do not advance the spine',
  spineDay({
    startedOn: '2026-09-18', asAt: '2027-01-06',
    pausedFor: [{ from: '2026-11-09', to: '2027-01-08' }],
  }), 52)
check('a pause that has not started yet takes nothing off',
  spineDay({ startedOn: '2026-09-18', asAt: '2026-10-18', pausedFor: [{ from: '2026-12-01', to: '2026-12-10' }] }), 30)
check('...and one still running is only counted up to today',
  spineDay({ startedOn: '2026-09-18', asAt: '2026-10-18', pausedFor: [{ from: '2026-10-08', to: '2026-12-01' }] }), 20)
check('two pauses both come off',
  spineDay({
    startedOn: '2026-09-18', asAt: '2026-11-18',
    pausedFor: [{ from: '2026-09-28', to: '2026-10-03' }, { from: '2026-10-13', to: '2026-10-18' }],
  }), 51)
check('a file cannot go backwards down the spine',
  spineDay({ startedOn: '2026-09-18', asAt: '2026-09-01' }), 0)

/* Leaving and coming back records the day left, which is the day it resumes at. */
const excursion = resumeDate({ startedOn: '2026-09-18', leftOn: '2026-11-09', returnedOn: '2027-01-08' })
check('a file resumes at the day it left', excursion.spineDay, 52)
check('...and the time away is what pauses it',
  excursion.pausedFor, { from: '2026-11-09', to: '2027-01-08' })
/* Which is the same answer spineDay gives once that pause is fed back in — the two agree by
   construction, and a check that did not assert it would let them drift. */
check('...so the two agree',
  spineDay({ startedOn: '2026-09-18', asAt: '2027-01-08', pausedFor: [excursion.pausedFor] }),
  excursion.spineDay)

check('days between two dates', calendarDaysBetween('2026-09-18', '2026-09-28'), 10)
check('...and backwards is negative', calendarDaysBetween('2026-09-28', '2026-09-18'), -10)

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Statutory periods counted in business days rather than calendar days; clerk rotation anchored to
the 5th rather than to a day count, so a clerk is measured on the month-ends they were given; a
debtor's deadline that stays on a Saturday and a clerk's job that does not; and a file that leaves
the spine on day 52 coming back to day 52.`)
