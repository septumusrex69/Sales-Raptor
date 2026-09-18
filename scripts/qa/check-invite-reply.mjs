/**
 * Answering a meeting request, so the organiser's calendar hears about it.
 *
 * THIS FAILS SILENTLY WHEN IT FAILS, which is why it is checked this hard. A malformed iTIP reply
 * is not bounced and does not error — Outlook and Google simply ignore it, the organiser's
 * tracking list goes on saying "No response", and nobody finds out until the day of the meeting,
 * by which time Raptor has been telling the person for a fortnight that their answer was sent.
 *
 * Four ways to produce a reply that looks perfect and is ignored:
 *
 *   - echoing the whole ATTENDEE list back. It reads as this person answering on everybody's
 *     behalf, and most clients discard it rather than guess which line is the reply.
 *   - dropping SEQUENCE. The organiser cannot tell an answer to the meeting as it stands from an
 *     answer to the version they have already moved, so it is treated as stale.
 *   - folding a line by counting characters instead of octets, which cuts a multi-byte character
 *     in half and breaks the property the two halves belonged to.
 *   - replying from the address the person signed in with rather than the one they were invited
 *     as. That attendee is a stranger to the organiser's meeting.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-invite-reply.mjs
 */
import { readFileSync } from 'node:fs'
import {
  PARTSTAT, RESPONSE_WORD, attendeeFor, canReplyTo, escapeIcsText, foldIcsLine, icsStamp,
  replyBody, replyIcs, replySubject,
} from '../../src/lib/inviteReply.ts'
import { parseInvite } from '../../src/lib/calendarInvite.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

/* A real invitation, in the shape Outlook sends one. */
const REQUEST = [
  'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'VERSION:2.0', 'BEGIN:VEVENT',
  'UID:040000008200E00074C5B7101A82E00800000000',
  'SEQUENCE:3',
  'SUMMARY:Stephan & Johann - Catch-up',
  'DTSTART;TZID=Africa/Johannesburg:20260929T143000',
  'DTEND;TZID=Africa/Johannesburg:20260929T153000',
  'ORGANIZER;CN=Danielle Louwrens:mailto:daniellel@pepla.co.za',
  'ATTENDEE;CN=Johann Combrink;PARTSTAT=NEEDS-ACTION:mailto:johann@pepla.co.za',
  /* MIXED CASE ON PURPOSE. Outlook preserves whatever the organiser typed, and written all in
     lower case here the fixture cannot tell a case-insensitive match from a case-sensitive one —
     both would pass, and the check would be proving nothing. */
  'ATTENDEE;CN=Stephan Ferreira;PARTSTAT=NEEDS-ACTION:mailto:Stephan@BredellFerreira.co.za',
  'END:VEVENT', 'END:VCALENDAR',
].join('\r\n')

const invite = parseInvite(REQUEST)
const NOW = new Date('2026-09-18T06:00:00.000Z')

/* ---------- the sequence has to survive the parser ---------- */

check('the revision number is read off the invite', invite.sequence, 3)
check('...and an invite without one says so rather than claiming nought',
  parseInvite(REQUEST.replace('SEQUENCE:3\r\n', '')).sequence, null)
check('...and rubbish is not passed off as a number',
  parseInvite(REQUEST.replace('SEQUENCE:3', 'SEQUENCE:later')).sequence, null)

/* ---------- which of the attendees is me ---------- */

/*
 * MATCHED ON ADDRESS, AND THE NAME COMES FROM THE INVITE. The reply must go out as the attendee
 * the organiser actually invited: a different address is somebody her meeting has never heard of.
 */
const me = attendeeFor(invite.attendees, ['stephan@bredellferreira.co.za'])
check('my address is found among the attendees whatever case the organiser typed',
  me.email, 'Stephan@BredellFerreira.co.za')
check('...with the name the organiser gave me', me.name, 'Stephan Ferreira')
check('...and from either side of the comparison',
  attendeeFor(invite.attendees, ['STEPHAN@BREDELLFERREIRA.CO.ZA']).email, 'Stephan@BredellFerreira.co.za')
check('...and around the whitespace mail clients leave behind',
  attendeeFor(invite.attendees, ['  stephan@bredellferreira.co.za ']).name, 'Stephan Ferreira')
