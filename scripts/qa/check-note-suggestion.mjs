/**
 * The note the clerk finds already written for them.
 *
 * THE FIRM: "you can automatically fill the note for the clerk ... the script would say, for
 * example, there is no ID number, just note, perhaps do a trace or confirm the ID number if
 * possible. But fill it automatically and then just accept, and they can remove it if they need
 * to."
 *
 * TWO THINGS ARE WORTH CHECKING AND NEITHER IS THE WORDING.
 *
 * FIRST, THAT IT IS AN INSTRUCTION. noteForAccount prints the typed note and then every problem
 * underneath it -- the typed part is what to do, the list under it is why. A suggestion that
 * repeated the problem would print the same sentence twice and still leave the collector with no
 * next action. So every line here is asserted to say what to DO and not to quote the fault.
 *
 * SECOND, THAT IT CAN BE CLEARED. A box that refills itself cannot be emptied, and the note goes
 * onto the account under the name of whoever pressed Accept -- so a suggestion nobody could
 * remove would be words put in somebody's mouth.
 */
import { readFileSync } from 'node:fs'
import { suggestedNote } from '../../src/lib/noteSuggestion.ts'
import { noteForAccount } from '../../src/lib/handoverDecision.ts'
import { planHandover } from '../../src/lib/handoverImport.ts'

