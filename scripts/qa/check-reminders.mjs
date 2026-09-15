/**
 * "Call me back in an hour."
 *
 * A reminder that fires an hour late is worse than no reminder at all: the debtor was given a
 * time, and the collector believed the app. So the arithmetic lives on its own, away from
 * anything that touches a database or a screen, and every clock below is pinned — a test for
 * time that reads the real clock passes this afternoon and fails at 23:55.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-reminders.mjs
 */
import {
  REMINDER_PRESETS, SNOOZE_MINUTES, atClockTime, atDayAndTime, clockTime, dueAt, isDue,
  lateness, todayIso, whenItLands,
} from '../../src/lib/reminderTime.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass += 1
  else failures.push(`${name}\n     got      ${a}\n     expected ${e}`)
}
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }

const at = (s) => new Date(s)

/* ---------- 1. an hour means an hour ---------- */

check('an hour from twenty past two',
  dueAt(60, at('2026-09-14T14:20:00')).toISOString(), at('2026-09-14T15:20:00').toISOString())
check('fifteen minutes', dueAt(15, at('2026-09-14T14:20:00')).getMinutes(), 35)
check('two hours', dueAt(120, at('2026-09-14T14:20:00')).getHours(), 16)

/*
 * NOT rounded to the nearest five minutes. A debtor told "I will ring you at twenty past" is not
 * served by a reminder at half past, and nothing on screen would say the app had moved it.
 */
check('twenty past stays twenty past',
  clockTime(dueAt(60, at('2026-09-14T14:20:00'))), '15:20')
check('and so does a ragged minute',
  clockTime(dueAt(60, at('2026-09-14T09:07:00'))), '10:07')

check('an hour late in the day rolls the date',
  dueAt(120, at('2026-09-14T23:30:00')).toISOString(), at('2026-09-15T01:30:00').toISOString())

/* ---------- 2. the clock reads the way a clock reads ---------- */

check('morning pads the hour', clockTime(at('2026-09-14T09:05:00')), '09:05')
check('midnight', clockTime(at('2026-09-14T00:00:00')), '00:00')
check('afternoon is 24-hour', clockTime(at('2026-09-14T15:40:00')), '15:40')

/* ---------- 3. how late it is, which is what the popup says ---------- */

const due = at('2026-09-14T14:00:00')
check('on the minute', lateness(due, at('2026-09-14T14:00:00')), 'now')
check('a few seconds is still now', lateness(due, at('2026-09-14T14:00:40')), 'now')
check('one minute', lateness(due, at('2026-09-14T14:01:10')), '1 minute ago')
check('minutes', lateness(due, at('2026-09-14T14:25:00')), '25 minutes ago')
check('an hour exactly', lateness(due, at('2026-09-14T15:00:00')), '1 hour ago')
check('an hour and change', lateness(due, at('2026-09-14T15:20:00')), '1h 20m ago')
check('hours', lateness(due, at('2026-09-14T17:00:00')), '3 hours ago')
// The tab was closed overnight. It still has to arrive, and say so.
check('the next day', lateness(due, at('2026-09-15T16:00:00')), '1 day ago')
check('a long weekend', lateness(due, at('2026-09-17T14:00:00')), '3 days ago')
ok('never reads "0 minutes ago"', !lateness(due, at('2026-09-14T14:00:30')).startsWith('0'))

/* ---------- 4. is it time ---------- */

ok('a second before is not due', !isDue(due, at('2026-09-14T13:59:59')))
ok('on the moment is due', isDue(due, at('2026-09-14T14:00:00')))
ok('after is due', isDue(due, at('2026-09-14T14:00:01')))

/* ---------- 5. a time typed by hand ---------- */

const now = at('2026-09-14T14:20:00')
check('later today', clockTime(atClockTime('15:40', now)), '15:40')
check('leading zero', clockTime(atClockTime('09:05', at('2026-09-14T08:00:00'))), '09:05')
check('one-digit hour', clockTime(atClockTime('9:05', at('2026-09-14T08:00:00'))), '09:05')
check('seconds are zeroed so it fires on the minute', atClockTime('15:40', now).getSeconds(), 0)

/*
 * A time already gone comes back as nothing rather than as a date. Saved, it would pop the
 * instant it was written, which reads as the app malfunctioning rather than as the slip it is.
 */
