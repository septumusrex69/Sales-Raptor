/**
 * Reading the sales team's leads workbook.
 *
 * The dangerous thing about this import is not that it might fail — a failure is visible and gets
 * fixed. It is that it might quietly succeed at reading the wrong columns. The workbook is a tab
 * per sales month going back to February 2023, and over those three years columns were inserted
 * and removed, so "Client Name" is the eleventh column on most tabs, the tenth on three of them
 * and the twelfth on two more. An importer reading by position puts email addresses into the
 * company name field for a quarter of the book and reports two thousand leads imported.
 *
 * So the first and largest group of checks below is a tab shifted one column left and one column
 * right against the same expected lead. Everything else is the cells the real workbook actually
 * contains: amounts written three ways in one cell, dates that are not dates, forty spellings of
 * eight statuses, and a second column also called "Status".
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-leads-import.mjs
 */
import {
  planLeadsImport, leadInsertRows, readAmount, loneAmount, isoDate, statusFor, sourceFor, rejectionFor,
  splitName, SheetColumns, splitMarketers, marketerCredits, ownerFor, phoneNumber,
} from '../../src/lib/leadsImport.ts'
import { plainNumber } from '../../src/lib/xlsx.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass += 1
  else failures.push(`${name}\n     got      ${a}\n     expected ${e}`)
}
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }

/* ---------- 1. the same lead on three differently-shaped tabs ---------- */

/**
 * The three layouts, as they really appear. The middle one is the common eighteen-tab shape;
 * the first drops "Lead - First contact"; the last adds two more follow-up columns.
 */
const HEADERS = {
  narrow: ['No', 'Status', 'Lead - Start Date', 'Source', 'Referred by', 'Follow up - 1',
    'Follow up - 2', "Unsuccesfull Follow-up's", 'Marketer', 'Client Name', 'Rank',
    'Handover Amount', 'Commission', 'No. of Acc.', 'Industry', 'Contact Person', 'Email',
    'Cell', 'Email/Phone', 'Location', 'Reason', 'Status', 'Date signed', 'Handover date',
    'Introductory Notes'],
  common: ['No.', 'Status', 'Lead - Start Date', 'Source', 'Referred by', 'Lead - First contact',
    'Follow up - 1', 'Follow up - 2', "Unsuccessful Follow-up's", 'Marketer', 'Client Name',
    'Rank', 'Handover Amount', 'Commission', 'No. of Acc.', 'Industry', 'Contact Person',
    'Email', 'Cell', 'Email/Phone', 'Location', 'Rejection reason', 'Status', 'Date signed',
    'Date Rejected', 'Handover date', 'Introductory Notes', 'Event'],
  wide: ['No', 'Status', 'Lead - Start Date', 'Source', 'Referred by', 'Follow up - 1',
    'Follow up - 2', 'Follow up - 3', 'Follow up - 4', "Unsuccesfull Follow-up's", 'Marketer',
    'Client Name', 'Rank', 'Handover Amount', 'Commission', 'No. of Acc.', 'Industry',
    'Contact Person', 'Email', 'Cell', 'Email/Phone', 'Location', 'Reason', 'Status',
    'Date signed', 'Handover date', 'Introductory Notes'],
}

/** One lead's values, keyed by heading — laid out against whichever header row is asked for. */
const LEAD = {
  'Status': 'Clo',
  'Lead - Start Date': '2025/03/14',
  'Source': 'Google Ads Campaign',
  'Referred by': 'Pieter at the auditors',
  'Marketer': 'Nomsa',
  'Client Name': 'Karoo Plant Hire (Pty) Ltd',
  'Rank': 'B',
  'Handover Amount': '400 000',
  'Commission': '0.3',
  'No. of Acc.': '12',
  'Industry': 'Mining',
  'Contact Person': 'Thandeka van der Merwe',
  'Email': 'thandeka@karooplant.example',
  'Cell': '082 555 1234',
  'Email/Phone': 'accounts@karooplant.example',
  'Location': 'Rustenburg',
  'Introductory Notes': 'Twelve accounts, oldest from 2023.',
}

/** Put the values under their headings, wherever those headings happen to be on this tab. */
function laidOut(header, values) {
  const row = new Array(header.length).fill('')
  for (const [heading, value] of Object.entries(values)) {
    const i = header.indexOf(heading)
    if (i >= 0) row[i] = value
  }
  return row
}

