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
  NO_DAY_COUNT, dayCountSentence, dayCounts, dayHeadline, joinLink, localDay, meetingDay,
  meetingTime, meetingWith, planDay, shiftDay, taskTime, weekStrip,
} from '../../src/lib/dayPlan.ts'
import { monthSpan } from '../../src/lib/dayWords.ts'

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
const picker = code('src/components/tasks/TaskDayPicker.tsx')
const meetingBox = code('src/components/calendar/MeetingModal.tsx')
const store = code('src/store/AppStore.tsx')
const grid = code('src/components/ui/DayGrid.tsx')
const diaryPicker = code('src/components/diary/DiaryDatePicker.tsx')
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

/* ---------------------------------------------------------------------------------------------
 * SEEING THE DAY'S LOAD BEFORE BOOKING ONTO IT
 *
 * THE FIRM, on the Add Task box: "it asks you when, but it should look like a rediarisation almost
 * thing, to show you how many meetings do you have for a specific day." Which is the diary's own
 * argument moved onto a task: the count has to be in front of somebody BEFORE the choice, because
 * a number that appears after it tells them they have overbooked and leaves them to work out
 * which other day was better.
 * ------------------------------------------------------------------------------------------- */

const meet = (id, startsAt) => ({
  id, title: `m-${id}`, startsAt, endsAt: null, allDay: false, startsOn: null,
  location: null, attendees: [], organiserName: null,
})

/* THE SAME DAY THE SAME WAY. dayCounts must place an item on the square planDay would draw it on,
   or the number under the 14th is not the number of rows the 14th then shows. */
const sameDayAsPlan = () => {
  const meetings = [meet('a', '2026-10-14T09:00:00Z'), meet('b', '2026-10-15T09:00:00Z')]
  const list = [task('t1', '2026-10-14T00:00:00'), task('t2', '2026-10-14T15:00:00')]
  const counted = dayCounts({ meetings, tasks: list }).get(DAY)
  const planned = planDay({ day: DAY, meetings, tasks: list })
  return [counted.total, planned.total]
}
const [counted, planned] = sameDayAsPlan()
check('a day counts what planDay would draw on it', counted, planned)

/* TWO KINDS COUNTED SEPARATELY, because a day with four meetings is full in a way a day with four
   tasks is not -- and whether any of it is an appointment is the one fact somebody picking a day
   needs at a glance. */
const mixed = dayCounts({
  meetings: [meet('a', '2026-10-14T09:00:00Z')],
  tasks: [task('t1', '2026-10-14T00:00:00'), task('t2', '2026-10-14T11:00:00')],
}).get(DAY)
check('meetings and tasks are counted apart', [mixed.meetings, mixed.tasks], [1, 2])
check('...and said apart', dayCountSentence(mixed), '1 meeting · 2 tasks')
check('...singular where there is one of each',
  dayCountSentence({ meetings: 1, tasks: 1, total: 2 }), '1 meeting · 1 task')
/* NOTHING IS A REAL ANSWER, said rather than left blank: an empty line under a date reads as a
   count that failed to load, which is the opposite of the fact it is reporting. */
check('an empty day says so', dayCountSentence(NO_DAY_COUNT), 'Nothing booked')

/* A CANCELLED TASK IS NOT WORK -- the same exclusion planDay and the calendar both make, or the
   number over a square counts rows the list below it will not show. */
check('a cancelled task is not counted',
  dayCounts({ meetings: [], tasks: [{ id: 'c', title: 'x', dueDate: '2026-10-14T00:00:00', status: 'Cancelled' }] }).size,
  0)
/* AND A MEETING WITH NO DAY RESOLVED BELONGS ON NO SQUARE. The calendar lists those separately as
   the ones it could not place; counted into today they would be a figure with no row behind it. */
check('a meeting with no day is not counted into one',
  dayCounts({ meetings: [{ ...meet('x', null), startsOn: null }], tasks: [] }).size, 0)

/* MONDAY FIRST, SEVEN AT A TIME. The diary's grid is Monday-first and somebody using both in one
   afternoon must not have to re-learn where Saturday is. */
