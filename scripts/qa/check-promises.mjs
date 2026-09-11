/**
 * What a promise to pay is allowed to say, and what it costs.
 *
 * The rules the firm asked for after watching a collector take a promise for more than the
 * account was worth: a once-off quotes the settlement figure, an instalment may not exceed the
 * balance, and taking an arrangement charges Annexure B item 5.
 *
 * Run: node --experimental-strip-types scripts/qa/check-promises.mjs
 */
import { promiseCeiling, promiseNote, promiseProblem, PROMISE_DESCRIPTION, PROMISE_ITEM_ID } from '../../src/lib/promiseRules.ts'
import { ANNEXURE_B_2026 } from '../../src/lib/annexureB.ts'
import { TARIFF_HISTORY } from '../../src/lib/actionTariff.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push(`${name}\n     expected ${e}\n     actual   ${a}`)
}
const checkTruthy = (name, actual) => {
  if (actual) pass++
  else failures.push(`${name}\n     expected something truthy, got ${JSON.stringify(actual)}`)
}

/* ---- the item the charge lands on ---- */
// Not asserted from memory: the item must exist in the gazetted schedule, and the rate the firm
// has historically charged for a promise must be the rate that item carries.
const item5 = ANNEXURE_B_2026.items.find((i) => i.id === PROMISE_ITEM_ID)
checkTruthy('item 5 is in the 2026 schedule', item5)
check('item 5 is the settlement account drawn at the debtor’s request',
  item5.description.startsWith('Settlement account drawn up and furnished'), true)
check('item 5 is R50 excluding VAT', item5.amount, 50)
check('item 5 counts towards the items 1-7 ceiling', item5.countsTowardCap, true)
check('item 5 is per occurrence, not a total for the account', item5.isTotal, undefined)
check('the promise_to_pay action has always been charged at the item 5 rate',
  TARIFF_HISTORY.map((t) => t.rates.promise_to_pay),
  TARIFF_HISTORY.map((t) => t.effectiveFrom === '2026-03-06' ? 50 : t.rates.promise_to_pay))
check('and under the current schedule that is R50', TARIFF_HISTORY[0].rates.promise_to_pay, 50)

/* ---- the ceiling ---- */
const BALANCE = 8000
const SETTLEMENT = 8610 // balance + the item 9 receipt fee on settling in full

check('a once-off is quoted at the settlement figure, not the bare balance',
  promiseCeiling('once_off', BALANCE, SETTLEMENT), SETTLEMENT)
check('a weekly instalment is capped at the balance', promiseCeiling('weekly', BALANCE, SETTLEMENT), BALANCE)
check('a monthly instalment is capped at the balance', promiseCeiling('monthly', BALANCE, SETTLEMENT), BALANCE)

/* ---- what is refused ---- */
check('a monthly instalment inside the balance is fine',
  promiseProblem('monthly', 500, BALANCE, SETTLEMENT), null)
check('a monthly instalment exactly equal to the balance is fine',
  promiseProblem('monthly', BALANCE, BALANCE, SETTLEMENT), null)
checkTruthy('a monthly instalment above the balance is refused',
  promiseProblem('monthly', BALANCE + 0.01, BALANCE, SETTLEMENT))
checkTruthy('a weekly instalment above the balance is refused',
  promiseProblem('weekly', 9000, BALANCE, SETTLEMENT))
check('the refusal names the outstanding amount',
  /R\s?8\s?000,00/.test(promiseProblem('weekly', 9000, BALANCE, SETTLEMENT) ?? ''), true)
check('the refusal says what to do instead',
  /once-off settlement/.test(promiseProblem('weekly', 9000, BALANCE, SETTLEMENT) ?? ''), true)

// The complaint that started this: a promise for more than the account was worth.
checkTruthy('50 000 typed where 5 000 was meant is refused on an instalment',
  promiseProblem('monthly', 50000, BALANCE, SETTLEMENT))

/* ---- what is allowed through, deliberately ---- */
// A once-off above the settlement figure is questioned on the form, never refused here:
// interest runs until the money arrives and a debtor may be rounding up to cover it.
check('a once-off above the settlement figure is not refused',
  promiseProblem('once_off', SETTLEMENT + 500, BALANCE, SETTLEMENT), null)
check('an empty amount is not yet an error',
  promiseProblem('monthly', 0, BALANCE, SETTLEMENT), null)
check('nor is a half-typed one',
  promiseProblem('monthly', Number(''), BALANCE, SETTLEMENT), null)

/* ---- what the timeline says ---- */
const promise = {
  amount: 1500,
  arrangement: 'monthly',
  dueOn: '2026-09-25',
  dayOfMonth: 25,
  onLastDay: false,
  dayOfWeek: null,
}
const charged = promiseNote(promise, { exclVat: 50, vat: 7.5, reason: 'charged' })
check('the note says what was agreed', /R\s?1\s?500,00 monthly on the 25th/.test(charged), true)
check('...and when it starts', /first due 2026-09-25/.test(charged), true)
check('...and what it cost', /Charged R50\.00 plus VAT under item 5\./.test(charged), true)

check('a written-off account says so instead of a fee',
  promiseNote(promise, { exclVat: 0, vat: 0, reason: 'written-off' }),
  'Payment arrangement taken — R\u00a01\u00a0500,00 monthly on the 25th, first due 2026-09-25. '
  + 'Not charged — the account is written off.')
check('so does an account at the ceiling',
  /at the Annexure B fee ceiling/.test(promiseNote(promise, { exclVat: 0, vat: 0, reason: 'at-ceiling' })), true)

/* ---- what the debtor reads ---- */
check('the statement line is plain', PROMISE_DESCRIPTION, 'Payment arrangement')
check('...and does not say "promise to pay", which is our word for it',
  /promise/i.test(PROMISE_DESCRIPTION), false)

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL ${f}`)
process.exit(failures.length ? 1 : 0)
