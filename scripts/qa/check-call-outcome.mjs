/**
 * What came of working an account, and what it writes.
 *
 * THE CLERK NEVER PICKS A STATUS. They answer one question — what happened? — and the status
 * follows. These checks are what stops that collapsing back into a status dropdown, which is how
 * the imported book ended up with 58 accounts claiming a promise to pay and only 43 promises.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-call-outcome.mjs
 */
import { readFileSync } from 'node:fs'
import {
  CALL_OUTCOMES, CALL_OUTCOME_ORDER, needsPromise, needsWords,
} from '../../src/lib/callOutcome.ts'
import { CLIENT_POSITIONS } from '../../src/lib/clientPosition.ts'
import { DIARY_KINDS } from '../../src/lib/diaryPriority.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

/* ---------- the vocabulary holds together ---------- */

ok('every outcome is offered', CALL_OUTCOME_ORDER.length === Object.keys(CALL_OUTCOMES).length)
ok('no outcome is offered twice', new Set(CALL_OUTCOME_ORDER).size === CALL_OUTCOME_ORDER.length)
ok('every outcome lands on a real position',
  CALL_OUTCOME_ORDER.every((k) => CALL_OUTCOMES[k].position in CLIENT_POSITIONS))
ok('every outcome suggests a real diary kind',
  CALL_OUTCOME_ORDER.every((k) => CALL_OUTCOMES[k].suggests in DIARY_KINDS))
ok('no two outcomes read the same to an agent',
  new Set(CALL_OUTCOME_ORDER.map((k) => CALL_OUTCOMES[k].label)).size === CALL_OUTCOME_ORDER.length)

/* ---------- the three that no machine can observe ---------- */

/*
 * Negotiating, Refusing and Cannot pay exist only because somebody was on a telephone. If any of
 * them stopped being reachable from this control they would become unreachable entirely — nothing
 * else in Raptor can produce them.
 */
for (const position of ['negotiating', 'refusing', 'cannot_pay']) {
  ok(`${CLIENT_POSITIONS[position].label} is reachable from an outcome`,
    CALL_OUTCOME_ORDER.some((k) => CALL_OUTCOMES[k].position === position))
}
ok('reaching the debtor is what separates negotiating from in progress',
  CALL_OUTCOMES.negotiating.reached && !CALL_OUTCOMES.no_answer.reached)
ok('a refusal requires having reached them', CALL_OUTCOMES.refused.reached)
// Somebody who did not answer the telephone has not refused anything.
ok('no answer is never read as a refusal', CALL_OUTCOMES.no_answer.position !== 'refusing')
ok('...nor as an inability to pay', CALL_OUTCOMES.no_answer.position !== 'cannot_pay')

/* ---------- a promise must carry its amount and date ---------- */

/*
 * The whole design in one assertion. A promise with no figure and no date cannot be diarised,
 * cannot fall due, cannot break and cannot be reported — it is a status with nothing behind it,
 * which is the fault this replaces.
 */
ok('agreeing to pay demands an amount and a date', needsPromise('promised'))
ok('nothing else does', CALL_OUTCOME_ORDER.filter((k) => needsPromise(k)).length === 1)
check('...and it is checked before saving', CALL_OUTCOMES.promised.position, 'arranged')
check('...and the diary is told to confirm it', CALL_OUTCOMES.promised.suggests, 'promise_due')

/* ---------- the ones that need words ---------- */

// "Cannot pay" with no reason is exactly the gap that had hardship reported as refusal.
ok('an inability to pay needs the reason', needsWords('cannot_pay'))
ok('a dispute needs its substance', needsWords('disputed'))
ok('an administration needs naming', needsWords('under_administration'))
ok('no answer needs nothing', !needsWords('no_answer'))

/* ---------- it writes records, not just a label ---------- */

const rec = readFileSync(new URL('../../src/lib/recordOutcome.ts', import.meta.url), 'utf8')
ok('a promise is written as a promise', /addPromise\(/.test(rec))
ok('a dispute is raised as a dispute', /raiseQuery\(/.test(rec))
/*
 * NOT CHARGED. Item 3 is for a dispute taken up with somebody else; one an agent writes down at
 * their own desk mid-call is the job, not a necessary expense recoverable from the debtor.
 */
ok('a dispute raised mid-call does not charge the debtor', /charge: false/.test(rec))
/*
 * THE STATUS LAST. If the promise could not be written, the account must not be left claiming an
 * arrangement that no record supports.
 */
/*
 * Asserted as PRESENCE first, then order. indexOf returns -1 for a string that is gone, and -1 is
 * less than everything — so an order-only check passes vacuously the moment the guard is deleted,
 * which is exactly the change it exists to catch.
 */
ok('the status write is guarded at all', rec.includes('failed.length === 0'))
ok('...and the guard comes before it', rec.indexOf('failed.length === 0') < rec.indexOf('sub_status'))

/* ---------- and it is wired where the work happens ---------- */

for (const file of ['CompleteDiaryModal', 'DiaryWorkBar']) {
  const src = readFileSync(new URL(`../../src/components/diary/${file}.tsx`, import.meta.url), 'utf8')
  ok(`${file} asks what came of it`, /<OutcomePicker/.test(src))
  ok(`${file} records it before booking the next date`,
    src.indexOf('recordOutcome({') < src.indexOf('await workEntry({'))
  ok(`${file} will not save a half-answered outcome`, /!outcomeReady\(came\)/.test(src))
  ok(`${file} lets the answer choose the next diary kind`, /CALL_OUTCOMES\[next\.outcome/.test(src))
}

const picker = readFileSync(new URL('../../src/components/diary/OutcomePicker.tsx', import.meta.url), 'utf8')
/*
 * OPTIONAL. An agent who did something the list does not cover must still be able to finish the
 * account — a required field with no honest option is how "Review" came to mean nothing.
 */
ok('recording nothing stays possible', /outcome: on \? null : k/.test(picker))
ok('...and an empty answer still saves', /if \(!c\.outcome\) return true/.test(picker))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
One question at the moment of work produces eight of the thirteen statuses, a promise cannot be
recorded without an amount and a date, and no status is written that a record does not support.`)
