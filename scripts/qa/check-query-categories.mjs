/**
 * The dispute classification, and the one category that will not carry itself.
 *
 * Run: node --experimental-strip-types scripts/qa/check-query-categories.mjs
 */
import { readFileSync } from 'node:fs'
import {
  categoryExamples, explanationMissing, stageForAssignee,
  CATEGORY_NEEDING_EXPLANATION, EXPLANATION_MIN_LENGTH, QUERY_CATEGORIES,
  ESCALATION_KINDS, ESCALATION_KIND_ORDER, escalationChargeable, escalationNote,
} from '../../src/lib/disputeCategories.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push(`${name}\n     expected ${e}\n     actual   ${a}`)
}

/* ---- the list itself ---- */
check('ten classifications', QUERY_CATEGORIES.length, 10)
check(
  'in the order the firm wrote them',
  QUERY_CATEGORIES.map((c) => c.value),
  ['Amount dispute', 'Product/service dispute', 'Liability dispute', 'Payment query',
    'Contract/cancellation', 'Information request', 'Legal/status issue', 'Third-party payment',
    'Administrative query', 'Other'],
)
check('"Other" is last, where a catch-all belongs', QUERY_CATEGORIES.at(-1).value, 'Other')
check('every one carries its examples', QUERY_CATEGORIES.every((c) => c.examples.trim().length > 10), true)
check('no duplicates', new Set(QUERY_CATEGORIES.map((c) => c.value)).size, 10)

/* ---- the examples a collector reads on the call ---- */
check('amount dispute', categoryExamples('Amount dispute'), 'Incorrect balance, fees, interest, missing payment')
check('third-party payment', categoryExamples('Third-party payment'), 'Insurance, medical aid, employer')
check('an unknown category has none', categoryExamples('Already paid'), null)
check('no category has none', categoryExamples(null), null)

/* ---- "Other" needs the words ---- */
const long = 'Debtor says the account belongs to their late father'
check('the constant matches the list', CATEGORY_NEEDING_EXPLANATION, 'Other')
check('"Other" with nothing is refused', explanationMissing('Other', ''), true)
check('"Other" with a shrug is refused', explanationMissing('Other', 'n/a'), true)
check('"Other" with "see notes" is refused', explanationMissing('Other', 'see notes'), true)
check('a real sentence is accepted', explanationMissing('Other', long), false)
check('whitespace does not count as words', explanationMissing('Other', '                    '), true)
check(
  'exactly the minimum is enough',
  explanationMissing('Other', 'x'.repeat(EXPLANATION_MIN_LENGTH)),
  false,
)
check(
  'one short of it is not',
  explanationMissing('Other', 'x'.repeat(EXPLANATION_MIN_LENGTH - 1)),
  true,
)
// Every other classification says what it is by itself; a short description is fine there.
for (const c of QUERY_CATEGORIES.filter((c) => c.value !== 'Other')) {
  check(`"${c.value}" needs no minimum`, explanationMissing(c.value, 'paid'), false)
}
check('no classification at all needs no minimum', explanationMissing('', 'paid'), false)
check('null category needs no minimum', explanationMissing(null, 'paid'), false)

/* ---- where a dispute lands, which follows who it was given to ---- */
// Unassigned is the only state that is not an escalation: nobody has been put to work on it.
check('nobody yet keeps it with the agent', stageForAssignee(undefined, false), 'agent')
// No assignee cannot be the liaison, whatever the second argument claims. The guard says so
// rather than leaving the two arguments free to contradict each other.
check('no assignee is never an escalation', stageForAssignee(undefined, true), 'agent')
check('an empty role is not an escalation either', stageForAssignee('', true), 'agent')
check('the client liaison means awaiting liaison', stageForAssignee('Liaison', true), 'liaison')
check('a liaison who is not this client\'s is still the liaison rung', stageForAssignee('Liaison', false), 'liaison')
check('a liaison manager counts as the liaison rung', stageForAssignee('Liaison Manager', false), 'liaison')
check('a pre-legal team leader is its own rung', stageForAssignee('Pre-legal Team Leader', false), 'team_leader')
// Being the client's liaison beats the role: that is what the relationship means here.
check('the client liaison wins over the role', stageForAssignee('Pre-legal Team Leader', true), 'liaison')
// Anyone else on the collections desk has not escalated it anywhere.
check('another agent is not an escalation', stageForAssignee('Pre-legal Agent', false), 'agent')
check('a sales rep is not an escalation', stageForAssignee('Sales Representative', false), 'agent')
check('an administrator alone is not an escalation', stageForAssignee('Administrator', false), 'agent')