const oneLead = (shape, values = LEAD, name = shape) =>
  ({ name, rows: [HEADERS[shape], laidOut(HEADERS[shape], values)] })

const only = (sheet) => planLeadsImport([sheet]).rows[0]

const narrow = only(oneLead('narrow'))
const common = only(oneLead('common'))
const wide = only(oneLead('wide'))

for (const [shape, got] of [['narrow', narrow], ['common', common], ['wide', wide]]) {
  check(`${shape} tab: the company is the company`, got.companyName, 'Karoo Plant Hire (Pty) Ltd')
  check(`${shape} tab: the email is an email`, got.email, 'thandeka@karooplant.example')
  check(`${shape} tab: the cell is the cell`, got.mobile, '082 555 1234')
  check(`${shape} tab: the amount is the amount`, got.estimatedHandoverAmount, 400000)
  check(`${shape} tab: the industry is the industry`, got.industry, 'Mining')
  check(`${shape} tab: the rank is the rank`, got.classification, 'B')
  check(`${shape} tab: the marketer is the marketer`, got.sourceMarketer, 'Nomsa')
  check(`${shape} tab: the date is the date`, got.createdAt, '2025-03-14')
  check(`${shape} tab: twelve accounts`, got.estimatedAccountsCount, 12)
}

// The point of all of the above, said once.
ok('all three layouts produce the identical lead',
  ['companyName', 'email', 'mobile', 'estimatedHandoverAmount', 'industry', 'classification',
    'sourceMarketer', 'createdAt', 'estimatedAccountsCount', 'status', 'source', 'firstName',
    'lastName'].every((f) => narrow[f] === common[f] && common[f] === wide[f]))

/*
 * The check that would have caught the bug this was written for. Reading by position, the narrow
 * tab's Client Name column (10 on the common layout) holds the Rank, and its Email column (17)
 * holds the Cell. If either of those ever shows up in a lead, the mapping has gone back to
 * counting columns.
 */
ok('a shifted tab never lands the rank in the company name', narrow.companyName !== 'B')
ok('a shifted tab never lands the cell in the email', narrow.email !== '082 555 1234')

/* ---------- 2. the second Status column ---------- */

const staged = only(oneLead('common', { ...LEAD, 'Status': 'Gla' }))
ok('the first Status column is the code', staged.status === 'Hot Lead')

const withStage = { ...LEAD }
const stageRow = laidOut(HEADERS.common, withStage)
stageRow[HEADERS.common.indexOf('Status', HEADERS.common.indexOf('Status') + 1)] = 'Mandate sent'
const stageLead = planLeadsImport([{ name: 's', rows: [HEADERS.common, stageRow] }]).rows[0]
ok('the second Status column is kept as a note, not read as the code',
  stageLead.status === 'Converted' && stageLead.notes.includes('Stage on the spreadsheet: Mandate sent'))

check('SheetColumns tells the two Status columns apart',
  [new SheetColumns(HEADERS.common).at('Status'), new SheetColumns(HEADERS.common).at('Status', 1)],
  [1, 22])
check('a heading the tab does not have is -1', new SheetColumns(HEADERS.narrow).at('Date Rejected'), -1)
check('either() takes whichever spelling the tab uses',
  [new SheetColumns(HEADERS.narrow).either('Rejection reason', 'Reason'),
    new SheetColumns(HEADERS.common).either('Rejection reason', 'Reason')], [20, 21])

/* ---------- 3. what the handover is worth ---------- */

/*
 * 192 of the 1,818 cells hold more than one figure, and they do not all mean the same thing.
 * The notes beside them settle it: "20 acc from 500- 2 000" and "Outstanding debt will range
 * from R 1000 to R 20 000" say a DASH is the size of one account, while "1500+2500" against a
 * count of 2 is "two jobs two different people" — an AMPERSAND OR PLUS is separate accounts.
 */

const amount = (cell, accounts = null) => readAmount(cell, accounts).value

/* --- one figure, however it was decorated --- */
check('a plain number', loneAmount('35000'), 35000)
check('South African spacing', loneAmount('1 250 000'), 1250000)
check('a non-breaking space, which is what Excel leaves behind',
  loneAmount('1 250 000'), 1250000)
