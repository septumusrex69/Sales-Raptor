/**
 * RAPTOR · HANDOVER 16 -- THE LETTER OF DEMAND'S RULES (Ryno's builder, inside Raptor, 3 Nov).
 *
 * Held here, without a browser: the money (a line total in cents, the amount due), the days in words, what is
 * still missing before a PDF, what an ACCOUNT fills in (our case number as the reference, one line, today's
 * balance only where it differs), the debtor's email (the primary live one, never a retired one), and that the
 * server route sends in somebody else's name only with campaign.run and never bills or files on its own -- the
 * browser records through recordSentEmail, the one path every email to a debtor takes.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-letter-of-demand.mjs
 */
import { readFileSync } from 'node:fs'

const L = await import('../../src/lib/letterOfDemand.ts')

let pass = 0
const failures = []
const check = (name, got, want) => {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g === w) pass += 1
  else failures.push(`${name}\n      expected ${w}\n      got      ${g}`)
}
const ok = (name, v) => check(name, !!v, true)
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/* ---------- money ---------- */
check('amounts are read however they are typed', ['R106,000.00', '106 000', 'R 1 250.50', 'abc', ''].map(L.parseAmt), [106000, 106000, 1250.5, null, null])
check('the rand is written with commas, never a non-breaking space', L.fmtRand(106000), 'R106,000.00')
const tenths = { rows: Array.from({ length: 12 }, () => ({ ...L.blankRow(), amt: 'R0.10' })) }
check('lines add up in cents, not in floating point', L.linesTotal(tenths), 1.2)
check('the amount due is the lines\' total', L.amountDue({ amount: '', rows: [{ ...L.blankRow(), amt: '100' }, { ...L.blankRow(), amt: '50.5' }] }), 150.5)
check('...unless one is typed', L.amountDue({ amount: 'R200', rows: [{ ...L.blankRow(), amt: '100' }] }), 200)
check('...and nothing yet is nothing, not R0.00', L.amountDue({ amount: '', rows: [L.blankRow()] }), null)
check('days in words', [1, 7, 14, 21, 30, 99, 100].map(L.numberWord), ['one', 'seven', 'fourteen', 'twenty-one', 'thirty', 'ninety-nine', null])

/* ---------- what is missing ---------- */
const blank = L.freshLetter('2026-11-03')
check('a new letter is dated today, as the letter writes a date', blank.date, '3 November 2026')
check('a blank letter names every field it still needs', L.missingFor(blank, 'letter'), ['Debtor', 'Client', 'Statement date', 'Payment reference', 'Amount due', '1 invoice'])
check('...the acknowledgement needs fewer', L.missingFor(blank, 'ack'), ['Debtor', 'Client', 'Payment reference', 'Amount due'])

/* ---------- an account ---------- */
const acc = { caseNumber: 'TRV00412', accountNumber: 'INVO000798', clientReference: '2608/1619', debtorFirstName: 'Esmar Transport (Pty) Ltd', debtorSurname: '',
  debtorKind: 'company', capitalHandedOver: 106000, handoverDate: '2026-08-11' }
const filled = L.letterFromAccount(blank, acc, 'Truevisions Enterprises (Pty) Ltd', 106000, 'accounts@esmar.example')
check('an account fills the parties, our case number as the reference, and its email',
  [filled.debtor, filled.client, filled.ref, filled.email], ['Esmar Transport (Pty) Ltd', 'Truevisions Enterprises (Pty) Ltd', 'TRV00412', 'accounts@esmar.example'])
check('...one line, the creditor\'s account number and the capital handed over', filled.rows, [{ inv: 'INVO000798', date: '11 Aug 2026', ref: '2608/1619', desc: 'Amount handed over for collection', amt: 'R106,000.00' }])
check('...and leaves the amount to the line where today\'s balance is the same', filled.amount, '')
check('today\'s balance, where it differs, is the amount due', L.letterFromAccount(blank, acc, 'X', 112345.6, null).amount, 'R112,345.60')
check('...and so is what the letter demands', L.amountDue(L.letterFromAccount(blank, acc, 'X', 112345.6, null)), 112345.6)
check('an account with no account number gives our case number as the invoice', L.letterFromAccount(blank, { ...acc, accountNumber: null }, 'X', null, null).rows[0].inv, 'TRV00412')
check('a person is named first name then surname; a company by its name', [L.debtorName({ debtorFirstName: 'Piet', debtorSurname: 'Smit', debtorKind: 'individual' }), L.debtorName({ debtorFirstName: '', debtorSurname: 'Smit & Seun', debtorKind: 'company' })], ['Piet Smit', 'Smit & Seun'])
check('the debtor\'s email is the primary live one', L.debtorEmail([
  { kind: 'email', value: 'old@x.co', is_primary: true, retired_at: '2026-01-01' },
  { kind: 'email', value: 'Main@X.co', is_primary: true, retired_at: null },
  { kind: 'mobile', value: '082', is_primary: true, retired_at: null },
]), 'main@x.co')
check('...else the newest live one, never a retired one', L.debtorEmail([
  { kind: 'email', value: 'a@x.co', retired_at: null, created_at: '2026-01-01' }, { kind: 'email', value: 'b@x.co', retired_at: null, created_at: '2026-06-01' },
  { kind: 'email', value: 'c@x.co', retired_at: '2026-07-01', created_at: '2026-07-01' },
]), 'b@x.co')
check('...and none is none', L.debtorEmail([]), null)
check('a file name a folder will take', L.letterFileName('Letter of Demand', { debtor: 'A/B: "C"', date: '3 November 2026' }), 'Letter of Demand - AB C - 3 November 2026.pdf')

/* ---------- the source holds ---------- */
const route = strip(readFileSync(new URL('../../api/_lib/email/letter.ts', import.meta.url), 'utf8'))
ok('sending in somebody else\'s name needs campaign.run', /if \(from !== 'me' && !mayOthers\)/.test(route) && /const mayOthers = can\(caller, 'campaign\.run'\)/.test(route))
ok('...a mailbox that is not connected sends nothing', /if \(!mailboxes\.has\(senderId\)\)/.test(route))
ok('...the letter must be attached', /if \(!files\.length\)/.test(route))
ok('the route itself never charges or files: that is recordSentEmail\'s', !/chargeItem|account_emails|account_fees/.test(route))
const page = strip(readFileSync(new URL('../../src/pages/letters/LetterOfDemandPage.tsx', import.meta.url), 'utf8'))
ok('a letter sent about an account is recorded as every email to a debtor is', /const charge = await recordSentEmail\(\{\s*accountId: account\.id/.test(page))
ok('...and its copy kept under the account\'s Documents as a Letter of Demand', /kind: 'Letter of Demand'/.test(page) && /uploadDocument\(/.test(page))
ok('the page writes no account figure', !/from\('debtor_accounts'\)\.(update|insert|upsert)|from\('account_(fees|payments)'\)\.(insert|update)/.test(page))
const sheet = strip(readFileSync(new URL('../../src/pages/letters/demandSheet.ts', import.meta.url), 'utf8'))
ok('a character the fonts cannot print is refused and named, never swapped', /if \(missing\.size\) throw new UnprintableError/.test(sheet))
ok('the wording editor draws the sheet at full size: no caret on a scaled page', /const s = this\.editing \? 1 : Math\.min\(1, avail \/ w\)/.test(sheet))
ok('the OFL notice travels with the fonts', /SIL OPEN FONT LICENSE Version 1\.1/.test(readFileSync(new URL('../../public/letter-of-demand/fonts/LICENCE.txt', import.meta.url), 'utf8')))

console.log(`\ncheck-letter-of-demand: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
