/**
 * THE INSTALMENTS OF AN ARRANGEMENT, AND WHICH ONE A NOTICE QUOTES.
 *
 * THE FIRM'S FIVE ARRANGEMENT NOTICES ALL QUOTE AN AMOUNT AND A DATE. On a three-instalment
 * arrangement that is fifteen notices carrying three different pairs of figures, and the entire
 * risk is in one question: which instalment is the notice going out today about.
 *
 * WHAT WOULD BREAK WITHOUT THIS. The default letter says "{{ptp_amount}}, due on {{ptp_date}}, has
 * not reached our trust account" -- so quoting the instalment AFTER the missed one is a written
 * demand for money that is not yet owed, over the firm's signature, with a 48-hour ultimatum under
 * it. And the last instalment of an arrangement is usually SMALLER than the rest; a reminder that
 * rounds it up to the full amount asks for money nobody agreed to.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-ptp-schedule.mjs
 */
import {
  arrangedFromRow, describeSchedule, instalmentCount, instalmentSchedule, liveArrangement,
  nextUnpaid, nextUnpaidFromRow, readsAsSlowPaying, SLOW_PAYING_FROM,
} from '../../src/lib/ptpSchedule.ts'
import { instalmentProgress } from '../../src/lib/paymentProgress.ts'
import { instalmentsDue, nextDueDate } from '../../src/lib/arrangements.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/** A monthly arrangement: R2 500 a month, R7 500 in all, first due 5 October 2026. */
const three = {
  arrangement: 'monthly', dueOn: '2026-10-05', dayOfMonth: 5, onLastDay: false, dayOfWeek: null,
  amount: 2500, totalPromised: 7500, instalmentsKept: 0,
}

/* ---------- how many ---------- */

check('R7 500 at R2 500 a month is three instalments', instalmentCount(three), 3)
/* ROUNDED UP. R1 000 at R300 is four payments, not three and a third -- a debtor who has made
   three has not finished, and an arrangement that thinks they have stops chasing the balance. */
check('...and a total that does not divide rounds up',
  instalmentCount({ ...three, amount: 300, totalPromised: 1000 }), 4)
/* A once-off is one whatever the totals say: there is no schedule to divide. */
check('a once-off is one instalment',
  instalmentCount({ ...three, arrangement: 'once_off', totalPromised: 99999 }), 1)
/* No total is one instalment's worth of information, so it is one instalment. */
check('no total is a single instalment', instalmentCount({ ...three, totalPromised: null }), 1)
/* A row with no amount cannot be scheduled at all, and 0 is what says so rather than a throw. */
check('an arrangement with no amount schedules nothing', instalmentCount({ ...three, amount: 0 }), 0)

/*
 * THE SAME NUMBER paymentProgress ALREADY WORKS OUT. Two functions that disagree about how many
 * instalments an arrangement is would put one number on the collector's bar and a different one on
 * the debtor's letter.
 */
for (const [amount, total, arrangement] of [
  [2500, 7500, 'monthly'], [300, 1000, 'monthly'], [500, 3000, 'weekly'],
  [1200, null, 'monthly'], [4000, 4000, 'monthly'], [999, 99999, 'once_off'],
]) {
  const p = { ...three, amount, totalPromised: total, arrangement }
  check(`the count matches paymentProgress (${amount} of ${total} ${arrangement})`,
    instalmentCount(p), instalmentProgress({ ...p, due: 0 })?.planned ?? 0)
}

/* ---------- the dates ---------- */

check('three monthly instalments are dated a month apart',
  instalmentSchedule(three).map((i) => i.dueOn), ['2026-10-05', '2026-11-05', '2026-12-05'])
check('...numbered from one, as the firm counts them',
  instalmentSchedule(three).map((i) => i.no), [1, 2, 3])
/*
 * WALKED WITH nextDueDate, NOT MULTIPLIED OUT. An instalment is a date in the month, not an
 * interval: the 31st is the 28th in February, and a monthly arrangement dated 31 January would
 * drift by three days a month under "add 30 days".
 */
