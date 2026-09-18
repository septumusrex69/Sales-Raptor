/**
 * Working out what time a meeting actually is.
 *
 * THIS FAILED IN PRODUCTION AND FAILED SILENTLY, which is why it is checked this hard. The firm
 * accepted an ordinary Outlook invitation. The reply went to the organiser, the card said so, the
 * event was written — and it appeared nowhere on their calendar, because the time had resolved to
 * null and a row with no date has no square to sit in. Nothing errored. Nothing was red.
 *
 * The cause: `DTSTART;TZID="South Africa Standard Time"`. That is a WINDOWS zone name, and
 * Intl.DateTimeFormat rejects it outright. Outlook writes Windows names, and on this firm's
 * mailbox Outlook is where nearly every invitation comes from — so this was not an edge case, it
 * was the common case.
 *
 * Four ways to get this wrong, each of which loses or moves a meeting:
 *
 *   - not translating Windows zone names, which is the bug above
 *   - guessing an offset for a zone nothing recognises, which puts a meeting an hour out — and a
 *     meeting an hour out is worse than one you had to read the zone off
 *   - preferring the invite's own declared offset over the zone NAME, which loses daylight saving
 *     for every European organiser half the year
 *   - letting the screen decide whether a time is resolvable by a different test from the one the
 *     WRITE uses, which is how the card stayed quiet while the event went in undated
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-invite-timezone.mjs
 */
import { readFileSync } from 'node:fs'
import {
  fixedOffsetToUtc, fixedZoneOffsets, ianaZone, icsLines, inviteInstant, inviteWhen,
  parseInvite, parseUtcOffset, zonedTimeToUtc,
} from '../../src/lib/calendarInvite.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

/* ---------- the zone names Outlook actually writes ---------- */

check('the one that lost a meeting', ianaZone('South Africa Standard Time'), 'Africa/Johannesburg')
check('...whatever case it arrives in', ianaZone('SOUTH AFRICA STANDARD TIME'), 'Africa/Johannesburg')
check('...and with the whitespace some clients leave', ianaZone('  South Africa Standard Time '), 'Africa/Johannesburg')
/* Some clients glue the offset to the front of the name. It is decoration, not part of it. */
check('an offset glued to the front is stripped',
  ianaZone('(UTC+02:00) South Africa Standard Time'), 'Africa/Johannesburg')
check('...in either spelling', ianaZone('(GMT+0200) South Africa Standard Time'), 'Africa/Johannesburg')

check('London', ianaZone('GMT Standard Time'), 'Europe/London')
check('Berlin', ianaZone('W. Europe Standard Time'), 'Europe/Berlin')
check('New York', ianaZone('Eastern Standard Time'), 'America/New_York')
check('Dubai', ianaZone('Arabian Standard Time'), 'Asia/Dubai')
check('Nairobi', ianaZone('E. Africa Standard Time'), 'Africa/Nairobi')
check('Windhoek, because the firm collects in Namibia', ianaZone('Namibia Standard Time'), 'Africa/Windhoek')
check('UTC by name', ianaZone('UTC'), 'Etc/UTC')

/* An IANA name is already an IANA name and must come back untouched. */
check('a real IANA zone passes through', ianaZone('Africa/Johannesburg'), 'Africa/Johannesburg')
check('...and so does one nobody has mapped', ianaZone('Europe/Isle_of_Man'), 'Europe/Isle_of_Man')
/*
 * AN UNKNOWN NAME COMES BACK AS IT WENT IN, rather than as a default. Defaulting to the firm's own
 * zone would silently place a Sydney organiser's meeting in Johannesburg hours, which is a wrong
 * answer dressed as a right one.
 */
check('a zone nobody has heard of is not guessed at',
  ianaZone('Middle Earth Standard Time'), 'Middle Earth Standard Time')
check('nothing at all is nothing', ianaZone(null), null)
check('...and so is an empty string', ianaZone('   '), null)

/* ---------- the offset an invite declares for its own zone ---------- */