check('a rand sign', loneAmount('R450 000'), 450000)
check('cents with a comma', loneAmount('12 500,50'), 12500.5)
check('cents with a full stop', loneAmount('12500.50'), 12500.5)
check('a comma grouping thousands', loneAmount('1,300 000'), 1300000)
check('about', loneAmount('40 000~'), 40000)
check('plus or minus', loneAmount('35 000+-'), 35000)
check('a minimum is still a figure', loneAmount('Minimum 40 000'), 40000)
check('thousands shorthand', loneAmount('17k'), 17000)
check('millions shorthand', loneAmount('8.5 m'), 8500000)
check('words that are not a number', loneAmount('ask reception'), null)
check('a foreign currency is not rands', loneAmount('$5000'), null)

/* --- a range: the size of one account, so the book is that times however many --- */
check('a range without a count is just its middle', amount('1 000-100 000'), 50500)
check('a range across 50 accounts', amount('1 000-100 000', 50), 2525000)
check('the real one from the workbook', amount('500-2 000', 20), 25000)
check('spaces around the dash', amount('20 000 - 60 000', 2), 80000)
check('no spaces at all', amount('2000-100000', 2), 102000)
check('a count of one changes nothing', amount('300-3 000', 1), 1650)
// Without the multiplication a 144-account book comes in at thirty thousand rand.
ok('a big book is not valued as one account',
  amount('1800-64 000', 144) > 4_000_000)
check('a backwards range is not a range', amount('100 000-2 000'), null)

/* --- several amounts: separate accounts, added up --- */
check('two, ampersand', amount('135 000&185 000', 2), 320000)
check('two, plus', amount('1500+2500', 2), 4000)
check('two, plus, larger', amount('60 000+30 000', 2), 90000)
check('three', amount('43 000&15 000&90 000', 3), 148000)
check('a slash', amount('600 000/880 000', 2), 1480000)
check('a comma separating two figures, not grouping one', amount('11 100,2800'), 13900)
check('an amount and a range together', amount('8 000&1000-3000', 6), 10000)
check('spaces around the ampersand', amount('900 & 2907', 2), 3807)
check('a list is never multiplied by the count — the figures are the accounts',
  amount('135 000&185 000', 50), 320000)

check('at least this much', loneAmount('100 000+'), 100000)
check('a range with an open top end', amount('7 000 - 1 000 000+', 10), 5035000)
check('"and" joins a list like an ampersand does', amount('17k and 7k', 2), 24000)
// "1500+2500" is two accounts, not one figure with a trailing plus.
check('a plus between two figures still adds them', amount('1500+2500', 2), 4000)

/* --- and what it still refuses --- */
check('dollars', amount('$5000'), null)
check('dollars spelled out', amount('15000USD'), null)
check('a figure with another bracketed inside it', amount('225 000(14 500-155 000)'), null)
check('a range with a bracketed total', amount('42 000-362 000(810 000)'), null)
check('a malformed group', amount('1 500 00,654 000'), null)
check('half a shorthand', amount('50 000-21.M'), null)
check('empty is empty', amount(''), null)
check('a dash means not applicable', amount('-'), null)
check('nothing at all', amount(undefined), null)

/*
 * The bug the strictness exists for: stripping the punctuation out of "42 000-362 000(810 000)"
 * and keeping the digits gives 42000362000810000. Across the book that produced a total of
 * sixty-five quadrillion rand, which is how it was noticed.
 */
ok('no reading ever concatenates the digits',
  amount('42 000-362 000(810 000)') !== 42000362000810000)

/* --- a figure that was worked out says so, on the lead --- */
const ranged = readAmount('500-2 000', 20)
ok('a range explains itself', ranged.basis.includes('"500-2 000"') && ranged.basis.includes('20'))
ok('and says it is the middle of the range', ranged.basis.includes('middle'))
const added = readAmount('135 000&185 000', 2)
ok('a list explains itself', added.basis.includes('added together'))
ok('and quotes the cell', added.basis.includes('"135 000&185 000"'))
check('a plain figure needs no explanation', readAmount('35 000', 4).basis, null)
check('and neither does one nobody could read', readAmount('$5000', 1).basis, null)

/*
 * The count multiplies a range into a handover value, so being out by a thousand here is out by
 * a thousand on the value of the lead. "Medical practice over 2k acc" has its count written
 * "2 000", and reading only the first run of digits made it a two-account practice.
 */
const counted = (n) => only(oneLead('common',
  { ...LEAD, 'No. of Acc.': n, 'Handover Amount': '600-8 000' }))
