/**
 * SAVING OFF A TRACE LANDS VERIFIED, CARRIES THE RELATIONSHIP, AND REACHES THE TIMELINE.
 *
 * THE FIRM, three complaints about one press:
 *   "if you save this person and their number, it's automatically verified... it goes into a
 *    verified state unless you remove it from a verified state."
 *   "you should be able to make a note -- what is the relationship to the case."
 *   "it should also go to the notes activity timeline -- this person was added to the trace and
 *    this is the situation."
 *
 * ALL THREE WERE REAL. promoteTraceItem called addContact, which did not even ACCEPT a verified
 * flag, so everything landed unverified and somebody went back to the account to tick it by hand.
 * The only relationship a promoted person carried was the BUREAU'S -- linkedHow, which reads how
 * two records touch, not why you would ring her. And nothing wrote a timeline note at all: the
 * sole record was a row quietly appearing in the contact list.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-trace-saved.mjs
 */
import { readFileSync } from 'node:fs'
import { promotedNote } from '../../src/lib/traceStore.ts'

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

const data = code('src/lib/traceStoreData.ts')
const rules = code('src/lib/traceStore.ts')
const workspace = code('src/lib/accountWorkspace.ts')
const modal = code('src/pages/accounts/TraceWorkspaceModal.tsx')

/* ---------------------------------------------------------------------------------------------
 * SAVED IS CONFIRMED
 * ------------------------------------------------------------------------------------------- */

ok('a contact can be born verified', /verified\?: boolean/.test(workspace))
/* A DATE, NOT A FLAG. "Nobody has confirmed it" and "confirmed on this day" are the two states and
   there is no third, which is why the column is a timestamp. */
ok('...and it is written as a date', /verified_at: input\.verified \? new Date\(\)\.toISOString\(\) : null/.test(workspace))
ok('a finding saved off a trace lands verified', /verified: true,/.test(data))
/*
 * BUT THE DEFAULT IS NOT TRUE. Saving a finding off a trace is a decision somebody made about a
 * specific row; typing a number into the contact form is a different act, and a default here would
 * quietly mark every hand-typed guess as confirmed.
 */
ok('...and nothing else is verified by default', !/verified: input\.verified \?\? true/.test(workspace))
/*
 * AND NOTHING KNOWN-BAD CAN REACH IT. canPromote refuses a finding that is not theirs, one they
 * have moved on from, and a linked person who disowns the connection -- which is what stops this
 * putting a dead detail on the contact list WEARING A TICK. Asserted from the other file because
 * that is where the guarantee lives; see check-trace-outcomes for the rule itself.
 */
ok('the save still goes through canPromote', /canPromote/.test(code('src/lib/traceStore.ts')))

/* ---------------------------------------------------------------------------------------------
 * AND THE TIMELINE SAYS SO
 * ------------------------------------------------------------------------------------------- */

/*
 * THE NOTE IS WRITTEN, NOT MERELY PRESENT IN THE FILE. Asserted as the first statement of the try
 * rather than as "addNote appears somewhere": written loosely this passed with the call disabled
 * by `if (false)` in front of it. Found by breaking it.
 */
ok('promoting writes a note on the account', /try \{\s*\n\s*await addNote\(\{/.test(data))
/*
 * LAST, AND IT CANNOT UNDO THE SAVE. The contact is on the account and the finding is marked
 * promoted either way; a note that would not write must not take those with it. Same swallow as
 * the main comment on a call and the bell on a ticket.
 */
ok('...and a note that will not write never undoes it',
  /await addNote\(\{[\s\S]{0,500}\} catch \(e\) \{/.test(data))

/* THE SENTENCE ITSELF. The person first where there is one -- "Nomsa Radebe (sister) — 0821110000
   — added from the trace" is a sentence; "a person and their number added from the trace" is a
   shrug. */
check('a person reads as a person',
  promotedNote({ what: 'a person and their number', value: '0821110000', personName: 'Nomsa Radebe', personRole: 'Next of kin' }),
  'Nomsa Radebe (next of kin) — 0821110000 — added from the trace.')
check('...and a plain number reads as what it will be',
  promotedNote({ what: 'a work number', value: '0125464431' }),
  'a work number added from the trace: 0125464431.')
/*
 * IT NAMES THE SOURCE, which is the point of writing it at all: "from the trace" separates a
 * number the bureau gave us from one a debtor read out on the telephone. Those are not equally
 * good and the history is where that is settled.
 */
ok('every note says where it came from',
  /from the trace/.test(promotedNote({ what: 'a mobile number', value: '0821110000' })))
/* AND THE COLLECTOR'S OWN WORDS FOLLOW IT, where they gave any. */
check('the relationship is carried into the history',
  promotedNote({
    what: 'a person and their number', value: '0821110000', personName: 'Nomsa Radebe',
    personRole: 'Next of kin', relationship: 'His sister. He stays there at weekends.',
  }),
  'Nomsa Radebe (next of kin) — 0821110000 — added from the trace. His sister. He stays there at weekends.')
/* AND NOTHING IS APPENDED WHERE NOTHING WAS SAID -- a trailing space and a full stop on their own
   is how a note starts looking like it failed to load. */
ok('...and nothing dangles where none was given',
  !/\.\s+$/.test(promotedNote({ what: 'a mobile number', value: '0821110000', relationship: '  ' })))

/* ---------------------------------------------------------------------------------------------
 * AND IT IS ASKED FOR, WHERE IT CAN BE ANSWERED
 * ------------------------------------------------------------------------------------------- */

ok('saving a person asks what they are to the case', /What are they to the case\?/.test(modal))
/*
 * ONLY ON A PERSON. "What is this to the case" is not a question about a work landline off the
 * debtor's own profile; asked there it is a field nobody can answer, which is how a field comes to
 * be ignored everywhere.
 */
ok('...and only on a person', /if \(category\.id === 'people'\) \{/.test(modal))
/*
 * OPTIONAL, AND SAVE IS THE DEFAULT PRESS. A collector who already knows the row is their sister
 * should not be made to type it; a box that refused would turn a one-press save into an argument.
 */
ok('...and it does not refuse an empty one', !/disabled=\{!relationship/.test(modal))
ok('...and the sentence reaches the writer', /void promote\(row, asNextOfKin, relationship\)/.test(modal))

console.log(`\ncheck-trace-saved: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