const endOfMonth = {
  ...three, dueOn: '2027-01-31', dayOfMonth: 31, amount: 1000, totalPromised: 4000,
}
check('the 31st clamps to the end of a short month',
  instalmentSchedule(endOfMonth).map((i) => i.dueOn),
  ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
/* And every date is the one arrangements.ts would give, walked the same way. */
{
  const walked = ['2027-01-31']
  let cursor = { ...endOfMonth }
  for (let i = 0; i < 3; i += 1) {
    const next = nextDueDate(cursor)
    walked.push(next)
    cursor = { ...cursor, dueOn: next }
  }
  check('...by exactly the arithmetic arrangements.ts already does',
    instalmentSchedule(endOfMonth).map((i) => i.dueOn), walked)
}
check('a weekly arrangement is dated seven days apart',
  instalmentSchedule({ ...three, arrangement: 'weekly', amount: 500, totalPromised: 1500 })
    .map((i) => i.dueOn), ['2026-10-05', '2026-10-12', '2026-10-19'])

/*
 * THE LAST INSTALMENT MAY BE SMALLER, AND ROUNDING IT UP ASKS FOR MONEY NOBODY AGREED TO.
 * R1 000 at R300 a month is R300, R300, R300 and R100.
 */
check('the last instalment is the remainder',
  instalmentSchedule({ ...three, amount: 300, totalPromised: 1000 }).map((i) => i.amount),
  [300, 300, 300, 100])
/* A total that divides exactly leaves the last one at the full amount -- not at zero. */
check('...and a total that divides exactly leaves it whole',
  instalmentSchedule(three).map((i) => i.amount), [2500, 2500, 2500])
/* The instalments add up to what was agreed. Anything else is an arrangement that collects the
   wrong total, which is the one thing a schedule cannot be allowed to do. */
for (const [amount, total] of [[300, 1000], [2500, 7500], [999, 5000], [1234, 1234]]) {
  const sum = instalmentSchedule({ ...three, amount, totalPromised: total })
    .reduce((n, i) => n + i.amount, 0)
  check(`the instalments add up to the total (${amount} of ${total})`, sum, total)
}

/* ---------- which one a notice is about ---------- */

/*
 * THE EARLIEST ONE NOT YET PAID, on all five steps. Each line below is one of the firm's notices.
 *
 * AND THE FIXTURES MOVE `dueOn` WITH THE COUNT, because that is what the database does.
 * keepInstalment is the only thing that writes a live arrangement after it is agreed and it does
 * both together -- one more counted, and `due_on` moved on to the next instalment. Fixtures that
 * bumped the count and left the date alone described a row the firm's own code never writes, and
 * they hid a double-count that dated every notice after the first payment a month late.
 */
const paid = (n, dueOn) => ({ ...three, instalmentsKept: n, dueOn })

check('nothing paid: the confirmation quotes instalment one',
  nextUnpaid(three), { no: 1, amount: 2500, dueOn: '2026-10-05' })
check('one paid: the receipt quotes the next one',
  nextUnpaid(paid(1, '2026-11-05')), { no: 2, amount: 2500, dueOn: '2026-11-05' })
/*
 * AND THE DEFAULT LETTER QUOTES THE MISSED ONE. This is the assertion the whole file exists for:
 * one instalment paid, the second missed, and the letter that says "has not reached our trust
 * account" must name instalment 2 on 5 November -- not instalment 3 on 5 December, which the
 * debtor does not owe yet.
 */
check('one paid and the second missed: the default letter quotes the second',
  nextUnpaid(paid(1, '2026-11-05')).dueOn, '2026-11-05')
/*
 * THE DOUBLE-COUNT, NAMED. `nextUnpaid` read `instalmentsKept` as a POSITION into a schedule that
 * already started at the next unpaid instalment, so the count was applied twice: the arrangement
 * above came back quoting 5 DECEMBER. A reminder a month late, a receipt naming a payment the
 * debtor had not reached, and on a final instalment a demand for money already paid -- and every
 * figure on its own looked right.
 */
check('...and never the one after it', nextUnpaid(paid(1, '2026-11-05')).dueOn !== '2026-12-05', true)
check('two paid: the third', nextUnpaid(paid(2, '2026-12-05')), { no: 3, amount: 2500, dueOn: '2026-12-05' })
/* FINISHED IS NULL, not the last instalment again. Null leaves {{ptp_amount}} standing as a
   placeholder, which is what stops a notice about an instalment that does not exist. */
check('an arrangement paid up quotes nothing', nextUnpaid(paid(3, '2027-01-05')), null)
check('...and so does one paid past its count', nextUnpaid(paid(9, '2027-01-05')), null)
/* A negative or fractional count cannot index past the front of the schedule. */
check('a nonsense kept count still lands on instalment one',
  nextUnpaid({ ...three, instalmentsKept: -2 }).no, 1)
/*
 * AND WHAT IS LEFT IS WORKED OUT FROM WHAT IS STILL OWED. R1 000 at R300 is four payments of
 * R300, R300, R300 and R100; with two behind it there is R400 left, so the remainder still lands
 * on the fourth. Measured against the whole R1 000 the last instalment would come back at R300 --
 * a demand for R200 the debtor never agreed to, on the very last letter of the arrangement.
 */
const short = { ...three, amount: 300, totalPromised: 1000 }
check('the remainder is measured against what is left, not what was agreed',
  instalmentSchedule({ ...short, instalmentsKept: 2, dueOn: '2026-12-05' })
    .map((i) => `${i.no}:${i.amount}`).join(' '),
  '3:300 4:100')

/*
 * IT IS A COUNT, NOT A CALENDAR. nextUnpaid does not care what today is -- an instalment overdue
 * since November is still the earliest unpaid one in January, which is what keeps the default
 * letter quoting the missed payment however late the firm gets to it. instalmentsDue is the
 * function that reads the calendar, and it is a different question.
 */
check('what has fallen due is the calendar’s question', instalmentsDue(three, '2026-11-06'), 2)
check('...and what is unpaid is the arrangement’s', nextUnpaid(paid(1, '2026-11-05')).no, 2)

/* ---------- which arrangement an account is on ---------- */

/*
 * TWO STATES COUNT AS LIVE, AND THE SECOND IS THE POINT. `defaulted` is the 48 hours the firm's
 * default letter promises -- the arrangement is still on its existing terms and a payment revives
 * it -- so the letter, the SMS beside it and anything a collector composes in those two days must
 * still be able to quote the instalment that was MISSED. Read `open` only and all three merge a
 * blank amount into a demand with an ultimatum under it.
 */
const withStatus = (status, over = {}) => ({ ...three, ...over, status })
check('an open arrangement is the live one',
  liveArrangement([withStatus('open')]).dueOn, '2026-10-05')
check('...and so is a defaulted one, inside its 48 hours',
  liveArrangement([withStatus('defaulted')]).dueOn, '2026-10-05')
check('a broken one is not', liveArrangement([withStatus('broken')]).amount, 0)
check('...nor a kept one', liveArrangement([withStatus('kept')]).amount, 0)
check('...nor a cancelled one', liveArrangement([withStatus('cancelled')]).amount, 0)
/* NOTHING LIVE QUOTES NOTHING, which leaves both placeholders standing -- which is what stops an
   arrangement notice being merged against an account that has no arrangement. */
check('an account with no arrangement quotes nothing', nextUnpaid(liveArrangement([])), null)
check('...and one whose arrangement is over quotes nothing',
  nextUnpaid(liveArrangement([withStatus('broken')])), null)
/*
 * THE NEWEST WHERE THERE ARE SOMEHOW TWO. One arrangement per account is the rule, but this reads a
 * table, and taking the first row of an order nobody set is the non-deterministic sort bug that has
 * already been found here once.
 */
check('the newest live arrangement wins',
  liveArrangement([
    withStatus('open', { dueOn: '2026-10-05', createdAt: '2026-09-01T08:00:00Z' }),
    withStatus('open', { dueOn: '2026-11-20', createdAt: '2026-09-20T08:00:00Z' }),
  ]).dueOn, '2026-11-20')
check('...whichever order the rows arrive in',
  liveArrangement([
    withStatus('open', { dueOn: '2026-11-20', createdAt: '2026-09-20T08:00:00Z' }),
    withStatus('open', { dueOn: '2026-10-05', createdAt: '2026-09-01T08:00:00Z' }),
  ]).dueOn, '2026-11-20')

/* ---------- a row, as the database hands it over ---------- */

/*
 * THE ONE PLACE THE COLUMN NAMES APPEAR ON THE SERVER SIDE, which is why every one of them is
 * asserted. CLAUDE.md's warning: a column present in the table, the type and the select but missing
 * from the mapper reads as undefined for ever and nothing fails. Here the slip would read as an
 * arrangement of ONE instalment -- so a three-instalment arrangement would stop sending reminders
 * after the first, and nothing anywhere would report it.
 */
/*
 * ONE INSTALMENT BEHIND IT, AND `due_on` MOVED ON WITH IT, which is the row keepInstalment
 * actually writes: one more counted, and the date advanced to the next instalment. A fixture
 * carrying the FIRST date beside a count of one describes a row the firm's own code never
 * produces -- and it is what hid the double-count in nextUnpaid.
 */
const row = {
  amount: '2500.00', due_on: '2026-11-05', arrangement: 'monthly', day_of_month: 5,
  on_last_day: false, day_of_week: null, instalments_kept: 1, total_promised: '7500.00',
}
check('a row maps to the arrangement it describes', arrangedFromRow(row), {
  amount: 2500, dueOn: '2026-11-05', arrangement: 'monthly', dayOfMonth: 5, onLastDay: false,
  dayOfWeek: null, instalmentsKept: 1, totalPromised: 7500,
})
/* NUMERIC ARRIVES AS A STRING from PostgREST, and '2500.00' * anything is what a missed Number()
   costs: the schedule would be NaN instalments long and every notice would hold. */
check('...with numeric columns read as numbers', typeof arrangedFromRow(row).amount, 'number')
check('...including the total', typeof arrangedFromRow(row).totalPromised, 'number')
/* AND IT AGREES WITH THE SCHEDULE: one instalment kept, so the next is the second -- and it is
   the date on the row, because the row is already standing at it. */
check('a mapped row quotes the same instalment', nextUnpaidFromRow(row),
  { no: 2, amount: 2500, dueOn: '2026-11-05' })

/*
 * EVERY COLUMN CHANGED, ONE AT A TIME, MUST CHANGE THE SCHEDULE -- a mapper that silently ignores
 * a column it was handed is the exact failure this is guarding, and it is invisible: the
 * arrangement still schedules, just wrongly.
 *
 * ASSERTED ON THE WHOLE SCHEDULE, NOT ON nextUnpaid, AND THAT IS A REAL WEAKENING REPAIRED. The
 * next unpaid instalment is now simply the date the row is standing at, so the recurrence
 * columns -- the shape, the day of the month, the last-day flag -- cannot move it by construction:
 * they decide where the instalments AFTER it fall. Left asserting on nextUnpaid, dropping
 * `day_of_month` from the mapper would have gone unnoticed, which is the whole failure this loop
 * exists for.
 *
 * CHANGED RATHER THAN DELETED, because some of these have real fallbacks and deleting them proves
 * nothing. `day_of_month` falls back to the day of `due_on`, which is the same answer, so the
 * substitute moves the day instead.
 */
const scheduleOf = (r) => JSON.stringify(instalmentSchedule(arrangedFromRow(r)))
for (const [k, v] of [
  ['amount', 1000], ['due_on', '2026-12-05'], ['arrangement', 'weekly'], ['day_of_month', 20],
  ['on_last_day', true], ['instalments_kept', 2], ['total_promised', 20000],
]) {
  ok(`changing ${k} changes the schedule`, scheduleOf({ ...row, [k]: v }) !== scheduleOf(row))
}
/*
 * AND THE THREE THAT DO NOT MOVE THE NEXT INSTALMENT, asserted rather than left out, because all
 * three look like bugs at a glance and none is:
 *
 *   - the RECURRENCE decides where later instalments fall, never the one the arrangement is
 *     standing at. A weekly arrangement whose next payment is 5 November still has it on 5
 *     November; the sixth, the twelfth and the day of the month are the ones that move.
 *   - `total_promised` sets HOW MANY instalments there are, not when the next one falls. Raising
 *     it from R7 500 to R20 000 makes a three-instalment arrangement an eight-instalment one and
 *     the next payment is still R2 500 on 5 November.
 *   - `day_of_week` is descriptive only: nextDueDate adds seven days to the previous date, so a
 *     weekly arrangement recurs on whatever day `due_on` is, and the column is what
 *     describeArrangement prints. Worth knowing before anybody relies on it to move a date.
 */
check('the recurrence does not move the instalment already due',
  nextUnpaidFromRow({ ...row, arrangement: 'weekly' }).dueOn, '2026-11-05')
check('the total changes how many, not when the next one falls',
  nextUnpaidFromRow({ ...row, total_promised: 20000 }), nextUnpaidFromRow(row))
check('...though it does change the count',
  instalmentCount(arrangedFromRow({ ...row, total_promised: 20000 })), 8)
check('the weekday is descriptive, and does not move a weekly date',
  nextUnpaidFromRow({ ...row, arrangement: 'weekly', day_of_week: 3 }),
  nextUnpaidFromRow({ ...row, arrangement: 'weekly', day_of_week: null }))
check('no row at all maps to no arrangement', arrangedFromRow(null), null)
check('...and quotes nothing', nextUnpaidFromRow(null), null)
/* A row with no due date cannot be scheduled and must not be guessed at. */
check('a row with no due date maps to nothing', arrangedFromRow({ ...row, due_on: null }), null)

/* ---------- slow paying ---------- */

/*
 * THE FIRM'S OWN LETTERS TELL THE DEBTOR THIS: "an arrangement that takes more than six
 * instalments to settle the account is reported as slow paying, which every credit provider who
 * assesses you can see." It is on the confirmation, before they agree, and on the default.
 */
check('the bureaus’ threshold is the seventh instalment', SLOW_PAYING_FROM, 7)
ok('six instalments does not read as slow paying',
  !readsAsSlowPaying({ ...three, amount: 1000, totalPromised: 6000 }))
ok('...and seven does', readsAsSlowPaying({ ...three, amount: 1000, totalPromised: 7000 }))

/* ---------- how it reads ---------- */

const money = (n) => `R ${n.toFixed(2)}`
check('an arrangement reads as its count and its shape',
  describeSchedule(three, money, 'Monthly on the 5th'),
  '3 instalments of R 2500.00, monthly on the 5th')
check('...and one payment is not "1 instalments"',
  describeSchedule({ ...three, arrangement: 'once_off' }, money, 'Once-off'),
  'One payment of R 2500.00')

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-ptp-schedule: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
