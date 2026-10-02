/**
 * A NEXT OF KIN CAN BE ADDED BY HAND.
 *
 * THE FIRM: "on the data details, if you say add a number, how do you add an additional number?"
 * -- and then, approving the fix: "you can open the other things, adding the next of kin by hand
 * or adding additional debtor details."
 *
 * IT HALF EXISTED, WHICH IS WHY IT WAS HARD TO SEE. ContactForm sits behind "+ Add" on Debtor
 * details, so a number could always be added. But the person-name and role fields were rendered
 * ONLY when `forCompany` was true, so on a person's account the form offered a kind, a value and a
 * free-text "whose is it?" caption -- and a caption is not a column.
 *
 * SO A NEXT OF KIN COULD NOT BE ADDED BY HAND AT ALL. The only way one ever reached an account was
 * by promoting a linked person off a trace, and a trace is not always there: a debtor who gives
 * you their sister's number on the telephone had nowhere to go.
 *
 * AND THE COLUMNS ARE THE POINT. The account screen groups the people it shows on `person_name`
 * -- the same fault promoteTraceItem was fixed for, where four linked people were saved with the
 * NAME in the value and the number in the caption, so the contact list held four names nobody
 * could dial and the panel could not see them at all.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-contact-by-hand.mjs
 */
import { readFileSync } from 'node:fs'

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

const panels = code('src/pages/accounts/AccountWorkspacePanels.tsx')
const promote = code('src/lib/traceStoreData.ts')

/* ---------------------------------------------------------------------------------------------
 * WHOSE IT IS GOES IN ITS OWN COLUMNS, ON BOTH KINDS OF ACCOUNT
 * ------------------------------------------------------------------------------------------- */

/*
 * THE ASSERTION THIS FILE IS FOR, and it is the absence of a condition. `personName: forCompany ?
 * person : null` is one short expression that reads as perfectly sensible and silently throws away
 * every name typed on a person's account.
 */
ok('a name typed by hand is saved whatever kind of account it is',
  /personName: person\.trim\(\) \|\| null/.test(panels))
ok('...and so is what they are to the debtor',
  /personRole: role\.trim\(\) \|\| null/.test(panels))
ok('...and neither is thrown away on a person',
  !/personName: forCompany \?/.test(panels) && !/personRole: forCompany \?/.test(panels))

/* AND THE FIELDS ARE DRAWN, or the columns above have nothing to carry. */
ok('the form asks whose it is on a person', /blank = the debtor/.test(panels))
ok('...and still asks who to ask for on a company', /blank = the company/.test(panels))
ok('...and what they are to the debtor', /sister, neighbour, employer/.test(panels))

/*
 * BLANK IS THE DEBTOR, which is the ordinary case and has to stay the quickest. A collector adding
 * a second mobile for the debtor types the number and presses Save; a required name would make the
 * common path the slow one.
 */
ok('the name is optional', /person\.trim\(\) \|\| null/.test(panels))
/* AND THE ROLE ONLY APPEARS ONCE THERE IS SOMEBODY TO DESCRIBE. A role with no name is a caption
   attached to nobody -- a field asking a question that cannot be answered. */
ok('what they are is asked only once somebody is named', /\{person\.trim\(\) && \(/.test(panels))

/*
 * THE LABEL KEEPS ITS OWN JOB ON A PERSON and is not quietly repurposed. "The one he answers" is a
 * fact about the NUMBER; whose it is, is a fact about a PERSON. Collapsing the two is how the
 * caption came to be doing both badly.
 */
ok('the label still describes the number, not the person', /label: forCompany \? null : label/.test(panels))

/* ---------------------------------------------------------------------------------------------
 * AND IT IS THE SAME SHAPE A TRACE WRITES
 * ------------------------------------------------------------------------------------------- */

/*
 * ONE KIND OF ROW, HOWEVER IT ARRIVED. A next of kin added by hand and one saved off a trace have
 * to be the same thing, or the account screen shows two lists of people that behave differently.
 * Held by asserting both paths write the same two columns.
 */
ok('promoting a linked person writes the same columns',
  /personName:/.test(promote) && /personRole:/.test(promote))

console.log(`\ncheck-contact-by-hand: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
