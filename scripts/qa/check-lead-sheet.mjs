/**
 * Reading the sales team's leads sheet.
 *
 * Every case here is a cell from the real sheet (Leads List, 11 Oct – 10 Nov 2026), written the
 * way somebody actually typed it.
 *
 * Run: node --experimental-strip-types --import ./scripts/qa/tsresolve.mjs scripts/qa/check-lead-sheet.mjs
 */
import {
  guessMapping, guessValues, planLeadSheet, readSheet, sheetAmount, sheetCount, sheetDates, sheetEmails, sheetOutcome, sheetPhones, sheetRejection,
  sheetSource, splitName,
} from '../../src/lib/leadSheetImport.ts'
import { parseCsvRows } from '../../src/lib/csv.ts'
import { rateForCapital } from '../../src/lib/commission.ts'
import { SA_LANGUAGES, normaliseLanguage } from '../../src/lib/languages.ts'
import {
  SLIDING_SCALES, choiceFromTerms, commissionLabel, parseCommission, termsFromChoice,
} from '../../src/lib/commissionPlans.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push(`${name}\n     expected ${e}, got ${a}`)
}
const TODAY = '2026-11-11'

// Dates
check('plain', sheetDates('2026/10/12', TODAY), ['2026-10-12'])
check('several', sheetDates('2026/10/12,2026/10/20,2026/10/22', TODAY), ['2026-10-12', '2026-10-20', '2026-10-22'])
check('with a remark', sheetDates('2026/10/22 (will speak to the bosses today)', TODAY), ['2026-10-22'])
check('missing slash', sheetDates('2026/1102', TODAY), ['2026-11-02'])
check('double slash', sheetDates('2026//10/26', TODAY), ['2026-10-26'])
check('suffix', sheetDates('2026/10/15-F', TODAY), ['2026-10-15'])
check('future typo', sheetDates('2029/10/29', TODAY), [])
check('three-digit year', sheetDates('202/10/02', TODAY), [])
check('a phone number is not a date', sheetDates('0826303869 teagan', TODAY), [])
check('no date', sheetDates('Email 2 sent', TODAY), [])

// Amounts
check('spaced thousands', sheetAmount('18 000').amount, 18000)
check('commas', sheetAmount('1,016,434.04').amount, 1016434.04)
check('broken decimal', sheetAmount('42 186. 60').amount, 42186.6)
check('millions', sheetAmount('1.2 M').amount, 1200000)
check('range takes low end', sheetAmount('4 000-20 000').amount, 4000)
check('k range', sheetAmount('34K-1M').amount, 34000)
check('less than', sheetAmount('Less  than 50 000').amount, 50000)
check('less than is not plain', sheetAmount('Less  than 50 000').plain, false)
check('plain figure is plain', sheetAmount('81 200').plain, true)
check('range is not plain', sheetAmount('4 000-20 000').plain, false)
check('empty', sheetAmount('').amount, undefined)

// Account counts
check('count', sheetCount('7'), 7)
check('count range', sheetCount('10-15'), 10)
check('count plus', sheetCount('30+'), 30)
check('count spaced', sheetCount('3 000'), 3000)
check('count blank', sheetCount('  '), undefined)

// Emails and phones
check('trailing >', sheetEmails('stopforthendrik@gmail.com>'), ['stopforthendrik@gmail.com'])
check("trailing '", sheetEmails("truckworx@ymail.com'"), ['truckworx@ymail.com'])
check('several, deduped', sheetEmails('filadelfia.finance@outlook.com\nFiladelfia.finance@outlook.com \ntembaidso@gmail.com'),
  ['filadelfia.finance@outlook.com', 'tembaidso@gmail.com'])
check('two numbers in one cell', sheetPhones("063 990 1441.'083 408 3665 "), ['0639901441', '0834083665'])
check('lost its zero', sheetPhones('724647691'), ['0724647691'])
check('with a name', sheetPhones('0826303869 teagan'), ['0826303869'])
check('foreign kept', sheetPhones('+267 73 002 367'), ['+267 73 002 367'])
check('not a number', sheetPhones('No contact'), [])
check('a date is not a number', sheetPhones('2026/11/06'), [])