check('a plain count', counted('12').estimatedAccountsCount, 12)
check('a count Excel wrote as a float', counted('12.0').estimatedAccountsCount, 12)
check('a count with its thousands spaced', counted('2 000').estimatedAccountsCount, 2000)
check('a count with a word after it', counted('12 accounts').estimatedAccountsCount, 12)
check('a range of counts takes the lower', counted('20-30').estimatedAccountsCount, 20)
check('an open-ended count takes the figure', counted('10+').estimatedAccountsCount, 10)
check('no count is no count', counted('').estimatedAccountsCount, null)
check('and a thousand accounts are valued as a thousand',
  counted('2 000').estimatedHandoverAmount, 8600000)

/* ---------- 4. dates that are not dates ---------- */

check('a date', isoDate('2025/03/14'), '2025-03-14')
check('dashes work too', isoDate('2025-03-14'), '2025-03-14')
check('a single-digit month and day', isoDate('2025/3/4'), '2025-03-04')
check('month zero is not a month', isoDate('2026/0/21'), null)
check('month thirteen is not a month', isoDate('2025/13/01'), null)
check('the 31st of February is not a day', isoDate('2025/02/31'), null)
check('a leap day that exists', isoDate('2024/02/29'), '2024-02-29')
check('a leap day that does not', isoDate('2025/02/29'), null)
check('a note is not a date', isoDate('call him back'), null)
// "0206/07/27" is in the workbook — 2026 with the digits transposed. Left alone it produced a
// lead signed in the third century, which sorts above everything and reads as a bug in Raptor.
check('a year nobody meant', isoDate('0206/07/27'), null)
check('nor one far in the future', isoDate('2206/07/27'), null)
check('the near future is fine — these are diarised ahead', isoDate('2026/07/27'), '2026-07-27')
check('and so is the past the firm actually has', isoDate('2023/02/11'), '2023-02-11')
check('nothing', isoDate(''), null)

/* ---------- 5. the status codes ---------- */

check('Clo is signed', statusFor('Clo').status, 'Converted')
check('Gla is the mandate being out', statusFor('gla').status, 'Hot Lead')
check('Rej is rejected', statusFor('REJ').status, 'Rejected')
check('Ns and Nc are the same thing',
  [statusFor('ns').status, statusFor('nc').status], ['No Contact Yet', 'No Contact Yet'])
check('Ped and Ref are both still talking',
  [statusFor('ped').status, statusFor('ref').status], ['Interested', 'Interested'])
check('a blank code is not an unknown code', statusFor('').known, true)
check('an unknown code is flagged', statusFor('zzz').known, false)
check('an unknown code still produces a lead', statusFor('zzz').status, 'No Contact Yet')

/* ---------- 6. sources and rejection reasons ---------- */

check('Google', sourceFor('Google Ads Campaign'), 'Google Ads')
check('a Google search result emailed in is an email', sourceFor('Email from Google search'), 'Email')
check('referral', sourceFor('Referred by existing client'), 'Referral')
check('cold calling is direct', sourceFor('Cold call'), 'Direct')
check('knocking on doors is direct', sourceFor('Door to door'), 'Direct')
check('ChatGPT', sourceFor('Found us on ChatGPT'), 'ChatGPT')
check('LinkedIn', sourceFor('LinkedIn message'), 'LinkedIn')
check('anything else', sourceFor('Radio advert'), 'Other')
check('nothing said', sourceFor(''), 'Other')

check('we turned them down', rejectionFor('Rejected by us - no paperwork'), 'We declined them')
check('declined reads the same way', rejectionFor('Declined, book too small'), 'We declined them')
check('price', rejectionFor('Our commission too expensive'), 'Too expensive')
check('a competitor', rejectionFor('Went with another provider'), 'Went with another provider')
check('silence', rejectionFor('No response after 4 calls'), 'No response')
check('lost interest', rejectionFor('Client not interested anymore'), 'Not interested anymore')
check('anything else keeps its own words elsewhere', rejectionFor('Company liquidated'), 'Other')
check('no reason given', rejectionFor(''), null)

/* ---------- 7. names ---------- */