const strip = weekStrip('2026-10-14', 2)
check('a strip is whole weeks', strip.length, 14)
check('...starting on the Monday of the week asked for', strip[0], '2026-10-12')
/* SUNDAY IS THE END OF ITS WEEK, NOT THE START. getDay() is Sunday-based, so this is the one date
   an off-by-one here gets wrong -- and it would silently shift a whole grid by a week. */
check('...and a Sunday belongs to the week it ends', weekStrip('2026-10-18', 1)[0], '2026-10-12')
check('a day shifts through a year end', shiftDay('2026-12-31', 1), '2027-01-01')
check('...and backwards through one', shiftDay('2026-01-01', -1), '2025-12-31')
/* ACROSS A MONTH END THE REPEATED YEAR GOES, and across a year end both stay. */
check('a heading names the months it spans', monthSpan(['2026-09-28', '2026-10-04']),
  'September – October 2026')
check('...and keeps both years across a year end', monthSpan(['2026-12-28', '2027-01-03']),
  'December 2026 – January 2027')

/* ---------------------------------------------------------------------------------------------
 * AND THE CONTROLS THAT DRAW IT
 * ------------------------------------------------------------------------------------------- */

/* ONE GRID. DiaryDatePicker's own comment is the argument -- "two calendars drift apart inside a
   month" -- so the seven columns are shared and only the policy is not. */
ok('the diary and the task picker draw one grid',
  /<DayGrid /.test(diaryPicker) && /<DayGrid /.test(picker))
/* AND THE GRID DECIDES NOTHING. A grid that knew about capacity would carry the diary's policy
   into a task picker the firm has never given a ceiling for. */
ok('...and the grid holds no policy of its own',
  !/capacity|dayLoad|publicHolidays/.test(grid))

/*
 * IT COUNTS AND DOES NOT JUDGE.
 *
 * No "full", no "over", no red. The diary colours against the firm's 50-a-day; a day of meetings
 * and tasks has no such number and the firm has not been asked for one. A warning that fires when
 * nothing is wrong is worse than none.
 */
ok('the task picker does not grade a day', !/rust|'full'|'over'/.test(picker))
/* A WEEKEND IS MARKED AND STILL CHOOSABLE, which is the deliberate difference from the diary: an
   account cannot come back on a Saturday because nobody will work it, and a reminder about
   Monday's trip written against the Sunday is somebody's own business. */
ok('...and a closed day is marked rather than refused',
  /Nobody is at a desk/.test(picker) && /disabled: past && !allowPast/.test(picker))

/* THE COUNTS ARE HANDED IN, not fetched a second time -- a second fetch would be a second answer
   to "what is on the 8th", which is what this whole file exists to prevent. */
