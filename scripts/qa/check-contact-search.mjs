/**
 * DEBTORS FOUND BY CELL NUMBER AND EMAIL (S10, prompt 13 item 7).
 *
 * The book's one search (applyAccountFilters) also matches contact_search, which a trigger on
 * account_contacts keeps: every number and address on the account, and each number as digits in
 * both South African forms. Held here: the number reading, the clause, and the database half. The
 * live half was probed on staging (S10): "082 123 4567" stored, "27821234567" found it, and the email
 * left the column the moment its contact row went.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-contact-search.mjs
 */
import { readFileSync } from 'node:fs'
import { contactDigits } from '../../src/lib/contactSearch.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

check('a cell number as typed is its digits', contactDigits('082 123 4567'), '0821234567')
check('...with the country code', contactDigits('+27 82 123 4567'), '27821234567')
check('...with brackets and a dash', contactDigits('(082) 123-4567'), '0821234567')
check('a surname is not a number', contactDigits('Smith'), null)
check('an account number with letters is not', contactDigits('KIS0007'), null)
check('five digits are too few to be a number', contactDigits('12345'), null)
check('an email is not a number', contactDigits('jan@example.co.za'), null)

const book = read('src/lib/accountBook.ts')
ok('the search clause still finds case number, account, reference and surname',
  /case_number\.ilike\.%\$\{s\}%,account_number\.ilike\.%\$\{s\}%,client_reference\.ilike\.%\$\{s\}%,debtor_surname\.ilike\.%\$\{s\}%,/.test(book))
ok('...and now the contacts, a number by its digits and anything else as typed',
  /const digits = contactDigits\(s\)/.test(book) && /contact_search\.ilike\.%\$\{\(digits \?\? s\)\.toLowerCase\(\)\}%/.test(book))

const sql = read('supabase/schema.sql')
const at = sql.lastIndexOf('create or replace function public.account_contact_terms(')
const terms = at < 0 ? '' : sql.slice(at, sql.indexOf('$$;', at))
ok('the account carries the column', /alter table public\.debtor_accounts add column if not exists contact_search text;/.test(sql))
ok('every number and address is in it, lower-cased', /lower\(btrim\(c\.value\)\) as raw/.test(terms) && /c\.kind in \('mobile', 'phone', 'work', 'email', 'other'\)/.test(terms))
ok('...a number also as digits', /regexp_replace\(c\.value, '\\D', '', 'g'\) as d/.test(terms))
ok('...in the 27 form when typed with a 0', /v\.d like '0%' and length\(v\.d\) = 10 then '27' \|\| substr\(v\.d, 2\)/.test(terms))
ok('...and the 0 form when typed with 27', /v\.d like '27%' and length\(v\.d\) = 11 then '0' \|\| substr\(v\.d, 3\)/.test(terms))
ok('a trigger on the contacts keeps it, on every change',
  /create or replace trigger account_contacts_search after insert or update or de' \|\| 'lete on public\.account_contacts/.test(sql))
ok('...including a contact moved between accounts', /old\.account_id is distinct from new\.account_id/.test(sql.slice(sql.lastIndexOf('create or replace function public.refresh_account_contact_search('))))
for (const p of ['src/pages/accounts/AccountsList.tsx', 'src/pages/finance/RecordPaymentModal.tsx']) {
  ok(`${p.split('/').pop()} says it searches cell and email`, /surname, cell or email"/.test(read(p)))
}

if (failures.length) {
  console.error(`check-contact-search: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`)
  process.exit(1)
}
console.log(`check-contact-search: ${pass} passed, 0 failed`)