/* A meeting sent to a distribution list names nobody in particular. Answering is still better. */
check('an invite addressed to nobody I am is still answerable',
  attendeeFor(invite.attendees, ['stephan@elsewhere.example']).email, 'stephan@elsewhere.example')
check('...but with nothing invented for a name',
  attendeeFor(invite.attendees, ['stephan@elsewhere.example']).name, null)
check('with no address of my own there is nobody to answer as',
  attendeeFor(invite.attendees, []), null)

/* ---------- the reply itself ---------- */

const ics = replyIcs({
  uid: invite.uid,
  sequence: invite.sequence,
  summary: invite.summary,
  organiser: { name: 'Danielle Louwrens', email: 'daniellel@pepla.co.za' },
  me,
  response: 'accepted',
  now: NOW,
  startsAt: '2026-09-29T12:30:00.000Z',
  endsAt: '2026-09-29T13:30:00.000Z',
})
/*
 * UNFOLDED FIRST, WHICH IS WHAT THE ORGANISER'S PARSER SEES.
 *
 * Asserted against the raw lines this check failed on correct output: the attendee line is over
 * 75 octets and is folded, so `mailto:stephan@bredellferreira.co.za` is split across two of them.
 * Reading the file the way the spec says to read it is the only honest way to assert what is in
 * it — and the fold itself is checked separately, further down.
 */
const unfold = (text) => text.split('\r\n').reduce((out, l) => {
  if ((l.startsWith(' ') || l.startsWith('\t')) && out.length) out[out.length - 1] += l.slice(1)
  else out.push(l)
  return out
}, [])
const lines = unfold(ics)

ok('it is a calendar', lines.includes('BEGIN:VCALENDAR'))
ok('...and it is a REPLY, which is what makes it act on the meeting', lines.includes('METHOD:REPLY'))
check('...carrying the same UID, or it matches no meeting at all',
  lines.includes(`UID:${invite.uid}`), true)
ok('...and the same revision', lines.includes('SEQUENCE:3'))
ok('...stamped when the answer was given', lines.includes('DTSTAMP:20260918T060000Z'))
ok('...naming the organiser unchanged',
  lines.includes('ORGANIZER;CN=Danielle Louwrens:mailto:daniellel@pepla.co.za'))

/*
 * ONE ATTENDEE, AND IT IS ME. Echoing the list back is the classic mistake: it reads as this
 * person answering for the whole room, and clients discard it rather than guess.
 */
const attendees = lines.filter((l) => l.startsWith('ATTENDEE'))
check('exactly one attendee is answered for', attendees.length, 1)
ok('...and it is me', /mailto:Stephan@BredellFerreira\.co\.za/i.test(attendees[0]))
ok('...with my answer on it', attendees[0].includes('PARTSTAT=ACCEPTED'))
ok('...and no further answer asked for', attendees[0].includes('RSVP=FALSE'))
check('nobody else is mentioned', ics.includes('johann@pepla.co.za'), false)

/* Every line ends CRLF, including the last: some parsers drop a line with no ending. */
ok('every line ends the way the spec says', ics.endsWith('END:VCALENDAR\r\n'))
check('and no bare newline slips in', /[^\r]\n/.test(ics), false)

for (const [response, partstat] of Object.entries(PARTSTAT)) {
  const one = replyIcs({
    uid: 'u', sequence: null, summary: 'x',
    organiser: { name: null, email: 'o@example.com' },
    me: { name: null, email: 'me@example.com' },
    response, now: NOW,
  })
  ok(`${response} goes out as ${partstat}`, one.includes(`PARTSTAT=${partstat}`))
}
/* Null and nought are different in the parser and the same on the wire, which is what the spec
   means by "absent". */
ok('an invite with no SEQUENCE replies as nought', replyIcs({
  uid: 'u', sequence: null, summary: null,
  organiser: { name: null, email: 'o@example.com' },
  me: { name: null, email: 'me@example.com' },
  response: 'accepted', now: NOW,
}).includes('SEQUENCE:0'))

/*
 * A FLOATING TIME HAS NO INSTANT TO STATE. Writing one anyway would be Raptor telling the
 * organiser a time nobody agreed to; RFC 5546 makes DTSTART optional in a reply for this reason.
 */
