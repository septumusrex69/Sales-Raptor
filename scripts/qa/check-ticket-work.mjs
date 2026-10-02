/**
 * THE TICKET AS A PLACE YOU WORK.
 *
 * THE FIRM, looking at a request that had reached the liaison: "there needs to be options. There
 * needs to be like a mail, where we will be able to request something from the client... it should
 * already be able to draft an email for the client. There should also be an option to call the
 * client just from the ticket. Make notes on the ticket, and the notes should also live in the
 * client section and on the ticket... So now we're working on the ticket, making the ticket better,
 * workable, flexible."
 *
 * THE PLUMBING WAS ALREADY BUILT AND THE SCREEN USED NONE OF IT, which is what most of this file
 * is really holding. `addNote` has taken a `queryId` since queries existed and
 * `account_emails.query_id` has filed mail against a ticket since the Forward button was written —
 * so the firm's "three places" is what the tables already do. What was missing was anywhere to make
 * those writes from. The assertions below are mostly that every action goes through the ACCOUNT'S
 * own library rather than a second write path: two paths to one record is how a dispute ends up
 * with a history the account does not have.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-ticket-work.mjs
 */
import { readFileSync } from 'node:fs'
import { ticketBody, ticketSubject } from '../../src/lib/ticketEmail.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
/* Comments stripped: several assertions below are about what is ABSENT, and each of these files
   explains at length what it does not do. The trap this codebase has walked into three times. */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ')

const page = code('src/pages/queries/QueryDetail.tsx')
const panel = code('src/components/queries/TicketWork.tsx')
const letter = code('src/lib/ticketEmail.ts')
const workspace = code('src/lib/accountWorkspace.ts')

/* ---------------------------------------------------------------------------------------------
 * THE EMAIL THE TICKET ALREADY KNOWS HOW TO WRITE
 * ------------------------------------------------------------------------------------------- */

const REQUEST = {
  kind: 'request',
  requestFor: 'Proof of communication',
  description: 'Debtor says they were never written to before handover.',
  debtorName: 'Ofentse Thema',
  accountNumber: 'RRC00008',
  contact: 'Rinda',
  from: 'Nicole Loder',
}

check('the subject says what is wanted, who it is about and the reference',
  ticketSubject(REQUEST), 'Proof of communication — Ofentse Thema — RRC00008')
/*
 * WHAT IS WANTED COMES FIRST. A liaison's inbox is full of mail about accounts, so the message has
 * to say what it is FOR before it says which debtor, which is the order somebody triages in.
 */
ok('...with what is wanted first', ticketSubject(REQUEST).startsWith('Proof of communication'))
check('a dispute says so instead',
  ticketSubject({ ...REQUEST, kind: 'dispute', requestFor: null }),
  'Account disputed — Ofentse Thema — RRC00008')

/*
 * NEITHER PIECE IS ASSUMED. 19 668 of the live book's accounts are missing fields somewhere; a
 * subject reading "Information needed —  — " is the kind of thing that goes out once and is
 * remembered for a year.
 */
check('a ticket with no debtor and no reference still has a subject',
  ticketSubject({ kind: 'request', requestFor: null, description: 'x' }), 'Information needed')
ok('...with no dangling dashes',
  !/—\s*$/.test(ticketSubject({ kind: 'request', requestFor: null, description: 'x' })))

const body = ticketBody(REQUEST)
ok('the body addresses the client contact by name', body.startsWith('Dear Rinda'))
ok('...falling back to a greeting where nobody is named',
  ticketBody({ ...REQUEST, contact: null }).startsWith('Good day'))
ok('...and asks for the thing the ticket asks for', /proof of communication/i.test(body))
ok('...naming the debtor and the reference', body.includes('Ofentse Thema (RRC00008)'))
/*
 * THE CLERK'S OWN WORDS, QUOTED AND MARKED AS QUOTED. They wrote it with the debtor on the
 * telephone; a liaison's summary of a summary is how the client answers a question nobody asked.
 */
ok('...quoting what was actually recorded', body.includes(REQUEST.description))
ok('...marked as a quotation rather than the firm s own words',
  /What was recorded on the account:/.test(body))
ok('...and asks for a date back', /when we can expect this/.test(body))
ok('...signed by whoever is sending it', body.trimEnd().endsWith('Nicole Loder'))

/*
 * NO MERGE FIELDS, AND THIS IS THE ASSERTION MOST WORTH HAVING. Every template in the library is a
 * notice to a DEBTOR, written under the Act and priced under Annexure B. This is a colleague at a
 * credit provider being asked for a document. A brace reaching a client's inbox would mean the two
 * vocabularies had been crossed, and the next thing crossed would go to a debtor.
 */