let pass = 0
const failures = []
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${label}\n    expected ${e}\n    got      ${a}`)
}
const ok = (label, actual) => check(label, actual, true)

const p = (key, message) => ({ key, message })

/* ---------- it says what to do ---------- */

const id = suggestedNote([p('id_number', '"0823456789" is not an ID number. Left empty rather than guessed at.')])
ok('a missing ID number suggests confirming or tracing it',
  /confirm the id number/i.test(id) && /trace/i.test(id))
/*
 * AND NOT A RESTATEMENT. The problem is printed directly above the box on screen, and
 * noteForAccount prints it again underneath whatever is typed -- so a suggestion quoting it puts
 * the same sentence on the account twice and still names no next action.
 */
ok('...without quoting the problem back', !/is not an ID number/.test(id))
ok('...or the value itself', !/0823456789/.test(id))

/*
 * THIRTEEN DIGITS THAT FAIL THE CHECK DIGIT IS A DIFFERENT JOB. It is almost always two digits
 * swapped, which the debtor settles in one question -- a trace would be the long way round for a
 * typo, and sending somebody to a bureau for it costs the account a fee.
 */
const transposed = suggestedNote([p('id_number', '"8503125009098" is thirteen digits but not a valid ID number — check for a transposed pair.')])
ok('a transposed ID says to read it back rather than trace', /read the id number back/i.test(transposed))
ok('...and does not send anybody to a bureau', !/trace/i.test(transposed))
ok('...which is a different instruction from a missing one', transposed !== id)

const email = suggestedNote([p('email_1', 'No email address — a section 129 is sent by email.')])
ok('a missing email says to ask for one', /ask for an email address/i.test(email))
/* WHY IT MATTERS, because "ask for an email" is a chore and "this cannot go to legal" is a
   reason. A collector who knows the consequence asks properly. */
ok('...and says what it blocks', /section 129|legal/i.test(email))

/* A duplicate is a question for the CLIENT, and the obvious thing is the wrong thing: ringing a
   debtor about a debt they already paid is how a complaint starts. */
const dup = suggestedNote([p('client_reference', 'Possible duplicate of BRF00003, already on this client’s book.')])
ok('a possible duplicate is put to the client first', /check with the client/i.test(dup))
ok('...before the debtor is contacted', /before contacting the debtor/i.test(dup))

/* No key at all is the "nobody can be contacted" problem, which is the most urgent of the lot. */
const noContact = suggestedNote([p(null, 'No telephone number and no email address — nobody can be contacted.')])
ok('unreachable says to trace before anything else', /trace/i.test(noContact) && /before anything else/i.test(noContact))

/* ---------- what it does NOT say ---------- */

/*
 * NOTHING RATHER THAN A PLEASANTRY. A row whose only problem has no action worth naming gets an
 * empty box: "please note the above" is a line every collector learns to skip, and it drags the
 * real ones down with it.
 */
check('a problem with nothing to do about it suggests nothing',
  suggestedNote([p('capital', 'The handover amount is nought or less.')]), '')
check('no problems at all suggests nothing', suggestedNote([]), '')
check('an unknown column suggests nothing', suggestedNote([p('favourite_colour', 'x')]), '')

/* ---------- several problems ---------- */

const many = suggestedNote([
  p('id_number', 'No ID number.'),
  p('email_1', 'No email address.'),
])
check('two problems give two lines', many.split('\n').length, 2)
ok('...bulleted, so the second is not read as the tail of the first',
  many.split('\n').every((l) => l.startsWith('• ')))
/* One stands alone: a single bulleted line reads as a list somebody forgot to finish. */
ok('one problem is not bulleted', !id.startsWith('•'))

/*
 * FOUR MISSING TELEPHONE COLUMNS ARE ONE INSTRUCTION. Repeated verbatim they would be four
 * bullets saying the same thing, which is how a note stops being read.
 */
const phones = suggestedNote([
  p('cell_1', 'x'), p('cell_2', 'y'), p('home_phone', 'z'), p('work_phone', 'w'),
])
check('every missing number is one instruction', phones.split('\n').length, 1)
ok('...about getting a working number', /working number/i.test(phones))

/* ---------- it reaches the account as the instruction ---------- */

/*
 * THE WHOLE POINT OF THE SHAPE. noteForAccount takes the typed note as the head and the problems
 * as the evidence under it -- so a suggestion accepted unchanged has to arrive as the head, not
 * as another bullet in the list.
 */
const onAccount = noteForAccount({
  note: id,
  planned: { problems: [{ message: '"0823456789" is not an ID number.' }] },
})
ok('the suggestion leads the note on the account', onAccount.startsWith(id))
ok('...with the problem underneath it as evidence', /• "0823456789" is not an ID number\./.test(onAccount))
/* And the generic heading is gone, which is what it replaced. */
ok('...instead of the heading it replaces', !/Accepted on import with the following/.test(onAccount))
/* Nothing typed still falls back to that heading, so a row somebody cleared is not left bare. */
ok('a cleared box still records what was overridden',
  /Accepted on import with the following/.test(noteForAccount({
    note: '', planned: { problems: [{ message: 'x' }] },
  })))

/* ---------- against the real planner ---------- */

/*
 * THE FIXTURES ABOVE ARE HAND-WRITTEN, which is how a suggester ends up keyed on problems nobody
 * raises. So a real sheet is planned and its real problems are fed in: if a key is renamed or a
 * message reworded on that side, this fails here rather than silently suggesting nothing.
 */
const plan = planHandover({
  rows: [
    ['Your reference', 'Handover amount', 'Date of default', 'Person or business',
      'Surname, or the business name', 'ID number', 'Cell number 1', 'Email address'],
    ['BF-201', '4200', '18/03/2026', 'Person', 'Maree', '0823456789', '082 123 4567', ''],
  ],
  today: '2026-09-22',
})
const real = plan.rows[0]?.problems ?? []
ok('the real planner still raises problems on that row', real.length > 0)
const fromReal = suggestedNote(real)
ok('...and they suggest something', fromReal !== '')
ok('...about the ID number', /id number/i.test(fromReal))
ok('...and about the email', /email address/i.test(fromReal))

/* ---------- the box can be emptied ---------- */

const card = readFileSync('src/components/settings/HandoverImportCard.tsx', 'utf8')
/*
 * AN OPENING VALUE, NOT A CONTROLLED DEFAULT. Written as `value={note || suggested}` the box
 * could not be cleared at all -- emptying it would put the suggestion straight back, and the note
 * goes onto the account under the name of whoever pressed Accept.
 */
ok('the suggestion is only the box’s starting value',
  /useState\(\(\) => row\.note \?\? suggestedNote\(problems\)\)/.test(card))
ok('...and never re-applied while rendering', !/value=\{note \|\|/.test(card))
/* A note already saved wins: it is what a person decided, and a suggestion is not. */
ok('...and a saved note beats it', /row\.note \?\? suggestedNote/.test(card))
/* Labelled while it is still ours, so it is not mistaken for somebody's own words -- and the
   label goes the moment they change a character, because then it IS theirs. */
ok('it says it is a suggestion', /Suggested/.test(card))
ok('...only while untouched', /note === suggestedNote\(problems\) && note !== ''/.test(card))

if (failures.length > 0) {
  console.log(`${pass} passed, ${failures.length} failed\n`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
The note box opens with the next action already in it -- confirm the ID or trace for it, ask for
an email because a section 129 needs one, put a possible duplicate to the client before ringing
the debtor. An instruction, never a restatement: the problems are already printed above the box
and again underneath whatever is typed. It is a starting value, so it can be edited or emptied,
and it says it is a suggestion until somebody makes it theirs.`)
