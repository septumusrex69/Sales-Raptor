/**
 * How long an account has been on the desk.
 *
 * Small function, and the interesting half is one line: the day-of-month comparison. Handed over
 * on the 20th of September and read on the 14th of the following September is ELEVEN months, not
 * twelve — the anniversary has not come round yet. Get that wrong and an account claims to be a
 * year old six days early, which on a book where prescription is counted in years is not a
 * rounding error somebody will shrug at.
 *
 * Every date below is pinned. A test for an age function that reads the real clock passes today
 * and fails on a date somebody picks at random in March.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-time-on-desk.mjs
 */
import { timeOnDesk } from '../../src/lib/dateLabels.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (actual === expected) pass += 1
  else failures.push(`${name}\n     got      ${JSON.stringify(actual)}\n     expected ${JSON.stringify(expected)}`)
}

const on = (iso) => new Date(iso)

/* ---------- the real one off the screen ---------- */

check('handed over 08 Oct 2025, read 14 Sep 2026',
  timeOnDesk('2025-10-08', on('2026-09-14')), '11 months on the desk')

/* ---------- the anniversary, from both sides ---------- */

check('the day before a year is eleven months',
  timeOnDesk('2025-09-20', on('2026-09-19')), '11 months on the desk')
check('the day itself is a year',
  timeOnDesk('2025-09-20', on('2026-09-20')), '12 months on the desk')
check('the day after is still a year',
  timeOnDesk('2025-09-20', on('2026-09-21')), '12 months on the desk')

// The same rule one month at a time, which is where an off-by-one hides.
check('a month, less a day', timeOnDesk('2026-08-20', on('2026-09-19')), 'this month')
check('exactly a month', timeOnDesk('2026-08-20', on('2026-09-20')), '1 month on the desk')
check('a month and a day', timeOnDesk('2026-08-20', on('2026-09-21')), '1 month on the desk')

/* ---------- the ends ---------- */

check('handed over today', timeOnDesk('2026-09-14', on('2026-09-14')), 'this month')
check('earlier this month', timeOnDesk('2026-09-01', on('2026-09-14')), 'this month')
check('two months', timeOnDesk('2026-07-10', on('2026-09-14')), '2 months on the desk')
check('just under two years stays in months',
  timeOnDesk('2024-10-20', on('2026-09-14')), '22 months on the desk')
check('two years reads as years', timeOnDesk('2024-09-14', on('2026-09-14')), '2 years on the desk')
check('the oldest on this book', timeOnDesk('2019-03-01', on('2026-09-14')), '7 years on the desk')

/* ---------- things that are not an age ---------- */

check('a date in the future is a data error, not an age',
  timeOnDesk('2027-01-01', on('2026-09-14')), '')
check('no date', timeOnDesk(null, on('2026-09-14')), '')
check('nothing at all', timeOnDesk(undefined, on('2026-09-14')), '')
check('not a date', timeOnDesk('handed over last year', on('2026-09-14')), '')
check('empty string', timeOnDesk('', on('2026-09-14')), '')

/* ---------- a month end, where day-of-month arithmetic goes wrong ---------- */

// 31 Jan read on 28 Feb: the 31st has not come round, so it is not yet a month.
check('the 31st, read on the 28th of the next month',
  timeOnDesk('2026-01-31', on('2026-02-28')), 'this month')
check('the 31st, read on the 31st of a month that has one',
  timeOnDesk('2026-01-31', on('2026-03-31')), '2 months on the desk')
check('a leap day', timeOnDesk('2024-02-29', on('2026-09-14')), '2 years on the desk')

if (failures.length) {
  console.error(`FAIL — ${failures.length} of ${pass + failures.length} checks\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
/*
 * THE LINE run-all.mjs READS. A file that prints no count is counted as ZERO in the
 * headline and is indistinguishable from a healthy one -- a review of this suite found 20
 * files silent that way, about 800 assertion sites reported as nothing.
 */
console.log(`${pass} passed, 0 failed`)
console.log(`PASS — ${pass} checks: an account handed over on the 20th is eleven months old on`)
console.log('       the 19th of the following September, and twelve on the 20th.')
