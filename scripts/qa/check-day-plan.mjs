/**
 * A PERSON'S DAY: THE MEETINGS THEY HAVE AND THE WORK THEY OWE, IN ONE LIST.
 *
 * THE FIRM, after a client's Teams invitation landed on the calendar and nowhere else: "it added
 * it to my calendar, but it didn't add it to my tasks... I think it should add it to the task as
 * well. And if you click on a specific day in the calendar, it should take you to the tasks and
 * have that filter for that entire day." And on what the page should read as: "what do you need to
 * do for the day in your tasks?"
 *
 * THE DRILLDOWN WAS ALREADY BUILT AND WAS UNREACHABLE. tasksUrlForDate and the `date` filter both
 * existed and worked; the only element carrying the link was the DATE NUMBER, a 24-pixel circle in
 * the corner of the cell. A target nobody can hit is not a feature, which is why the assertion
 * below is about the whole square.
 *
 * AND THE MEETING IS NOT COPIED INTO `tasks`. That is the decision this file mostly holds: two
 * rows for one commitment drift the moment a client moves the meeting, and "complete" does not
 * mean the same thing for the two. They are merged at the READ, in one function, so the calendar
 * and the task list cannot come to different conclusions about what is on a Tuesday.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-day-plan.mjs
 */
import { readFileSync } from 'node:fs'
import {
  dayHeadline, localDay, meetingDay, meetingTime, planDay, taskTime,
} from '../../src/lib/dayPlan.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
/* Comments stripped: several assertions are about what is ABSENT, and both pages explain at
   length what they deliberately do not do. The trap this codebase has walked into three times. */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ')

const cal = code('src/pages/calendar/CalendarPage.tsx')
const tasks = code('src/pages/tasks/TasksPage.tsx')
const lib = code('src/lib/dayPlan.ts')

/* ---------------------------------------------------------------------------------------------
 * ONE LOCAL DAY, SHARED, OR THE DRILLDOWN LANDS ON AN EMPTY LIST
 * ------------------------------------------------------------------------------------------- */

/*
 * THE TWO PAGES EACH HAD THEIR OWN `ymd`. They have to agree exactly: the calendar builds the day
 * that goes into the link, the task list builds the day it filters on, and an hour of difference
 * between them is a square that opens a list which is empty for a reason nobody can see.
 */