// Names
check('surname first', splitName('Youngman, Stacie '), { firstName: 'Stacie', lastName: 'Youngman' })
check('particle', splitName('Michelle van Wyk'), { firstName: 'Michelle', lastName: 'van Wyk' })
check('one name', splitName('Thabo'), { firstName: 'Thabo', lastName: '' })
check('trailing full stop', splitName('Heidi Naude.'), { firstName: 'Heidi', lastName: 'Naude' })

// Sources
check('google', sheetSource('Google').source, 'Google Ads')
check('misspelt referral', sheetSource('Refferal').source, 'Referral')
check('email campaign kept', sheetSource('Email Marketing - Saqiba'), { source: 'Email', campaign: 'Email Marketing - Saqiba' })
check('chat gpt', sheetSource('Chat GPT').source, 'ChatGPT')
check('germini', sheetSource('Germini').source, 'Gemini')
check('blank', sheetSource('').source, 'Other')

// Outcomes
check('closed', sheetOutcome('Clo', 'Mandate sent', true), { status: 'Converted', dealStage: 'Won' })
check('rejected beats mandate sent', sheetOutcome('Rej', 'Mandate sent', true), { status: 'Rejected', dealStage: 'Rejected' })
check('good lead with mandate out', sheetOutcome('Gla', 'Mandate sent ', true), { status: 'Hot Lead', dealStage: 'Mandate Sent' })
check('quoted', sheetOutcome('Ref', 'Quoted ', true), { status: 'Hot Lead', dealStage: 'Quotation Sent' })
check('meeting, any case', sheetOutcome('Gla', 'ARRanging meeting ', true), { status: 'Hot Lead', dealStage: 'New Deal' })
check('waiting', sheetOutcome('Gla', 'Waiting for info', true), { status: 'Interested', dealStage: 'New Deal' })
check('no contact', sheetOutcome('Nc', 'Waiting for info', false), { status: 'No Contact Yet', dealStage: 'New Deal' })
check('referred out', sheetOutcome('Ref', 'Referred', false).status, 'Rejected')
check('blank code, rejected', sheetOutcome('', 'Rejected', false).status, 'Rejected')

// Rejection reasons
check('price', sheetRejection('Price'), 'Too expensive')
check('commission', sheetRejection('Commission too high'), 'Too expensive')
check('someone else', sheetRejection('Found someone else'), 'Went with another provider')
check('by us', sheetRejection('Rejected by us'), 'We declined them')
check('changed mind', sheetRejection('Changed their mind'), 'Not interested anymore')
check('blank', sheetRejection(''), 'Other')

// The whole sheet, in miniature: two Status columns, a multi-line cell, a duplicate, a totals block.
const header = '   ,Status,Lead - Start Date,Source,Referred by,Lead - First contact,Follow up - 1,Follow up - 2,'
  + "Unsuccessful Follow-up's,Marketer,Client Name,Rank,Handover Amount,Commission,No. of Acc.,Industry,Contact Person,"
  + 'Email,Cell,Email/Phone,Location,Rejection reason,Status,Date signed,Date Rejected,Handover date,Introductory Notes,Event'
const csv = [
  header,
  '1,Clo,2026/10/12,Google,,2026/10/12,,,,Destiny,Triiton Monitoring,C,18 000,30%,1,Security,Jana Pudifin,accounts@triiton.co.za,061 439 5094,,,,Mandate sent,2026/10/19,,,"We have an overdue\ndebtor",',
  '2,Gla,2026/10/13,Referral,Frik,2026/10/14,,,,Nobody,Swart Digital,B,4 000-20 000,25%,10-15,Digital,Michelle van Wyk,michelle@swartdigital.co.za,0784528542,,,,Mandate sent,,,,,',
  '3,Rej,2026/10/14,Google,,2026/10/14,,,,Felicia,Henry Marsh,C,180 000,25%,1,,Henry Marsh,info@henrymarsh.co.za,0835562222,,,Commission too high,Rejected,,2026/10/20,,,',
  '4,Gla,2026/10/15,Google,,,,,,Felicia,Already Here Ltd,,,,,,Someone,someone@here.co.za,,,,,,,,,,',
  '5,Clo,2026/10/16,Google,,,,,,Felicia,Triiton Monitoring,C,,,,,Jana,accounts@triiton.co.za,,,,,,,,,,',
  '110,Gla,2026/11/06,,,2026/11/06,,,,Ryno,,,,,,,,,,,,,,,,,,',
  ',,,,,,,,,,,,,,,,,,,,,,,,,,,',
  ',,,Total Leads,73,Source Total,12,Keywords,,Total Mandates Signed,,,,,,,,,,,,,,,,,,',
].join('\n')
let n = 0
const users = [
  { id: 'd', name: 'Destiny Mokoena', status: 'Active' },
  { id: 'f', name: 'Felicia Botha', status: 'Active' },
  { id: 'r', name: 'Ryno Bredell', status: 'Active' },
]
const existing = { leads: [{ id: 'x', leadNumber: 7, companyName: 'Already Here (Pty) Ltd', email: 'other@here.co.za' }], companies: [], users }
const sheet = readSheet(parseCsvRows(csv))
const mapping = guessMapping(sheet)
const { maps } = guessValues(sheet, mapping, users, 'r')
const opts = { defaultOwnerId: 'r', today: TODAY, newId: () => `id${++n}` }
const plan = planLeadSheet(sheet, mapping, maps, existing, opts)

