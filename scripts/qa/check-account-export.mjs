/**
 * THE BOOK AS A CSV (Raptor · Handover 17, S18).
 *
 * An export is checked against the screen it came from. Every way it can be quietly wrong is
 * asserted here: a money column reading nought where it was never worked out, a client name with a
 * comma splitting a row, a debtor called "=HYPERLINK(...)" running in Excel, a page bigger than the
 * database hands back, a figure that is not computeBalance's.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-account-export.mjs
 */
import { readFileSync } from 'node:fs'
import {
  CSV_BOM, CSV_EOL, EXPORT_COLUMNS, cents, csvCell, exportColumns, exportFilename, headerLine, isoDay,
  positionLabel, rowLine,
} from '../../src/lib/accountExport.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

const account = (over = {}) => ({
  id: 'a1', caseNumber: 'RAP-100001', accountNumber: 'NB10000', clientReference: 'REF/0',
  debtorFirstName: 'Anna', debtorSurname: 'Mhlongo', debtorKind: 'individual', debtorIdNumber: '8001015009087',
  companyName: 'Northbank Properties', handoverDate: '2026-03-01', capitalHandedOver: 180000,
  interestRateAnnual: 0.24, book: 'active', status: 'Active: Unfrozen', subStatus: null, bucket: null,
  endedAs: null, endedOn: null, inDuplum: false, assignedTo: 'u1', lastActionAt: '2026-10-30T09:14:00Z',
  diaryDate: '2026-11-07', lastPaymentAt: null, prescriptionDate: '2029-03-01', clientActionAsk: null,
  ...over,
})
const balance = {
  capital: 180000, interest: 1234.5, fees: 250, receiptFees: 13.8, vat: 32.6, payments: 1000,
  balance: 180498.3, settlementFee: 120, settlement: 180618.3, waived: 0, withheld: 0,
  withheldFees: 0, withheldInterest: 0,
}
const nameOf = (id) => ({ u1: 'Lungi Dube' })[id]
const cols = exportColumns(true)
const header = headerLine(cols).split(',')
const cell = (line, h) => line.split(',')[header.indexOf(h)]

/* ---------- what is in it ---------- */

for (const h of ['Case number', 'Account number', 'Client reference', 'Debtor', 'ID / registration number',
  'Client', 'Handed over', 'Capital handed over', 'Interest', 'Fees (incl VAT)', 'Receipt fees (incl VAT)',
  'Paid', 'Balance', 'To settle', 'Book', 'Position', 'Status', 'Working the account', 'Last worked']) {
  ok(`the file has a "${h}" column`, header.includes(h))
}
check('no two columns share a header', new Set(EXPORT_COLUMNS.map((c) => c.header)).size, EXPORT_COLUMNS.length)

const line = rowLine(cols, account(), { balance, nameOf })
check('the case number', cell(line, 'Case number'), 'RAP-100001')
check('the debtor, first name and surname', cell(line, 'Debtor'), 'Anna Mhlongo')
check('the handover date as yyyy-mm-dd', cell(line, 'Handed over'), '2026-03-01')
check('capital with two decimals, no separator', cell(line, 'Capital handed over'), '180000.00')
check('interest off computeBalance', cell(line, 'Interest'), '1234.50')
check('receipt fees apart from the other fees', cell(line, 'Receipt fees (incl VAT)'), '13.80')
check('fees and interest as the list joins them', cell(line, 'Fees and interest'), '1498.30')
check('paid', cell(line, 'Paid'), '1000.00')
check('to settle is the settlement, as the list draws it', cell(line, 'To settle'), '180618.30')
check('the rate as a percentage', cell(line, 'Interest rate'), '24%')
check('the book in the firm’s word', cell(line, 'Book'), 'Active')
check('who is working it, by name', cell(line, 'Working the account'), 'Lungi Dube')
check('last worked as a day, not a timestamp', cell(line, 'Last worked'), '2026-10-30')
check('the position as the list’s pill reads it', cell(line, 'Position'), positionLabel(account()))
check('a never-worked account reads New, as on the desk', positionLabel(account({ lastActionAt: null })), 'New')
check('nobody holding it says so', cell(rowLine(cols, account({ assignedTo: null }), { balance, nameOf }), 'Working the account'), 'Unallocated')

/* ---------- money that was not worked out is blank, never nought ---------- */