ok('the calendar takes its day from the shared function', /localDay\(d\)/.test(cal))
ok('...and so does the task list', /localDay\(new Date\(t\.dueDate\)\) === dateFilter/.test(tasks))
ok('...and neither keeps a copy of its own',
  !/function ymd\(/.test(cal) && !/function ymd\(/.test(tasks))

/*
 * AND IT IS LOCAL, NOT UTC. A meeting at ten at night in Johannesburg is the NEXT day in UTC, so a
 * day built with toISOString() puts it on the wrong square — and the bug only shows up after dark,
 * which is the kind nobody reproduces.
 */
ok('the shared function does not go through UTC', !/toISOString/.test(lib))
/*
 * AND THE SOURCE ASSERTION ABOVE IS THE ONLY ONE THAT CAN CATCH IT HERE. This container runs in
 * UTC, so local time and UTC are the same and the call below returns the right answer on a broken
 * implementation too -- confirmed by breaking it. Kept because it documents the intent and does
 * bite on a developer machine in SAST; do not "strengthen" it into replacing the grep, which is
 * what actually holds the rule. The browser-side version of this lives in the e2e layer, which can
 * emulate a timezone.
 */
check('a late evening still belongs to its own day',
  localDay(new Date(2026, 9, 14, 22, 30)), '2026-10-14')

/* ---------------------------------------------------------------------------------------------
 * A MEETING IS NOT A TASK
 * ------------------------------------------------------------------------------------------- */

/*
 * THE ASSERTION THE WHOLE DESIGN RESTS ON, held as an ABSENCE. Writing a task row per invitation
 * is the obvious implementation and the wrong one: two things to complete for one commitment, and
 * they part company the moment the client reschedules.
 */
ok('the task page never writes a task for a meeting',
  !/addTask\(\s*\{[^}]*meeting/i.test(tasks))
ok('...and a meeting row has nothing to tick', !/checked=\{m\./.test(tasks))
/* MERGED AT THE READ, in the one function that decides what a day holds. */
ok('the day is assembled by planDay', /planDay\(\{ day: dayShown/.test(tasks))
ok('...and the page keeps no second idea of what a day holds',
  (tasks.match(/planDay\(/g) ?? []).length === 1)

/* ---------------------------------------------------------------------------------------------
 * WHAT A DAY HOLDS
 * ------------------------------------------------------------------------------------------- */

const MEET = {
  id: 'm1', title: 'Rinda Roo — handover review', startsAt: '2026-10-14T12:00:00.000Z',
  endsAt: null, allDay: false, startsOn: null, location: 'Teams', attendees: [], organiserName: null,
}
const ALLDAY = {
  id: 'm2', title: 'Public holiday', startsAt: null, endsAt: null, allDay: true,
  startsOn: '2026-10-14', location: null, attendees: [], organiserName: null,
}
/* NEITHER RESOLVED. An invitation whose time was floating belongs on NO day rather than on today:
   the calendar already lists those separately as the ones it could not place. */
const FLOATING = {
  id: 'm3', title: 'Somewhere, sometime', startsAt: null, endsAt: null, allDay: false,
  startsOn: null, location: null, attendees: [], organiserName: null,
}

check('an all-day event is on the day it names', meetingDay(ALLDAY), '2026-10-14')
check('...and a whole-day event shows no clock', meetingTime(ALLDAY), null)
check('a floating invitation is on no day at all', meetingDay(FLOATING), null)

const task = (id, dueDate, status = 'Not Started') => ({ id, title: id, dueDate, status })
const DAY = '2026-10-14'
const plan = planDay({
  day: DAY,
  meetings: [MEET, ALLDAY, FLOATING],
  tasks: [
    task('nine', '2026-10-14T09:00:00'),
    task('anytime', '2026-10-14T00:00:00'),
    task('four', '2026-10-14T16:00:00'),
    task('other day', '2026-10-15T09:00:00'),
    task('cancelled', '2026-10-14T11:00:00', 'Cancelled'),
  ],
})

check('the day holds its two placeable meetings', plan.meetings.map((m) => m.id), ['m2', 'm1'])
/* ALL DAY ABOVE THE CLOCK: it frames the day rather than taking an hour out of it. */
ok('...with the whole-day one first', plan.meetings[0].id === 'm2')
check('timed work is in time order', plan.timed.map((t) => t.id), ['nine', 'four'])
check('...and the rest is any time', plan.anytime.map((t) => t.id), ['anytime'])
/* A CANCELLED TASK IS NOT WORK, and the calendar leaves them out too — the two views have to show
   the same day or clicking through reads as broken. */
ok('a cancelled task is not on the day', !JSON.stringify(plan).includes('cancelled'))
ok('...and neither is another day s work', !JSON.stringify(plan).includes('other day'))
check('the day counts meetings and tasks together', plan.total, 5)

/* ---------------------------------------------------------------------------------------------
 * A TASK'S TIME IS OPTIONAL, AND MIDNIGHT IS HOW WE KNOW
 * ------------------------------------------------------------------------------------------- */

/*
 * `dueDate` is one timestamp with no companion flag, so midnight is the only value that cannot
 * have been meant: nobody schedules a call for twelve at night, and it is what a date with no time
 * produces.
 */
check('a task given a time has one', taskTime(task('x', '2026-10-14T14:30:00')), '14:30')
check('...and one left blank has none', taskTime(task('x', '2026-10-14T00:00:00')), null)
/*
 * AND THE OTHER HALF OF THE RULE IS IN THE ADD BOX. Without this the rule is useless: the form
 * defaulted the time to 09:00, so every task ever added carried a time nobody picked and every one
 * of them would print as fact on the day's list.
 */
ok('the add box no longer invents a time', !/time: '09:00'/.test(tasks))
ok('...and says the field is optional', /leave it blank for any time that day/i.test(read('src/pages/tasks/TasksPage.tsx')))
/* AND AN EMPTY BOX STILL SAVES. `new Date('2026-10-14T')` is an Invalid Date, which would have
   written a null due date on the first task somebody left the time off. */
ok('...and an empty time still makes a real date', /form\.time \|\| '00:00'/.test(tasks))

/* ---------------------------------------------------------------------------------------------
 * THE WHOLE SQUARE OPENS THE DAY
 * ------------------------------------------------------------------------------------------- */

/*
 * THE LINK USED TO BE ON THE DATE NUMBER ALONE. Asserted on the overlay rather than on the link
 * existing at all, because the link always existed — what was missing was anything you could hit.
 */
ok('the day s link is stretched across the whole cell',
  /to=\{tasksUrlForDate\(d\)\}[\s\S]{0,300}absolute inset-0/.test(cal))
/*
 * AND IT IS A SIBLING, NOT A WRAPPER. The cell already holds a Link per event chip, and an anchor
 * inside an anchor is invalid markup that browsers silently un-nest — the chips would stop opening
 * what they point at. Held as the absence of a wrapper around the chip loop.
 */
ok('...and the event chips are not inside it',
  !/<Link[^>]*tasksUrlForDate\(d\)[^>]*>[\s\S]{0,400}dayEvents\.slice/.test(cal))
ok('...and the date itself no longer swallows the click', /pointer-events-none/.test(cal))

/* ---------------------------------------------------------------------------------------------
 * AND THE DAY SAYS WHAT IS IN IT
 * ------------------------------------------------------------------------------------------- */

check('a day with both says so', dayHeadline(plan), '2 meetings · 3 tasks')
check('...one of each reads singular',
  dayHeadline(planDay({ day: DAY, meetings: [MEET], tasks: [task('a', '2026-10-14T00:00:00')] })),
  '1 meeting · 1 task')
/* NOTHING IS A REAL ANSWER. An empty day says so rather than drawing a heading over an empty
   table, and a count of nought is not a thing to print. */
check('an empty day says so', dayHeadline(planDay({ day: DAY, meetings: [], tasks: [] })),
  'Nothing booked')
ok('...and the meetings block is absent rather than empty',
  /plan && plan\.meetings\.length > 0 && \(/.test(tasks))

/*
 * MEETINGS ONLY WHERE THE PAGE IS ABOUT ONE DAY. A week of tasks with meetings threaded through it
 * is a calendar, and there is already a calendar.
 */
ok('meetings show on a single day, not on a range', /const dayShown = dateFilter/.test(tasks))
ok('...which covers Today and Tomorrow as well',
  /view === 'Today' \? localDay\(today\)/.test(tasks) && /view === 'Tomorrow' \? localDay\(tomorrow\)/.test(tasks))

console.log(`\ncheck-day-plan: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
