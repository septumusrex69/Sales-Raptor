/**
 * Suspense near matches (S21 · Raptor H19). Stephan, 9 Nov: "proceed with the suspense near match. Give options still a
 * search option." Offered, never placed; the name on the bank line is the check.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-suspense-near-match.mjs
 */
import { readFileSync } from 'node:fs'
import { nameOnLine, optionsFor, referenceTokens, slipWords } from '../../src/lib/suspenseNearMatch.ts'

let pass = 0
const failures = []
const check = (name, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) pass += 1; else failures.push(`${name}\n    expected ${JSON.stringify(b)}\n    got      ${JSON.stringify(a)}`) }
const ok = (name, v) => check(name, v, true)
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

check('a reference on the bank line is a word to try', referenceTokens({ reference: null, description: 'CAPITEC J SMITH DRC0081' }), ['DRC0081'])
check('...written with a dash or a space', referenceTokens({ reference: 'drc-0081', description: 'ABSA DRC 0081' }), ['DRC0081'])
check('...and a name is not', referenceTokens({ reference: null, description: 'FNB APP PAYMENT FROM MOKOENA' }), [])
check('the debtor\'s surname on the bank line is seen', nameOnLine('John Smith', 'CAPITEC J SMITH DRC0081'), true)
check('...a word inside another word is not', nameOnLine('Al Smit', 'CAPITEC SMITHERS'), false)

const row = (token, accountId, caseNumber, debtor, how, rank) => ({ token, accountId, caseNumber, accountNumber: null, debtor, client: 'Dr C', matchedOn: 'case number', how, rank })
/* The neighbour has the SMALLER slip; the right debtor only wins because the bank line carries his name -- which is the
   whole point of the check (sequential case numbers put a real account one digit away from nearly every number). */
const rows = [
  row('DRC0081', 'a10', 'DRC0010', 'Peter Naidoo', 'two characters swapped', 1),
  row('DRC0081', 'a10', 'DRC0010', 'Peter Naidoo', 'one digit different', 2),
  row('DRC0081', 'a82', 'DRC0082', 'Mary Dube', 'one digit different', 2),
  row('DRC0081', 'a18', 'DRC0018', 'John Smith', 'one digit different', 2),
  row('OTHER1', 'x', 'X0001', 'Nobody', 'same reference', 0),
]
const opts = optionsFor({ reference: null, description: 'CAPITEC J SMITH DRC0081' }, rows)
check('the account whose debtor is on the bank line comes first', opts[0]?.caseNumber, 'DRC0018')
check('...each account once, at its smallest slip', opts.filter((o) => o.accountId === 'a10').map((o) => o.how), ['two characters swapped'])
check('...and only accounts this receipt\'s words name', opts.some((o) => o.accountId === 'x'), false)
check('...at most three', optionsFor({ reference: null, description: 'DRC0081' }, [...rows, row('DRC0081', 'a71', 'DRC0071', 'Q', 'one digit different', 2)]).length, 3)
check('the slip is said in words', slipWords(opts[0]), 'DRC0081 is this case number with one digit different')

const sql = read('supabase/schema.sql')
const fn = sql.slice(sql.lastIndexOf('create or replace function public.near_reference_accounts('))
ok('the database looks each form up exactly, never fuzzily', /join public\.debtor_accounts a on a\.case_number = f\.variant/.test(fn)
  && /join public\.debtor_accounts a on a\.account_number = f\.variant/.test(fn) && !/similarity|levenshtein|%/.test(fn.slice(0, fn.indexOf('end $$;'))))
ok('...behind the trust account', /if not public\.has_capability\('finance\.view'\) then/.test(fn))
ok('...trying swapped, one digit different, missing and extra', ['two characters swapped', 'one digit different', 'one digit missing', 'one character too many'].every((h) => fn.includes(`'${h}'`)))
const page = read('src/pages/finance/UnallocatedReceipts.tsx')
ok('an option is placed only after "Yes, place it"', /onClick=\{\(\) => setConfirmNear\(\{ lineId: r\.id, accountId: m\.accountId \}\)\}/.test(page)
  && /onClick=\{\(\) => void placeNear\(r\.id, m\.accountId\)\} data-testid="near-confirm"/.test(page))
ok('...and Place it, the search, stays beside the options', /None of these\? Use Place it to search\./.test(page) && /onClick=\{\(\) => setPlacing\(r\)\}/.test(page))
ok('...says whether the name on the bank line matches', /the name on the bank line matches/.test(page) && /does not match, so check it/.test(page))

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-suspense-near-match: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
