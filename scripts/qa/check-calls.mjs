/**
 * What a call to a debtor costs.
 *
 * Two Annexure B items are in play and only one of them is charged. The firm asked for the
 * consultation on an answered call and said nothing about a call that rings out, so this pins
 * down which is which and that the second stays off until they say otherwise.
 *
 * Run: node --experimental-strip-types scripts/qa/check-calls.mjs
 */
import {
  consultationNote, dialledNote, noAnswerNote,
  ATTEMPT_ITEM_ID, CONSULTATION_DESCRIPTION, CONSULTATION_ITEM_ID,
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

/* ---- the item that is NOT charged, on purpose ---- */
check('the call-attempt item is 2', ATTEMPT_ITEM_ID, '2')
check('...which the gazette defines as the call that is NOT a consultation',
  item(ATTEMPT_ITEM_ID).description, 'Necessary phone call, which is not a consultation (per call)')
check('...so the two can never both apply to one call',
  item(ATTEMPT_ITEM_ID).description.includes('not a consultation'), true)
// The firm asked only for the consultation. Nothing may bill item 2 without them saying so.
check('placing a call promises no charge',
  dialledNote('27821234567', '201'),
  'Called 27821234567 from extension 201. Nothing charged unless it is answered.')
check('a call nobody answered is recorded and not charged',
  noAnswerNote('27821234567'), 'No answer on 27821234567. Not charged.')
check('...and never mentions a fee', /charged R/i.test(noAnswerNote('27821234567')), false)

/* ---- an extension we do not know ---- */
check('an unknown extension is left out rather than printed as null',
  dialledNote('27821234567', null),
  'Called 27821234567. Nothing charged unless it is answered.')

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

/* ---- what the debtor reads ---- */
check('the statement line is the gazette’s own word', CONSULTATION_DESCRIPTION, 'Consultation')

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL ${f}`)
process.exit(failures.length ? 1 : 0)
