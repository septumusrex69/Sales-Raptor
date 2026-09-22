/**
 * The working-day clock a query's deadline is built on.
 *
 * These dates are checkable against a South African wall calendar, which is the point: the
 * deadline in the letter is what the firm will later stand on.
 *
 * Run: node --experimental-strip-types scripts/qa/check-working-days.mjs
 */
import {
  addWorkingDays, easterSunday, isWorkingDay, publicHolidays, subtractWorkingDays, workingDaysBetween,
} from '../../src/lib/workingDays.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push(`${name}\n     expected ${e}\n     actual   ${a}`)
}

/* ---- Easter, which moves everything around it ---- */
check('Easter 2024', easterSunday(2024), '2024-03-31')
check('Easter 2025', easterSunday(2025), '2025-04-20')
check('Easter 2026', easterSunday(2026), '2026-04-05')
check('Easter 2027', easterSunday(2027), '2027-03-28')
/*
 * AND TWO THAT ACTUALLY DISCRIMINATE THE METONIC CONSTANT.
 *
 * The computus opens with `year % 19`. A review of this suite changed it to `% 38` and watched
 * all four years above stay green, and recommended adding a year outside 2014-2032 -- where
 * `% 19` and `% 38` agree -- on the reasoning that any year outside that range would catch it.
 *
 * THAT REASONING IS WRONG AND THE FIX WOULD NOT HAVE WORKED. Where the two differ, `a` moves by
 * 19, so `19a` moves by 361 and `h` by 361 mod 30 = 1. But `l` is computed as `(... - h ...) % 7`,
 * so h rising by one drops l by one -- and the date is built from `h + l`, which does not move at
 * all. The formula absorbs its own error. 2033 was tried first here and stayed green.
 *
 * It only shows through when one of those two steps wraps its modulus, which across 2000-2099
 * happens in seven years: 2000, 2008, 2012, 2038, 2042, 2076 and 2086. Two of them are pinned.
 * 2038 is worth knowing for its own sake -- 25 April is the latest Easter can ever fall.
 */
check('Easter 2012, which the Metonic constant decides', easterSunday(2012), '2012-04-08')
check('Easter 2038, the latest Easter can fall', easterSunday(2038), '2038-04-25')

const h2026 = publicHolidays(2026)
check('Good Friday 2026', h2026.get('2026-04-03'), 'Good Friday')
check('Family Day 2026', h2026.get('2026-04-06'), 'Family Day')
check('Freedom Day is fixed', h2026.get('2026-04-27'), 'Freedom Day')
check('Heritage Day is fixed', h2026.get('2026-09-24'), 'Heritage Day')

/* ---- the Sunday rule, and the fact that it does not cascade ---- */
/*
 * ---- EVERY HOLIDAY, NOT A HANDFUL ----
 *
 * The twelve dates of the Public Holidays Act 36 of 1994, pinned as a whole set for a year.
 *
 * WHY A WHOLE SET RATHER THAN MORE SPOT CHECKS. A review of this suite moved Christmas Day, Human
 * Rights Day, Youth Day, Women's Day and the Day of Reconciliation to any date it liked with the
 * suite green -- five of the twelve, unguarded, because the assertions here tested the Sunday
 * rule and the Easter arithmetic and never the plain list they operate on. A working-day count is
 * what a section 129's ten days and every diary date are measured in.
 *
 * NOTE FOR WHOEVER BREAKS THIS ON PURPOSE: moving Christmas to the 27th does NOT prove the check
 * bites -- the 27th collides with the Goodwill-cascade assertion below and fails for the wrong
 * reason. The review was caught by exactly that. Move it to the 23rd.
 *
 * TWO YEARS, because one cannot show both halves of the Sunday rule: 2026 has Women's Day on a
 * Sunday and 2027 has two of them, one at either end of the year.
 */
