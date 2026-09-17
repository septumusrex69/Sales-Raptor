/**
 * Reading a meeting request out of an email.
 *
 * An invite arrived in the firm's mailbox and Raptor showed "This message has no text in it" —
 * the body reader takes text/plain and text/html only, and an invite's body is text/calendar. A
 * collector could see that somebody had written to them and nothing about what was being asked.
 *
 * THE TWO THINGS THAT MUST NOT BE GOT WRONG, and most of what is checked here:
 *
 *   - A CANCELLATION IS NOT AN INVITATION. It arrives looking like one, carrying METHOD:CANCEL or
 *     STATUS:CANCELLED, and shown as an invite it would put a meeting in somebody's day that the
 *     organiser has already called off.
 *   - A TIME IS NOT SHIFTED. `DTSTART;TZID=Africa/Johannesburg:20260917T160000` is a wall-clock
 *     time in a zone whose offset needs a database this parser does not have. It is carried as
 *     written with the zone named beside it; guessing would put a meeting an hour out.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-calendar-invite.mjs
 */
import { readFileSync } from 'node:fs'
import {
  describeRepeat, icsDate, icsLines, icsPerson, inviteHeadline, inviteWhen, parseInvite,
  unescapeIcsText, unfoldIcs,
} from '../../src/lib/calendarInvite.ts'