check('first and last', splitName('Thandeka van der Merwe', 'Karoo Plant Hire'), ['Thandeka', 'van der Merwe'])
check('one name only', splitName('Sipho', 'Bokmakierie Traders'), ['Sipho', '(no surname)'])
check('no contact person falls back to the company',
  splitName(null, 'Karoo Plant Hire (Pty) Ltd'), ['Karoo', 'Plant Hire (Pty) Ltd'])
check('neither', splitName(null, null), ['Unknown', '(no surname)'])
check('extra spaces do not become an empty surname',
  splitName('Thandeka   van der Merwe', null), ['Thandeka', 'van der Merwe'])

/* ---------- 8. the notes carry what Raptor has no column for ---------- */

check('the commission fraction is written as a percentage',
  common.notes.includes('Commission quoted: 30%'), true)
ok('the introductory note leads', common.notes.startsWith('Twelve accounts, oldest from 2023.'))
ok('the referrer is labelled as the referrer', common.notes.includes('Referred by: Pieter at the auditors'))
ok('the other contact is labelled as the other contact',
  common.notes.includes('Other contact: accounts@karooplant.example'))
ok('the location is labelled as the location', common.notes.includes('Location: Rustenburg'))

/*
 * These two are the shape of an earlier mistake: the second Status column arriving labelled
 * "Rejection reason", and the Email/Phone column arriving labelled "Location". Both survive an
 * import silently and mislead whoever reads the lead a year later.
 */
ok('the other contact is never labelled as the location',
  !common.notes.includes('Location: accounts@karooplant.example'))
ok('the stage is never labelled as a rejection reason',
  !stageLead.notes.includes('Rejection reason as written: Mandate sent'))

const messy = only(oneLead('common', { ...LEAD, 'Handover Amount': '42 000-362 000(810 000)' }))
check('an unreadable amount is left empty', messy.estimatedHandoverAmount, null)
ok('and the cell is kept word for word',
  messy.notes.includes('Handover amount as written: "42 000-362 000(810 000)"'))

// A worked-out figure must never appear in Raptor without the lead saying where it came from.
const fromRange = only(oneLead('common', { ...LEAD, 'Handover Amount': '500-2 000', 'No. of Acc.': '20' }))
check('a range becomes a figure', fromRange.estimatedHandoverAmount, 25000)
ok('and the lead says how',
  fromRange.notes.includes('"500-2 000"') && fromRange.notes.includes('middle'))

const signedOff = only(oneLead('common', { ...LEAD, 'Date signed': '2025/04/02' }))
ok('the sign date is kept', signedOff.notes.includes('Signed 2025-04-02'))

/*
 * A tidied sheet has already turned a range into a figure, so the cell holds a plain number and
 * the original wording sits beside it. Without this the worked-out figures arrive looking
 * exactly like quoted ones, which is the thing all of the above exists to prevent.
 */
const tidied = planLeadsImport([{
  name: 'Leads',
  rows: [
    [...HEADERS.common, 'Handover Amount as written'],
    [...laidOut(HEADERS.common, { ...LEAD, 'Handover Amount': '2525000', 'No. of Acc.': '50' }),
      '1 000-100 000'],
  ],
}]).rows[0]
check('the figure in the cell is the figure', tidied.estimatedHandoverAmount, 2525000)
ok('and the lead says it was worked out rather than quoted',
  tidied.notes.includes('"1 000-100 000"') && tidied.notes.includes('not quoted'))
ok('with the figure in it, so the note reads on its own',
  tidied.notes.includes('R2 525 000'))

// A plainly quoted figure gets no such line — there is nothing to explain.
ok('a quoted figure explains nothing', !common.notes.includes('not quoted'))

/* ---------- 9. rejection is a status, not a column ---------- */

const rejected = only(oneLead('common',
  { ...LEAD, 'Status': 'Rej', 'Rejection reason': 'Too expensive for them' }))
check('a rejected lead gets the reason', rejected.rejectionReason, 'Too expensive')

const live = only(oneLead('common',
  { ...LEAD, 'Status': 'Gla', 'Rejection reason': 'Too expensive for them' }))
check('a live lead does not get a rejection reason', live.rejectionReason, null)

const oddReason = only(oneLead('common',
  { ...LEAD, 'Status': 'Rej', 'Rejection reason': 'Company was liquidated' }))
check('an unmapped reason reports as Other', oddReason.rejectionReason, 'Other')
ok('and keeps its own words', oddReason.notes.includes('Rejection reason as written: Company was liquidated'))
ok('a mapped reason does not repeat itself in the notes',
  !rejected.notes.includes('Rejection reason as written'))

