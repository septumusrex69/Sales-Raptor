/**
 * The flags under a position, and the sentence a client reads.
 *
 * Two layers are being protected. The POSITION answers "where is this account", once, so the
 * counts add up to the book. FLAGS answer "why", as many as are true at once. The firm's own
 * document grouped flags under eleven titles; the titles are gone, and these checks are what
 * stops them growing back in the form of a flag that cannot be read without one.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-account-flags.mjs
 */
import {
  ACCOUNT_FLAGS, clientFlags, flagFor, parseFlags, positionFromFlags,
} from '../../src/lib/accountFlags.ts'
import { CLIENT_POSITIONS } from '../../src/lib/clientPosition.ts'
import { accountNarrative } from '../../src/lib/accountNarrative.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

/* ---------- the catalogue holds together ---------- */

ok('every flag has words a client can read',
  ACCOUNT_FLAGS.every((f) => f.value && f.description && f.description.length > 20))
ok('no two flags share a name',
  new Set(ACCOUNT_FLAGS.map((f) => f.value)).size === ACCOUNT_FLAGS.length)
ok('every implied position is a real one',
  ACCOUNT_FLAGS.every((f) => !f.implies || f.implies in CLIENT_POSITIONS))

/*
 * SELF-IDENTIFYING NAMES. The firm's document used "Verified" under liquidation, debt review AND
 * a deceased estate, so the stored string could not be read without a parent title the data does
 * not carry. No flag name may be that ambiguous again.
 */
for (const bare of ['Verified', 'Unverified']) {
  ok(`"${bare}" is not a flag name on its own`,
    !ACCOUNT_FLAGS.some((f) => f.value.toLowerCase() === bare.toLowerCase()))
}
ok('the ambiguous legacy names still resolve to something', flagFor('Verified') !== null)
ok('a legacy name resolves to its new one', flagFor('Untracable')?.value === 'Untraceable')
ok('the old Section 129 wording still resolves', flagFor('Section 129 in process')?.value === 'Section 129 issued')
ok('the old refusal wording still resolves', flagFor('Non-Cooperative')?.value === 'Refuses to pay')
// The book is full of words nobody chose. A report must skip them, not fall over.
check('an unknown flag is skipped, not thrown', flagFor('Whatever Swordfish Called It'), null)
check('an empty flag is skipped', flagFor(''), null)
check('a null flag is skipped', flagFor(null), null)

/* ---------- flags stack; that is the whole point of them ---------- */

const stacked = 'Awaiting written dispute; Debtor avoiding contact; Section 129 in process'
check('a stacked string splits into its parts', parseFlags(stacked).length, 3)
check('...and they all resolve', clientFlags(stacked).length, 3)
check('stray whitespace and empties are dropped', parseFlags('  A ;; ; B  ').length, 2)
check('nothing stored reads as no flags', parseFlags(null).length, 0)

/*
 * The most-used flag on the book -- 380 accounts -- and absent from the firm's own document.
 * Dropping it because it was undocumented would have silently emptied half the book's detail.
 */
ok('the book’s most common flag is carried', flagFor('Debtor avoiding contact') !== null)

/* ---------- what the flags imply, and what beats them ---------- */

check('a stacked set takes the most constraining position',
  positionFromFlags(stacked), 'legal')
check('a lone hardship flag implies not paying', positionFromFlags('Unemployed'), 'not_paying')
check('a trace implies tracing', positionFromFlags('New trace request'), 'tracing')
check('debt review implies administration', positionFromFlags('Debt review'), 'under_administration')
check('a flag with nothing to imply says nothing', positionFromFlags('Discount requested'), null)
check('no flags at all says nothing', positionFromFlags(null), null)

/* ---------- the sentence a client reads ---------- */

check('a reached call with a promise and a date reads as one sentence',
  accountNarrative({
    lastAttemptOn: '2026-09-14', lastAttemptChannel: 'phone', reached: true,
    promise: { amount: 2000, dueOn: '2026-09-25' }, nextFollowUpOn: '2026-09-26',
  }),
  // en-ZA renders September as "Sept", which is what the diary already shows on screen.
  'Contacted 14 Sept 2026 by phone. Debtor undertook to pay R2 000 by 25 Sept 2026. Next follow-up 26 Sept 2026.')

ok('an unanswered call says so',
  /no reply/.test(accountNarrative({ lastAttemptOn: '2026-09-12', lastAttemptChannel: 'phone', reached: false })))
ok('a single attempt does not boast about being the first',
  !/attempt/.test(accountNarrative({ lastAttemptOn: '2026-09-12', reached: false, attemptsThisPeriod: 1 })))
ok('several attempts are counted',
  /Third attempt this period/.test(accountNarrative({
    lastAttemptOn: '2026-09-12', reached: false, attemptsThisPeriod: 3 })))

/*
 * THE CLAUSE THAT MATTERS MOST. When the firm has not worked an account, the sentence has to say
 * so. A client report that dressed the firm's own silence up as the debtor's would be the one
 * dishonest thing in the document, and it is the easiest to write by accident.
 */
check('nothing done reads as nothing done', accountNarrative({}), 'No contact attempted.')
ok('...and it is not hidden by a follow-up date',
  /No contact attempted/.test(accountNarrative({ nextFollowUpOn: '2026-09-20' })))

ok('a freeze is said first', /^Work is on hold/.test(accountNarrative({
  frozenReason: 'Debtor in debt review.', lastAttemptOn: '2026-09-12' })))
ok('a freeze reason is not double-stopped',
  !/\.\./.test(accountNarrative({ frozenReason: 'Debtor in debt review.' })))
ok('money received is reported', /R1 500 received/.test(accountNarrative({
  paidInPeriod: { amount: 1500, on: '2026-09-03' } })))
// A blank cell reads as "nothing here"; "No information available" reads as a broken system.
check('a frozen account with nothing else does not claim no contact was tried',
  /No contact attempted/.test(accountNarrative({ frozenReason: 'Client asked us to hold.' })), false)

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Flags stack and carry the firm's own words, no flag needs a parent title to be read, and the
client's sentence is composed from records — including when the record is that nobody rang.`)