/* ---------- what kind of escalation it is, and who pays ---------- */

// The rule the firm stated: a debtor pays for their own dispute and for nothing else here.
check('a dispute is chargeable', escalationChargeable('dispute'), true)
check('asking a team leader is not', escalationChargeable('help'), false)
check('recommending litigation is not', escalationChargeable('litigation'), false)
// A missing or unknown kind must fail CLOSED — never charge on something we cannot identify.
check('an unknown kind never charges', escalationChargeable('something_else'), false)
check('a null kind never charges', escalationChargeable(null), false)
check('an undefined kind never charges', escalationChargeable(undefined), false)

// Only a dispute is classified; the other two have nothing to classify.
check('only a dispute needs a category',
  ESCALATION_KIND_ORDER.filter((k) => ESCALATION_KINDS[k].needsCategory), ['dispute'])
// Chargeable and classifiable must be the same set, or a screen could offer a fee box on
// something the database will not let carry a category.
check('chargeable and classifiable agree',
  ESCALATION_KIND_ORDER.filter((k) => ESCALATION_KINDS[k].chargeable),
  ESCALATION_KIND_ORDER.filter((k) => ESCALATION_KINDS[k].needsCategory))

// The dispute stays first: it is the common case and the box opens on it.
check('the dispute is offered first', ESCALATION_KIND_ORDER[0], 'dispute')
check('there are three kinds', ESCALATION_KIND_ORDER.length, 3)
check('every kind has a label, a blurb and a placeholder', ESCALATION_KIND_ORDER.every(
  (k) => ESCALATION_KINDS[k].label && ESCALATION_KINDS[k].blurb && ESCALATION_KINDS[k].placeholder), true)

// The timeline has to say which of the three happened.
check('a dispute reads as one', escalationNote('dispute', 'says she paid'), 'Dispute raised: says she paid')
check('help reads as help', escalationNote('help', 'what now?'), 'Escalated for help: what now?')
check('litigation reads as litigation', escalationNote('litigation', 'will not pay'),
  'Recommended for litigation: will not pay')
const notes = ESCALATION_KIND_ORDER.map((k) => escalationNote(k, 'x'))
check('no two kinds read the same on the timeline', new Set(notes).size, 3)

/*
 * THE FEE GUARD IS STRUCTURAL, and this proves it is still wired.
 *
 * raiseQuery must gate the item 3 charge on escalationChargeable() rather than on the caller
 * passing `charge: false` — otherwise a future screen that forgets the flag silently bills a
 * debtor for the firm supervising its own staff. Checked by reading the source, because the
 * function itself talks to Postgres and cannot be exercised here.
 */
const queriesSrc = readFileSync(new URL('../../src/lib/accountQueries.ts', import.meta.url), 'utf8')
const gate = queriesSrc.match(/const mayCharge = escalationChargeable\([\s\S]{0,60}?\)/)
check('raiseQuery works out whether it may charge', !!gate, true)
check('and the charge is gated on it',
  /const charge = \(!mayCharge \|\| input\.charge === false\)/.test(queriesSrc), true)
// The old unconditional form must not come back.
check('the charge is never unconditional',
  /const charge = input\.charge === false \? null : await chargeItem/.test(queriesSrc), false)

console.log(`${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  !! ${f}`)
process.exit(failures.length ? 1 : 0)