let pass = 0
const failures = []
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${name}\n    expected ${e}\n    got      ${a}`)
}
const ok = (name, actual) => eq(name, actual, true)

/* ---------- folding, which is the first thing and the classic bug ---------- */

/*
 * RFC 5545 folds any line over 75 octets and marks the continuation with a leading space. Parsed
 * line by line, a long SUMMARY arrives cut in half and its second half reads as a property called
 * " and the rest of the subject" — which then becomes nothing at all. Outlook folds constantly.
 */
eq('a folded line is put back together',
  unfoldIcs('SUMMARY:Catch-up about the\r\n  Pepla arrangement'),
  ['SUMMARY:Catch-up about the Pepla arrangement'])
eq('...with a tab as well as a space',
  unfoldIcs('SUMMARY:Catch-up\r\n\tabout fees'), ['SUMMARY:Catch-upabout fees'])
eq('...and bare newlines work, because plenty of senders emit them',
  unfoldIcs('SUMMARY:One\n TWO'), ['SUMMARY:OneTWO'])
eq('two real lines stay two lines', unfoldIcs('SUMMARY:A\r\nLOCATION:B').length, 2)
/* A continuation with nothing before it cannot be joined to anything and must not throw. */
eq('a stray continuation does not crash', unfoldIcs(' orphan'), [' orphan'])
eq('blank lines are dropped', unfoldIcs('A:1\r\n\r\nB:2').length, 2)

/* ---------- escaping ---------- */

eq('an escaped newline is a newline', unescapeIcsText('Line one\\nLine two'), 'Line one\nLine two')
eq('an escaped comma is a comma', unescapeIcsText('Smith\\, John'), 'Smith, John')
eq('an escaped semicolon is a semicolon', unescapeIcsText('a\\;b'), 'a;b')
/*
 * ORDER MATTERS. A doubled backslash has to resolve LAST, or "\\n" — a literal backslash followed
 * by an n — becomes a line break that was never in the message.
 */
eq('a literal backslash is not a line break', unescapeIcsText('C:\\\\nowhere'), 'C:\\nowhere')

/* ---------- the line format ---------- */

{
  const [line] = icsLines('ORGANIZER;CN=Danielle Louwrens:mailto:dl@example.co.za')
  eq('the property name is read', line.name, 'ORGANIZER')
  eq('...its parameters', line.params.CN, 'Danielle Louwrens')
  eq('...and its value, colons and all', line.value, 'mailto:dl@example.co.za')
}
/* A quoted CN is how a name containing the separator is carried: "Louwrens, Danielle". */
eq('a quoted parameter keeps its commas',
  icsLines('ATTENDEE;CN="Louwrens, Danielle":mailto:dl@example.co.za')[0].params.CN,
  'Louwrens, Danielle')
eq('a parameter name is matched whatever its case',
  icsLines('DTSTART;tzid=Africa/Johannesburg:20260917T160000')[0].params.TZID, 'Africa/Johannesburg')
/* A line with no colon is not a property; it must be skipped, not half-read. */
eq('a line with no colon is skipped', icsLines('NOT A PROPERTY').length, 0)

/* ---------- when ---------- */

eq('a UTC time is an instant',
  icsDate({ name: 'DTSTART', params: {}, value: '20260917T140000Z' }),
  { at: '2026-09-17T14:00', allDay: false, tz: 'UTC' })
/*
 * CARRIED, NOT CONVERTED. The offset for a named zone lives in a database this file does not
 * have, and a meeting shown an hour out is worse than one whose zone you had to read.
 */
eq('a zoned time keeps its own clock and names the zone',
  icsDate({ name: 'DTSTART', params: { TZID: 'Africa/Johannesburg' }, value: '20260917T160000' }),
  { at: '2026-09-17T16:00', allDay: false, tz: 'Africa/Johannesburg' })
eq('a floating time has no zone at all',
  icsDate({ name: 'DTSTART', params: {}, value: '20260917T160000' }).tz, null)
eq('a whole day is a day, not midnight',
  icsDate({ name: 'DTSTART', params: { VALUE: 'DATE' }, value: '20260917' }),
  { at: '2026-09-17', allDay: true, tz: null })
eq('a missing date is missing, not today',
  icsDate(undefined), { at: null, allDay: false, tz: null })
eq('something that is not a date is not read as one',
  icsDate({ name: 'DTSTART', params: {}, value: 'whenever' }).at, null)

/* ---------- people ---------- */

{
  const p = icsPerson(icsLines('ATTENDEE;CN=Stephan Bredell;PARTSTAT=ACCEPTED:mailto:s@example.co.za')[0])
  eq('an attendee has a name', p.name, 'Stephan Bredell')
  eq('...an address', p.email, 's@example.co.za')
  eq('...and what they have said', p.status, 'ACCEPTED')
  eq('...and is required unless the invite says otherwise', p.optional, false)
}
eq('an optional attendee is marked as one',
  icsPerson(icsLines('ATTENDEE;ROLE=OPT-PARTICIPANT:mailto:x@example.co.za')[0]).optional, true)
/*
 * A CN that is just the address again is not a name. Printed as both it reads as a bug, and
 * Outlook does exactly this for anybody not in the address book.
 */
eq('an address repeated as a name is not a name',
  icsPerson(icsLines('ATTENDEE;CN=x@example.co.za:mailto:x@example.co.za')[0]).name, null)
eq('...whatever its case',
  icsPerson(icsLines('ATTENDEE;CN=X@Example.co.za:mailto:x@example.co.za')[0]).name, null)
eq('a bare address with no mailto: still reads',
  icsPerson(icsLines('ORGANIZER:dl@example.co.za')[0]).email, 'dl@example.co.za')

/* ---------- a whole invite ---------- */

const REQUEST = [
  'BEGIN:VCALENDAR', 'PRODID:-//Microsoft Corporation//Outlook//EN', 'VERSION:2.0',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'UID:040000008200E00074C5B7101A82E008',
  'SUMMARY:Stephan & Johann - Catch-up',
  'DTSTART;TZID=Africa/Johannesburg:20260917T160000',
  'DTEND;TZID=Africa/Johannesburg:20260917T170000',
  'LOCATION:Microsoft Teams Meeting',
  'DESCRIPTION:Agenda\\n1. The Pepla arrangement\\n2. Fees',
  'ORGANIZER;CN=Danielle Louwrens:mailto:daniellel@example.co.za',
  'ATTENDEE;CN=Stephan Bredell;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:s@example.co.za',
  'ATTENDEE;CN=Johann Ferreira;ROLE=OPT-PARTICIPANT:mailto:j@example.co.za',
  'END:VEVENT', 'END:VCALENDAR',
].join('\r\n')

{
  const inv = parseInvite(REQUEST)
  eq('an invite is recognised', inv.method, 'REQUEST')
  eq('...and is not a cancellation', inv.cancelled, false)
  eq('what the meeting is', inv.summary, 'Stephan & Johann - Catch-up')
  eq('where it is', inv.location, 'Microsoft Teams Meeting')
  eq('...and the agenda comes back as lines, not as backslash-n',
    inv.description, 'Agenda\n1. The Pepla arrangement\n2. Fees')
  eq('who called it', inv.organiser.name, 'Danielle Louwrens')
  eq('...and their address', inv.organiser.email, 'daniellel@example.co.za')
  eq('who is asked', inv.attendees.length, 2)
  eq('...and which of them need not come', inv.attendees.map((a) => a.optional), [false, true])
  eq('when it starts', inv.when.startsAt, '2026-09-17T16:00')
  eq('...when it ends', inv.when.endsAt, '2026-09-17T17:00')
  eq('...and in which zone', inv.when.timeZone, 'Africa/Johannesburg')
  eq('it does not repeat', inv.repeats, null)
  eq('the heading says what is being asked', inviteHeadline(inv), 'Meeting request')
  eq('and it reads as a sentence',
    inviteWhen(inv.when), '17 September 2026, 16:00\u201317:00 (Africa/Johannesburg)')
}

/* ---------- a cancellation, which is the one that matters ---------- */

eq('METHOD:CANCEL is a cancellation',
  parseInvite(REQUEST.replace('METHOD:REQUEST', 'METHOD:CANCEL')).cancelled, true)
/* Senders do not agree on which flag they set, so either alone has to be enough. */
eq('...and so is STATUS:CANCELLED on its own',
  parseInvite(REQUEST.replace('BEGIN:VEVENT', 'BEGIN:VEVENT\r\nSTATUS:CANCELLED')).cancelled, true)
eq('a cancellation says so at the top',
  inviteHeadline(parseInvite(REQUEST.replace('METHOD:REQUEST', 'METHOD:CANCEL'))), 'Meeting cancelled')
eq('a confirmed meeting is not a cancellation',
  parseInvite(REQUEST.replace('BEGIN:VEVENT', 'BEGIN:VEVENT\r\nSTATUS:CONFIRMED')).cancelled, false)
eq('somebody else\u2019s reply is named for what it is',
  inviteHeadline(parseInvite(REQUEST.replace('METHOD:REQUEST', 'METHOD:REPLY'))),
  'Reply to a meeting request')

/* ---------- what is not an invite ---------- */

eq('an ordinary email is not an invite', parseInvite('Hi Stephan, are you free on Thursday?'), null)
eq('nothing is not an invite', parseInvite(null), null)
eq('an empty string is not an invite', parseInvite(''), null)
/* A calendar with no event in it — a timezone definition alone — is not a meeting. */
eq('a calendar with no event is not a meeting',
  parseInvite('BEGIN:VCALENDAR\r\nBEGIN:VTIMEZONE\r\nEND:VTIMEZONE\r\nEND:VCALENDAR'), null)

/*
 * ONLY THE FIRST EVENT. A repeating meeting's invite carries the series and then one VEVENT per
 * exception; reading them all would report a single invitation as nine separate meetings.
 */
{
  const series = REQUEST.replace('END:VCALENDAR',
    'BEGIN:VEVENT\r\nSUMMARY:Moved that week\r\nDTSTART;TZID=Africa/Johannesburg:20260924T170000\r\nEND:VEVENT\r\nEND:VCALENDAR')
  eq('a series with an exception is still one meeting', parseInvite(series).summary, 'Stephan & Johann - Catch-up')
}
/* A property outside the VEVENT is not the event's: a VTIMEZONE has its own DTSTART. */
{
  const withTz = REQUEST.replace('BEGIN:VEVENT',
    'BEGIN:VTIMEZONE\r\nDTSTART:19700101T000000\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT')
  eq('a timezone block\u2019s own DTSTART is not the meeting\u2019s',
    parseInvite(withTz).when.startsAt, '2026-09-17T16:00')
}

/* ---------- repeats ---------- */

eq('a weekly meeting says so', describeRepeat('FREQ=WEEKLY'), 'Repeats weekly')
eq('...and every second week says that', describeRepeat('FREQ=WEEKLY;INTERVAL=2'), 'Repeats every 2 weeks')
eq('...with a count', describeRepeat('FREQ=WEEKLY;COUNT=12'), 'Repeats weekly, 12 times')
eq('...or an end date', describeRepeat('FREQ=MONTHLY;UNTIL=20261231T000000Z'), 'Repeats monthly until 2026-12-31')
/* The raw rule is never shown: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU" is not for a collector. */
eq('a rule nobody can phrase says nothing rather than showing itself',
  describeRepeat('BYDAY=TU'), null)
eq('no rule is no repeat', describeRepeat(undefined), null)

/* ---------- how the time reads ---------- */

eq('a whole day is a day',
  inviteWhen({ startsAt: '2026-09-17', endsAt: '2026-09-18', allDay: true, timeZone: null }),
  '17 September 2026, all day')
/*
 * AN ALL-DAY EVENT'S DTEND IS THE DAY AFTER IT ENDS. A one-day event reads 17th to 18th in the
 * file and is a single day to a person; printed as written it would claim two.
 */
eq('...and two days are two, not three',
  inviteWhen({ startsAt: '2026-09-17', endsAt: '2026-09-19', allDay: true, timeZone: null }),
  '17 September 2026 to 18 September 2026')
eq('a meeting crossing midnight names both days',
  inviteWhen({ startsAt: '2026-09-17T23:00', endsAt: '2026-09-18T01:00', allDay: false, timeZone: 'UTC' }),
  '17 September 2026 23:00 to 18 September 2026 01:00 UTC')
eq('a start with no end still reads',
  inviteWhen({ startsAt: '2026-09-17T16:00', endsAt: null, allDay: false, timeZone: null }),
  '17 September 2026, 16:00')
eq('no start is nothing to say',
  inviteWhen({ startsAt: null, endsAt: null, allDay: false, timeZone: null }), null)
/*
 * SPELLED OUT HERE, not through Intl. en-ZA renders September as "Sept" — neither the full month
 * nor a normal abbreviation — and this codebase has been bitten by that before.
 */
ok('the month is spelled in full',
  inviteWhen({ startsAt: '2026-09-17T09:00', endsAt: null, allDay: false, timeZone: null })
    .includes('September'))

/* ---------- and the part reaches the page at all ---------- */

/*
 * THE PARSER IS USELESS IF THE PART IS NEVER FETCHED. readableParts decides what to pull out of
 * the mailbox, and it took text/plain and text/html only — so the calendar part was never asked
 * for, assembleBody found no text, and the whole message was reported as empty. Every hop from
 * the mailbox to the screen is checked, because any one of them silently undoes the rest.
 */
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const mime = read('../../api/_lib/mime.ts')
const sync = read('../../api/_lib/emailSync.ts')
const route = read('../../api/email/attachment.ts')
const userMail = read('../../src/lib/userMail.ts')
const page = read('../../src/pages/mail/MailPage.tsx')

/*
 * SCOPED TO readableParts, which decides what is FETCHED. Asserted against the whole file it
 * passed happily with the clause deleted — assembleBody mentions text/calendar as well, so the
 * check was satisfied by a line that has nothing to do with fetching. Found by break-testing it:
 * the mutation removed the clause and the check stayed green.
 */
{
  const from = mime.indexOf('export function readableParts(')
  ok('the part chooser exists', from > -1)
  const chooser = mime.slice(from, mime.indexOf('\n}', from))
  ok('the calendar part is fetched from the mailbox', /p\.type === 'text\/calendar'/.test(chooser))
  /* A .ics somebody deliberately attached is a file, not the body — same rule as a .txt. */
  ok('...unless it was attached as a file',
    /if \(p\.disposition === 'attachment'\) continue/.test(chooser))
}
{
  const from = mime.indexOf('export function assembleBody(')
  const assembler = mime.slice(from, mime.indexOf('\n}', from))
  ok('...and it is carried out of the assembler', /calendars\.push\(toText/.test(assembler))
}
/*
 * AN INVITE WITH NO TEXT ALTERNATIVE IS STILL A MESSAGE. Returning null when there is no plain or
 * html part sent the whole thing down the fallback to be reported as empty — which is exactly
 * what the firm saw.
 */
ok('...a calendar part on its own counts as a body',
  /texts\.length === 0 && htmls\.length === 0 && calendars\.length === 0/.test(mime))
/*
 * BOTH WAYS IN. The structure walk is the fast path and mailparser is the fallback; teaching one
 * and not the other is the shape of bug that survives a release, because the fallback only runs
 * on the messages the walk could not place — which is disproportionately the odd ones.
 */
ok('the slow path reads a calendar part too',
  /startsWith\('text\/calendar'\)/.test(sync))
ok('the route sends it to the browser', /calendar: body\.calendar/.test(route))
ok('...the client reads it off the response', /calendar: body\.calendar \?\? ''/.test(userMail))
ok('...the page keeps it beside the text', /setCalendars\(\(c\) => \(\{ \.\.\.c, \[mail\.id\]: calendar \}\)\)/.test(page))
ok('...and renders it', /<InviteCard ics=\{calendar\} \/>/.test(page))

/*
 * ABOVE THE MESSAGE TEXT. Where there is a covering note as well, what the meeting IS beats a
 * note about it — and the actions above it stay above everything.
 */
{
  const start = page.indexOf('function MailBody(')
  const mailBody = page.slice(start, page.indexOf('function InviteCard(', start))
  const invite = mailBody.indexOf('<InviteCard')
  const body = mailBody.indexOf('whitespace-pre-wrap break-words')
  ok('the invite block is in the message renderer', invite > -1)
  ok('...and the message text is too', body > -1)
  ok('...with the invite first', invite < body)
}

/*
 * NO ACCEPT BUTTON, and that is deliberate. Raptor has no calendar to put a meeting in --
 * CalendarPage renders tasks and deal dates, there is no events table and no Outlook or Google
 * connection. A button that notified the organiser and put the meeting nowhere would leave the
 * collector believing it was in their day.
 */
{
  const card = page.slice(page.indexOf('function InviteCard('), page.indexOf('function InviteLine('))
  ok('the invite does not offer to accept what it cannot store', !/Accept/.test(card))
  ok('...and says why, rather than leaving somebody hunting for the button',
    /Raptor has no calendar of its own yet/.test(card))
  /* A cancellation must not be dressed in the same colours as an invitation. */
  ok('a cancellation is coloured as one', /invite\.cancelled \? 'border-negative-100/.test(card))
  ok('...and says there is nothing to accept', /The organiser has called this off/.test(card))
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  \u2717 ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A meeting request reads as what it asks: what, when, where and who. A cancellation is never shown
as an invitation, and a time in a named zone is carried as written with the zone beside it rather
than shifted by an offset this parser does not have.`)
