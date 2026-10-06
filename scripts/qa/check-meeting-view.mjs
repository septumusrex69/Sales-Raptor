/**
 * A MEETING OPENS AS A MEETING, NOT AS THE MAILBOX.
 *
 * THE FIRM, clicking one on the calendar: "if I click on the 8th where it says call centre
 * discussion, it takes me to the emails. But it doesn't take me to that specific email. I don't
 * want it to take me to the email at all -- rather to call centre discussion. There's not a lot of
 * details that were brought through. Who was that with? Who did it come from?"
 *
 * THE CAUSE WAS ONE LINE: every meeting chip was built with `href: '/mail'`. Not the message --
 * the MAILBOX. So every meeting on the calendar went to the same place, and the one thing a click
 * could not tell you was anything about the meeting.
 *
 * AND EVERY DETAIL THEY ASKED FOR WAS ALREADY STORED. calendar_events carries the organiser's name
 * and address, the attendees, the location, the notes, and user_email_id -- the invitation it
 * arrived on. None of it was drawn anywhere, so this is a reading of a row, not new data.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-meeting-view.mjs
 */
import { readFileSync } from 'node:fs'
import { whenItIs } from '../../src/lib/dayPlan.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')

const cal = code('src/pages/calendar/CalendarPage.tsx')
const meeting = code('src/components/calendar/MeetingModal.tsx')
const mail = code('src/pages/mail/MailPage.tsx')

/* ---------------------------------------------------------------------------------------------
 * THE MAILBOX IS NO LONGER WHERE A MEETING TAKES YOU
 * ------------------------------------------------------------------------------------------- */

/*
 * THE ASSERTION THE COMPLAINT ACTUALLY ASKS FOR, and it is an ABSENCE. `href: '/mail'` is one
 * short line that would read as perfectly reasonable to anybody adding a chip back.
 */
ok('no meeting chip points at the mailbox', !/href: '\/mail'/.test(cal))
ok('a meeting chip carries the meeting instead', /meeting: m,/.test(cal))
ok('...and the page opens it', /<MeetingModal meeting=\{openMeeting\}/.test(cal))

/*
 * ONE CHIP COMPONENT, THREE VIEWS. The calendar draws a chip in Month, Week and Day; written out
 * three times it would be the Month view that got fixed and the Day view that quietly still went
 * to the mailbox. Asserted by counting: three call sites, one decision.
 */
check('every view draws its chips through one component',
  (cal.match(/<Chip\b/g) ?? []).length, 3)