/* ---------- 10. the whole workbook ---------- */

const workbook = [
  oneLead('common', LEAD, 'Complete Leads List'),
  // The same lead again on the month it signed. One lead, not two.
  oneLead('narrow', LEAD, '3. 11 March - 10 Apr 2025'),
  // A different lead on a third layout.
  oneLead('wide', { ...LEAD, 'Client Name': 'Drakensberg Signage', 'Email': 'ops@drakensbergsignage.example' },
    '4. 11 Apr - 10 May 2025'),
  // A tab that is not a leads list at all.
  { name: 'Targets', rows: [['Month', 'Target'], ['March', '40']] },
  // A tab with the headings and nothing under them.
  { name: 'Leads Closed Previous months', rows: [HEADERS.common] },
]
const plan = planLeadsImport(workbook)

check('the same lead on two tabs comes through once', plan.counts.total, 2)
check('and the duplicate is counted', plan.counts.duplicates, 1)
check('the tab that is not a leads list is skipped',
  plan.sheets.find((s) => s.name === 'Targets').skipped, 'not a leads list')
/*
 * A covering note is not worth a warning — warning about it trains people to ignore warnings.
 * A leads tab whose key column has been RENAMED is the opposite: importing without it loses a
 * month quietly, so that one shouts.
 */
ok('a tab that was never a leads list is not warned about',
  !plan.warnings.some((w) => w.includes('Targets')))

const renamed = HEADERS.common.map((h) => (h === 'Client Name' ? 'Company' : h))
const lost = planLeadsImport([{
  name: '9. 11 Sep - 10 Oct 2025',
  rows: [renamed, laidOut(HEADERS.common, LEAD)],
}])
check('a leads tab with its key column renamed is skipped', lost.rows.length, 0)
ok('and it is warned about, because a month would go missing quietly',
  lost.warnings.some((w) => w.includes('9. 11 Sep - 10 Oct 2025') && w.includes('renamed')))
check('an empty tab is reported as empty, not as a broken tab',
  plan.sheets.find((s) => s.name === 'Leads Closed Previous months').skipped, 'no rows')
ok('an empty tab is not worth warning about',
  !plan.warnings.some((w) => w.includes('Leads Closed Previous months')))
check('every tab is accounted for', plan.sheets.length, workbook.length)
check('the counts add up', plan.byStatus, { Converted: 2 })

// A "Client Name" cell holding nothing but digits is a stray keystroke, not a company.
const junk = planLeadsImport([{
  name: 'junk',
  rows: [HEADERS.common, laidOut(HEADERS.common, { ...LEAD, 'Client Name': '51', 'Contact Person': '' })],
}])
check('a company name with no letters in it is not a lead', junk.rows.length, 0)
const numeric = planLeadsImport([{
  name: 'ok',
  rows: [HEADERS.common, laidOut(HEADERS.common, { ...LEAD, 'Client Name': '3 Rivers Logistics' })],
}])
check('but a name that merely starts with a digit is', numeric.rows[0].companyName, '3 Rivers Logistics')

/* ---------- 11. what actually gets written ---------- */

const OWNER = '48eb7492-9ed9-4a5b-90be-a8732ac13546'
const insert = leadInsertRows(plan, OWNER)

check('one row per lead', insert.length, 2)
ok('every row has an owner', insert.every((r) => r.owner_id === OWNER))
ok('every row has a company', insert.every((r) => r.company_name))
ok('every row has both names', insert.every((r) => r.first_name && r.last_name))
ok('every row carries a legacy key so a second run updates rather than doubles',
  insert.every((r) => typeof r.legacy_key === 'string' && r.legacy_key.length > 0))
ok('legacy keys are unique', new Set(insert.map((r) => r.legacy_key)).size === insert.length)
check('the start date becomes the created date', insert[0].created_at, '2025-03-14')
ok('every row is a debt collection lead',
  insert.every((r) => Array.isArray(r.services) && r.services[0] === 'Debt Collection'))

// Column names, not field names. One typo here is a failed insert at row one of two thousand.
const COLUMNS = ['legacy_key', 'first_name', 'last_name', 'company_name', 'email', 'mobile',
  'source', 'status', 'owner_id', 'industry', 'classification', 'estimated_handover_amount',
  'estimated_accounts_count', 'services', 'notes', 'source_marketer', 'rejection_reason']