const floating = replyIcs({
  uid: 'u', sequence: 0, summary: 'x',
  organiser: { name: null, email: 'o@example.com' },
  me: { name: null, email: 'me@example.com' },
  response: 'accepted', now: NOW, startsAt: null, endsAt: null,
})
check('an unresolvable time is left out rather than invented', /DTSTART/.test(floating), false)

/* ---------- text that would otherwise break the file ---------- */

check('a semicolon is escaped', escapeIcsText('a;b'), 'a\;b')
check('a comma is escaped', escapeIcsText('a,b'), 'a\\,b')
check('a newline becomes the escape, not a real break', escapeIcsText('a\nb'), 'a\\nb')
/*
 * BACKSLASH FIRST. Escaped last, that pass would go on to escape the backslashes the comma and
 * semicolon passes had just added, and one comma in a meeting title reaches the organiser as
 * "\\,". Same trap as unescapeIcsText, from the other direction.
 */
check('a backslash is escaped once, not twice', escapeIcsText('a\\b'), 'a\\\\b')
check('...even beside a comma', escapeIcsText('a\\,b'), 'a\\\\\\,b')

const longSummary = replyIcs({
  uid: 'u', sequence: 0,
  summary: 'Herbeplanning van die hele週 se afsprake met Bredell Ferreira se hele span, asseblief',
  organiser: { name: null, email: 'o@example.com' },
  me: { name: null, email: 'me@example.com' },
  response: 'accepted', now: NOW,
})
/*
 * FOLDED IN OCTETS, NOT CHARACTERS. A fold that counts characters can land inside a multi-byte
 * one; the two halves arrive as broken bytes and the parser gives up on the property.
 */
for (const line of longSummary.split('\r\n')) {
  const octets = new TextEncoder().encode(line).length
  if (octets > 75) failures.push(`a line is ${octets} octets long: ${line.slice(0, 40)}`)
  else pass += 1
}
ok('a folded line continues with a space, as the spec requires', /\r\n [^\r\n]/.test(longSummary))
/* Unfolding it must give the property back exactly — otherwise the fold is the bug. */
ok('...and unfolds back to the whole summary',
  unfold(longSummary).some((l) => l.includes('Bredell Ferreira se hele span')))
/* The multi-byte characters have to survive it, which is the whole reason for counting octets. */
ok('...with its multi-byte characters intact',
  unfold(longSummary).some((l) => l.includes('hele\u9031 se afsprake')))
check('a short line is left alone', foldIcsLine('SUMMARY:short'), 'SUMMARY:short')

check('an instant is written the way ICS writes UTC',
  icsStamp('2026-09-29T12:30:00.000Z'), '20260929T123000Z')

/* ---------- what a person sees ---------- */

check('the subject is the convention every mail client already uses',
  replySubject('Stephan & Johann - Catch-up', 'accepted'), 'Accepted: Stephan & Johann - Catch-up')
check('...and a nameless meeting still has one', replySubject(null, 'declined'), 'Declined: Meeting')
check('the firm’s word for a maybe', RESPONSE_WORD.tentative, 'Tentative')

const note = (response) => replyBody({
  summary: 'Catch-up', response, when: '29 September 2026, 14:30-15:30',
  me: { name: 'Stephan Ferreira', email: 'stephan@bredellferreira.co.za' },
})
ok('the note says who answered', note('declined').includes('Stephan Ferreira'))
ok('...and what they said', note('declined').includes('has declined'))
ok('...and which meeting', note('declined').includes('Catch-up'))
ok('an accept says so', note('accepted').includes('has accepted'))
ok('a maybe says so', note('tentative').includes('has tentatively accepted'))
/*
 * NO INVENTED APOLOGY, ON ANY OF THE THREE. A decline is a decline; Raptor does not speak for
 * somebody. Checked against every response rather than one: asserted on the decline alone, this
 * passed happily with an apology added to the accept branch two lines away.
 */
for (const r of ['accepted', 'tentative', 'declined']) {
  check(`nothing is said on their behalf (${r})`, /sorry|apolog|unfortunately|regret/i.test(note(r)), false)
}

