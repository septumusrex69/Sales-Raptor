/**
 * THE TOP BAR SEARCHES EVERYTHING (S14, Raptor H13).
 *
 * The firm, 27 Oct: search "on a surname, on a telephone number ... on a reference number, on a
 * client reference number, all of the data ... if it doesn't affect the speed". The box searched the
 * sales side by name only and never the debtor book. See src/lib/globalSearch.ts and the
 * global_search migration.
 *
 * Run: node scripts/qa/check-global-search.mjs
 */
import { readFileSync } from 'node:fs'
import { asksTheBook, matchesAny, phoneForms } from '../../src/lib/globalSearch.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`)
}
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

check('a phone number in both its forms', [phoneForms('082 123 4567'), phoneForms('+27 82 123 4567'), phoneForms('')],
  [['0821234567', '27821234567'], ['27821234567', '0821234567'], []])
const lead = ['John Smith', 'Acme (Pty) Ltd', 'L-0042', 'john@acme.co.za', '011 555 1234', '+27 82 123 4567', 'acme.co.za']
check('the sales side is found by name, either order',
  [matchesAny(lead, 'smith'), matchesAny(lead, 'smith john'), matchesAny(lead, 'JOHN SMITH')].join(), 'true,true,true')
check('...by email, website and company', [matchesAny(lead, 'john@acme'), matchesAny(lead, 'acme.co'), matchesAny(lead, 'acme (pty)')].join(), 'true,true,true')
check('...and by a phone number however it is typed',
  [matchesAny(lead, '0821234567'), matchesAny(lead, '082 123 4567'), matchesAny(lead, '27821234567'), matchesAny(lead, '011-555-1234')].join(), 'true,true,true,true')
check('...but not by what is not there', [matchesAny(lead, 'jones'), matchesAny(lead, '0829999999'), matchesAny(lead, '')].join(), 'false,false,false')
check('the book is asked from three characters, or a T-/R- number', [asksTheBook('mo'), asksTheBook('mot'), asksTheBook('T-1016'), asksTheBook('r6'), asksTheBook('  ')].join(), 'false,true,true,true,false')

const schema = read('supabase/schema.sql')
const fn = schema.slice(schema.lastIndexOf('create or replace function public.global_search('))
check('the book is searched in the database, through the two trigram indexes', [
  /create index if not exists debtor_accounts_search_key_trgm on public\.debtor_accounts using gin \(\s*public\.debtor_search_key\(case_number, account_number, client_reference, legacy_reference,\s*swordfish_reference, debtor_id_number, contact_search\) extensions\.gin_trgm_ops\)/.test(schema),
  /create index if not exists debtor_accounts_name_key_trgm on public\.debtor_accounts using gin \(\s*public\.debtor_name_key\(debtor_first_name, debtor_surname\) extensions\.gin_trgm_ops\)/.test(schema),
  /where public\.debtor_search_key\(a\.case_number, a\.account_number, a\.client_reference, a\.legacy_reference,\s*a\.swordfish_reference, a\.debtor_id_number, a\.contact_search\) like v_like/.test(fn),
  /or public\.debtor_name_key\(a\.debtor_first_name, a\.debtor_surname\) like v_name/.test(fn),
].join(), 'true,true,true,true')
check('...as the person searching, so nobody finds what they may not read', /security invoker/.test(fn.slice(0, 400)), true)
check('...with tickets and requests by number', [/v_q ~ '\^t-\?\\d\{4,\}\$'/.test(fn), /v_q ~ '\^r-\?\\d\{1,6\}\$'/.test(fn)].join(), 'true,true')

const bar = read('src/components/layout/GlobalSearch.tsx')
check('the top bar asks the book after a pause, and only draws the newest answer',
  [/supabase\.rpc\('global_search', \{ p_q: q, p_limit: 8 \}\)/.test(bar), /window\.setTimeout\(/.test(bar), /if \(!live\) return/.test(bar)].join(), 'true,true,true')
check('...and searches the sales side by more than the name',
  [/matchesAny\(\[label, l\.companyName, leadNumber, l\.email, l\.phone, l\.mobile, l\.website\], q\)/.test(bar), /matchesAny\(\[co\.name, co\.code, co\.email, co\.phone, co\.website\], q\)/.test(bar)].join(), 'true,true')

const accounts = read('src/lib/accountBook.ts')
check('the Accounts page finds a full name in either order, every word in the first name or surname',
  /for \(const w of words\) out = out\.or\(`debtor_first_name\.ilike\.%\$\{w\}%,debtor_surname\.ilike\.%\$\{w\}%`\)/.test(accounts), true)
check('...and the first name, ID number and old references on their own',
  /debtor_first_name\.ilike\.%\$\{s\}%,debtor_id_number\.ilike\.%\$\{s\}%,legacy_reference\.ilike\.%\$\{s\}%,swordfish_reference\.ilike\.%\$\{s\}%,/.test(accounts), true)

if (failures.length) {
  console.log(`check-global-search: ${pass} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-global-search: ${pass} passed, 0 failed`)