ok('every key written is a snake_case column',
  insert.every((r) => Object.keys(r).every((k) => COLUMNS.includes(k) || k === 'created_at')))
ok('nothing is written camelCase',
  insert.every((r) => !Object.keys(r).some((k) => /[A-Z]/.test(k))))
ok('the score and the estimated value are left to their defaults',
  insert.every((r) => !('score' in r) && !('estimated_value' in r)))

// A lead with no start date takes the column default rather than a made-up one.
const undated = planLeadsImport([oneLead('common', { ...LEAD, 'Lead - Start Date': '' })])
ok('a lead with no date does not get an invented one',
  !('created_at' in leadInsertRows(undated, OWNER)[0]))

/* ---------- 12. what Excel actually stores ---------- */

/*
 * A cell's cached value is not the text you see in the cell. A mobile number typed as digits is
 * stored as a number, and Excel writes it in scientific notation — 450 of the 1,700 mobiles in
 * the current workbook. Reading it back raw imports "6.60185836E8" as somebody's phone number,
 * which is only discovered when somebody tries to phone them.
 */
check('a mobile stored as a number', plainNumber('6.60185836E8'), '660185836')
check('an international one', plainNumber('9.89177E11'), '989177000000')
check('lower case e', plainNumber('7.22519378e8'), '722519378')
check('an explicit plus', plainNumber('8.25537805E+8'), '825537805')
check('a small number keeps its decimals', plainNumber('1.5E-3'), '0.0015')
check('an ordinary number is left exactly as it is', plainNumber('35000'), null)
check('a decimal is left alone too', plainNumber('0.3'), null)
check('text is not a number', plainNumber('Karoo Plant Hire'), null)
check('empty is not a number', plainNumber(''), null)
// "Elite Labels" would be destroyed by a looser pattern; so would a South African cell number
// written with a leading zero, which is text and must stay text.
check('a word with an e in it is not scientific notation', plainNumber('Elite'), null)
check('a phone number written as text is left as text', plainNumber('082 555 1234'), null)

/* ---------- 13. who worked the lead ---------- */

/*
 * Three years of a shared spreadsheet: forty-two distinct spellings of eight people, and a
 * quarter of the cells name more than one of them.
 */
check('one person', splitMarketers('Barend'), ['Barend'])
check('two, slashed', splitMarketers('Barend/Destiny'), ['Barend', 'Destiny'])
check('spaces around the slash', splitMarketers('Felicia / Barend'), ['Felicia', 'Barend'])
check('four of them, spaced every which way',
  splitMarketers('Barend/ Stephan/ Zian / Destiny'), ['Barend', 'Stephan', 'Zian', 'Destiny'])
check('a trailing slash is not a person', splitMarketers('Barend/'), ['Barend'])
check('nobody', splitMarketers(null), [])
check('a blank cell is nobody', splitMarketers('   '), [])

const worked = (marketer) => ({ ...LEAD, 'Marketer': marketer, 'Client Name': `Co ${marketer}` })
const book = planLeadsImport([{
  name: 'book',
  rows: [HEADERS.common, ...[
    'Nomsa', 'Nomsa', 'nomsa', 'Pieter', 'Nomsa/Pieter', 'Pieter / Thabo', '', 'Thabo',
  ].map((m, i) => laidOut(HEADERS.common,
    { ...worked(m), 'Client Name': `Company ${i}`, 'Lead - Start Date': `2025/03/${10 + i}` }))],
}])
const credits = marketerCredits(book)

check('three people, commonest first', credits.map((c) => c.name), ['Nomsa', 'Pieter', 'Thabo'])
check('counted across the cells that name several', credits.map((c) => c.leads), [4, 3, 2])
check('and how many are shared', credits.map((c) => c.shared), [1, 2, 1])
check('and how many they are named first on', credits.map((c) => c.owns), [4, 2, 1])
check('a lower-case spelling is the same person',
  credits.find((c) => c.name === 'Nomsa').spellings, ['Nomsa', 'nomsa'])
ok('and the commonest spelling is the one shown',
  credits.find((c) => c.name === 'Nomsa').name === 'Nomsa')
ok('a blank marketer is not a person', !credits.some((c) => c.name === ''))