check('every public holiday of 2026', [...publicHolidays(2026).entries()].sort(), [
  ['2026-01-01', "New Year's Day"],
  ['2026-03-21', 'Human Rights Day'],
  ['2026-04-03', 'Good Friday'],
  ['2026-04-06', 'Family Day'],
  ['2026-04-27', 'Freedom Day'],
  ['2026-05-01', "Workers' Day"],
  ['2026-06-16', 'Youth Day'],
  ['2026-08-09', "National Women's Day"],
  /* The 9th was a Sunday, so the Monday is a holiday as well -- s2(1) of the Act. */
  ['2026-08-10', "National Women's Day (observed)"],
  ['2026-09-24', 'Heritage Day'],
  ['2026-12-16', 'Day of Reconciliation'],
  ['2026-12-25', 'Christmas Day'],
  ['2026-12-26', 'Day of Goodwill'],
])
check('every public holiday of 2027', [...publicHolidays(2027).entries()].sort(), [
  ['2027-01-01', "New Year's Day"],
  ['2027-03-21', 'Human Rights Day'],
  ['2027-03-22', 'Human Rights Day (observed)'],
  ['2027-03-26', 'Good Friday'],
  ['2027-03-29', 'Family Day'],
  ['2027-04-27', 'Freedom Day'],
  ['2027-05-01', "Workers' Day"],
  ['2027-06-16', 'Youth Day'],
  ['2027-08-09', "National Women's Day"],
  ['2027-09-24', 'Heritage Day'],
  ['2027-12-16', 'Day of Reconciliation'],
  ['2027-12-25', 'Christmas Day'],
  ['2027-12-26', 'Day of Goodwill'],
  /* Boxing Day on a Sunday pushes Goodwill to the 27th -- the case the 2022 assertion below
     proves does NOT happen when it is Christmas that falls on the Sunday. */
  ['2027-12-27', 'Day of Goodwill (observed)'],
])

// 1 Jan 2023 was a Sunday, so the Monday was a public holiday.
check('New Year 2023 moved to the Monday', publicHolidays(2023).get('2023-01-02'), "New Year's Day (observed)")
// 25 Dec 2022 was a Sunday and 26 Dec was already the Day of Goodwill, so 27 Dec was NOT a
// holiday -- the rule fills a free Monday, it does not push a queue of holidays along.
check('Christmas 2022 did not push Goodwill to the 27th', publicHolidays(2022).has('2022-12-27'), false)
check('...and the 26th stayed the Day of Goodwill', publicHolidays(2022).get('2022-12-26'), 'Day of Goodwill')

/* ---- what is and is not a working day ---- */
check('a Thursday is a working day', isWorkingDay('2026-09-10'), true)
check('a Saturday is not', isWorkingDay('2026-09-12'), false)
check('a Sunday is not', isWorkingDay('2026-09-13'), false)
check('Heritage Day is not', isWorkingDay('2026-09-24'), false)
check('Good Friday is not', isWorkingDay('2026-04-03'), false)

/* ---- the seven working days a query actually gets ---- */
// Raised Thursday 10 Sep 2026: Fri 11, Mon 14, Tue 15, Wed 16, Thu 17, Fri 18, Mon 21.
check('seven working days from a Thursday', addWorkingDays('2026-09-10', 7), '2026-09-21')
// The day it was raised is not one of the days the debtor gets.
check('the day it was raised does not count', addWorkingDays('2026-09-11', 1), '2026-09-14')
// Raised the day before Heritage Day (Thu 24 Sep 2026), so the holiday falls inside the window.
check('a public holiday inside the window extends it', addWorkingDays('2026-09-23', 7), '2026-10-05')
// Easter: raised Wed 1 Apr 2026, with Good Friday and Family Day inside the window.
check('Easter extends a window by two days', addWorkingDays('2026-04-01', 7), '2026-04-14')

/* ---- a date that landed on a weekend gets moved forward, not backward ---- */
check('zero days from a Saturday is the Monday', addWorkingDays('2026-09-12', 0), '2026-09-14')
check('zero days from a working day is that day', addWorkingDays('2026-09-10', 0), '2026-09-10')

/* ---- the reminder, two working days before the deadline ---- */
check('two working days before a Monday deadline', subtractWorkingDays('2026-09-21', 2), '2026-09-17')
// 14 Apr 2026 is a Tuesday, so counting back two working days crosses the weekend to the Friday.
check('two working days before a Tuesday deadline', subtractWorkingDays('2026-04-14', 2), '2026-04-10')

/* ---- counting, for "how long has this been open" ---- */
check('a working week is five', workingDaysBetween('2026-09-10', '2026-09-17'), 5)
check('the same day is none', workingDaysBetween('2026-09-10', '2026-09-10'), 0)
check('backwards is none, not negative', workingDaysBetween('2026-09-17', '2026-09-10'), 0)
check('a count over New Year still works', workingDaysBetween('2025-12-30', '2026-01-05'), 3)

/* ---- a declared once-off holiday ---- */
const extra = { '2026-05-29': 'National election day' }
check('a declared holiday is not a working day', isWorkingDay('2026-05-29', extra), false)
check('...and it lengthens a window', addWorkingDays('2026-05-28', 1, extra), '2026-06-01')
check('...but only in its own year', publicHolidays(2027, extra).has('2026-05-29'), false)

console.log(`${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  !! ${f}`)
process.exit(failures.length ? 1 : 0)
