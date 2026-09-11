/**
 * The dispute classification, and the one category that will not carry itself.
 *
 * Run: node --experimental-strip-types scripts/qa/check-query-categories.mjs
 */
import {
  categoryExamples, explanationMissing,
  CATEGORY_NEEDING_EXPLANATION, EXPLANATION_MIN_LENGTH, QUERY_CATEGORIES,
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

console.log(`${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  !! ${f}`)
process.exit(failures.length ? 1 : 0)
