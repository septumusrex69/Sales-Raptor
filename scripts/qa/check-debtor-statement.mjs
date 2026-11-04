/**
 * THE DEBTOR PORTAL'S STATEMENT CAN ACTUALLY BE DRAWN (Raptor H16, part 2).
 *
 * letterToPdf REFUSES a document whose merge fields the values cannot fill, rather than printing {{braces}} -- right
 * for a notice, and on the portal it would mean a debtor pressing "Download my statement" and getting an error. So this
 * draws one, through debtorStatement (the very function the server calls) and letterToPdf with filled: true, for an
 * ordinary account: one with NO identity number (97% of the book, CLAUDE.md) and the firm's trust account set.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-debtor-statement.mjs
 */
import { readFileSync } from 'node:fs'
import { debtorStatement, debtorLetterValues, unfilledFields, UNASSIGNED_SIGNER } from '../../src/lib/debtorStatement.ts'
import { fillLetter } from '../../src/lib/letterDocument.ts'
import { blanksFor, FILLABLE } from '../../src/lib/signingBlanks.ts'
import { affordability } from '../letters/affordability.mjs'
import { ledgerRowsByAccount } from '../../src/lib/storedBalance.ts'
import { FIRM_UNSET } from '../../src/lib/firmSettingsRow.ts'
import { A4_LETTERHEAD } from '../../src/lib/letterDocument.ts'
import { letterToPdf } from '../../src/lib/letterPdf.ts'
import { moneyZa } from '../../api/_lib/workflow/locale.ts'

let pass = 0
const failures = []
const ok = (name, v) => { if (v) pass += 1; else failures.push(name) }

const ACCOUNT = {
  id: 'a1', case_number: 'RAP-125318', capital_handed_over: 1500, handover_date: '2026-09-01', interest_rate_annual: 24,
  status: 'Active: Activated', last_action_at: null, ended_as: null, ended_on: null, prescribed: false, prescription_date: null,
  opening_as_at: '2026-09-01', listing_date: null, listing_reference: null, bureaus_listed: null, debtor_kind: 'individual',
  debtor_title: 'Ms', debtor_first_name: 'Tumelo Patience', debtor_surname: 'Molefe', account_number: 'ALP00010',
  client_reference: 'ALIANNAPH/30182', capital_outstanding: 1300, preferred_language: null, debtor_id_number: null,
}
const ledgers = ledgerRowsByAccount(['a1'], {
  payments: [{ account_id: 'a1', id: 'p1', received_at: '2026-10-01T00:00:00+02:00', amount: 200, paid_to_client: false, reversed_at: null, receipt_fee_legacy: null, rejected_at: null }],
  fees: [{ account_id: 'a1', incurred_at: '2026-09-05', description: 'Letter of demand', amount_excl_vat: 25, vat_amount: 3.75, billed: true, segments: null, cancelled_at: null, annexure_item: '1a', payment_id: null, legacy_name: null }],
  accruals: [],
}).get('a1')
const FIRM = {
  ...FIRM_UNSET, phone: '012 000 0000', email: 'collections@bredellferreira.co.za',
  trustBank: 'FNB', trustBranchCode: '250655', trustAccountName: 'Bredell Ferreira Attorneys Trust Account', trustAccountNumber: '62000000000', trustAccountType: 'Trust',
}
const collector = { name: 'Lungi Dube', phone: '012 000 0001', email: 'lungi@bredellferreira.co.za', whatsapp: null }

const built = debtorStatement({
  account: ACCOUNT, ledgers, firm: FIRM, contacts: [{ kind: 'email', value: 'tumelo@example.com', isPrimary: true, retiredAt: null }],
  collector, liaison: null, clientName: 'Alianna Pharmacy', today: '2026-11-03', money: moneyZa,
})
ok('it is the statement of account', JSON.stringify(built.doc).includes('Statement of account') || JSON.stringify(built.doc).includes('STATEMENT'))
ok(`the file is named for the case and the day (${built.fileName})`, built.fileName === 'Statement RAP-125318 2026-11-03.pdf')
let bytes = null
let why = ''
try {
  bytes = await letterToPdf({ doc: built.doc, page: A4_LETTERHEAD, filled: true, values: built.values, letterhead: null, charter: null })
} catch (e) { why = e instanceof Error ? e.message : String(e) }
const gaps = unfilledFields(built.doc, built.values)
ok(`every merge field it prints is filled for this account (unfilled: ${gaps.join(', ') || 'none'})`, gaps.length === 0)
ok('...the guard sees the fields it is meant to: the case number, the bank, the page numbers left to the printer',
  JSON.stringify(unfilledFields(built.doc, {})).includes('case_number') && JSON.stringify(unfilledFields(built.doc, {})).includes('firm_bank_account')
  && !unfilledFields(built.doc, {}).includes('page') && !unfilledFields(built.doc, {}).includes('debtor_id_masked'))
