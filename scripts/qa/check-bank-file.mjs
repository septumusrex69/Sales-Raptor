/**
 * THE BANK FILE (S7, the firm, 13 Oct): "an export sheet to pay all of the different people", where
 * you "choose which you will be able to include and exclude", and a refund with no banking details
 * "stays in a pending state". What this holds: only ticked AND payable rows go in; pending says why;
 * a payover before its day is pending; the total is in cents.
 *
 * AND THE FILE IS FNB'S (Online Banking Enterprise, "Payments - CSV Import Guide", June 2025): row 1
 * the template's name, row 2 the action date as CCYY/MM/DD, row 3 the TRUST account it pays from and
 * a hash total left blank unless asked for, row 4 the headings A-AJ, then one payment a row padded to
 * 36 columns; every field cut to FNB's length, nothing quoted because nothing needs to be, leading
 * zeros kept with no apostrophe, account type 1, no notification unless one is passed, and the hash
 * total as the guide's own example reads it -- the sum of the account NUMBERS, in BigInt.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-bank-file.mjs
 */
import {
  FNB_HEADINGS, bankFileCsv, canPay, defaultTicked, fileTotal, fnbDate, fnbHashTotal, fnbHashTotalDigitSum, fnbOwnAccount, fnbText,
  keyOf, needsBanking, pendingWords, whatIsMissing,
} from '../../src/lib/bankFile.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const throws = (fn) => { try { fn(); return false } catch { return true } }
/* Every bank number here is invented. This repository is public. */
const OWN = '62812345678'
const OPTS = { ownAccount: OWN, actionDate: '2026-10-21' }
const pay = (o) => ({ kind: 'payover', id: 'x', payee: 'P', amount: 100, reference: 'BF PO-X-2610', status: 'approved', dueOn: null,
  holder: 'Holder', bank: 'FNB', branch: '250655', accountNo: '62000000001', companyId: null, accountId: null, caseNumber: null, ...o })
const ok = pay({ id: 'a', payee: 'Summit', holder: 'Summit Fitness, Pty', amount: 12345.6 })
const noBank = pay({ id: 'b', kind: 'refund', holder: null, bank: null, branch: null, accountNo: null })
const early = pay({ id: 'c', status: 'scheduled' })
const badBranch = pay({ id: 'd', branch: '2506' })
const drawing = pay({ id: 'e', kind: 'drawing', reference: 'BF FEES-2610', amount: 5000 })
const all = [ok, noBank, early, badBranch, drawing]

/* ---- WHAT GOES IN (unchanged by the format) ---- */
check('a payment with everything can be paid', canPay(ok), true)
check('a refund with no banking details is pending, said once', pendingWords(whatIsMissing(noBank)), 'no banking details')
check('...and offers to add them', needsBanking(noBank), true)
check('a payover before its day is pending, with nothing to add', [whatIsMissing(early), needsBanking(early)], [['not yet due'], false])
check('a branch code that is not six digits is pending', whatIsMissing(badBranch), ['branch code'])
check('a payment past FNB\'s eleven-character amount is pending, not written', whatIsMissing(pay({ amount: 100_000_000 })), ['too large for one bank payment'])
check('...and R99 999 999.99 still fits', canPay(pay({ amount: 99_999_999.99 })), true)
check('everything payable is ticked by default, nothing else', [...defaultTicked(all)].sort(), ['drawing:e', 'payover:a'])
const ticked = new Set(['payover:a', 'refund:b', 'payover:c'])
check('the total is what goes in the file', fileTotal(all, new Set([...ticked, keyOf(drawing)])), 17345.6)

/* ---- FNB'S LAYOUT ---- */
const csv = bankFileCsv(all, ticked, OPTS)
const lines = csv.split('\r\n')
const cols = (l) => l.split(',')
check('lines end CRLF, the last one too', [csv.endsWith('\r\n'), lines.at(-1)], [true, ''])
check('four header rows and only the ticked AND payable payment (ticking a pending one does nothing)', lines.length - 1, 5)
check('row 1 is the template\'s own name', cols(lines[0])[0], 'BInSol - U ver 1.00')
check('row 2, A: the action date as CCYY/MM/DD (anything else FNB silently reads as today)', cols(lines[1])[0], '2026/10/21')
check('row 3, A: the trust account it pays from; B: the hash total, BLANK unless asked for', cols(lines[2]).slice(0, 2), [OWN, ''])
check('row 4: the 36 headings, A to AJ', [FNB_HEADINGS.length, cols(lines[3])[0], cols(lines[3])[6], cols(lines[3])[7], cols(lines[3])[22], cols(lines[3])[30], cols(lines[3])[35]],
  [36, 'RECIPIENT NAME', 'RECIPIENT REFERENCE', 'EMAIL 1 NOTIFY', 'FAX 1 NOTIFY', 'SMS 1 NOTIFY', 'SMS 2 NUMBER'])
