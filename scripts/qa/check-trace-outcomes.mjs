/**
 * EVERY LIST ASKS ITS OWN QUESTION.
 *
 * THE FIRM, working a real trace: "if you go and you click on the not tested, it says, okay, well,
 * wrong person or disconnected. What does that mean? An address is an address or not an address.
 * Employment the same."
 *
 * THEY WERE RIGHT, AND IT WAS WORSE THAN IT LOOKED. Four outcomes written for a telephone were
 * offered against four lists, so an address could be marked Disconnected and an employer No
 * answer. And the LINKED PEOPLE had no picker at all -- the firm again, naming the row: "there is
 * a Cherie Hennen and I saved it as a next of kin. But Elise Ferreira is there. What if I haven't
 * tried to call Elise Ferreira? There should be outcomes of these ones as well."
 *
 * A QUESTION WITH NO TRUE ANSWER IS WORSE THAN NO QUESTION. A column of "Not tested" against rows
 * nobody could ever answer is how a column comes to mean nothing -- the same rule CLAUDE.md states
 * about warnings that fire when nothing is wrong.
 *
 * ONE VALUE, MANY WORDINGS. The stored outcome means the same thing everywhere so a report can
 * group on it; only the label changes per list. That is the whole shape of the fix, and most of
 * what follows holds one half of it against the other.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-trace-outcomes.mjs
 */
import { readFileSync } from 'node:fs'
import {
  OUTCOMES_FOR, TRACE_CATEGORIES, TRACE_OUTCOMES, canPromote, outcomeLabelIn,
  outcomeOptionsFor, principalAddress, principalPhone, currentEmployer, traceSummary,
} from '../../src/lib/traceStore.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ')

const modal = code('src/pages/accounts/TraceWorkspaceModal.tsx')
const sql = read('supabase/schema.sql')

const I = (over) => ({
  id: 'x', traceId: 't', accountId: 'a', kind: 'mobile', value: '0821110000', label: null,
  peopleLinked: null, seenOn: null, amount: null, status: null,
  outcome: null, outcomeAt: null, outcomeNote: null, promotedContactId: null, ...over,
})

/* ---------------------------------------------------------------------------------------------
 * NOTHING IS OFFERED THAT CANNOT BE TRUE
 * ------------------------------------------------------------------------------------------- */

/*
 * THE ASSERTION THE FIRM'S COMPLAINT ACTUALLY ASKS FOR, said as a pair of absences. A picker is
 * only honest if the wrong answers are not in it.
 */
const of = (c) => OUTCOMES_FOR[c].map((o) => o.outcome)
ok('an address cannot be disconnected', !of('addresses').includes('unreachable'))
ok('...and cannot fail to answer', !of('addresses').includes('no_answer'))
ok('an employer cannot be disconnected', !of('employment').includes('unreachable'))
ok('...and cannot fail to answer', !of('employment').includes('no_answer'))
/* WHAT THEY CAN BE: there and still there, or gone. The firm's "an address is an address or not
   an address", with the third state they actually need — they were there and have moved. */
check('an address says whether they are still there', of('addresses'),
  ['verified', 'moved_on', 'not_theirs'])
check('...and so does an employer', of('employment'), ['verified', 'moved_on', 'not_theirs'])
/* AND THE SAME VALUE IS WORDED FOR THE LIST IT IS ON — one fact, two sentences. */
check('a confirmed address reads as confirmed', outcomeLabelIn('addresses', 'verified'), 'Confirmed')
check('...and a confirmed employer as still there',
  outcomeLabelIn('employment', 'verified'), 'Still there')
check('...and a confirmed number as reaching the debtor',
  outcomeLabelIn('phones', 'verified'), 'Reached the debtor')

/* ---------------------------------------------------------------------------------------------
 * WHO DID YOU REACH?
 * ------------------------------------------------------------------------------------------- */

/*
 * ON THE DEBTOR'S OWN NUMBERS, REACHING SOMEBODY ELSE IS REAL AND COMMON. The firm: "it's possible
 * in the details provided by the debtor that you could meet the spouse or reach the spouse, so
 * there should be an option for reached someone."
 */
ok('a number can have reached somebody who is not the debtor',
  of('phones').includes('reached_other'))
/*
 * AND ON A LINKED PERSON THERE IS NO "REACHED THE DEBTOR" AT ALL. The one the firm asked to be
 * LEFT OUT: "it's very seldomly, actually doesn't really happen, that you've reached the debtor on
 * the linked people. So don't, don't add anything there." An option that is almost never right is
 * one that gets picked by mistake.
 */
ok('a linked person cannot have reached the debtor', !of('people').includes('verified'))
check('what a linked person can be', of('people'),
  ['reached_other', 'no_answer', 'not_theirs', 'denies_link'])
check('...and reaching one reads as speaking to them',
  outcomeLabelIn('people', 'reached_other'), 'Spoke to them')
/* THE BUREAU JOINED THEM; A HUMAN CAN UNJOIN THEM. Stored rather than deleted — the next trace
   prints the same link, and this says somebody has already asked. */
ok('...and one can disown the connection', of('people').includes('denies_link'))

/* THE LINKED PEOPLE CAN BE WORKED AT ALL, which is where this started: the list was marked
   unworkable, so there was no picker on it and Elise Ferreira could not be marked tried. */