check('a plain offset', parseUtcOffset('+0200'), 120)
check('west of Greenwich', parseUtcOffset('-0500'), -300)
check('one with a half hour in it', parseUtcOffset('+0530'), 330)
check('...and one with seconds on the end', parseUtcOffset('-053000'), -330)
check('Greenwich itself', parseUtcOffset('+0000'), 0)
check('rubbish is not an offset', parseUtcOffset('two hours'), null)
check('...nor is nothing', parseUtcOffset(undefined), null)

/*
 * ONE SUB-COMPONENT MEANS ONE RULE ALL YEAR, which is simply true and can be used. Two means the
 * offset depends on the date, and choosing between them needs the RRULE evaluated — so those are
 * left out entirely rather than guessed at.
 */
const SA_VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:South Africa Standard Time',
  'BEGIN:STANDARD', 'DTSTART:16010101T000000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0200', 'END:STANDARD',
  'END:VTIMEZONE',
].join('\r\n')
check('a zone with one rule all year gives up its offset',
  fixedZoneOffsets(icsLines(SA_VTIMEZONE))['South Africa Standard Time'], 120)

const LONDON_VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:GMT Standard Time',
  'BEGIN:STANDARD', 'DTSTART:16011028T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0000', 'END:STANDARD',
  'BEGIN:DAYLIGHT', 'DTSTART:16010325T010000', 'TZOFFSETFROM:+0000', 'TZOFFSETTO:+0100', 'END:DAYLIGHT',
  'END:VTIMEZONE',
].join('\r\n')
check('a zone that changes through the year does not',
  fixedZoneOffsets(icsLines(LONDON_VTIMEZONE))['GMT Standard Time'], undefined)
/* Two zones in one file, which every invitation with an overseas attendee carries. */
const BOTH = fixedZoneOffsets(icsLines(`${SA_VTIMEZONE}\r\n${LONDON_VTIMEZONE}`))
check('one file can describe several zones', BOTH['South Africa Standard Time'], 120)
check('...without the second one bleeding into the first', BOTH['GMT Standard Time'], undefined)
/*
 * AND IN THE OTHER ORDER, which is the one that actually catches a leak.
 *
 * With the simple zone first, a parser that forgets to reset between blocks still gives the right
 * answers by luck -- the good one is already stored before the bad one adds to the count. Put the
 * daylight-saving zone first and the leak shows: its two sub-components carry over, the simple
 * zone is counted as three, and its offset is silently dropped. That is the fallback gone for
 * every invitation that happens to list an overseas attendee before the organiser's own zone.
 * Found by break-testing this check, which passed on the broken parser.
 */
const REVERSED = fixedZoneOffsets(icsLines(`${LONDON_VTIMEZONE}\r\n${SA_VTIMEZONE}`))
check('the order the zones appear in does not matter', REVERSED['South Africa Standard Time'], 120)
check('...and the daylight-saving one is still left out', REVERSED['GMT Standard Time'], undefined)
/* A block with no TZID must not inherit the name of the one before it. */
const NAMELESS = fixedZoneOffsets(icsLines([
  SA_VTIMEZONE,
  'BEGIN:VTIMEZONE',
  'BEGIN:STANDARD', 'DTSTART:16010101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'END:STANDARD',
  'END:VTIMEZONE',
].join('\r\n')))
check('a nameless zone does not steal the previous name\u2019s offset',
  NAMELESS['South Africa Standard Time'], 120)
check('...and adds nothing of its own', Object.keys(NAMELESS).length, 1)
check('no VTIMEZONE at all is an empty answer, not a crash',
  Object.keys(fixedZoneOffsets(icsLines('BEGIN:VCALENDAR\r\nEND:VCALENDAR'))).length, 0)

check('a wall-clock time at a known offset', fixedOffsetToUtc('2026-09-29T14:30', 120), '2026-09-29T12:30:00.000Z')
check('...west of Greenwich', fixedOffsetToUtc('2026-09-29T14:30', -300), '2026-09-29T19:30:00.000Z')
check('...and across midnight', fixedOffsetToUtc('2026-09-29T01:00', 120), '2026-09-28T23:00:00.000Z')
check('a malformed time is null, not NaN', fixedOffsetToUtc('the 29th', 120), null)

