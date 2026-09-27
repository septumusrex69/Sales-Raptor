/**
 * HOW LONG A DEBTOR HAS TO PUT A DISPUTE IN WRITING.
 *
 * THE FIRM'S RULE: "Section 129 not yet sent: 10 business days... Already sent: the business days
 * remaining until that notice's own {{respond_by}}, and that same date is used. A debtor who
 * alleges a dispute on day 4 gets 6 business days, not a fresh 10. Floor of 5 business days."
 *
 * WHAT IS AT STAKE IN EACH HALF, and they are different risks pointing opposite ways:
 *
 *   - A FRESH TEN WOULD EXTEND A STATUTORY PERIOD by the simple expedient of saying the word
 *     "dispute". The section 129 gives ten business days; a debtor who telephones on day 4 has six
 *     of them left. It would also put TWO dates in front of them -- the notice's and the
 *     dispute's, days apart, each headed "respond by" -- and they would be entitled to read
 *     whichever suited them.
 *   - NO FLOOR WOULD GIVE A DEBTOR ONE DAY, OR NONE. A letter saying "you had until yesterday"
 *     invites the answer that they were never given a chance, which is the kind of thing the
 *     Council for Debt Collectors acts on.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-dispute-window.mjs
 */
import {
  DISPUTE_WINDOW_DAYS, DISPUTE_WINDOW_FLOOR, disputeDaysPhrase, disputeWindow, noticeRespondBy,
  remindsAt,
} from '../../src/lib/disputeWindow.ts'
import { addWorkingDays, isWorkingDay, workingDaysBetween } from '../../src/lib/workingDays.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/* A section 129 issued Monday 5 October 2026 runs ten business days, to 19 October. */
const ISSUED = '2026-10-05'
const NOTICE_BY = addWorkingDays(ISSUED, DISPUTE_WINDOW_DAYS)
check('the notice itself runs ten business days', NOTICE_BY, '2026-10-19')

/* ---------- nothing sent: the dispute sets its own clock ---------- */

const fresh = disputeWindow(ISSUED, null)
check('with no demand out, the debtor gets the full window', fresh.days, DISPUTE_WINDOW_DAYS)
check('...to a date ten business days out', fresh.respondBy, addWorkingDays(ISSUED, 10))
check('...and it is the fresh reading', fresh.basis, 'fresh')

/* ---------- a demand is running: what is left of ITS period ---------- */

/*
 * THE FIRM'S OWN EXAMPLE, ASSERTED AS THEY WROTE IT. Day 4 of ten leaves six, and the date is the
 * notice's own -- not a new one six days from now, which would be the same number of days against
 * a different deadline.
 */
const day4 = disputeWindow(addWorkingDays(ISSUED, 4), NOTICE_BY)
check('a dispute alleged on day 4 gets six business days', day4.days, 6)
check('...to the notice’s own date', day4.respondBy, NOTICE_BY)
check('...and says that is why', day4.basis, 'notice')
/* THE WHOLE POINT: it is never a fresh ten while a demand is running. */
ok('...which is fewer than a fresh window', day4.days < DISPUTE_WINDOW_DAYS)

/*
 * EVERY DAY OF THE NOTICE PERIOD, so an off-by-one cannot hide in the middle of it. The count must
 * fall by one each working day and the date must not move at all while the floor is clear.
 */
for (let d = 0; d <= 5; d += 1) {
  const w = disputeWindow(addWorkingDays(ISSUED, d), NOTICE_BY)
  check(`day ${d} of the notice leaves ${10 - d}`, w.days, 10 - d)
  check(`...still to the notice’s date (day ${d})`, w.respondBy, NOTICE_BY)
}
/* AND IT IS THE SAME ARITHMETIC workingDaysBetween DOES, not a second opinion about a count that
   ends up in a debtor's letter. */
for (const d of [0, 1, 3, 5]) {
  const today = addWorkingDays(ISSUED, d)
  check(`the count is workingDaysBetween (day ${d})`,
    disputeWindow(today, NOTICE_BY).days, workingDaysBetween(today, NOTICE_BY))
}

/* ---------- the floor ---------- */

/*
 * TOO LITTLE LEFT TO BE A CHANCE. Day 6 leaves four, which is under the floor, so the debtor gets
 * five -- AND THE DATE MOVES WITH IT. Both have to move together: five days counted to a date four
 * days away is a sentence that contradicts itself on the page.
 */