ok('the picker is given its counts', /counts: Map<string, DayCount>/.test(picker))
ok('...computed once on the page', /dayCounts\(\{/.test(tasks))

/* THE ADD BOX USES IT. This is the firm's actual request, and the input it replaced would accept
   the 8th exactly as readily when the 8th already holds four client meetings. */
ok('Add Task chooses the day on the grid', /<TaskDayPicker/.test(tasks))
ok('...and no longer on a bare date field', !/type="date"/.test(tasks))
/*
 * AND IT COUNTS THE OWNER'S DAY, NOT THE TYPIST'S. A task can be given to somebody else, and a
 * count drawn from the signed-in person's own tasks would describe the wrong day entirely.
 * MEETINGS ONLY FOR YOURSELF, said out loud: a calendar event belongs to one person and RLS
 * scopes it to them, so a total that silently left them out would answer the firm's question --
 * "how many meetings do I have that day" -- with a number that cannot.
 */
ok('the box counts the owner\'s day', /tasks: allTasks\.filter\(\(t\) => t\.ownerId === form\.ownerId\)/.test(tasks))
ok('...and says when it cannot see their meetings',
  /Counting their tasks only/.test(tasks))

/*
 * NEXT WEEK, AND BOTH WEEKS ARE NOW WEEKS.
 *
 * THE FIRM: "I think it's important to see next week as well." This Week was a ROLLING SEVEN DAYS
 * from today, so on a Thursday it reached into the middle of next week and the two buttons would
 * have overlapped by three days with no way to tell which one a Tuesday task belonged to.
 */
/* THE BUTTON AND THE FILTER, BOTH. A `case 'Next Week'` with nothing in VIEWS to reach it is a
   view that exists and cannot be opened -- and an assertion that matched either one would have
   passed on exactly that. */
ok('the list offers next week', /VIEWS = \[[^\]]*'Next Week'/.test(tasks))
ok('...and filters on it', /case 'Next Week':/.test(tasks))
ok('...and both weeks are calendar weeks', /weekStrip\(localDay\(today\), 1\)/.test(tasks)
  && /weekStrip\(shiftDay\(localDay\(today\), 7\), 1\)/.test(tasks))
/* THE WEEKS DO NOT OVERLAP. Asserted on the function rather than on the source, because this is
   the thing the change was for. */
const overlap = weekStrip('2026-10-15', 1)
  .filter((d) => weekStrip(shiftDay('2026-10-15', 7), 1).includes(d))
check('...and they do not overlap', overlap, [])

/* A DAY OF THEIR OWN CHOOSING, which seven named views could not reach. */
ok('the list can be filtered to any day', /allowPast/.test(tasks))
/* AND THE DAY GOES IN THE URL, the same parameter a calendar square links to -- so a day chosen
   here and a day arrived at from the calendar are one state, and the back button works. */
ok('...and the day chosen is the day in the URL', /next\.set\('date', day\)/.test(tasks))

/* ---------------------------------------------------------------------------------------------
 * THE CALENDAR SAYS HOW MUCH IS ON A DAY
 *
 * The square fits three chips, so a day with three things and a day with eleven looked identical
 * until you read the "+8 more" at the bottom of it -- and scanning a month for the heavy days
 * meant reading forty-two of those lines.
 * ------------------------------------------------------------------------------------------- */

ok('a month square says how much is on it', /dayEvents\.length > 0 && \(/.test(cal))
ok('...and a week column says it in words',
  /dayEvents\.length === 1 \? '1 thing' : `\$\{dayEvents\.length\} things`/.test(cal))

/* ---------------------------------------------------------------------------------------------
 * TWO FIGURES ON A DAY, NOT ONE TOTAL
 *
 * THE FIRM, booking a task: "you can see what other tasks you have left to do, but you can't see
 * meetings. There should be two little numbers at the bottom, possibly with different colours --
 * because if you want to book something: oh, I've got five meetings that day, how many tasks are
 * you going to do?"
 *
 * One figure cannot carry it. Five meetings and one task is a day that is gone; one meeting and
 * five tasks is a day with room in it; both of them read as "6".
 * ------------------------------------------------------------------------------------------- */

ok('the square shows meetings apart from tasks', /c\.meetings > 0 && \(/.test(picker) && /c\.tasks > 0 && \(/.test(picker))
/* THE CALENDAR'S OWN BLUE for a meeting -- a third colour for the same thing would be a third
   thing to learn. */
ok('...in the colour a meeting already wears', /color: 'var\(--c-steel\)'/.test(picker))
/* AND THE KEY, because two numbers in two colours is a riddle until somebody says which is which. */
ok('...and says which is which', /meetings\s*<\/span>[\s\S]{0,200}tasks/.test(picker))
/* A DASH WHERE THERE IS NEITHER, so the line holds and the column stays scannable. */
ok('...with a dash on an empty day', /c\.total === 0 \? '\u2013'/.test(picker))
/* AND THE GRID STILL DECIDES NOTHING: the footer is handed to it, like every other part of a
   cell -- the diary has one count against a capacity and this has two against none. */
ok('the grid draws what it is given', /footer\?: React\.ReactNode/.test(grid))
ok('...and still holds no policy of its own', !/meetings|capacity|dayLoad/.test(grid))

/* ---------------------------------------------------------------------------------------------
 * WHO IT IS WITH, AND THE LINK THAT OPENS IT
 *
 * THE FIRM: "I see Bredell Ferreira partnership, and then call centre discussion. It's more
 * important that... it's with this person. Simone Pretorius -- that's really important." And:
 * "if the link is pulled in there as well, that'd be cool."
 * ------------------------------------------------------------------------------------------- */

const US = ['stephan@bredellferreira.co.za']
const invite = (over) => ({
  organiserName: 'Moagi, Oscar', organiserEmail: 'Oscar.Moagi@fnb.co.za',
  attendees: [{ name: null, email: 'CAMILLE@BREDELFERREIRA.co.za' }], ...over,
})

/* THE ORGANISER FIRST: they called it, and they are the one to ring if it has to move. */
check('a meeting says who called it', meetingWith(invite(), US), 'Oscar Moagi')
/* "Moagi, Oscar" is how Exchange writes a name and is not how anybody says it. */
check('...the way a person would say it', meetingWith(invite({ organiserName: 'Pretorius, Simone' }), US), 'Simone Pretorius')
/* AND ONLY ON A SINGLE COMMA BETWEEN TWO NAMES. "Smith, Jones and Partners" is a firm, and
   turning it into "Jones and Partners Smith" would be worse than leaving it alone. */
check('...but a firm with a comma in it is left alone',
  meetingWith(invite({ organiserName: 'Smith, Jones and Partners' }), US), 'Smith, Jones and Partners')
/*
 * AND IT LEAVES US OUT. An invitation the firm sent itself has the firm as organiser, and "with
 * Stephan" on Stephan's own calendar says nothing at all.
 */
check('a meeting we called names the other person',
  meetingWith(invite({
    organiserName: 'Stephan', organiserEmail: 'stephan@bredellferreira.co.za',
    attendees: [{ name: 'Simone Pretorius', email: 's@example.co.za' }],
  }), US), 'Simone Pretorius')
/* AN ADDRESS IS A NAME WHEN THERE IS NO NAME -- dropping an attendee because the invitation
   omitted a display name tells somebody less, not more. */
check('...falling back to an address where there is no name',
  meetingWith({ organiserName: null, organiserEmail: null, attendees: [{ name: null, email: 'ops@acme.co.za' }] }, US),
  'ops@acme.co.za')
/* NOBODY ELSE IS A REAL ANSWER: a note to yourself in the calendar is not a meeting with anybody,
   and "with —" would be furniture on every one of them. */
check('a meeting with nobody says nobody',
  meetingWith({ organiserName: null, organiserEmail: null, attendees: [] }, US), null)

/*
 * THE JOIN LINK, AND THE HARD PART IS NOT FINDING A URL -- IT IS NOT FINDING THE WRONG ONE.
 *
 * The firm's own Teams boilerplate carries aka.ms/JoinTeamsMeeting (a help page) and a
 * webex.com/msteams marketing page beside the real link. A button that opened the help page would
 * be worse than no button, because it looks like it worked.
 */
const TEAMS = [
  'Microsoft Teams meeting',
  'Join: https://teams.microsoft.com/meet/3723873974543254?p=f51WYaIJEBYHNuEHZr',
  'Meeting ID: 372 387 397 454 325 4',
  'Need help?<https://aka.ms/JoinTeamsMeeting?omkt=en-US> | System reference<https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0>',
  'More info<https://www.webex.com/msteams?confid=1>',
].join('\n')
check('the join link comes out of the invitation',
  joinLink(TEAMS, 'Microsoft Teams Meeting'),
  'https://teams.microsoft.com/meet/3723873974543254?p=f51WYaIJEBYHNuEHZr')
ok('...and not the help page', !/aka\.ms/.test(joinLink(TEAMS, null) ?? ''))
ok('...nor the marketing page', !/webex\.com\/msteams/.test(joinLink(TEAMS, null) ?? ''))
/* TRAILING PUNCTUATION IS NOT PART OF A URL: an invitation wraps one in angle brackets and a human
   ends the sentence with a full stop, and a link carrying either 404s. */
check('a bracketed link loses its bracket',
  joinLink('Join<https://zoom.us/j/12345678>'), 'https://zoom.us/j/12345678')
check('...and a sentence loses its full stop',
  joinLink('See https://meet.google.com/abc-defg-hij.'), 'https://meet.google.com/abc-defg-hij')
/* THE LOCATION IS LOOKED AT TOO, because some clients put the URL there and write "Microsoft Teams
   Meeting" in the notes. */
check('a link in the location is found', joinLink(null, 'https://zoom.us/j/999'), 'https://zoom.us/j/999')
/* NULL IS THE COMMON CASE AND NOT A FAILURE. A meeting in a boardroom has no link, and a button
   that appeared on all of them and worked on half would teach people not to press it. */
check('a meeting in a room has no link', joinLink('Boardroom, third floor', 'Boardroom'), null)

/* AND IT IS PRESSABLE IN BOTH PLACES SOMEBODY LOOKS. */
ok('the meeting itself offers Join', /Join the meeting/.test(meetingBox))
ok("...and so does the day's own list", /<Video size=\{12\} \/> Join/.test(tasks))
/* OFF THE INVITATION'S OWN WORDS, which is where the URL is -- so a day list that wanted a button
   had to be given the notes. */
ok('...read off the notes the invitation carried', /notes\?: string \| null/.test(read('src/lib/dayPlan.ts')))

/* ---------------------------------------------------------------------------------------------
 * A TASK CAN BE CHANGED, CALLED OFF, AND BELONG TO A CLIENT
 *
 * THE FIRM: "you should also be able to edit a task, the name of the task, and also cancel a task
 * -- the cancel reason. It could be attached to a client: this client has a meeting on the 15th,
 * schedule the meeting, goes onto the notes of the client... the client has cancelled the meeting,
 * and then it will also be on the notes of the client. So all the data is captured there."
 * ------------------------------------------------------------------------------------------- */

/* ONE BOX FOR BOTH. Two would drift: the day picker, the blank time and the client are the same
   decisions whichever end you came in at. */
ok('adding and editing are one box', /function TaskModal\(\{/.test(tasks))
ok('...and the box knows which it is', /editing \? 'Edit task' : 'Add Task'/.test(tasks))
/* THE DAY AND THE TIME COME APART THROUGH taskTime, the same function the list reads them with --
   an edit box that guessed differently would put 00:00 into a field somebody left blank. */
ok('...reading a time back the way the list does', /time: taskTime\(editing\) \?\? ''/.test(tasks))
ok('a task can be edited from the list', /onClick=\{\(\) => setEditTask\(t\)\}/.test(tasks))

/* CANCELLING ASKS WHY. 'Cancelled' has been a status all along and the only thing it could say was
   that somebody had -- a meeting the CLIENT called off and one the firm dropped are the same row. */
ok('cancelling asks why', /function CancelTaskModal\(\{/.test(tasks))
ok('...and stores the answer', /cancelReason: reason/.test(tasks))
/* ASKED FOR, NOT REQUIRED: a required reason is a box everybody fills with a full stop, and a file
   of full stops is worse than one with gaps, because the gaps at least read as gaps. */
ok('...without forcing one', /Optional &mdash;/.test(tasks.slice(tasks.indexOf('function CancelTaskModal'))))
/* AND NOT ON ONE ALREADY FINISHED: there is nothing to call off, and a button that refuses is
   worse than one that is not there. */
ok('...and is absent on a task already finished',
  /t\.status !== 'Completed' && t\.status !== 'Cancelled' && \(/.test(tasks))

/*
 * AND ALL THREE EVENTS LAND ON THE CLIENT'S OWN FILE.
 *
 * Creating a task already wrote there and completing one did; CANCELLING did not, so a meeting a
 * client called off left no trace anywhere except a row quietly leaving a list -- which is the one
 * event a client file most needs, and the one that went unrecorded.
 */
ok('cancelling writes to the client', /patch\.status === 'Cancelled' && previous\.status !== 'Cancelled'/.test(store))
/* THE REASON IS IN THE SENTENCE, not a second field nobody reads: an activity feed is read as a
   column of sentences, and "Meeting cancelled: Quarterly review" without the why is the same
   sentence for a client who postponed and a firm that gave up. */
ok('...with the reason in the sentence', /cancelled: \$\{previous\.title\}\$\{why/.test(store))
ok('...on the client it was about', /companyId: previous\.companyId/.test(store))

/*
 * AND A TASK CAN BE GIVEN A CLIENT AT ALL, which it could not.
 *
 * `companyId` has been on a task all along and nothing on this screen could set it, so every task
 * added here was attached to nobody -- three working activity writes with nothing to write to.
 */
ok('the box can attach a client', /companyId: form\.companyId \|\| undefined/.test(tasks))
/* UNDEFINED, NOT AN EMPTY STRING: the column is a uuid and '' is not one. */
ok('...and no client is nothing, not an empty string', !/companyId: form\.companyId,/.test(tasks))
ok('...named on the row so the list can say whose it is', /relatedToLabel: companies\.find/.test(tasks))

console.log(`\ncheck-day-plan: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
