/**
 * What a call to a debtor costs.
 *
 * Two Annexure B items are in play and the firm charges BOTH on an answered call: item 2 on
 * every outgoing call whether or not it connects, and item 7 as well when it does. Their explicit
 * instruction, made after being shown that the gazette defines item 2 as the call "which is not a
 * consultation" -- see ATTEMPT_ITEM_ID in callRules.ts. So an answered call is R85 excluding VAT.
 *
 * Run: node --experimental-strip-types --import ./scripts/qa/tsresolve.mjs \
 *        scripts/qa/check-calls.mjs
 */
import { readFileSync } from 'node:fs'
import {
  consultationNote, dialledNote, noAnswerNote,
  ATTEMPT_DESCRIPTION, ATTEMPT_ITEM_ID, CONSULTATION_DESCRIPTION, CONSULTATION_ITEM_ID,
} from '../../src/lib/callRules.ts'
import { ANNEXURE_B_2026 } from '../../src/lib/annexureB.ts'
import { TARIFF_HISTORY } from '../../src/lib/actionTariff.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push(`${name}\n     expected ${e}\n     actual   ${a}`)
}

const ok = (name, actual) => check(name, actual, true)

const item = (id) => ANNEXURE_B_2026.items.find((i) => i.id === id)

/* ---- the item that IS charged ---- */
check('a consultation is item 7', CONSULTATION_ITEM_ID, '7')
check('...which the gazette calls a necessary consultation with the debtor',
  item(CONSULTATION_ITEM_ID).description, 'Necessary consultation with debtor')
check('...at R60 excluding VAT', item(CONSULTATION_ITEM_ID).amount, 60)
check('...counting towards the items 1-7 ceiling', item(CONSULTATION_ITEM_ID).countsTowardCap, true)
check('...per occurrence, not a total for the account', item(CONSULTATION_ITEM_ID).isTotal, undefined)
check('...with no monthly allowance to run out', item(CONSULTATION_ITEM_ID).maxPerMonth, undefined)
/*
 * "ALWAYS" MEANS ALL FOUR SCHEDULES, not `[0]`. As written this said always and read the current
 * one, so a consultation could have been any price on any date before March 2026 -- and a fee is
 * priced on the schedule in force on the day of the ACTION, so those dates are live.
 */
check('and the firm has always charged its consultation at that schedule\u2019s rate',
  TARIFF_HISTORY.map((t) => t.rates.consultation), [60, 52, 49, 44])
check('...which under the current schedule is R60', TARIFF_HISTORY[0].rates.consultation, 60)

/* ---- the item charged when nobody picks up ---- */
check('the unanswered-call item is 2', ATTEMPT_ITEM_ID, '2')
check('...which the gazette defines as the call that is NOT a consultation',
  item(ATTEMPT_ITEM_ID).description, 'Necessary phone call, which is not a consultation (per call)')
check('...at R25 excluding VAT', item(ATTEMPT_ITEM_ID).amount, 25)
check('...counting towards the items 1-7 ceiling', item(ATTEMPT_ITEM_ID).countsTowardCap, true)
check('...per occurrence, not a total for the account', item(ATTEMPT_ITEM_ID).isTotal, undefined)
check('and the firm has always charged a phone call at that schedule\u2019s rate',
  TARIFF_HISTORY.map((t) => t.rates.phone_call), [25, 21, 20, 18])
check('...which under the current schedule is R25', TARIFF_HISTORY[0].rates.phone_call, 25)

/*
 * The gazette's own wording, recorded because the firm's rule departs from it.
 *
 * Not a check that the code refuses to charge both -- it charges both, as instructed. This pins
 * down WHY that is a decision rather than an oversight, so nobody later "fixes" the tariff data
 * to make the double charge look inevitable.
 */
check('item 2 is gazetted as the call which is NOT a consultation',
  item(ATTEMPT_ITEM_ID).description.includes('not a consultation'), true)
check('the two are different items', ATTEMPT_ITEM_ID === CONSULTATION_ITEM_ID, false)
check('an answered call therefore costs R25 + R60 excluding VAT',
  item(ATTEMPT_ITEM_ID).amount + item(CONSULTATION_ITEM_ID).amount, 85)

/* ---- what the timeline says ---- */
check('placing a call says who was rung, and from where',
  dialledNote('27821234567', '201'),
  'Called 27821234567 from extension 201.')
check('a call nobody answered says so',
  noAnswerNote('27821234567'), 'No answer on 27821234567.')
check('...and never claims to be a consultation',
  /consultation/i.test(noAnswerNote('27821234567')), false)