const day6 = disputeWindow(addWorkingDays(ISSUED, 6), NOTICE_BY)
check('four days left is raised to the floor', day6.days, DISPUTE_WINDOW_FLOOR)
check('...with the date moved to match', day6.respondBy, addWorkingDays(addWorkingDays(ISSUED, 6), 5))
check('...and it says the floor did it', day6.basis, 'floor')
ok('...so the date is no longer the notice’s', day6.respondBy !== NOTICE_BY)

/* EXACTLY FIVE IS NOT FLOORED: the floor raises what is below it and leaves what is on it. */
const day5 = disputeWindow(addWorkingDays(ISSUED, 5), NOTICE_BY)
check('exactly five left is left alone', day5.days, 5)
check('...and keeps the notice’s date', day5.respondBy, NOTICE_BY)
check('...on the notice’s own reading', day5.basis, 'notice')

/*
 * AND AN EXPIRED NOTICE STILL GIVES FIVE, which is the case the firm spelled out: "if the notice
 * period has already expired, the debtor still gets 5 business days and {{respond_by}} is set
 * accordingly for this message."
 */
for (const late of [10, 12, 30, 200]) {
  const today = addWorkingDays(ISSUED, late)
  const w = disputeWindow(today, NOTICE_BY)
  check(`a dispute ${late} days in still gets five`, w.days, DISPUTE_WINDOW_FLOOR)
  check(`...to a date five working days out (${late})`, w.respondBy, addWorkingDays(today, 5))
  ok(`...which is in the future (${late})`, w.respondBy > today)
}

/*
 * EVERY DATE THIS PRODUCES IS A WORKING DAY. A letter telling a debtor to send something by a
 * Sunday is a deadline nobody can meet at an office that is shut.
 */
for (const d of [0, 2, 4, 6, 9, 14, 40]) {
  const w = disputeWindow(addWorkingDays(ISSUED, d), NOTICE_BY)
  ok(`the date is a working day (day ${d})`, isWorkingDay(w.respondBy))
}
ok('...and so is the fresh one', isWorkingDay(fresh.respondBy))
/* NEVER IN THE PAST, whatever the notice says: a respond-by already gone is not a period. */
for (const d of [0, 6, 12, 60]) {
  const today = addWorkingDays(ISSUED, d)
  ok(`the date is never behind today (day ${d})`, disputeWindow(today, NOTICE_BY).respondBy > today)
}
/* AND NEVER FEWER THAN THE FLOOR, on any input at all. */
for (const d of [0, 1, 5, 7, 11, 25, 99]) {
  ok(`never under the floor (day ${d})`,
    disputeWindow(addWorkingDays(ISSUED, d), NOTICE_BY).days >= DISPUTE_WINDOW_FLOOR)
}

/* ---------- the phrase the letters merge ---------- */

/*
 * A PHRASE, NOT A NUMBER, because the firm's own wording reads "You have {{dispute_days_left}},
 * that is by {{respond_by}}" -- a field merging a bare "6" would leave the template to supply the
 * noun, which is how one of them ends up saying "6 business days days".
 */
check('ten reads as ten business days', disputeDaysPhrase(10), '10 business days')
check('six reads as six', disputeDaysPhrase(6), '6 business days')
/* Singular where it would be wrong. The floor makes it unreachable today; it costs one line for
   the day somebody lowers the floor. */
check('one is a day, not days', disputeDaysPhrase(1), '1 business day')
check('none is still plural', disputeDaysPhrase(0), '0 business days')

/* ---------- when the first reminder goes ---------- */

/*
 * HALF THE WINDOW, ROUNDED DOWN, and skipped on a short one: "skip the first reminder if the
 * window is 3 business days or shorter." On a three-day window half is day 1, which chases a
 * debtor for a document they were asked for yesterday.
 */
check('half of ten is day five', remindsAt(10), 5)
check('half of six is day three', remindsAt(6), 3)
check('half of five is day two', remindsAt(5), 2)
check('a three-day window gets no first reminder', remindsAt(3), null)
check('...nor a two-day one', remindsAt(2), null)
check('...nor one day', remindsAt(1), null)
/* THE REMINDER ALWAYS FALLS INSIDE THE WINDOW, or it is a reminder sent after the deadline. */
for (const n of [4, 5, 6, 8, 10, 20]) {
  const at = remindsAt(n)
  ok(`the reminder is inside the window (${n} days)`, at !== null && at >= 1 && at < n)
}
/* AND THE FLOOR KEEPS IT REACHABLE: disputeWindow never returns a window short enough to skip. */
for (const d of [0, 6, 12, 60]) {
  ok(`a real window always gets its reminder (day ${d})`,
    remindsAt(disputeWindow(addWorkingDays(ISSUED, d), NOTICE_BY).days) !== null)
}

