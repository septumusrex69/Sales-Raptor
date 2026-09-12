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

const item = (id) => ANNEXURE_B_2026.items.find((i) => i.id === id)

/* ---- the item that IS charged ---- */
check('a consultation is item 7', CONSULTATION_ITEM_ID, '7')
check('...which the gazette calls a necessary consultation with the debtor',
  item(CONSULTATION_ITEM_ID).description, 'Necessary consultation with debtor')
check('...at R60 excluding VAT', item(CONSULTATION_ITEM_ID).amount, 60)
check('...counting towards the items 1-7 ceiling', item(CONSULTATION_ITEM_ID).countsTowardCap, true)
check('...per occurrence, not a total for the account', item(CONSULTATION_ITEM_ID).isTotal, undefined)
check('...with no monthly allowance to run out', item(CONSULTATION_ITEM_ID).maxPerMonth, undefined)
check('and the firm has always charged its consultation at that rate',
  TARIFF_HISTORY[0].rates.consultation, 60)

/* ---- the item charged when nobody picks up ---- */
check('the unanswered-call item is 2', ATTEMPT_ITEM_ID, '2')
check('...which the gazette defines as the call that is NOT a consultation',
  item(ATTEMPT_ITEM_ID).description, 'Necessary phone call, which is not a consultation (per call)')
check('...at R25 excluding VAT', item(ATTEMPT_ITEM_ID).amount, 25)
check('...counting towards the items 1-7 ceiling', item(ATTEMPT_ITEM_ID).countsTowardCap, true)
check('...per occurrence, not a total for the account', item(ATTEMPT_ITEM_ID).isTotal, undefined)
check('and the firm has always charged a phone call at that rate', TARIFF_HISTORY[0].rates.phone_call, 25)

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
check('placing a call charges item 2 there and then',
  dialledNote('27821234567', '201', { exclVat: 25, reason: 'charged' }),
  'Called 27821234567 from extension 201. Charged R\u00a025,00 plus VAT under item 2.')
// The dial's own line already names the R25. Naming it again here would read as a second one.
check('a call nobody answered names no further fee',
  noAnswerNote('27821234567'), 'No answer on 27821234567.')
check('...and never claims to be a consultation',
  /consultation/i.test(noAnswerNote('27821234567')), false)

/* ---- an extension we do not know ---- */
check('an unknown extension is left out rather than printed as null',
  dialledNote('27821234567', null, { exclVat: 25, reason: 'charged' }),
  'Called 27821234567. Charged R\u00a025,00 plus VAT under item 2.')

/* ---- what the timeline says once it connects ---- */
const answered = consultationNote('27821234567', { exclVat: 60, reason: 'charged' })
check('an answered call is a consultation', /Consultation with the debtor on 27821234567/.test(answered), true)
check('...and says what it cost, under which item',
  /Charged R\s?60,00 plus VAT under item 7\./.test(answered), true)

check('a written-off account says so instead of a fee',
  consultationNote('27821234567', { exclVat: 0, reason: 'written-off' }),
  'Consultation with the debtor on 27821234567. Not charged — the account is written off.')
check('so does an account at the ceiling',
  /at the Annexure B fee ceiling/.test(consultationNote('2782', { exclVat: 0, reason: 'at-ceiling' })), true)

/*
 * Both notes explain a blocked charge the same way. They share one helper precisely so an
 * account at the ceiling cannot read differently depending on who answered the phone.
 */
for (const reason of ['written-off', 'item-total-spent', 'monthly-limit', 'at-ceiling']) {
  const tail = (note) => note.slice(note.indexOf('. ') + 2)
  check(`"${reason}" reads the same on both notes`,
    tail(dialledNote('x', null, { exclVat: 0, reason })).replace(/item 2/, 'ITEM'),
    tail(consultationNote('x', { exclVat: 0, reason })).replace(/item 7/, 'ITEM'))
}

/* ---- what the debtor reads ---- */
check('the statement line is the gazette’s own word', CONSULTATION_DESCRIPTION, 'Consultation')
check('and a call that rang out says plainly what it was', ATTEMPT_DESCRIPTION, 'Telephone call')
check('the two statement lines are distinguishable',
  ATTEMPT_DESCRIPTION === CONSULTATION_DESCRIPTION, false)

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL ${f}`)
process.exit(failures.length ? 1 : 0)