/* ---- an extension we do not know ---- */
check('an unknown extension is left out rather than printed as null',
  dialledNote('27821234567', null),
  'Called 27821234567.')

/* ---- what the timeline says once it connects ---- */
check('an answered call is a consultation',
  consultationNote('27821234567'),
  'Consultation with the debtor on 27821234567.')

/*
 * A note says what happened. It does NOT say what it cost.
 *
 * These notes used to end with "Charged R25,00 plus VAT under item 2." and the firm had it
 * taken out: "don't have to say about the charges in the notes, it's on the transaction list."
 * Every fee is already its own entry on the same timeline as well as a line on Transactions, so
 * one call read as two events.
 *
 * Asserted rather than just deleted, because the natural thing for anyone touching these
 * functions later is to helpfully put the amount back.
 */
const MONEY = /R\s?\d|VAT|charged|item \d|ceiling|written off|allowance/i
for (const [name, note] of [
  ['a dial note', dialledNote('27821234567', '201')],
  ['a dial note with no extension', dialledNote('27821234567', null)],
  ['a consultation note', consultationNote('27821234567')],
  ['a no-answer note', noAnswerNote('27821234567')],
]) {
  check(`${name} says nothing about money`, MONEY.test(note), false)
}

/* ---- what the debtor reads ---- */
check('the statement line is the gazette’s own word', CONSULTATION_DESCRIPTION, 'Consultation')
check('and a call that rang out says plainly what it was', ATTEMPT_DESCRIPTION, 'Telephone call')
check('the two statement lines are distinguishable',
  ATTEMPT_DESCRIPTION === CONSULTATION_DESCRIPTION, false)

/* ---------------- what the collector is asked after the call ---------------- */

/*
 * THE BOX WHERE THE CONSULTATION IS WRITTEN, which is the field in Raptor with the best claim to
 * being dictated: the collector has just put the receiver down, the conversation is still in
 * their head, and typing it out is the step that gets skipped -- leaving a R60 fee with no
 * evidence behind it, the one kind nobody can defend when it is queried.
 */
const button = readFileSync(new URL('../../src/pages/accounts/CallButton.tsx', import.meta.url), 'utf8')
ok('what was said can be dictated', /<DictateButton size="small" value={comment} onChange={setComment} \/>/.test(button))
/* THE SAME CONTROL THE NOTE AND COMPOSE BOXES USE, so the language somebody dictates in is
   remembered once across all of them rather than three times. */
ok('...through the one dictate control', /from '\.\.\/\.\.\/components\/ui\/Dictate'/.test(button))

/*
 * AND THE SAME WORDS CAN BECOME THE MAIN COMMENT. The firm asked for it here because this is
 * where the sentence gets written: the main comment is "the two lines the next person needs" and
 * the last call is usually exactly that, but it lives four inches up the page from this box.
 */
ok('the call can be made the main comment too', /Also make this the main comment/.test(button))
/*
 * OFF EVERY TIME, NEVER REMEMBERED. saveMainComment REPLACES what is there and puts the old one
 * on the timeline -- a tick that defaulted on, or that stuck between calls, would quietly
 * overwrite a carefully written summary with "left a message" on the next call that rang out.
 */
ok('...starting off', /const \[alsoMain, setAlsoMain\] = useState\(false\)/.test(button))
ok('...and cleared when the next call is placed', /setAlsoMain\(false\)/.test(button))
/*
 * AFTER THE CALL IS RECORDED, NEVER INSTEAD OF IT. The consultation and its fee are the thing
 * that must not be lost; written first, a failure would leave the fee with no note behind it.
 */
const atRecord = button.indexOf('await recordNoAnswer(')
const atMain = button.indexOf('await saveMainComment(')
ok('the call is recorded before the main comment is touched', atRecord > 0 && atMain > atRecord)
/*
 * AND IT DOES NOT FAIL THE CALL. The call went, the fee is raised and the note is on the timeline
 * either way; a red error over all of that because one more field would not save would be a lie
 * about what happened.
 */
ok('...and a main comment that will not save does not fail the call',
  /catch \(e\) \{\s*console\.error\('\[call\] the call was recorded but the main comment was not:'/.test(button))
/* NOTHING IS WRITTEN FROM AN EMPTY BOX: the main comment is cleared by an empty string, so an
   unticked-but-empty note would wipe the top of the account. */
ok('...and an empty note never replaces one', /if \(alsoMain && comment\.trim\(\)\)/.test(button))

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL ${f}`)
process.exit(failures.length ? 1 : 0)