const noMoney = rowLine(cols, account(), { balance: null, nameOf })
check('without the ledger, interest is EMPTY rather than 0.00', cell(noMoney, 'Interest'), '')
check('...and paid', cell(noMoney, 'Paid'), '')
check('...but capital is still there: it is on the account', cell(noMoney, 'Capital handed over'), '180000.00')
const quick = exportColumns(false)
ok('a quick export leaves the money columns out altogether', !quick.some((c) => c.money))
ok('...and keeps capital', quick.some((c) => c.header === 'Capital handed over'))
check('...and every row is as wide as its header', rowLine(quick, account(), { balance: null, nameOf }).split(',').length, quick.length)

/* ---------- quoting ---------- */

check('a comma is quoted', csvCell('Smit, Seun'), '"Smit, Seun"')
check('a quote is doubled', csvCell('The "Big" Shop'), '"The ""Big"" Shop"')
check('a line break is quoted', csvCell('a\nb'), '"a\nb"')
check('null is empty', csvCell(null), '')
check('a formula is defused', csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"')
check('...and a leading @', csvCell('@SUM(A1)'), "'@SUM(A1)")
check('...but a negative number we wrote stays a number', csvCell('-12.50', true), '-12.50')
const comma = rowLine(cols, account({ companyName: 'Highveld Glass & Aluminium, (Pty) Ltd' }), { balance, nameOf })
ok('a client name with a comma does not split the row', comma.includes('"Highveld Glass & Aluminium, (Pty) Ltd"'))

check('cents rounds half up to two places', cents(10.005 + 1e-9), '10.01')
check('isoDay off a timestamp', isoDay('2026-10-30T23:59:00+02:00'), '2026-10-30')
check('isoDay of nothing', isoDay(null), null)
check('the BOM is there, for Excel', CSV_BOM, '﻿')
check('CRLF line ends', CSV_EOL, '\r\n')
check('the filename says whose and which book', exportFilename({ clientName: 'Northbank Properties', book: 'Whole book', today: '2026-11-05' }),
  'accounts-northbank-properties-whole-book-2026-11-05.csv')
check('...and without a client', exportFilename({ book: 'Active', today: '2026-11-05' }), 'accounts-active-2026-11-05.csv')

/* ---------- the runner, read back ---------- */

const run = readFileSync(new URL('../../src/lib/accountExportRun.ts', import.meta.url), 'utf8')
ok('pages of a thousand, never more (PostgREST max-rows)', /EXPORT_PAGE = 1000\b/.test(run))
ok('the count is taken before the pages are read', /countAccounts\(selection\.query\)/.test(run))
ok('the balance is computeBalance over balanceInputFor, as on the list', /computeBalance\(balanceInputFor\(/.test(run))
ok('...through the shared ledger reader', /fetchLedgerRows\(supabase,/.test(run))
ok('...with written-off read the list’s way', /writtenOff: isWrittenOff/.test(run))
ok('it can be stopped', /signal\?\.aborted/.test(run))
ok('nothing in it writes', !/\.(insert|update|upsert|delete)\(|\.rpc\(/.test(run))

const list = readFileSync(new URL('../../src/pages/accounts/AccountsList.tsx', import.meta.url), 'utf8')
ok('the export is the screen’s own query', /query=\{query\}/.test(list))
/* WHO MAY EXPORT: whoever has the Trust (Stephan, 5 Nov) -- the finance.view tick, and nothing else. */
ok('the export is offered to whoever has the Trust', /const mayExport = canViewTrust\(currentUser\)/.test(list))
ok('...and both Export buttons ask that one question', (list.match(/\{mayExport && \(/g) ?? []).length === 1
  && /trailing=\{mayExport \?/.test(list))
ok('...and "all matching" is not a list of the ticked page', /ticked=\{allMatching \? \[\] : \[\.\.\.ticked\]\}/.test(list))
ok('Load more sits in the count line at the top', list.indexOf('data-testid="load-more"') > 0
  && list.indexOf('data-testid="load-more"') < list.indexOf('<table'))
ok('...and is no longer under the table', list.indexOf('Load {Math.min') === list.lastIndexOf('Load {Math.min'))

const filters = readFileSync(new URL('../../src/pages/accounts/AccountFilters.tsx', import.meta.url), 'utf8')
ok('the filter panel can hang from the right edge', /alignRight \? 'right-0' : 'left-0'/.test(filters))
ok('the chips have their own row', /basis-full flex flex-wrap/.test(filters))

console.log(`${pass} passed, ${failures.length} failed`)
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`)
  process.exit(1)
}
console.log('\nThe export is the screen\'s question, read whole, with the account page\'s figures.')
