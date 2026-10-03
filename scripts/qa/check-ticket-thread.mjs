/**
 * ONE CONVERSATION ON A TICKET, EACH VOICE NAMED.
 *
 * THE FIRM, showing a design of what a dispute ticket should look like: the internal note, the
 * client's email and the debtor's own words one under the other, each labelled with who said it,
 * under a band that says where the ticket stands and what to do next.
 *
 * IT WAS TWO CARDS. The notes sat inside TicketWork and the correspondence in TicketEmails, so the
 * one question a ticket exists to answer -- what has passed between the three parties, and in what
 * order -- could only be got at by reading two lists and merging them by eye. On the firm's own
 * example that is the debtor at 09:15, the client at 10:02 and a liaison at 11:24: one exchange,
 * three voices, drawn as two unrelated boxes.
 *
 * WHAT THIS FILE GUARDS:
 *
 *   1. THE VOICE IS DERIVED FROM THE ADDRESS AND NEVER GUESSED. `account_emails` carries the OTHER
 *      party's address whichever end they were on, so "client or debtor" is answered by looking --
 *      and where it cannot tell, it says the neutral thing rather than picking a camp. A ticket is
 *      read six months later by somebody deciding whether a client was told.
 *   2. THE ORDER. Newest first, stably, because a ticket is opened to find where it has got to.
 *   3. RAPTOR DOES NOT SIGN ITS OWN ENTRIES WITH WHOEVER WAS AT THE DESK.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-ticket-thread.mjs
 */
import { readFileSync } from 'node:fs'
import {
  VOICE_LABEL, emailVoice, nextAction, noteVoice, ticketThread,
} from '../../src/lib/ticketThread.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

const CLIENT = ['accounts@rindaroo.co.za', 'Nicole@RindaRoo.co.za']
const note = (over = {}) => ({
  id: 'n1', body: 'Reviewed the statement.', authorName: 'Nicole Loder',
  createdAt: '2026-10-03T11:24:00Z', kind: 'note', source: 'manual', ...over,
})
const email = (over = {}) => ({
  id: 'e1', direction: 'in', debtorAddress: 'promise@example.com',
  subject: 'Re: statement', body: 'I made a R20 payment.', attachmentNames: [],
  sentByName: 'Promise Sikelele', occurredAt: '2026-10-03T09:15:00Z', ...over,
})

/* ---------------------------------------------------------------------------------------------
 * WHICH VOICE
 * ------------------------------------------------------------------------------------------- */

check('a note somebody wrote is internal', noteVoice(note()), 'internal')
check('a call note is its own kind of work', noteVoice(note({ kind: 'call' })), 'call')
/*
 * `source` DECIDES BEFORE `kind` DOES, and that order matters: a collector who happens to write
 * like the app still counts as a person, and Raptor's own entries count as Raptor's however filed.
 */
check('Raptor’s own entry is Raptor’s', noteVoice(note({ source: 'system' })), 'system')
check('...even where it is filed as a call',
  noteVoice(note({ source: 'system', kind: 'call' })), 'system')
/* Swordfish wrote it, but a person at Swordfish wrote it. It is not the app talking. */
check('an imported note is still somebody’s', noteVoice(note({ source: 'swordfish' })), 'internal')

check('mail from the debtor is the debtor', emailVoice(email(), CLIENT), 'debtor')
check('mail from the client is the client',
  emailVoice(email({ debtorAddress: 'accounts@rindaroo.co.za' }), CLIENT), 'client')
/* AN ADDRESS IS AN ADDRESS WHATEVER THE CAPITALS. A client who signs their mail in title case is
   the same client, and a thread that files half their messages as the debtor's is unreadable. */
check('...whatever the capitals',
  emailVoice(email({ debtorAddress: 'nicole@rindaroo.co.za' }), CLIENT), 'client')
check('...and whatever the spacing',
  emailVoice(email({ debtorAddress: ' accounts@rindaroo.co.za ' }), CLIENT), 'client')
check('mail TO the client is the client',
  emailVoice(email({ direction: 'out', debtorAddress: 'accounts@rindaroo.co.za' }), CLIENT), 'client')
