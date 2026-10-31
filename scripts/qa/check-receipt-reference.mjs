/**
 * R-14: A REFERENCE TYPED BESIDE A RECEIPT PLACES IT -- only on an exact match to exactly one account.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-receipt-reference.mjs
 */
import { readFileSync } from 'node:fs'
import { matchReference } from '../../src/lib/receiptReference.ts'

let pass = 0
const failures = []
const ok = (name, v) => { if (v === true) pass += 1; else failures.push(name) }
const acc = (id, caseNumber, accountNumber = null, clientReference = null) => ({ id, caseNumber, accountNumber, clientReference })

const book = [acc('1', 'DCR1811'), acc('2', 'DCR18110', 'ACC-9'), acc('3', 'DNV0009', null, 'CLI-7')]
ok('an exact case number is the one account', matchReference('DCR1811', book).account?.id === '1')
ok('...whatever the case or spaces', matchReference('  dnv0009 ', book).account?.id === '3')
ok('a longer number does not stand in for a shorter (DCR181 is nobody)', matchReference('DCR181', book).kind === 'none')
ok('the creditor account number and the client reference match too',
  matchReference('acc-9', book).account?.id === '2' && matchReference('CLI-7', book).account?.id === '3')
ok('nothing found places nothing', matchReference('ZZZ1', book).kind === 'none' && matchReference('  ', book).kind === 'none')
ok('two accounts on one reference places nothing',
  matchReference('SAME', [acc('a', 'SAME'), acc('b', 'X', 'SAME')]).kind === 'many')
ok('...but one account matching on two fields is still one',
  matchReference('SAME', [acc('a', 'SAME', 'SAME')]).kind === 'one')

const page = readFileSync(new URL('../../src/pages/finance/UnallocatedReceipts.tsx', import.meta.url), 'utf8')
ok('Needs an account has a reference box and a button beside each receipt',
  /data-testid="receipt-reference"/.test(page) && /data-testid="place-by-reference"/.test(page))
ok('...placed through the same place_bank_line as the pop-up', /placeBankLine\(r\.id, m\.account\.id\)/.test(page))
ok('...and an unmatched reference says so rather than placing', /m\.kind === 'none'\) \{ fail\(/.test(page) && /m\.kind === 'many'\) \{ fail\(/.test(page))
ok('the pop-up is still there for the ones that need a search', /Place it\n\s+<\/button>/.test(page))

if (failures.length) {
  console.error(`check-receipt-reference: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`)
  process.exit(1)
}
console.log(`check-receipt-reference: ${pass} passed, 0 failed`)
