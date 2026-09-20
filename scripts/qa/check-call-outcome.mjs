/**
 * What came of working an account, and what it writes.
 *
 * THE CLERK PICKS THE POSITION, AND THE RECORD IS WRITTEN ANYWAY. The choices read as the firm's
 * own rungs now, at their instruction — one vocabulary, not two — but every one of them still
 * writes the promise, the dispute or the trace that stands behind it. These checks are what stops
 * that half collapsing into a bare status dropdown, which is how the imported book ended up with
 * 58 accounts claiming a promise to pay and only 43 promises.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-call-outcome.mjs
 */
import { readFileSync } from 'node:fs'
import {
  CALL_OUTCOMES, CALL_OUTCOME_ORDER, needsPromise, needsWords,
} from '../../src/lib/callOutcome.ts'
import { CLIENT_POSITIONS, clientPosition } from '../../src/lib/clientPosition.ts'
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

/*
 * THE ROUND TRIP, which is the only version of this that is worth anything.
 *
 * An outcome carries a `position` AND the sub-status recordOutcome writes to the account. Nothing
 * downstream ever reads `position` again: the account screen, the client report and every count
 * derive the rung from the SUB-STATUS. So the two can disagree, silently, for as long as nobody
 * opens one of these accounts and reads the tile.
 *
 * Two of them did. "Under administration" and "Cannot pay" both derived to 'in_progress' — an
 * agent who ended a call by saying the debtor was in liquidation, or that a pensioner had
 * nothing, produced an account that reported to the client as though nobody had rung it yet. The
 * second one broke the firm's own rule that refusing to pay and cannot pay never share a list.
 *
 * Asserting `position` against itself would have passed throughout.
 */
for (const key of CALL_OUTCOME_ORDER) {
  const outcome = CALL_OUTCOMES[key]
  check(`'${outcome.label}' reports as the rung it claims`,
    clientPosition({ status: 'Active', subStatus: outcome.subStatus }),
    outcome.position)
}
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

/* ---------- the firm's own words on the buttons ---------- */

/*
 * EACH CHOICE LEADS WITH THE RUNG IT PRODUCES. It read as eight events — "they agreed to pay",
 * "no answer" — and the firm asked for their own vocabulary instead: one list, the rungs an
 * account is reported on, no second set of words to learn. The event is still there, underneath,
 * because it is what a clerk can answer in a tap with the debtor on the line.
 *
 * Checked against CLIENT_POSITIONS rather than a list written out here, so the two cannot drift.
 */
for (const [key, meta] of Object.entries(CALL_OUTCOMES)) {
  ok(`${key} is labelled as the position it produces`,
    meta.label === CLIENT_POSITIONS[meta.position].label)
  ok(`...and still says what happened`, (meta.hint ?? '').length > 0)
}

/* ---------- and it is wired where the work happens ---------- */

for (const file of ['CompleteDiaryModal', 'DiaryWorkBar']) {
  const src = readFileSync(new URL(`../../src/components/diary/${file}.tsx`, import.meta.url), 'utf8')
  ok(`${file} asks what came of it`, /<OutcomePicker/.test(src))
  /*
   * PRESENCE BEFORE ORDER. indexOf returns -1 for something that is not there, so an order-only
   * assertion goes green the day the thing it orders is deleted: -1 is less than everything.
   * Deleting the whole outcome-recording block from CompleteDiaryModal left this line passing.
   */
  ok(`${file} records it at all`, src.includes('recordOutcome({'))
  ok(`${file} books the next date at all`, src.includes('await workEntry({'))
  ok(`${file} records it before booking the next date`,
    src.indexOf('recordOutcome({') < src.indexOf('await workEntry({'))
  ok(`${file} will not save a half-answered outcome`, /!outcomeReady\(came, /.test(src))
  /*
   * AND IT IS TOLD WHETHER A PROMISE ALREADY STANDS. Without that argument outcomeReady goes on
   * demanding an amount and a date the account already has — which is the firm's objection,
   * "there's already a PTP in place, why do you need to redo this?" — and the box cannot be
   * finished without retyping it.
   */
  ok(`${file} knows a promise already stands`, /outcomeReady\(came, !!livePromise\)/.test(src))
  /*
   * THE WRITE MUST NOT MAKE A SECOND PROMISE. Keeping the existing one and writing a new row for
   * it anyway would leave two due dates on one account and a client report that cannot say which
   * arrangement is the arrangement.
   */
  ok(`${file} does not re-record a promise it is keeping`,
    /promise: came\.outcome === 'promised' && \(!livePromise \|\| came\.repromise\)/.test(src))
  /* Only an OPEN promise stands: one already kept or broken is history. */
  ok(`${file} only reuses a promise that is still open`,
    /entry\.promise\.status === 'open'/.test(src))
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
