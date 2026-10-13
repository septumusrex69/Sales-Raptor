/**
 * WHAT A BANK LINE PLAINLY IS, FROM THE BANK'S OWN WORDS (S7, 13 Oct).
 *
 * The firm, at CREDIT INTEREST under "Needs an account" and two bank charges reading "No run of this
 * amount": "By default credit interest is interest. Should be allocated as interest." What this holds:
 * interest in, charges out and a returned debit order are each recognised by the words FNB writes; a
 * debtor's ordinary receipt and an ordinary payment out are none of them (a wrong guess books a
 * debtor's money to the firm); a returned debit is never a charge even when it says FEE; the account
 * a returned debit names is found; and the import books interest and charges through
 * allocate_bank_line, nothing else.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-line-nature.mjs
 */
import { readFileSync } from 'node:fs'
import { accountNumberIn, lineNature } from '../../src/lib/bankLineAllocation.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
check('CREDIT INTEREST in is interest', lineNature('CREDIT INTEREST', 'credit'), 'bank_interest')
check('...and CR INT', lineNature('CR INT CAPITALISED', 'credit'), 'bank_interest')
check('a debtor\'s receipt is nothing obvious', lineNature('CAPITEC P NAIDOO', 'credit'), null)
check('...even one with a reference', lineNature('MPG-CUST-3001 PAYMENT', 'credit'), null)
check('##BANK CHARGE out is a charge', lineNature('##BANK CHARGE', 'debit'), 'bank_charge')
check('##SERVICE FEE out is a charge', lineNature('##SERVICE FEE', 'debit'), 'bank_charge')
check('a payover out is nothing obvious', lineNature('INTERNET TRF BF PO-KLR-2607', 'debit'), null)
check('a returned debit order is recognised', lineNature('RETURNED DEBIT SBB/2003 ZULU INSUFFICIENT FUNDS', 'debit'), 'returned_debit')
check('...and an UNPAID one', lineNature('UNPAID DEBIT ORDER SBB/2003', 'debit'), 'returned_debit')
check('...and is never a charge, even with FEE in it', lineNature('RETURNED DEBIT SBB/2003 ##UNPAID FEE', 'debit'), 'returned_debit')
check('interest OUT is not interest IN', lineNature('DEBIT INTEREST', 'debit'), null)
check('the account a returned debit names', accountNumberIn('RETURNED DEBIT SBB/2003 ZULU INSUFFICIENT FUNDS'), 'SBB/2003')
check('...none where none is named', accountNumberIn('RETURNED DEBIT ZULU'), null)

const api = readFileSync(new URL('../../src/lib/bankAllocationApi.ts', import.meta.url), 'utf8')
const body = api.slice(api.indexOf('export async function bookObviousLines'))
check('the import books only interest and charges', body.length > 0 && /if \(n !== 'bank_interest' && n !== 'bank_charge'\) continue/.test(body), true)
check('...through allocate_bank_line', /await allocateBankLine\(l\.id, n, null, null\)/.test(body), true)
const card = readFileSync(new URL('../../src/pages/finance/BankImportCard.tsx', import.meta.url), 'utf8')
check('...straight after the import', /result\.booked = await bookObviousLines\(\)/.test(card), true)

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-line-nature: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