check('every row is exactly 36 columns wide, as Excel saves the template', lines.slice(0, -1).map((l) => cols(l).length), [36, 36, 36, 36, 36])
check('a payment row: name (comma gone, not quoted), account, type 1, branch, amount, BF reference both sides',
  cols(lines[4]).slice(0, 7), ['Summit Fitness Pty', '62000000001', '1', '250655', '12345.60', 'BF PO-X-2610', 'BF PO-X-2610'])
check('...and no notification, fax or SMS columns filled', cols(lines[4]).slice(7).every((c) => c === ''), true)
check('nothing in the file is quoted, because nothing needs to be', csv.includes('"'), false)

/* ---- FIELDS CUT TO FNB'S LENGTHS AND CHARACTERS ---- */
const one = (o, opts = OPTS) => cols(bankFileCsv([pay(o)], new Set(['payover:x']), opts).split('\r\n')[4])
check('the name is cut at 20', one({ holder: 'Baobab Property Managers (Pty) Ltd' })[0], 'Baobab Property Mana')
check('"&" reads "and", accents go, quotes and brackets become nothing', one({ holder: '"Smit & Seun" (Café)' })[0], 'Smit and Seun Cafe')
check('a holder the field cannot carry falls back to the payee\'s name', one({ holder: '—', payee: 'Karoo Linen' })[0], 'Karoo Linen')
check('a long reference is cut at 20, on both sides', one({ reference: 'BF PO-VERYLONGCODE-202610' }).slice(5, 7), ['BF PO-VERYLONGCODE-2', 'BF PO-VERYLONGCODE-2'])
check('a reference already inside the set is left exactly as it is (the statement import matches on it)', fnbText('BF RAP-124059', 20), 'BF RAP-124059')
check('a comma or newline in a reference cannot make a column', one({ reference: 'BF A,B\nC' }).length, 36)
check('amounts: a dot, two places, no separator', [one({ amount: 0.1 })[4], one({ amount: 1234567.5 })[4], one({ amount: 8426.07 })[4]], ['0.10', '1234567.50', '8426.07'])

/* ---- LEADING ZEROS: the digits as they are, no apostrophe ---- */
check('a Standard Bank branch code keeps its zero, without an apostrophe', one({ branch: '051001' })[3], '051001')
check('an account number keeps its leading zero, spaces taken out', one({ accountNo: '0012 345 678' })[1], '0012345678')
check('no apostrophe anywhere in the file', bankFileCsv([pay({ branch: '051001', accountNo: '0012345678' })], new Set(['payover:x']), { ...OPTS, hashTotal: true }).includes("'"), false)

/* ---- THE OWN ACCOUNT ---- */
check('the trust account number is read with its spaces taken out', fnbOwnAccount('628 1234 5678'), OWN)
check('...and no file is written without one (rather than one paying from nowhere)', [throws(() => bankFileCsv(all, ticked, { ...OPTS, ownAccount: '' })),
  throws(() => bankFileCsv(all, ticked, { ...OPTS, ownAccount: 'see the bank letter' }))], [true, true])
check('an action date that is not a date is refused, not left for FNB to read as today', throws(() => fnbDate('21 Oct 2026')), true)

/* ---- THE HASH TOTAL (FNB's guide, "How is a Hash Total calculated on a CSV File?") ---- */
check('the guide\'s own example: the last 12 digits of 12345678987654321', fnbHashTotal(['12345678987654321'], '0'), '678987654321')
check('sum of the recipient account NUMBERS, plus the own account once', fnbHashTotal(['62000000001', '1234567890', '51234567'], OWN), '126098148136')
check('exact past 2^53, and zero-filled to twelve (right justified)', fnbHashTotal(['9999999999999999', '9999999999999999'], OWN), '062812345676')
check('the other reading (a sum of DIGITS) is there to switch to, and is different', fnbHashTotalDigitSum(['62000000001', '1234567890', '51234567'], OWN), '062812345765')
const hashed = bankFileCsv([pay({ accountNo: '62000000001' }), pay({ id: 'y', accountNo: '1234567890' }), pay({ id: 'z', accountNo: '51234567' })],
  new Set(['payover:x', 'payover:y', 'payover:z']), { ...OPTS, hashTotal: true })
check('asked for, row 3 B carries the hash of the accounts IN the file', cols(hashed.split('\r\n')[2]).slice(0, 2), [OWN, '126098148136'])

/* ---- NOTIFICATIONS: off unless passed; fax never ---- */
const notified = one({}, { ...OPTS, notify: () => ({ address: ' remit,tance@client.example ', subject: 'Payover BF PO-X-2610, October' }) })
check('passed, an email notice fills H-J: Yes, the address (nothing that breaks a column), the subject at 25',
  notified.slice(7, 10), ['Yes', 'remittance@client.example', 'Payover BF PO-X-2610 Octo'])
check('...and the fax columns W-AD stay blank, as FNB requires', notified.slice(22, 30).every((c) => c === ''), true)
check('a notice with no usable address writes no notice', one({}, { ...OPTS, notify: () => ({ address: ',,', subject: 'x' }) })[7], '')
check('the account type can be given per payment', one({}, { ...OPTS, accountType: () => '2' })[2], '2')

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-bank-file: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