check('two Status columns: status then progress', [mapping[1], mapping[22]], ['status', 'progress'])
check('referred by goes to notes', mapping[4], 'notes')
check('follow-ups are contact dates', mapping.slice(5, 9), ['contactDates', 'contactDates', 'contactDates', 'contactDates'])
check('empty column left out', mapping[27], 'ignore')
check('Clo · Mandate sent guessed as signed', maps.outcome['Clo · Mandate sent'], 'signed')
check('rep matched by first name', maps.owner.Felicia, 'f')
check('unknown rep goes to default', maps.owner.Nobody, 'r')
check('commission guessed', maps.commission['25%'], { choice: '0.25', custom: '' })
check('leads read', plan.leads.length, 3)
check('skipped: existing and in-sheet duplicate', plan.skipped.map((s) => s.sheetNumber), ['4', '5'])
check('rep-only row left out', plan.skippedBlank, 1)
const [triiton, swart, marsh] = plan.leads
check('first Status column is the code', triiton.lead.status, 'Converted')
check('signed deal is Won on the sign date', [triiton.deal.stage, triiton.deal.wonAt], ['Won', '2026-10-19T09:00:00+02:00'])
check('won lead points at its deal', triiton.lead.convertedDealId, triiton.deal.id)
check('signed client carries the estimate', triiton.newCompany?.estimatedHandoverAmount, 18000)
check('multi-line enquiry kept', triiton.lead.notes?.startsWith('Enquiry: We have an overdue\ndebtor'), true)
check('unmatched rep goes to default', swart.lead.ownerId, 'r')
check('unmatched rep kept in notes', swart.lead.notes?.includes('Rep on the sheet: Nobody'), true)
check('range low end', swart.lead.estimatedHandoverAmount, 4000)
check('range kept as written', swart.lead.notes?.includes('Amount as written: 4 000-20 000'), true)
check('mandate out has a date', swart.deal.mandateSentAt, '2026-10-14T09:00:00+02:00')
check('referred by kept', swart.lead.notes?.includes('Referred by: Frik'), true)
check('rejected with reason', [marsh.lead.status, marsh.lead.rejectionReason, marsh.lead.rejectionNote], ['Rejected', 'Too expensive', 'Commission too high'])
check('rejected on the date given', marsh.deal.rejectedAt, '2026-10-20T09:00:00+02:00')
check('handover deal carries no value', [marsh.deal.kind, marsh.deal.value, marsh.deal.handoverAmount], ['Handover', 0, 180000])
check('in date order', plan.leads.map((p) => p.sheetNumber), ['1', '2', '3'])

check('flat commission carried', triiton.lead.commissionRate, 0.3)

// A person's choices win over the guesses.
const overridden = planLeadSheet(sheet, mapping, { ...maps, outcome: { ...maps.outcome, 'Gla · Mandate sent': 'interested' } }, existing, opts)
check('chosen outcome used', overridden.leads.find((p) => p.sheetNumber === '2').lead.status, 'Interested')