/* ---------------- which notice the window is measured against ---------------- */

/*
 * THE DATE THE LIVE DEMAND RUNS TO, OFF THE STEPS THAT ACTUALLY WENT OUT.
 *
 * This is the input to everything above, so getting it wrong does not produce a wrong count -- it
 * produces a confident count against the wrong notice. Four things are asserted and each is a
 * decision rather than arithmetic.
 */
/* NOTHING SENT IS NULL, which is what disputeWindow reads as the ten-day case. Asserted first, or
   a function that always returned null would pass every assertion below by agreeing there is no
   notice. */
check('an account with no notices has no window to measure against', noticeRespondBy([]), null)
const S129 = { sentOn: '2026-10-05', deadlineDays: 10, deadlineUnit: 'business' }
check('a section 129 runs ten business days from the day it went out',
  noticeRespondBy([S129]), addWorkingDays('2026-10-05', 10))
/* AND THE PERIOD IS THE NODE'S, NOT TEN HARD-WIRED HERE: a chart revised to eleven days moves the
   date without anybody editing this file. */
check('...or eleven, if that is what the notice says',
  noticeRespondBy([{ ...S129, deadlineDays: 11 }]), addWorkingDays('2026-10-05', 11))
/* THE LATEST OF THEM WINS. An account carrying a section 129 and a final notice is running against
   the one that ends LAST; the first would be a window that closed weeks ago, and the floor would
   then hand the debtor five days -- a fair answer reached by ignoring the notice in their hand. */
const FINAL = { sentOn: '2026-10-20', deadlineDays: 7, deadlineUnit: 'business' }
check('the notice that ends last is the one the debtor is running against',
  noticeRespondBy([S129, FINAL]), addWorkingDays('2026-10-20', 7))
check('...whichever order they are read in',
  noticeRespondBy([FINAL, S129]), addWorkingDays('2026-10-20', 7))
/* A STEP THAT GAVE THE DEBTOR NOTHING TO RESPOND WITHIN DOES NOT COUNT. Most steps are like this --
   a reminder declares no deadline -- and counted as zero-day periods they would each land a
   respond-by on the day they were sent, and the latest of those would win. */
check('a step with no period of its own is not a notice',
  noticeRespondBy([{ sentOn: '2026-11-30', deadlineDays: null, deadlineUnit: null }]), null)
check('...nor is one with a period of zero',
  noticeRespondBy([{ sentOn: '2026-11-30', deadlineDays: 0, deadlineUnit: 'business' }]), null)
check('...and one of them cannot outrank a real notice',
  noticeRespondBy([S129, { sentOn: '2026-11-30', deadlineDays: null, deadlineUnit: null }]),
  addWorkingDays('2026-10-05', 10))
/* CALENDAR IS THE DEBTOR'S CLOCK AND BUSINESS IS THE STATUTORY ONE, and "10" means two different
   dates. A unit ignored here would put the section 129's own window two days early. */
const cal = noticeRespondBy([{ sentOn: '2026-10-05', deadlineDays: 10, deadlineUnit: 'calendar' }])
check('a calendar period counts weekends in', cal, '2026-10-15')
ok('...which is not the same date as ten business days', cal !== addWorkingDays('2026-10-05', 10))
/* An absent unit reads as business, because every notice in the firm\'s chart is. */
check('a notice that does not say which unit is read as business days',
  noticeRespondBy([{ sentOn: '2026-10-05', deadlineDays: 10, deadlineUnit: null }]),
  addWorkingDays('2026-10-05', 10))

/*
 * AND THE TWO HALVES MEET: the firm's own worked example, end to end. A section 129 issued on
 * 5 October 2026 with ten business days on it, and a debtor who alleges a dispute on day 4, is
 * given 6 business days to the notice's own date -- computed here from the STEP rather than from a
 * date typed into the test.
 */
{
  const by = noticeRespondBy([S129])
  /* Four business days after the notice went out, which is how the firm counts in the sentence
     this example comes from: ten days on the notice, four gone, six left. */
  const day4 = addWorkingDays('2026-10-05', 4)
  const w = disputeWindow(day4, by)
  check('the firm\'s example, from the notice that was sent', [w.days, w.respondBy, w.basis],
    [6, by, 'notice'])
  check('...and it reads as six business days', disputeDaysPhrase(w.days), '6 business days')
}

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-dispute-window: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