check('mail to the debtor is the debtor',
  emailVoice(email({ direction: 'out' }), CLIENT), 'debtor')
/*
 * AND THE ONE CASE IT HONESTLY CANNOT TELL: an outbound message where NO client address is known at
 * all. "Not the client" means nothing when nothing is the client, and calling a liaison's email to
 * a client the debtor's would be a confident wrong label on a ticket read six months later to
 * decide whether the client was told.
 */
check('...and an outbound message with no client known at all is only "sent"',
  emailVoice(email({ direction: 'out', debtorAddress: 'someone@elsewhere.com' }), []), 'sent')
/* BUT WHERE THE CLIENT IS KNOWN, "not the client" is an answer: everything else on an account's
   correspondence is the debtor's side, which is that table's own contract. */
check('...while with the client known, anything else outbound is the debtor\u2019s side',
  emailVoice(email({ direction: 'out', debtorAddress: 'someone@elsewhere.com' }), CLIENT), 'debtor')
/* INBOUND FROM AN UNKNOWN ADDRESS IS STILL THE DEBTOR'S SIDE: it arrived on the account's own
   correspondence, which is what that table is. */
check('an inbound message from an unknown address is still the debtor’s side',
  emailVoice(email({ debtorAddress: 'someone@elsewhere.com' }), []), 'debtor')

/* EVERY VOICE HAS WORDS. A chip rendering `undefined` is how a list stops being readable. */
for (const v of ['internal', 'call', 'system', 'debtor', 'client', 'sent']) {
  ok(`"${v}" has a label`, typeof VOICE_LABEL[v] === 'string' && VOICE_LABEL[v].length > 0)
}

/* ---------------------------------------------------------------------------------------------
 * THE THREAD ITSELF
 * ------------------------------------------------------------------------------------------- */

const thread = ticketThread({
  notes: [note()],
  emails: [
    email(),
    email({ id: 'e2', direction: 'out', debtorAddress: 'accounts@rindaroo.co.za',
      subject: 'Payment query', body: 'Please advise.', sentByName: 'Rinda Roo Company',
      occurredAt: '2026-10-03T10:02:00Z' }),
  ],
  clientAddresses: CLIENT,
})
check('everything lands in one list', thread.length, 3)
/* NEWEST FIRST, because a ticket is opened to find out where it has got to -- and on a ticket three
   weeks old the answer at the bottom of a chronological list is a scroll. */
check('...newest first', thread.map((e) => e.voice), ['internal', 'client', 'debtor'])
check('...and the firm’s own example reads in that order',
  thread.map((e) => e.who), ['Nicole Loder', 'Rinda Roo Company', 'Promise Sikelele'])

/* KEYS ARE UNIQUE ACROSS BOTH SOURCES, so a note id can never collide with an email id. */
check('every entry has its own key', new Set(thread.map((e) => e.key)).size, 3)
ok('...and the two sources are told apart in it',
  thread.some((e) => e.key.startsWith('note:')) && thread.some((e) => e.key.startsWith('email:')))

/* ONLY A MESSAGE CAN BE FORWARDED. An internal note was written for the next collector, which is
   exactly what the firm's own objection to putting notes in client reporting was about. */
ok('an email carries its id so it can be forwarded',
  thread.filter((e) => e.emailId).length === 2)
ok('...and a note does not', thread.find((e) => e.voice === 'internal')?.emailId === undefined)

/*
 * RAPTOR DOES NOT SIGN ITS OWN ENTRIES WITH WHOEVER WAS AT THE DESK. `authorName` is carried on a
 * system note so the account's timeline can say who was working; on a ticket thread it would read
 * as that person having written the sentence, which they did not.
 */
const system = ticketThread({ notes: [note({ source: 'system', authorName: 'Nicole Loder' })], emails: [] })
check('an automatic entry is signed Raptor', system[0].who, 'Raptor')
/* AND A NOTE WITH NOBODY'S NAME ON IT STILL ANSWERS "who". */
check('a note with no author still says somebody',
  ticketThread({ notes: [note({ authorName: null })], emails: [] })[0].who, 'Somebody at the firm')