/*
 * A typo is not corrected. "Baren" is almost certainly Barend, but almost is not a basis for
 * moving somebody's work onto somebody else — it arrives as its own name, visible on the screen,
 * for a person who knows to resolve.
 */
const typo = marketerCredits(planLeadsImport([{
  name: 't', rows: [HEADERS.common, laidOut(HEADERS.common, worked('Nomas'))],
}]))
check('a misspelt name is its own name, not quietly merged', typo.map((c) => c.name), ['Nomas'])

const OWNERS = { fallback: 'fallback-id', byMarketer: { Nomsa: 'nomsa-id', Pieter: 'pieter-id' } }
const lead = (marketer) => planLeadsImport([{
  name: 'l', rows: [HEADERS.common, laidOut(HEADERS.common, worked(marketer))],
}]).rows[0]

check('a lead lands on the person who worked it', ownerFor(lead('Nomsa'), OWNERS), 'nomsa-id')
check('a joint lead lands on whoever is named first',
  ownerFor(lead('Nomsa/Pieter'), OWNERS), 'nomsa-id')
check('and the other way round', ownerFor(lead('Pieter/Nomsa'), OWNERS), 'pieter-id')
check('an unmapped first name falls through to the next one named',
  ownerFor(lead('Thabo/Pieter'), OWNERS), 'pieter-id')
check('nobody mapped at all falls back', ownerFor(lead('Thabo'), OWNERS), 'fallback-id')
check('a blank marketer falls back', ownerFor(lead(''), OWNERS), 'fallback-id')
check('case does not decide who gets the lead', ownerFor(lead('nomsa'), OWNERS), 'nomsa-id')

// Choosing an owner must not lose the fact that two people worked it.
check('the cell is kept exactly as written whoever it lands on',
  lead('Nomsa/Pieter').sourceMarketer, 'Nomsa/Pieter')

const mixed = planLeadsImport([{
  name: 'm',
  rows: [HEADERS.common, ...['Nomsa', 'Pieter/Nomsa', 'Thabo'].map((m, i) => laidOut(HEADERS.common,
    { ...worked(m), 'Client Name': `Co ${i}`, 'Lead - Start Date': `2025/04/${10 + i}` }))],
}])
check('a whole book splits across its owners',
  leadInsertRows(mixed, OWNERS).map((r) => r.owner_id),
  ['nomsa-id', 'pieter-id', 'fallback-id'])
check('and one owner for everybody still works',
  leadInsertRows(mixed, 'everyone-id').map((r) => r.owner_id),
  ['everyone-id', 'everyone-id', 'everyone-id'])

/* ---------- 14. numbers that can be dialled ---------- */

/*
 * Excel stores a number typed as digits as a number, and a number has no leading zero, so
 * 0828258252 comes back as 828258252 — 627 of the 1,706 numbers in this workbook. The only
 * symptom is a collector saying the number does not work.
 */
check('a mobile that lost its zero gets it back', phoneNumber('828258252'), '0828258252')
check('and one starting 7', phoneNumber('722519378'), '0722519378')
check('and one starting 6', phoneNumber('660185836'), '0660185836')
check('a landline too — nine digits is nine digits', phoneNumber('117894561'), '0117894561')
check('one that still has its zero is left alone', phoneNumber('082 555 1234'), '082 555 1234')
check('spacing is not tidied up', phoneNumber('082  555-1234'), '082  555-1234')
check('an international number is left alone', phoneNumber('263 774 452 774'), '263 774 452 774')
check('and one written with a plus', phoneNumber('+27 82 555 1234'), '+27 82 555 1234')
// The nine-digit rule must not fire on something that only looks like nine digits.
check('nine digits behind a plus is not a local number', phoneNumber('+12345 6789'), '+12345 6789')
check('a field with no number in it is no number', phoneNumber('No number'), null)
check('a dash is no number', phoneNumber('-'), null)
check('nothing is nothing', phoneNumber(''), null)

const dialable = only(oneLead('common', { ...LEAD, 'Cell': '828258252' }))
check('and it reaches the lead that way', dialable.mobile, '0828258252')

/* ---------- report ---------- */

if (failures.length) {
  console.error(`FAIL — ${failures.length} of ${pass + failures.length} checks\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`PASS — ${pass} checks: the same lead reads identically off three differently-shaped`)
console.log('       tabs, a dash means the size of one account while an ampersand means several,')
console.log('       and no figure reaches a lead without the lead saying where it came from.')