// Any other sheet: different headings, matched by what they mean.
const other = readSheet(parseCsvRows('Company,Name,Phone,E-mail,Rep,Status,Date,Notes\nAcme,Jo Soap,082 111 2222,jo@acme.co.za,Destiny,Won,2026/09/01,Big book\nBeta,,0123456789,,,Lost,2026/09/02,'))
const otherMap = guessMapping(other)
check('generic headings', otherMap, ['clientName', 'contactName', 'phone', 'email', 'owner', 'status', 'createdDate', 'notes'])
const otherVals = guessValues(other, otherMap, users, 'r').maps
check('won / lost guessed', [otherVals.outcome['Won · (blank)'], otherVals.outcome['Lost · (blank)']], ['signed', 'rejected'])
const otherPlan = planLeadSheet(other, otherMap, otherVals, { leads: [], companies: [], users }, opts)
check('generic sheet imports', otherPlan.leads.map((p) => [p.lead.companyName, p.lead.status, p.lead.ownerId]), [['Acme', 'Converted', 'd'], ['Beta', 'Rejected', 'r']])
check('unmapped column kept in notes', otherPlan.leads[0].lead.notes.includes('Notes: Big book'), true)

// Two columns on one single field is refused, not silently resolved.
const clash = planLeadSheet(other, otherMap.map((t) => (t === 'contactName' ? 'clientName' : t)), otherVals, { leads: [], companies: [], users }, opts)
check('clash refused', [clash.leads.length, clash.problems.length], [0, 1])

// Commission terms
check('flat', parseCommission('30%'), { commissionRate: 0.3 })
check('decimal', parseCommission('27.50%'), { commissionRate: 0.275 })
check('scale, number first', parseCommission('25%SS'), { commissionScale: 'SS25' })
check('scale, SS first', parseCommission('SS25%'), { commissionScale: 'SS25' })
check('scale, no %', parseCommission('25SS'), { commissionScale: 'SS25' })
check('which scale unknown', parseCommission('SS'), undefined)
check('listed rate picks its option', choiceFromTerms({ commissionRate: 0.225 }), { choice: '0.225', custom: '' })
check('unlisted rate is custom', choiceFromTerms({ commissionRate: 0.28 }), { choice: 'custom', custom: '28' })
check('custom back to terms', termsFromChoice('custom', '28'), { commissionRate: 0.28, commissionScale: undefined })
check('scale clears rate', termsFromChoice('SS30', ''), { commissionRate: undefined, commissionScale: 'SS30' })
check('none clears both', termsFromChoice('', ''), { commissionRate: undefined, commissionScale: undefined })
check('label', [commissionLabel({ commissionRate: 0.275 }), commissionLabel({ commissionScale: 'SS25' })], ['27.5%', '25% sliding scale'])
// The scales as Ryno set them out, 11 Nov 2026. A boundary rand belongs to the lower band.
const ss25 = { source: 'test', bands: SLIDING_SCALES.SS25.bands }
const ss30 = { source: 'test', bands: SLIDING_SCALES.SS30.bands }
check('SS25 bands', [50_000, 100_000, 100_001, 500_000, 750_000, 1_000_000, 2_000_000].map((c) => rateForCapital(c, ss25)), [0.25, 0.25, 0.2, 0.2, 0.15, 0.15, 0.1])
check('SS30 bands', [50_000, 100_001, 750_000, 2_000_000].map((c) => rateForCapital(c, ss30)), [0.3, 0.25, 0.2, 0.15])

// Languages: all twelve official ones, plus Other.
check('thirteen choices', SA_LANGUAGES.length, 13)
check('aliases', ['zulu', 'IsiXhosa', 'Afr', 'northern sotho', 'Shangaan', 'SASL', 'Portuguese', ''].map(normaliseLanguage),
  ['isiZulu', 'isiXhosa', 'Afrikaans', 'Sepedi', 'Xitsonga', 'South African Sign Language', 'Portuguese', undefined])
const langSheet = readSheet(parseCsvRows('Client,Email,Language\nAcme,a@acme.co.za,Zulu'))
const langMap = guessMapping(langSheet)
check('language column found', langMap[2], 'language')
const langPlan = planLeadSheet(langSheet, langMap, guessValues(langSheet, langMap, users, 'r').maps, { leads: [], companies: [], users }, opts)
check('language on lead and client', [langPlan.leads[0].lead.preferredLanguage, langPlan.leads[0].newCompany.preferredLanguage], ['isiZulu', 'isiZulu'])

const notSheet = readSheet([['Name', 'Email'], ['a', 'b']])
const notMap = guessMapping(notSheet)
check('a sheet with only a name still reads', planLeadSheet(notSheet, notMap, guessValues(notSheet, notMap, users, 'r').maps, { leads: [], companies: [], users }, opts).leads.length, 1)

console.log(`${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  !! ${f}`)
process.exit(failures.length ? 1 : 0)