check('a time already gone today', atClockTime('09:00', now), null)
check('the current minute is already gone', atClockTime('14:20', now), null)
check('not a time', atClockTime('soon', now), null)
check('an hour that does not exist', atClockTime('25:00', now), null)
check('a minute that does not exist', atClockTime('15:75', now), null)
check('empty', atClockTime('', now), null)
check('spaces are forgiven', clockTime(atClockTime('  15:40  ', now)), '15:40')

/* ---------- 5b. a reminder on another day ---------- */

/*
 * A reminder is not only "later today". A debtor who says "ring me on Friday morning" gets a
 * day AND a time, and the past-check has to be against the whole moment rather than the clock:
 * 09:00 has gone today and is perfectly good tomorrow. Getting that backwards either refuses a
 * valid Friday or accepts a Friday that has already been.
 */
check('nine in the morning, tomorrow',
  atDayAndTime('2026-09-15', '09:00', at('2026-09-14T14:20:00')).toISOString(),
  at('2026-09-15T09:00:00').toISOString())
check('the same time, but today, is already gone',
  atDayAndTime('2026-09-14', '09:00', at('2026-09-14T14:20:00')), null)
check('later today is fine',
  clockTime(atDayAndTime('2026-09-14', '16:00', at('2026-09-14T14:20:00'))), '16:00')
check('next week', atDayAndTime('2026-09-21', '08:30', at('2026-09-14T14:20:00')).getDate(), 21)
check('a day that has gone is refused whatever the time',
  atDayAndTime('2026-09-13', '23:59', at('2026-09-14T14:20:00')), null)

check('a date that does not exist', atDayAndTime('2026-02-31', '09:00', at('2026-01-01T09:00:00')), null)
check('not a date at all', atDayAndTime('Friday', '09:00', at('2026-09-14T14:20:00')), null)
check('a date with no time', atDayAndTime('2026-09-15', '', at('2026-09-14T14:20:00')), null)

// atClockTime is the same thing against today, and must stay that way.
check('atClockTime is atDayAndTime on today',
  atClockTime('16:00', at('2026-09-14T14:20:00')).toISOString(),
  atDayAndTime('2026-09-14', '16:00', at('2026-09-14T14:20:00')).toISOString())

/* ---------- 5c. the local day, not the UTC one ---------- */

/*
 * toISOString() gives the UTC day, which in South Africa rolls the evening into tomorrow. A
 * reminder set at half past ten at night would be filed against the wrong date and the presets
 * would stop being "today".
 */
check('half past ten at night is still today', todayIso(at('2026-09-14T22:30:00')), '2026-09-14')
check('and one minute to midnight', todayIso(at('2026-09-14T23:59:00')), '2026-09-14')
check('just after midnight is tomorrow', todayIso(at('2026-09-15T00:01:00')), '2026-09-15')

/* ---------- 5d. how it reads back ---------- */

const nowish = at('2026-09-14T14:20:00')
check('today says only the time', whenItLands(at('2026-09-14T15:40:00'), nowish), 'at 15:40')
check('tomorrow says so', whenItLands(at('2026-09-15T09:00:00'), nowish), 'tomorrow at 09:00')
// Four hours at eleven at night crosses midnight — the one case relative wording would mislead.
check('a preset that crosses midnight says tomorrow',
  whenItLands(dueAt(240, at('2026-09-14T23:00:00')), at('2026-09-14T23:00:00')),
  'tomorrow at 03:00')
ok('further out names the day',
  whenItLands(at('2026-09-21T08:30:00'), nowish).includes('08:30')
  && /Mon|21/.test(whenItLands(at('2026-09-21T08:30:00'), nowish)))

/* ---------- 6. the presets a collector actually reaches for ---------- */

ok('an hour is one of them', REMINDER_PRESETS.some((p) => p.minutes === 60))
ok('every preset is in the future', REMINDER_PRESETS.every((p) => p.minutes > 0))
ok('they run shortest first',
  REMINDER_PRESETS.every((p, i) => i === 0 || p.minutes > REMINDER_PRESETS[i - 1].minutes))
ok('none of them is a day — that is what the diary is for',
  REMINDER_PRESETS.every((p) => p.minutes < 24 * 60))
ok('a snooze is short enough to be a snooze', SNOOZE_MINUTES > 0 && SNOOZE_MINUTES <= 30)

if (failures.length) {
  console.error(`FAIL — ${failures.length} of ${pass + failures.length} checks\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`PASS — ${pass} checks: an hour means an hour to the minute, a reminder missed`)
console.log('       overnight still arrives and says how late it is, and a time already gone')
console.log('       is refused rather than fired the instant it is saved.')