/* ---------- the invitation that broke it, end to end ---------- */

/* Exactly what Outlook sent, down to the quoted TZID. */
const REAL = [
  'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'VERSION:2.0',
  SA_VTIMEZONE,
  'BEGIN:VEVENT',
  'UID:040000008200E00074C5B7101A82E008',
  'SEQUENCE:0',
  'SUMMARY:Stephan & Johann - Catch-up',
  'LOCATION:Pepla Software Solutions; DeathStar',
  'DTSTART;TZID="South Africa Standard Time":20260929T143000',
  'DTEND;TZID="South Africa Standard Time":20260929T153000',
  'ORGANIZER;CN=Danielle Louwrens:mailto:daniellel@pepla.co.za',
  'ATTENDEE;CN=Stephan Ferreira:mailto:stephan@bredellferreira.co.za',
  'END:VEVENT', 'END:VCALENDAR',
].join('\r\n')

const invite = parseInvite(REAL)
check('the zone is carried as the invite wrote it', invite.when.timeZone, 'South Africa Standard Time')
check('...with the quotes taken off', invite.when.timeZone.includes('"'), false)
check('the invite’s own offset is read alongside it', invite.when.tzOffsetMinutes, 120)
/*
 * THE LINE THAT MATTERS. This was null, and null is what put a meeting on nobody's calendar.
 * 14:30 in Johannesburg is 12:30 UTC.
 */
const at = inviteInstant(invite.when)
check('the meeting resolves to a real instant', at.startsAt, '2026-09-29T12:30:00.000Z')
check('...and so does its end', at.endsAt, '2026-09-29T13:30:00.000Z')
/* What a person reads is still the organiser's own wall clock, never shifted. */
check('...while the screen still shows the organiser’s own time',
  inviteWhen(invite.when), '29 September 2026, 14:30–15:30 (South Africa Standard Time)')

/*
 * THE NAME WINS OVER THE DECLARED OFFSET. A named zone knows about daylight saving; an offset
 * declared in a file only knows about the half of the year it was written in. An invitation from
 * London in July that declares +0000 must still resolve to British Summer Time.
 */
const LONDON_JULY = [
  'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'VERSION:2.0',
  'BEGIN:VTIMEZONE', 'TZID:GMT Standard Time',
  'BEGIN:STANDARD', 'DTSTART:16011028T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0000', 'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT', 'UID:L', 'SUMMARY:London call',
  'DTSTART;TZID=GMT Standard Time:20260715T090000',
  'ORGANIZER:mailto:a@b.example',
  'END:VEVENT', 'END:VCALENDAR',
].join('\r\n')
const london = parseInvite(LONDON_JULY)
check('the file declares GMT for a summer meeting', london.when.tzOffsetMinutes, 0)
check('...and the zone NAME wins, so British Summer Time applies',
  inviteInstant(london.when).startsAt, '2026-07-15T08:00:00.000Z')

/*
 * A ZONE NOTHING RECOGNISES, WITH AN OFFSET THE INVITE DECLARED. The invitation told us the
 * answer; refusing to read it would be pedantry at the cost of a meeting with no date on it.
 */
const ODD = [
  'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'VERSION:2.0',
  'BEGIN:VTIMEZONE', 'TZID:Customized Time Zone',
  'BEGIN:STANDARD', 'DTSTART:16010101T000000', 'TZOFFSETFROM:+0345', 'TZOFFSETTO:+0345', 'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT', 'UID:O', 'SUMMARY:Somewhere else',
  'DTSTART;TZID=Customized Time Zone:20260929T140000',
  'ORGANIZER:mailto:a@b.example',
  'END:VEVENT', 'END:VCALENDAR',
].join('\r\n')
check('an unknown zone falls back to the offset the invite declared',
  inviteInstant(parseInvite(ODD).when).startsAt, '2026-09-29T10:15:00.000Z')

/*
 * AND WHERE THERE IS NEITHER, IT STAYS NULL. A guessed offset puts a meeting an hour out, which
 * is worse than one you had to read the zone off. The screen says so instead — checked below.
 */