/* The markup a name can carry. An unescaped ampersand is the one that gets forgotten, because
   the angle brackets are what everybody remembers to escape. */
const nasty = replyBody({
  summary: '<script>x</script>', response: 'accepted', when: null,
  me: { name: 'Louw & Seun', email: 'a@b.example' },
})
ok('a tag in the subject cannot break out of the note', nasty.includes('&lt;script&gt;'))
check('...and no live tag survives', /<script>/.test(nasty), false)
ok('...and an ampersand in a name is escaped too', nasty.includes('Louw &amp; Seun'))

/* ---------- when there is nobody to answer ---------- */

ok('a request with an organiser can be answered', canReplyTo(invite))
check('a cancellation cannot', canReplyTo({ ...invite, cancelled: true }), false)
/* A published calendar copy is not a request and nobody is waiting on an answer to it. */
check('a published copy cannot', canReplyTo({ ...invite, method: 'PUBLISH' }), false)
check('somebody else’s reply cannot', canReplyTo({ ...invite, method: 'REPLY' }), false)
check('one with no organiser cannot', canReplyTo({ ...invite, organiser: null }), false)
check('one with no organiser address cannot',
  canReplyTo({ ...invite, organiser: { name: 'X', email: null } }), false)
check('one with no UID cannot', canReplyTo({ ...invite, uid: null }), false)

/* ---------- it reaches the mail server as a calendar part, not an attachment ---------- */

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const send = read('../../api/email/send.ts')
const events = read('../../src/lib/calendarEvents.ts')
const page = read('../../src/pages/mail/MailPage.tsx')

/*
 * icalEvent, NOT an attachment. Attached as a file it arrives as invite.ics sitting at the bottom
 * of an email and the organiser's tracking list still says nobody has answered; carried as
 * icalEvent nodemailer gives it `text/calendar; method=REPLY` inside a multipart/alternative,
 * which is what makes the answer fold into the organiser's own meeting.
 */
ok('the endpoint takes a calendar reply', /calendarReply\?: string/.test(send))
ok('...and sends it as a calendar part', /icalEvent: \{ method: 'REPLY'/.test(send))
ok('...on the message itself', /sendMail\(\{[\s\S]{0,200}\.\.\.ical,/.test(send))
/* The Sent copy must carry it too, or the sender's own mail client shows a different message
   from the one the organiser got. */
ok('...and on the Sent copy', /MailComposer\(\{[\s\S]{0,200}\.\.\.ical,/.test(send))

/*
 * THE MAIL GOES FIRST. An email cannot be unsent, so the note in Raptor is written only once the
 * server has taken it — the other order leaves a card saying "You accepted" for an answer that
 * never left the building.
 */
const replyFn = events.slice(events.indexOf('export async function replyToInvite'))
ok('the reply function exists to read', replyFn.length > 500)
ok('the answer is sent before it is recorded',
  replyFn.indexOf("fetch('/api/email/send'") < replyFn.indexOf('invite_response:'))
ok('...and it replies as the address I was invited as', /attendeeFor\(invite\.attendees, myAddresses\)/.test(replyFn))
ok('...refusing outright where there is no organiser to answer',
  /if \(!invite\.uid \|\| !organiser\)/.test(replyFn))

/* Declining and keeping the meeting in your day is not a state anybody meant to be in. */
const respond = page.slice(page.indexOf('async function respond('), page.indexOf('async function dropEvent'))
ok('the page has a respond handler', respond.length > 300)
ok('a decline takes the meeting off the calendar', /if \(response === 'declined'\)[\s\S]{0,200}dropEvent/.test(respond))
ok('...and an accept puts it on', /acceptInvite\(\{ invite, ownerId: currentUser\.id/.test(respond))
/*
 * BOTH ADDRESSES. Mail arrives at the connected mailbox, which is not always the address somebody
 * signs in with, and the reply has to go out as the one the organiser actually invited.
 */
ok('both of my addresses are offered to the matcher',
  /myAddresses: \[mailbox, currentUser\.email\]/.test(respond))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
An accept leaves the building as an iTIP reply carrying the meeting's own UID and revision, with
one attendee on it and that attendee the address the organiser invited — so the answer lands on
the organiser's meeting rather than as a file at the bottom of an email.`)
