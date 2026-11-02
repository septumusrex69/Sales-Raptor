/**
 * FIND A PAYMENT (request #18) -- the amount is read the way a POP writes it, and the search tells the truth.
 *
 * The match is EXACT on the amount, so a misread amount finds nothing, and "nothing found" reads as "the money
 * never reached Raptor" -- the wrong answer to the only question the page is for.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-find-payment.mjs
 */
import { readFileSync } from 'node:fs'
import { parseRandAmount } from '../../src/lib/findPaymentAmount.ts'
import { stripSqlComments } from './sqlComments.mjs'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)

/* ---------- the amount, every way it arrives ---------- */
check('the firm’s own en-ZA, with the non-breaking space', parseRandAmount('R 1 500,00'), 1500)
check('...typed with ordinary spaces', parseRandAmount('R 1 500,00'), 1500)
check('a bank app’s 1,500.00', parseRandAmount('1,500.00'), 1500)
check('plain 1500.00', parseRandAmount('1500.00'), 1500)
check('plain 1500', parseRandAmount('1500'), 1500)
check('a thousands comma alone is not a decimal (1,500)', parseRandAmount('1,500'), 1500)
check('...nor a thousands point (1.500)', parseRandAmount('1.500'), 1500)
check('cents with a comma', parseRandAmount('150,45'), 150.45)
check('one decimal digit', parseRandAmount('99,5'), 99.5)
check('European 12.345,67', parseRandAmount('12.345,67'), 12345.67)
check('lower-case r', parseRandAmount('r250'), 250)
check('nothing is no amount', parseRandAmount('   '), null)
check('words are no amount', parseRandAmount('fifteen'), null)
check('nought is no amount', parseRandAmount('0,00'), null)
check('a minus is no amount (a POP is money in)', parseRandAmount('-100'), null)

/* ---------- the search itself (the LAST definition is the live one) ---------- */
const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const at = schema.lastIndexOf('create or replace function public.find_payments(')
const fn = at < 0 ? '' : stripSqlComments(schema.slice(at, schema.indexOf('\n$$;', at)))
ok('find_payments is in the file', fn.length > 0)
ok('...behind finance.view, like the statement', /where public\.has_capability\('finance\.view'\)/.test(fn))
ok('...and answers nothing when asked nothing',
  /and \(p_amount is not null or p_from is not null or p_to is not null or q\.w is not null\)/.test(fn))
ok('...matching the amount to the cent, not near it', /abs\(r\.amount - p_amount\) < 0\.005/.test(fn))
/* EVERY STATE, because "where did it go" has answers other than an account. A filter on approved or
   not-reversed here is exactly the payment Camille is looking for, dropped. */
ok('...over every payment, whatever its state', /from public\.account_payments p\s+join public\.debtor_accounts a/.test(fn)
  && !/where p\.(reversed_at|rejected_at|suspended_at|approved_at) is (null|not null)\s/.test(fn))
for (const s of ['Rejected', 'Moved to another account', 'Returned unpaid', 'Reversed', 'In suspense', 'Waiting for approval', 'Paid to the client direct', 'On the account']) {
  ok(`...naming the state "${s}"`, fn.includes(`'${s}'`))
}
ok('...naming the account a moved payment went to', /x\.replaces_payment_id = p\.id/.test(fn))
ok('...and the credit lines nobody placed', /'Not on any account yet \(To sort\)'/.test(fn) && /l\.direction = 'credit'/.test(fn))
ok('...without listing a placed line twice', /not exists \(select 1 from public\.account_payments p where p\.bank_line_id = l\.id\)/.test(fn))
ok('...and a typed % or _ is a character, not a wildcard', /replace\(replace\(replace\(lower/.test(fn))
ok('nobody outside the firm may call it', /revoke all on function public\.find_payments\(numeric, date, date, text\) from public, anon;/.test(schema))

console.log(`\ncheck-find-payment: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
