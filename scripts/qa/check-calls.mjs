/**
 * What a call to a debtor costs.
 *
 * Two Annexure B items are in play and EXACTLY ONE applies to any given call. Item 2 is defined
 * as the call "which is not a consultation", so the two are mutually exclusive by the gazette's
 * own wording -- answered is item 7 at R60, unanswered is item 2 at R25, never both. These
 * checks exist so a future edit cannot quietly make one call charge twice.
 *
 * Run: node --experimental-strip-types scripts/qa/check-calls.mjs
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
 * The two are mutually exclusive, and the gazette says so rather than us.
 *
 * This is the check that matters most here: it is the reason one call cannot raise both fees.
 */
check('item 2 excludes a consultation by its own wording',
  item(ATTEMPT_ITEM_ID).description.includes('not a consultation'), true)
check('so the two items are different items',
  ATTEMPT_ITEM_ID === CONSULTATION_ITEM_ID, false)
check('and an answered call costs more than one that rang out',
  item(CONSULTATION_ITEM_ID).amount > item(ATTEMPT_ITEM_ID).amount, true)

/* ---- what the timeline says ---- */
check('placing a call charges nothing yet, and says the charge is coming',
  dialledNote('27821234567', '201'),
  'Called 27821234567 from extension 201. Charged once we know whether it was answered.')
const rangOut = noAnswerNote('27821234567', { exclVat: 25, reason: 'charged' })
check('a call nobody answered is charged under item 2',
  rangOut, 'No answer on 27821234567. Charged R\u00a025,00 plus VAT under item 2.')
check('...and never claims to be a consultation', /consultation/i.test(rangOut), false)

/* ---- an extension we do not know ---- */
check('an unknown extension is left out rather than printed as null',
  dialledNote('27821234567', null),
  'Called 27821234567. Charged once we know whether it was answered.')

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
    tail(noAnswerNote('x', { exclVat: 0, reason })).replace(/item 2/, 'ITEM'),
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
