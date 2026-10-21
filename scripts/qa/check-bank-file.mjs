/**
 * THE BANK FILE (S7, the firm, 13 Oct): "an export sheet to pay all of the different people", where
 * you "choose which you will be able to include and exclude", and a refund with no banking details
 * "stays in a pending state". What this holds: only ticked AND payable rows go in; pending says why;
 * a payover before its day is pending; amounts are plain (no thousands separator); a comma in a name
 * cannot break a column; the reference is the BF reference on both sides; the total is in cents.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-bank-file.mjs
 */
import { bankFileCsv, canPay, defaultTicked, fileTotal, keyOf, needsBanking, pendingWords, whatIsMissing } from '../../src/lib/bankFile.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const pay = (o) => ({ kind: 'payover', id: 'x', payee: 'P', amount: 100, reference: 'BF PO-X-2610', status: 'approved', dueOn: null,
  holder: 'Holder', bank: 'FNB', branch: '250655', accountNo: '62000000001', companyId: null, accountId: null, caseNumber: null, ...o })
const ok = pay({ id: 'a', payee: 'Summit', holder: 'Summit Fitness, Pty', amount: 12345.6 })
const noBank = pay({ id: 'b', kind: 'refund', holder: null, bank: null, branch: null, accountNo: null })
const early = pay({ id: 'c', status: 'scheduled' })
const badBranch = pay({ id: 'd', branch: '2506' })
const drawing = pay({ id: 'e', kind: 'drawing', reference: 'BF FEES-2610', amount: 5000 })
const all = [ok, noBank, early, badBranch, drawing]

check('a payment with everything can be paid', canPay(ok), true)
check('a refund with no banking details is pending, said once', pendingWords(whatIsMissing(noBank)), 'no banking details')
check('...and offers to add them', needsBanking(noBank), true)
check('a payover before its day is pending, with nothing to add', [whatIsMissing(early), needsBanking(early)], [['not yet due'], false])
check('a branch code that is not six digits is pending', whatIsMissing(badBranch), ['branch code'])
check('everything payable is ticked by default, nothing else', [...defaultTicked(all)].sort(), ['drawing:e', 'payover:a'])
const ticked = new Set(['payover:a', 'refund:b', 'payover:c'])
const csv = bankFileCsv(all, ticked).split('\r\n')
check('only ticked AND payable rows go in the file (ticking a pending one does nothing)', csv.length, 3)
check('...the header the bank reads', csv[0], 'Beneficiary name,Bank,Branch code,Account number,Amount,Own reference,Beneficiary reference')
check('...a comma in a name is quoted, the amount is plain, the BF reference on both sides', csv[1],
  '"Summit Fitness, Pty",FNB,250655,62000000001,12345.60,BF PO-X-2610,BF PO-X-2610')
check('the total is what goes in the file', fileTotal(all, new Set([...ticked, keyOf(drawing)])), 17345.6)
check('a long reference is cut at the 20 characters banks allow', bankFileCsv([pay({ reference: 'BF PO-VERYLONGCODE-202610' })], new Set(['payover:x'])).split('\r\n')[1].split(',').slice(-1)[0], 'BF PO-VERYLONGCODE-2')

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-bank-file: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