const people = TRACE_CATEGORIES.find((c) => c.id === 'people')
ok('the linked people are a list you work', people.worked)
/* AND A COMPANY AND A DEED STILL ARE NOT. A house cannot be rung and a directorship cannot
   answer — the distinction that made the original `worked` flag right. */
for (const id of ['companies', 'property']) {
  ok(`${id} are still not worked`, !TRACE_CATEGORIES.find((c) => c.id === id).worked)
  check(`...and offer nothing`, OUTCOMES_FOR[id], [])
}

/* EVERY LIST'S OPTIONS START WITH "NOT TESTED", which is the firm's "you can unverify it": a
   picker that only moves forwards leaves a wrong outcome standing. */
for (const c of TRACE_CATEGORIES.filter((x) => x.worked)) {
  check(`${c.id} can be set back to not tested`, outcomeOptionsFor(c.id)[0].outcome, null)
}

/* AND EVERY LABEL A LIST OFFERS IS A REAL OUTCOME. A typo here would store a value the database
   refuses, and the collector would meet it as a failed save. */
const known = new Set(TRACE_OUTCOMES.map((o) => o.outcome))
ok('every option maps to a real outcome',
  Object.values(OUTCOMES_FOR).flat().every((o) => known.has(o.outcome)))
/* AND THE DATABASE ACCEPTS ALL OF THEM. The check constraint is the thing that actually refuses,
   and a value added here and forgotten there is a save that fails in front of somebody. */
const constraint = sql.slice(sql.lastIndexOf('account_trace_items_outcome_check'))
for (const o of known) {
  ok(`the database accepts ${o}`, constraint.includes(`'${o}'`))
}

/* ---------------------------------------------------------------------------------------------
 * WHAT A DEAD FINDING MAY NOT DO
 * ------------------------------------------------------------------------------------------- */

/*
 * THREE WAYS OF SAYING "DO NOT PUT THIS ON THE ACCOUNT", and each is somebody's finding rather
 * than a guess. It matters more than it did: promoting now marks the contact VERIFIED, so saving
 * one of these would put a dead detail on the contact list wearing a tick.
 */
ok('a number that is not theirs cannot be saved', !canPromote(I({ outcome: 'not_theirs' })))
ok('...nor an address they have left', !canPromote(I({ kind: 'address', outcome: 'moved_on' })))
ok('...nor somebody who says they do not know them',
  !canPromote(I({ kind: 'link', outcome: 'denies_link' })))
/* BUT A LIVE ONE STILL CAN, or the rule above would have quietly closed the panel's whole
   purpose. */
ok('a number that reached somebody can be saved', canPromote(I({ outcome: 'reached_other' })))
ok('...and an untried one', canPromote(I({ outcome: null })))

/*
 * AND A FINDING THEY HAVE MOVED ON FROM IS NOT THE PRINCIPAL ONE. A former address still dates the
 * move and is kept as evidence; it is simply not where anybody is served, and a job somebody has
 * left is not a garnishee route. The bureau's own "seen on" cannot tell the two apart — only
 * somebody who went there or rang can.
 */
check('an address they have left is not the address',
  principalAddress([I({ id: 'old', kind: 'address', outcome: 'moved_on', seenOn: '2026-01-01' })]),
  null)
check('a job they have left is not the employer',
  currentEmployer([I({ id: 'old', kind: 'employer', outcome: 'moved_on', seenOn: '2026-01-01' })]),
  null)

/*
 * A NUMBER THAT PRODUCED A HUMAN BEATS ONE THAT RANG OUT, and loses to one that produced the
 * debtor. Somebody answered, so the line is live and there is a person on it who knows them.
 */
const ranked = principalPhone([
  I({ id: 'rang', outcome: 'no_answer', value: '0821110001' }),
  I({ id: 'spouse', outcome: 'reached_other', value: '0821110002' }),
])
check('a number that reached a person outranks one that rang out', ranked.id, 'spouse')
check('...and the debtor s own outranks that', principalPhone([
  I({ id: 'spouse', outcome: 'reached_other', value: '0821110002' }),
  I({ id: 'theirs', outcome: 'verified', value: '0821110003' }),
]).id, 'theirs')

/* ---------------------------------------------------------------------------------------------
 * AND THE WORKSPACE DRAWS THE LIST'S OWN QUESTION
 * ------------------------------------------------------------------------------------------- */

ok('the row picker asks this list s question', /outcomeOptionsFor\(category\)\.map/.test(modal))
ok('...and so does the filter above it', /outcomeOptionsFor\(category\.id\)/.test(modal))
/*
 * HELD AS AN ABSENCE TOO. The whole vocabulary is still exported for anything that needs all of
 * it, and dropping it back into the picker is exactly the regression this file exists for.
 */
ok('...and neither offers the whole vocabulary', !/OUTCOME_OPTIONS\.map/.test(modal))
/* AND A DEAD FINDING READS AS DEAD. moved_on and denies_link joined the two that were struck
   through — an address they have left is as useless as a disconnected line. */
ok('every dead outcome is struck through',
  /moved_on'\s*\|\|\s*row\.outcome === 'denies_link'/.test(modal))

console.log(`\ncheck-trace-outcomes: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