ok(`and it draws (${why || 'drawn'})`, bytes !== null)
ok('...as a PDF', bytes !== null && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-')
ok('...on an account with no identity number, which is most of the book', ACCOUNT.debtor_id_number === null && bytes !== null)

/* NOBODY HOLDS THE ACCOUNT (Raptor H16, 4 Nov): Stephan, as a debtor on an unassigned account, could not download
   the statement -- {{collector_name}} had nothing to fill it and the guard refused. The firm's team signs instead. */
const orphan = debtorStatement({
  account: ACCOUNT, ledgers, firm: FIRM, contacts: [], collector: null, liaison: null, clientName: 'Alianna Pharmacy', today: '2026-11-03', money: moneyZa,
})
const orphanGaps = unfilledFields(orphan.doc, orphan.values)
ok(`an account nobody holds still gets its statement (unfilled: ${orphanGaps.join(', ') || 'none'})`, orphanGaps.length === 0)
ok('...signed by the firm\'s collections team, not a person who does not exist', orphan.values.collector_name === UNASSIGNED_SIGNER.name)

/* ---------- THE AFFORDABILITY ASSESSMENT AN APPLICATION CARRIES (Stephan, 3 Nov: more than 12 months) ----------
   Built as createAssessment builds it: the account's values, every fillable field Raptor cannot answer plus the
   offer's three terms left as boxes. What must not happen is a {{field}} left on the page that is NOT one of the
   boxes -- the debtor would see braces they cannot fill. Both kinds of debtor, because the forms differ. */
for (const kind of ['individual', 'company']) {
  const { values } = debtorLetterValues({
    account: { ...ACCOUNT, debtor_kind: kind }, ledgers, firm: FIRM, contacts: [], collector, liaison: null,
    clientName: 'Alianna Pharmacy', today: '2026-11-03', money: moneyZa,
  })
  const unanswered = FILLABLE.filter((b) => !(values[b.key] ?? '').trim()).map((b) => b.key)
  const blanks = blanksFor([...unanswered, 'ptp_amount', 'ptp_frequency', 'ptp_date'], kind)
  const filled = fillLetter(affordability(kind), values, blanks.map((b) => b.key))
  const boxes = new Set(blanks.map((b) => b.key))
  const left = [...new Set([...JSON.stringify(filled.blocks).matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/g)].map((m) => m[1]))]
  const stray = left.filter((k) => !boxes.has(k))
  ok(`the ${kind}'s assessment leaves only the debtor's boxes open (stray: ${stray.join(', ') || 'none'})`, stray.length === 0)
  ok(`...and asks for the offer's terms and the money lines (${boxes.size} boxes)`, boxes.has('ptp_amount') && boxes.has('ptp_date') && boxes.size >= 6)
}

/* AND THE SERVER CALLS THIS, rather than a statement of its own. */
const api = readFileSync(new URL('../../api/_lib/debtorPortal.ts', import.meta.url), 'utf8')
ok('the server refuses to draw a statement with a field it cannot fill', /const gaps = unfilledFields\(doc, values\)\s*if \(gaps\.length\) \{[\s\S]{0,400}return\s*\}\s*const paper = await letterheadFor/.test(api))
ok('the server draws the statement through debtorStatement and letterToPdf, on the letterhead',
  /debtorStatement\(input\)/.test(api) && /letterToPdf\(\{ doc, page: paper\.page, filled: true, values, letterhead: paper\.image/.test(api))
/* AND A PROOF OF PAYMENT IS NEVER MONEY. */
const pop = api.slice(api.indexOf('const proofOfPayment: Handler'), api.indexOf('const signOut: Handler'))
ok('a proof of payment is kept as a document', /from\('account_documents'\)\.insert\(/.test(pop) && /kind: 'Proof of payment'/.test(pop))
ok('...and touches no ledger: no payment, no allocation, no fee', pop.length > 0 && !/account_payments|payment_allocations|account_fees|allocate_payment|rpc\(/.test(pop))

console.log(`\ncheck-debtor-statement: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
