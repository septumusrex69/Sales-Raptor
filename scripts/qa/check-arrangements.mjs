/**
 * When the next instalment falls due.
 *
 * Calendar arithmetic, not interval arithmetic, and the difference only shows up in the months
 * that embarrass you: February, the 31st, and a leap year. A due date that drifts by a day a
 * month is one the debtor is entitled to argue about, and they would be right.
 *
 *   node --experimental-strip-types scripts/qa/check-arrangements.mjs
 */
import { nextDueDate, describeArrangement } from '../../src/lib/arrangements.ts'

let failed = 0
function check(name, actual, expected) {
  const ok = actual === expected
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) console.log(`        expected ${expected}, got ${actual}`)
}

const monthly = (dueOn, dayOfMonth = null, onLastDay = false) =>
  nextDueDate({ arrangement: 'monthly', dueOn, dayOfMonth, onLastDay, dayOfWeek: null })
const weekly = (dueOn) =>
  nextDueDate({ arrangement: 'weekly', dueOn, dayOfMonth: null, onLastDay: false, dayOfWeek: null })

/* The ordinary case. */
check('monthly on the 15th', monthly('2026-01-15', 15), '2026-02-15')
check('monthly rolls into the new year', monthly('2026-12-15', 15), '2027-01-15')

/* The 31st does not exist in every month, and must not spill into the next one. */
check('the 31st becomes the 28th in February', monthly('2026-01-31', 31), '2026-02-28')
check('the 31st becomes the 30th in April', monthly('2026-03-31', 31), '2026-04-30')
check('and returns to the 31st in May', monthly('2026-04-30', 31), '2026-05-31')
check('the 30th becomes the 28th in February', monthly('2026-01-30', 30), '2026-02-28')

/* Leap years: 2028 is one, 2100 is not. */
check('February in a leap year gets the 29th', monthly('2028-01-31', 31), '2028-02-29')
check('a leap-year 29th is kept', monthly('2028-01-29', 29), '2028-02-29')

/* "Last day" is a rule, not a number. */
check('last day of January is the 28th in February', monthly('2026-01-31', null, true), '2026-02-28')
check('last day of February is the 31st in March', monthly('2026-02-28', null, true), '2026-03-31')
check('last day of March is the 30th in April', monthly('2026-03-31', null, true), '2026-04-30')
check('last day in a leap February', monthly('2028-01-31', null, true), '2028-02-29')

/* Weekly is the one case where adding days is right — a week is always seven days. */
check('weekly adds seven days', weekly('2026-09-09'), '2026-09-16')
check('weekly crosses a month end', weekly('2026-09-30'), '2026-10-07')
check('weekly crosses a year end', weekly('2026-12-30'), '2027-01-06')
check('weekly crosses a leap day', weekly('2028-02-26'), '2028-03-04')

/* A once-off has no next date, and must not invent one. */
check('a once-off does not recur',
  nextDueDate({ arrangement: 'once_off', dueOn: '2026-09-09', dayOfMonth: null, onLastDay: false, dayOfWeek: null }),
  null)

/* Without a stored day, the day of the current due date carries. */
check('monthly falls back to the day it is due on', monthly('2026-01-20'), '2026-02-20')

/* How it reads to a person. */
const p = (over) => describeArrangement({
  arrangement: 'monthly', dueOn: '2026-01-15', dayOfMonth: 15, onLastDay: false,
  dayOfWeek: null, ...over,
})
check('monthly reads with an ordinal', p({}), 'Monthly on the 15th')
check('the 1st reads as 1st', p({ dayOfMonth: 1 }), 'Monthly on the 1st')
check('the 2nd reads as 2nd', p({ dayOfMonth: 2 }), 'Monthly on the 2nd')
check('the 3rd reads as 3rd', p({ dayOfMonth: 3 }), 'Monthly on the 3rd')
check('the 11th does not read as 11st', p({ dayOfMonth: 11 }), 'Monthly on the 11th')
check('the 21st reads as 21st', p({ dayOfMonth: 21 }), 'Monthly on the 21st')
check('last day reads as last day', p({ onLastDay: true }), 'Monthly on the last day')
check('weekly names the day', p({ arrangement: 'weekly', dayOfWeek: 3 }), 'Weekly on Wednesday')
check('once-off says so', p({ arrangement: 'once_off' }), 'Once-off')

console.log(failed === 0 ? '\nAll checks passed.\n' : `\n${failed} check(s) failed.\n`)
process.exit(failed ? 1 : 0)