ok('nothing in it is a merge field', !/\{\{|\}\}/.test(body + ticketSubject(REQUEST)))
ok('...and it is not drawn from the template library', !/fetchLibrary|renderTemplate/.test(letter))
/*
 * AND RAPTOR'S OWN CASE NUMBER IS NOT IN IT. It means nothing at the client's end — CLAUDE.md on
 * the three numbers — and quoting it would invite a liaison to ask the client about a reference
 * only the firm can resolve.
 */
ok('...and quotes no reference the client cannot match', !/case_?number|caseNumber/i.test(letter))

/* PURE: no clock, no database, so the words can be held without a browser. */
ok('the letter is pure', !/supabase|fetch\(|new Date\(\)/.test(letter))

/* ---------------------------------------------------------------------------------------------
 * EVERY ACTION GOES THROUGH THE ACCOUNT'S OWN LIBRARY
 * ------------------------------------------------------------------------------------------- */

ok('the ticket offers the three things a person does with one',
  /Email the client/.test(panel) && /Log a call/.test(panel) && /Add a note/.test(panel))

/*
 * THE ONE FIELD THAT PUTS IT IN BOTH PLACES AT ONCE. The firm's "it should live in the client
 * section and on the ticket" is `queryId` on an ordinary account note — not a second table, and
 * not a copy. A note written here IS an account note.
 */
ok('a note written here is an account note carrying the ticket',
  /addNote\(\{[\s\S]{0,400}queryId: q\.id/.test(page))
ok('...and so is a call', (page.match(/addNote\(\{[\s\S]{0,400}queryId: q\.id/g) ?? []).length >= 2)
ok('...read back off the ticket', /fetchQueryNotes/.test(page) && /fetchQueryNotes/.test(workspace))
/* OLDEST FIRST. A ticket is a short exchange read in order — what was asked, what was answered. */
ok('...oldest first, like a conversation',
  /query_id.{0,60}order\('created_at', \{ ascending: true \}\)/s.test(workspace))

/*
 * WHO WAS SPOKEN TO IS PART OF THE SENTENCE, not a column of its own. Six months later the question
 * is "who at the client said that", and the note has to answer it while being read on the ACCOUNT'S
 * timeline, where there is no ticket around it to explain.
 */
ok('a logged call records who was spoken to', /`Called \$\{who\}\. \$\{said\}`/.test(page))
ok('...and still reads as a call when nobody was named', /Called the client\. \$\{said\}/.test(page))

/*
 * AND A CALL TO THE CLIENT CHARGES THE DEBTOR NOTHING. Item 2 is a telephone call and the account's
 * own Call button raises it — but that is a call to the DEBTOR. This is the firm chasing its own
 * answer on a dispute that has already charged item 3. Held as an ABSENCE because adding the fee
 * here would read like consistency.
 */
ok('logging a call raises no fee', !/chargeItem|chargeAction/.test(panel))
ok('...and the panel says so where the decision is made',
  /raises no fee on the debtor/.test(panel))

/*
 * ONE COMPOSE BOX FOR BOTH A FORWARD AND A FRESH MESSAGE, because they produce the same record:
 * charged item 1(a), filed on the ticket and on the account. Two modals would be two `onSent`
 * handlers, and the one nobody was watching would be the one that forgot the ticket.
 */
ok('a fresh message and a forward share one compose box',
  /\(forwarding \|\| writing\) && q\.accountId/.test(page))
ok('...and one handler files both against the ticket',
  /recordSentEmail\(\{[\s\S]{0,400}queryId: q\.id/.test(page))
/* AND THE THREAD REFRESHES, or a liaison presses Send and the ticket looks untouched. */
ok('...and the thread is re-read after a send',
  /recordSentEmail[\s\S]{0,900}fetchQueryNotes\(q\.id\)/.test(page))

/* ---------------------------------------------------------------------------------------------
 * AND NOT ON A TICKET THAT HAS NO ACCOUNT
 * ------------------------------------------------------------------------------------------- */

/*
 * A BATCH TICKET IS ABOUT A CLIENT'S OWN SPREADSHEET. There is no account to file a note against —
 * `addNote` is per account and a sheet is not one — so the panel is ABSENT rather than disabled: a
 * row of controls that all refuse reads as a fault.
 */
ok('the work panel is only on a ticket about an account',
  /\{q\.accountId && \(\s*<TicketWork/.test(page))
/*
 * AND THE BATCH KEEPS ITS FULL WIDTH. Those carry tables of every row a client's sheet could not
 * open, running to hundreds, and two thirds of a screen is where seven columns stop fitting.
 */
ok('the two-column shape is only for an account ticket',
  /q\.accountId \? 'grid gap-4 items-start lg:grid-cols-3' : 'contents'/.test(page))
/* THE FIGURES ARE DRAWN ONCE. In the rail on an account ticket, in the card on a batch — both and
   they would be the same four facts twice on one screen. */
ok('...and the facts are not drawn twice', /\{!q\.accountId && \(\s*<dl/.test(page))

console.log(`\ncheck-ticket-work: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
