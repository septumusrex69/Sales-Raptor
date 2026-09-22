/**
 * Every rate of every tariff schedule, pinned.
 *
 * WHAT WAS GUARDED BEFORE: the current schedule's phone call, consultation and promise to pay,
 * and nothing else. A review of this suite set every 2020, 2017 and 2015 rate to any number it
 * liked and watched the whole suite stay green -- and those are not dead history. `scheduleFor`
 * takes the ACTION's date, so a fee raised in 2019 and re-read today is still priced off the 2017
 * schedule, and the migrated book is full of them. A wrong figure here is a wrong invoice on an
 * account somebody has already been remitted for.
 *
 * WHAT THIS CHECK DOES AND DOES NOT DO. It stops the numbers MOVING. It does not confirm they
 * were right in the first place: the values below are the ones in actionTariff.ts, which carries
 * a Government Gazette citation for each schedule but has not been read back against the
 * gazettes themselves. That is a question for the firm, and it is open -- see the note under each
 * schedule. Pinning them is still strictly better than leaving them free, because today a typo
 * and a correction are indistinguishable.
 *
 * THE DATES ARE PINNED TOO, and in order. A schedule dropped from the list does not fail an
 * assertion about rates -- the remaining ones still hold -- so the boundaries are asserted as a
 * list of their own. scheduleOn() walks them newest-first and takes the first that has come into
 * force, which only works while they stay sorted.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-tariff-history.mjs
 */
import { TARIFF_HISTORY, scheduleOn } from '../../src/lib/actionTariff.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/*
 * THE FOUR SCHEDULES AND WHEN EACH CAME INTO FORCE, newest first.
 *
 * Asserted as one list rather than four separate dates: a schedule deleted from the middle leaves
 * every surviving date correct, and the only thing that notices is the shape of the whole.
 */
check('the schedules, newest first', TARIFF_HISTORY.map((t) => t.effectiveFrom), [
  '2026-03-06',
  '2020-05-22',
  '2017-10-27',
  '2015-12-23',
])
/* Sorted, because scheduleOn takes the first that has come into force and stops. Out of order,
   a 2019 action would be priced off 2015 with nothing raised anywhere. */
ok('...and in descending order', TARIFF_HISTORY.every((t, i) =>
  i === 0 || TARIFF_HISTORY[i - 1].effectiveFrom > t.effectiveFrom))

/*
 * EVERY RATE OF EVERY SCHEDULE.
 *
 * As whole objects rather than field by field, so a rate ADDED to one schedule and not the others
 * fails here rather than being charged silently on some dates and not on others.
 *
 * SOURCES, as actionTariff.ts records them. Not independently verified against the gazettes:
 *   2026-03-06  GN R.7207, GG 54273
 *   2020-05-22  GN R.580,  GG 43343
 *   2017-10-27  GN R.1141, GG 41205
 *   2015-12-23  GN R.1272, GG 39552
 */
const RATES = {
  '2026-03-06': {
    phone_call: 25, sms: 3.5, email_out: 25, letter: 25,
    consultation: 60, perusal: 25,
    /* The 4(a) band, for a debt under R50 000. */
    acknowledgement_of_debt: 161,
    promise_to_pay: 50,
  },
  '2020-05-22': {
    phone_call: 21, sms: 3, email_out: 21, letter: 21,
    consultation: 52, perusal: 21,
    /* The 4(b) figure, which is what was charged under this schedule. */
    acknowledgement_of_debt: 210,
    promise_to_pay: 41,
  },
  '2017-10-27': {
    phone_call: 20, sms: 2.8, email_out: 20, letter: 20,
    consultation: 49, perusal: 20,
    acknowledgement_of_debt: 198,
    promise_to_pay: 39,
  },
  '2015-12-23': {
    phone_call: 18, sms: 2.5, email_out: 18, letter: 18,
    consultation: 44, perusal: 18,
    acknowledgement_of_debt: 178,
    promise_to_pay: 35,
  },
}

for (const schedule of TARIFF_HISTORY) {
  check(`every rate of the ${schedule.effectiveFrom} schedule`,
    schedule.rates, RATES[schedule.effectiveFrom])
}
/* And no schedule exists that this file has not been told about. */
check('no schedule is unpinned',
  TARIFF_HISTORY.map((t) => t.effectiveFrom).filter((d) => !RATES[d]), [])

/*
 * ---- AND THE DATE DECIDES, which is the whole reason the old rates still matter ----
 *
 * CLAUDE.md: "New charges are priced on the schedule in force on the day of the action ... a 2019
 * fee re-read today is still a 2019 fee." Asserted on both sides of every boundary, because an
 * off-by-one on a comparison is the failure that prices a whole month wrong and looks like
 * nothing at all.
 */
check('the day a schedule comes in uses it', scheduleOn('2026-03-06').effectiveFrom, '2026-03-06')
check('...and the day before does not', scheduleOn('2026-03-05').effectiveFrom, '2020-05-22')
check('a 2019 action is priced off 2017', scheduleOn('2019-07-01').effectiveFrom, '2017-10-27')
check('...at that year’s rate, not today’s', scheduleOn('2019-07-01').rates.phone_call, 20)
check('the 2020 boundary holds', scheduleOn('2020-05-22').effectiveFrom, '2020-05-22')
check('...and the day before it', scheduleOn('2020-05-21').effectiveFrom, '2017-10-27')
check('the 2017 boundary holds', scheduleOn('2017-10-27').effectiveFrom, '2017-10-27')
check('...and the day before it', scheduleOn('2017-10-26').effectiveFrom, '2015-12-23')
/* Older than anything we hold falls back to the oldest rather than to nothing, so a fee from a
   date nobody expected is priced rather than dropped. */
check('older than the oldest falls back to it', scheduleOn('2001-01-01').effectiveFrom, '2015-12-23')

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Every rate of all four schedules is pinned, not just the three of the current one that were. The
old ones are not history: a fee is priced on the schedule in force on the day of the ACTION, so
the migrated book is still being read through 2017 and 2015 rates. What this cannot tell you is
whether the figures were right to begin with -- they are the file's own, with gazette citations
but unread against the gazettes.`)