/* AN EMAIL WITH NO NAME FALLS BACK TO THE ADDRESS, which is still an answer; "Unknown" is not. */
check('an email with no name falls back to the address',
  ticketThread({ notes: [], emails: [email({ sentByName: null })] })[0].who, 'promise@example.com')

/* TIES ARE BROKEN STABLY. Two entries on the same second is rare, and a list that reshuffles
   itself between renders is the kind of thing nobody reports and everybody distrusts. */
const tied = ticketThread({
  notes: [note({ id: 'b' }), note({ id: 'a' })], emails: [],
}).map((e) => e.key)
check('a tie is broken stably', tied, ['note:a', 'note:b'])
check('...the same way every time',
  ticketThread({ notes: [note({ id: 'a' }), note({ id: 'b' })], emails: [] }).map((e) => e.key), tied)

check('an empty ticket is an empty thread', ticketThread({ notes: [], emails: [] }), [])

/* ---------------------------------------------------------------------------------------------
 * AND WHAT TO DO NEXT
 * ------------------------------------------------------------------------------------------- */

ok('a ticket with the client says to chase them',
  /chase/i.test(nextAction({ stage: 'client', status: 'open' }) ?? ''))
ok('one with the liaison says to answer it or put it to the client',
  /client/i.test(nextAction({ stage: 'liaison', status: 'open' }) ?? ''))
ok('one with the agent says to answer it or pass it on',
  /liaison/i.test(nextAction({ stage: 'agent', status: 'open' }) ?? ''))
/*
 * A CLOSED TICKET HAS NO NEXT ACTION, and inventing one would put work in front of somebody that
 * the firm has already decided is finished.
 */
check('a closed ticket is given no next action',
  nextAction({ stage: 'client', status: 'closed' }), null)
/* AND A STAGE NOBODY HAS WORDS FOR SAYS NOTHING rather than falling through to somebody else's
   instruction -- the fault the escalation kinds' own record was written to end. */
check('an unknown stage says nothing', nextAction({ stage: 'nowhere', status: 'open' }), null)

/* ---------------------------------------------------------------------------------------------
 * THE PAGE
 * ------------------------------------------------------------------------------------------- */

const page = read('src/pages/queries/QueryDetail.tsx')
ok('the ticket page draws one thread', /<TicketThread/.test(page))
/* THE CLIENT'S OWN PEOPLE GO IN, because only this page knows them -- and without them every
   client email on the ticket would read as the debtor's. */
ok('...and hands it the client’s addresses', /clientAddresses: \[/.test(page)
  && /data\.clientPeople\.map\(\(person\) => person\.email\)/.test(page))
/* THE TWO CARDS IT REPLACES ARE GONE, not left drawing the same entries a second time. */
ok('...and the old correspondence card is not drawn as well', !/<TicketEmails/.test(page))
const work = read('src/components/queries/TicketWork.tsx')
ok('...and the work panel no longer lists the notes', !/notes\.map\(/.test(work))

/* THE BAND, AND WHAT IT CARRIES. Four questions somebody opening a ticket asks, in one place. */
ok('the band says where it stands', /Where it stands<\/dt>/.test(page))
ok('...who has it', /With<\/dt>/.test(page))
ok('...when it comes back', /Follow up<\/dt>/.test(page))
ok('...and what to do next', /nextAction\(\{ stage: q\.stage, status: q\.status \}\)/.test(page))
/*
 * ON AN ACCOUNT TICKET ONLY. A batch ticket is about a client's spreadsheet -- no debtor, no
 * account number, nothing to work -- and a band of blanks reads as a screen that failed to load.
 */
ok('...and none of it is drawn on a batch ticket',
  /\{q\.accountId && \(\s*\n\s*<div className="rounded-2xl bg-navy-950/.test(page))

/*
 * AND NO INVENTED TICKET NUMBER. The firm's design shows "DSP-00428" and Raptor has no such
 * column; a ticket is identified by a UUID, which is not something anybody reads out on a
 * telephone. Printing eight characters of one would look like a reference while being unusable as
 * one, so the band says what the ticket IS instead.
 */
ok('the band does not print a fragment of the row id as a reference',
  !/q\.id\.slice\(/.test(page))

console.log(`\ncheck-ticket-thread: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