ok('...and the component decides link or press', /if \(event\.meeting\) \{/.test(cal))
/* AND A TASK OR A DEAL IS STILL A LINK. The fix must not have turned every chip into a button
   that goes nowhere. */
ok('a chip with no meeting is still a link', /return <Link to=\{event\.href\}/.test(cal))

/* AND THE DAY SQUARE STILL OPENS THE DAY. A blanket edit over this file is exactly how the
   whole-cell drilldown built in #48 would be lost. */
ok('the day still opens its tasks', /to=\{tasksUrlForDate\(d\)\}/.test(cal))

/* ---------------------------------------------------------------------------------------------
 * WHO IT IS WITH, AND WHO IT CAME FROM
 * ------------------------------------------------------------------------------------------- */

/* The firm's two questions, by name. */
ok('the meeting says who organised it', /Organised by/.test(meeting))
ok('...and who is attending', /Attendees/.test(meeting))
ok('...and where', /label="Where"/.test(meeting))
ok('...and what the invitation said', /meeting\.notes/.test(meeting))
/*
 * ATTENDEES NAMED, NOT COUNTED. "3 attendees" is what a calendar square has room for; on the
 * meeting itself the question is WHO, and a count here sends somebody back to the email -- which
 * is the journey this screen exists to end.
 */
ok('attendees are listed rather than counted', /people\.map\(/.test(meeting))

/* ---------------------------------------------------------------------------------------------
 * WHEN IT IS, WITHOUT INVENTING AN HOUR
 * ------------------------------------------------------------------------------------------- */

const M = (over) => ({
  id: 'm', ownerId: 'u', title: 'Call centre discussion', startsAt: null, endsAt: null,
  allDay: false, startsOn: null, location: null, notes: null, source: 'invite',
  icalUid: null, organiserName: null, organiserEmail: null, attendees: [],
  userEmailId: null, createdAt: '2026-10-02T06:00:00Z', ...over,
})

ok('a timed meeting shows its span', /to/.test(
  whenItIs(M({ startsAt: '2026-10-08T08:00:00Z', endsAt: '2026-10-08T09:00:00Z' }))))
/*
 * AN ALL-DAY EVENT HAS NO CLOCK, and 00:00 against one would be a time nobody set -- the same rule
 * dayPlan.taskTime holds for a task.
 */
check('an all-day event says so', whenItIs(M({ allDay: true, startsOn: '2026-10-08' })),
  'Thursday, 8 October 2026 · all day')
ok('...and shows no hour', !/00:00/.test(whenItIs(M({ allDay: true, startsOn: '2026-10-08' }))))
/*
 * AND AN INVITATION WHOSE TIME NEVER RESOLVED SAYS SO rather than inventing one. The calendar
 * already refuses to place those on a square; saying "midnight" here would put back the claim it
 * declined to make. See inviteInstant.
 */
check('an invitation with no time admits it', whenItIs(M({})), 'No time on the invitation')

/* ---------------------------------------------------------------------------------------------
 * AND THE INVITATION OPENS THAT MESSAGE
 * ------------------------------------------------------------------------------------------- */

ok('the invitation is one press away', /Open the invitation/.test(meeting))
ok('...and it names the message', /\/mail\?message=\$\{encodeURIComponent\(meeting\.userEmailId\)\}/.test(meeting))
/* ABSENT WHERE THERE IS NO INVITATION. A meeting made by hand has no message, and a button that
   drops somebody into an inbox with nothing selected is the fault this screen exists to fix. */
ok('...and is absent on a meeting made by hand', /\{meeting\.userEmailId && \(/.test(meeting))

/* THE MAILBOX HONOURS IT, or the link is the same complaint with an extra step. */
ok('the mailbox reads the message it was sent to', /searchParams\.get\('message'\)/.test(mail))
/*
 * AND THE EFFECT ACTUALLY RUNS. Written as "it finds the row and opens it" this passed with the
 * whole body short-circuited one line above -- `if (true) return` left every assertion below it
 * matching source that could never execute. Found by breaking it. The guard has to be the ASK,
 * nothing else.
 */
ok('...and only stands down when nothing was asked for', /if \(!wanted\) return\n/.test(mail))
ok('...and opens it the way a click does', /void toggleTo\(found\)/.test(mail))
/*
 * AND CLEARS IT. An id left in the address re-opens and re-marks-read on every refresh, and fights
 * the person the moment they click a different message.
 */
ok('...and clears the ask once used', /next\.delete\('message'\)/.test(mail))
ok('...without adding a history entry', /\{ replace: true \}/.test(mail))
/*
 * AND IT FINDS THE MESSAGE WHEREVER IT IS. It used to give up quietly when the row was not on the
 * page in hand -- and the firm hit exactly that: "If I open an invitation from the calendar, it just
 * takes me [to the mailbox]." An invitation is days old by the time the meeting is opened, so it is
 * past the first fifty, or the server put it in Junk.
 */
ok('a miss is no longer where it stops', !/if \(!found\) return/.test(mail))
ok('...it fetches that one row by id', /fetchMailItem\(currentUser\.id, id\)/.test(mail))
ok('...once, not on every render', /if \(lookedUp\.current\) return\n\s*lookedUp\.current = true/.test(mail))
ok('...moves to the tab that holds it', /const tab = tabOf\(wantedRow\)\n\s*if \(filter !== tab\) \{ setFilter\(tab\); return \}/.test(mail))
/* ORDER, and it is the whole bug in miniature: `filter` changes a render before the list does, so a
   row put into the list in hand is thrown away by the load that follows and the pane empties. */
ok('...and waits for THAT tab\'s list before adding the row', /if \(loadedTab !== tab\) return\n\s*setItems\(\(list\) => \[wantedRow, /.test(mail))
ok('...which the load records as it lands', /setItems\(res\.items\)\n\s*setLoadedTab\(filter\)/.test(mail))
ok('a message that is gone is said, not swallowed', /if \(row\) \{ setWantedRow\(row\); return \}[\s\S]{0,300}no longer in your mailbox/.test(mail))

/* THE ROW IS THE LIST'S OWN SHAPE: same columns, same mapper, and only this person's. A hand-built
   item here would be a second mapper, which is how a column goes quietly undefined. */
const userMail = code('src/lib/userMail.ts')
const one = userMail.slice(userMail.indexOf('export async function fetchMailItem('))
ok('fetchMailItem exists', userMail.includes('export async function fetchMailItem('))
ok('...reads the list\'s columns', /\.select\(COLUMNS\)/.test(one.slice(0, 400)))
ok('...only this person\'s mail', /\.eq\('user_id', userId\)\.eq\('id', id\)/.test(one.slice(0, 400)))
ok('...through the list\'s mapper', /toItem\(data as unknown as MailRow\)/.test(one.slice(0, 600)))

console.log(`\ncheck-meeting-view: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