const NOTHING = ODD.replace(/BEGIN:VTIMEZONE[\s\S]*END:VTIMEZONE\r\n/, '')
check('an unknown zone with nothing to fall back on stays unresolved',
  inviteInstant(parseInvite(NOTHING).when).startsAt, null)
/* A floating time means "whatever the reader's clock says", which is not a fact about a meeting. */
const FLOATING = [
  'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:F',
  'DTSTART:20260929T140000', 'ORGANIZER:mailto:a@b.example', 'END:VEVENT', 'END:VCALENDAR',
].join('\r\n')
check('a floating time is still not placed at an hour',
  inviteInstant(parseInvite(FLOATING).when).startsAt, null)
/* Z is an instant and needs no zone database at all. */
const ZULU = FLOATING.replace('20260929T140000', '20260929T140000Z')
check('a UTC time needs no zone at all',
  inviteInstant(parseInvite(ZULU).when).startsAt, '2026-09-29T14:00:00.000Z')
/* A whole day is a DATE. Storing midnight would show it as 00:00. */
const ALL_DAY = FLOATING.replace('DTSTART:20260929T140000', 'DTSTART;VALUE=DATE:20260929')
check('an all-day event stays a date', inviteInstant(parseInvite(ALL_DAY).when).startsAt, '2026-09-29')

/* The two-pass offset solver still works where daylight saving moves under it. */
check('a wall time the night the clocks go forward',
  zonedTimeToUtc('2026-03-29T02:30', 'Europe/London'), '2026-03-29T01:30:00.000Z')

/* ---------- the screen tells the truth about it ---------- */

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const page = read('../../src/pages/mail/MailPage.tsx')
const calendar = read('../../src/pages/calendar/CalendarPage.tsx')

/*
 * THE CARD'S TEST IS THE WRITE'S TEST. It used to warn only when the invite named no zone at all,
 * so the case that actually bit -- a zone named but unreadable -- produced no warning while the
 * event went in undated. Two different tests for one question is how that happens.
 */
ok('the card asks whether the time RESOLVES, not whether a zone was named',
  /const undated = !invite\.when\.allDay\s*\n\s*&& invite\.when\.startsAt !== null\s*\n\s*&& inviteInstant\(invite\.when\)\.startsAt === null/.test(page))
ok('...and warns on that', /\{!invite\.cancelled && undated && \(/.test(page))
ok('...naming the zone it could not read', /does not recognise this invite&rsquo;s timezone/.test(page))
ok('...and still covers an invite with no zone at all', /The invite gives no timezone/.test(page))
ok('...saying in both cases what will happen', /go on your calendar without a time/.test(page))

/*
 * AND THE CALENDAR STOPS DROPPING THEM IN SILENCE. A meeting with no hour has no square to sit
 * in, and saying nothing about it is how somebody who accepted an invitation is left unable to
 * tell a failure from looking in the wrong month.
 */
ok('the calendar knows which meetings it could not place',
  /const undated = useMemo\(\s*\n\s*\(\) => meetings\.filter\(\(m\) => \(m\.allDay \? m\.startsOn : m\.startsAt\) === null\)/.test(calendar))
ok('...and says so on the screen', /\{undated\.length > 0 && \(/.test(calendar))
ok('...naming each one', /\{undated\.map\(\(m\) => \(/.test(calendar))
ok('...and saying where to find the real time', /Open the message in Mail/.test(calendar))
/* The same test the grid uses, so the two cannot disagree about which are missing. */
ok('the grid drops exactly the ones the notice lists',
  /const when = m\.allDay \? m\.startsOn : m\.startsAt\s*\n\s*if \(when === null\) return \[\]/.test(calendar))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
An Outlook invitation saying "South Africa Standard Time" lands at half past twelve UTC, which is
half past two in Johannesburg, which is when the meeting is. A zone nothing recognises falls back
to the offset the invitation declared for itself, and where there is neither the screen says so
rather than the meeting quietly going nowhere.`)
