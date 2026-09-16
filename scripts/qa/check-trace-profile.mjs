/**
 * Reading a credit bureau profile, and putting it on an account.
 *
 * The firm pays for every trace under Annexure B item 4(c) and, until now, filed the PDF and
 * retyped the answer — or did not. This is the reading of it.
 *
 * NO REAL PROFILE IS IN THIS FILE. Every fixture below is invented and shaped like the real
 * thing: this repo is public, and a bureau profile is somebody's ID number, their addresses and
 * where they work. The parser was developed against seven real reports; what is checked in is the
 * SHAPE they share.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-trace-profile.mjs
 */
import { readFileSync } from 'node:fs'
import {
  administrationReading, normaliseRegistration, parseTrace, rankContacts, readDirectors,
  readJudgments, sameRegistration, splitJudgmentRow, titleCase, traceDate, traceKind,
} from '../../src/lib/traceProfile.ts'
import { clientPosition } from '../../src/lib/clientPosition.ts'
import { plainPdfTokens } from '../../src/lib/pdfPlainText.ts'

let pass = 0
const failures = []
const ok = (name, actual) => {
  if (actual === true) { pass += 1; return }
  failures.push(`${name}\n    expected true\n    got      ${JSON.stringify(actual)}`)
}
const eq = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const schema = read('../../supabase/schema.sql')
const modal = read('../../src/pages/accounts/TraceUploadModal.tsx')
const importer = read('../../src/lib/traceImport.ts')
const reader = read('../../src/lib/pdfText.ts')
const detail = read('../../src/pages/accounts/AccountDetail.tsx')
const workspace = read('../../src/lib/accountWorkspace.ts')
const documentsPanel = read('../../src/pages/accounts/AccountWorkspacePanels.tsx')

/* ---------- getting the words out of the file at all ---------- */

/*
 * A READER WITH NO LIBRARY BEHIND IT, and it is the primary one.
 *
 * pdf.js reads these files perfectly in Chromium and threw "undefined is not a function" from
 * inside its own minified code on the firm's iPads — twice, on the default build and again on the
 * legacy build with the polyfills compiled in. The firm works this app on iPads.
 *
 * It turns out not to be needed: every trace the bureau has produced carries its content streams
 * UNCOMPRESSED — not one FlateDecode across seven real reports — so the words are plain text in
 * the file. Checked token for token against pdf.js on all seven: identical.
 *
 * Bytes, not characters. A PDF is part text and part binary and the reader works on it
 * byte-for-byte, so the fixtures here are built the same way.
 */
const pdf = (body) => Uint8Array.from(`%PDF-1.4\n1 0 obj\n<< >>\nstream\n${body}\nendstream\nendobj\n`,
  (c) => c.charCodeAt(0)).buffer

eq('a drawn string is a token', plainPdfTokens(pdf('(Kopano Freight) Tj')), ['Kopano Freight'])
/* Reading order is file order, and the whole of traceProfile depends on it: label, then value. */
eq('...and they come back in the order the page draws them',
  plainPdfTokens(pdf('(Registration Number) Tj (2019/445102/07) Tj')),
  ['Registration Number', '2019/445102/07'])
/*
 * ONE TJ ARRAY IS ONE RUN OF TEXT. A PDF writer splits a word to nudge the kerning; split into
 * two tokens it becomes two table cells and the reader downstream counts columns.
 */
eq('a kerned run is one token, not several',
  plainPdfTokens(pdf('[(Kop) -20 (ano) -15 ( Freight)] TJ')), ['Kopano Freight'])
/* Escapes, because a bracket in a company name is not the end of the string. */
eq('escaped brackets survive', plainPdfTokens(pdf('(Kopano \\(Pty\\) Ltd) Tj')), ['Kopano (Pty) Ltd'])
eq('...and an escaped backslash', plainPdfTokens(pdf('(a\\\\b) Tj')), ['a\\b'])
/*
 * Octal is the one that matters in practice: the bureau writes a non-breaking space as \240, and
 * left raw that is a stray character in the middle of a name.
 */
eq('octal escapes become their character',
  plainPdfTokens(pdf('(Kopano\\240Freight) Tj')), ['Kopano\u00a0Freight'])
/*
 * AND THE READER DOES NOT THEN TIDY IT. The non-breaking space is left exactly as the file has
 * it; parseTrace turns it into an ordinary space along with everything else it normalises. One
 * place does that, or the two readers hand the parser two different versions of one document.
 */
ok('...and are left as the file has them, for the parser to normalise',
  plainPdfTokens(pdf('(Kopano\\240Freight) Tj'))[0].includes('\u00a0'))
eq('a hex string is read too', plainPdfTokens(pdf('<4B6F70616E6F> Tj')), ['Kopano'])

/*
 * A FONT OR AN IMAGE YIELDS NOTHING. Its bytes can contain anything, including something shaped
 * like a string — but a PDF string only becomes text when an operator draws it, and a font stream
 * has no operators. Nothing is scraped out of binary just because it looks like text.
 *
 * The `continue` above this in the reader is a cost saving and not what makes this true; the
 * operator regex is. Asserted on the behaviour rather than on that line, because deleting the line
 * changes nothing here and a check that survives its own subject is worth nothing.
 */
eq('a font or image stream yields nothing', plainPdfTokens(pdf('\x00\x01(NOTTEXT)\x02\x03')), [])
eq('...even with a bracketed run in the middle of it',
  plainPdfTokens(pdf('\x00\x8f(Helvetica)\x00\x03(Bold)\xff')), [])
/*
 * A STRING IS ONLY TEXT WHEN AN OPERATOR DRAWS IT, and this is the case that proves the reader
 * checks. The stream below has a real Tj in it, so it is not skipped as binary — and the second
 * bracketed run is an operand to a positioning operator, not something drawn. A reader that
 * scraped every pair of brackets would put it on the account as a word from the report.
 */
eq('a bracketed run that is not drawn is not text',
  plainPdfTokens(pdf('(Kopano Freight) Tj (NotDrawn) 5 0 Td')), ['Kopano Freight'])
/*
 * AND NOTHING IS NOT A GUESS. A PDF this cannot read comes back empty, which is the caller's
 * signal to fall back to pdf.js — never a half-read document presented as a whole one.
 */
eq('an unreadable file yields nothing at all', plainPdfTokens(new Uint8Array([1, 2, 3, 4]).buffer), [])

/*
 * THE READER IS FAITHFUL AND parseTrace NORMALISES. The bureau pads its cells — "MANAGER  ALL
 * TYPES" — and pdf.js collapses those runs while a byte-level reader does not. Two readers, two
 * slightly different tokens, and the same job recorded twice because its dedupe key differed by
 * one space. Collapsing at the door is what stops the two drifting.
 */
eq('the reader reports the file as it is', plainPdfTokens(pdf('(MANAGER  ALL TYPES) Tj')), ['MANAGER  ALL TYPES'])
/*
 * Asserted on what comes OUT of the parser, not on the line inside it. The same collapse appears
 * in several places in that file, so a source search for it went on passing with the one that
 * matters deleted.
 */
/*
 * THE SAME JOB, WRITTEN TWICE WITH DIFFERENT PADDING, IS ONE JOB — and that is the bug this
 * collapse was added for. The rows are deduplicated on the raw token, not on the tidied name, so
 * "MANAGER  ALL TYPES" and "MANAGER ALL TYPES" were two different keys and the job appeared
 * twice: nine rows off a report that has eight.
 *
 * Asserting the tidied NAME would have passed either way — titleCase splits on whitespace and
 * rejoins, so it hides the difference. This asserts the count, which is what actually moved.
 */
const padded = parseTrace([
  'CONSUMER REPORT - SIPHO RADEBE, 8506105000085', 'CONSUMER REPORT',
  'EMPLOYMENT HISTORY',
  'COMMERCIAL NAME', 'DESIGNATION', 'UPDATED DATE', 'CREATED DATE',
  'KOPANO FREIGHT', 'MANAGER ALL TYPES', '07-09-2026', '21-06-2009',
  'KOPANO  FREIGHT', 'MANAGER  ALL TYPES', '07-09-2026', '21-06-2009',
])
eq('...and the parser collapses the padding, for every reader', padded.employment.length, 1)
eq('...keeping the tidy version of it', padded.employment[0].designation, 'Manager All Types')

/* ---------- dates ---------- */

eq('a bureau date reads as a date', traceDate('08-11-2023'), '2023-11-08')
/* The report header prints a single-digit month: "16-9-2026". */
eq('...including the unpadded one in the header', traceDate('16-9-2026'), '2026-09-16')
/*
 * A DATE THE CALENDAR DOES NOT HAVE IS A MISREAD COLUMN. Dates are what tell one table row from
 * the next in here, so a string that merely looks like one would silently split a row in half.
 */
eq('the 31st of February is not a date', traceDate('31-02-2024'), null)
eq('a number that is not a date is not a date', traceDate('0835550178'), null)
eq('nothing is not a date', traceDate(undefined), null)

/* ---------- the registration number, which is the join key ---------- */

/*
 * THE BUREAU PREFIXES A LETTER AND THE CLIENT DOES NOT. Two real handovers came in without the
 * letter while their profiles are filed with it. Compared literally, a trace never matches the
 * company it is for — and the "this profile is for a different company" warning would fire on
 * every upload, which is the same as not warning at all.
 */
eq('the bureau letter comes off', normaliseRegistration('K2019/445102/07'), '2019/445102/07')
eq('...and a number without one is left alone', normaliseRegistration('2019/445102/07'), '2019/445102/07')
ok('the two are the same company', sameRegistration('K2019/445102/07', '2019/445102/07'))
/* The leading zeros and the slashes ARE the number. Stripping them would match two companies. */
eq('nothing else is stripped', normaliseRegistration('M2007/551209/07'), '2007/551209/07')
ok('two different companies are not the same', !sameRegistration('2019/445102/07', '2016/880431/07'))
/*
 * NOTHING ON ONE SIDE IS NOT A MATCH — it is an unknown, and must never read as agreement.
 *
 * Both-null is the case that discriminates: an equality test alone calls two unknowns the same
 * company, and the "wrong company" warning then stays silent on exactly the upload where neither
 * side has a number to check.
 */
ok('an unknown registration matches nothing', !sameRegistration(null, '2019/445102/07'))
ok('...and two unknowns are not the same company', !sameRegistration(null, null))
ok('...nor are two blanks', !sameRegistration('Unknown', ''))
eq('and "Unknown" is not a registration number', normaliseRegistration('Unknown'), null)

/* ---------- names ---------- */

eq('a shouted name reads as a name', titleCase('BRETT PEARCE'), 'Brett Pearce')
eq('...with its particles intact', titleCase('ELMARIE VAN DER MERWE'), 'Elmarie van der Merwe')
eq('...and its second capital', titleCase('SEAN MCGREGOR'), 'Sean McGregor')
eq('...and its hyphen', titleCase('ANNE-MARIE BOTHA'), 'Anne-Marie Botha')
/*
 * WORDS THAT ARE NOT WORDS. A case reason of "VAT" title-cased reads "Vat", which is not a tax
 * and looks like a typo — on a client report.
 */
eq('an acronym is not a word', titleCase('VAT'), 'VAT')
eq('...even beside real words', titleCase('SARS VAT ASSESSMENT'), 'SARS VAT Assessment')

/* ---------- the director table, off a commercial report ---------- */

/*
 * The table repeats its own headings at every page break and a page footer lands in the middle of
 * it, so the reader is anchored on the thirteen-digit ID number rather than counting five tokens
 * at a time from the top.
 */
const directorTokens = [
  'ID NUMBER', 'FULL NAME', 'STATUS', 'APPOINTMENT DATE', 'CREATED DATE',
  '8801015000084', 'THEMBA NKOSI', 'Resigned', '22-06-2021', '23-06-2021',
  'Page 1 of 12',
  'ID NUMBER', 'FULL NAME', 'STATUS', 'APPOINTMENT DATE', 'CREATED DATE',
  '7203045000082', 'IAIN FOURIE', 'Active', '10-06-2024', '13-06-2024',
]
const dirs = readDirectors(directorTokens)
eq('both directors are found across the page break', dirs.length, 2)
eq('...with the name read', dirs[0].fullName, 'Themba Nkosi')
eq('...and the status', dirs[1].status, 'Active')
eq('...and the appointment date', dirs[1].appointedOn, '2024-06-10')
/* The headings between the two rows must not become a third director. */
ok('the repeated headings are not a director', dirs.every((d) => /[a-z]/.test(d.fullName)))

/* ---------- judgments off a commercial report: label and value ---------- */

const commercialJudgments = [
  'Case Number', '70211/2023',
  'Case Filing Date', '08-11-2023',
  'Case Type', 'JUDGEMENT BY DEFAULT',
  'Case Reason', 'VAT',
  'Plaintiff Name', 'SARS',
  'Created On Date', '25-11-2023',
  'Case Number', '40021/2024',
  'Case Filing Date', '04-10-2024',
  'Case Type', 'JUDGEMENT BY DEFAULT',
  'Case Reason', 'CREDIT AGREEMENT',
  'Plaintiff Name', 'BOSVELD PLANT HIRE (PTY) LTD',
  'Created On Date', '03-12-2024',
]
const cj = readJudgments(commercialJudgments, 'commercial')
eq('both judgments are read', cj.length, 2)
eq('...with the filing date, not the created date', cj[0].filedOn, '2023-11-08')
eq('...the reason kept as a tax, not a typo', cj[0].caseReason, 'VAT')
eq('...and the plaintiff as the bureau named them', cj[0].plaintiff, 'SARS')
eq('...and nothing left unread', cj[0].unread, null)

/* ---------- judgments off a consumer report: a wrapped table ---------- */

/*
 * THE HARD ONE. A consumer report prints judgments as a table whose cells wrap, so the case type,
 * the reason and the plaintiff arrive as one run of tokens with no marker between them. The two
 * known columns are matched from fixed lists; the plaintiff is what is left.
 */
eq('a wrapped row splits into its columns',
  splitJudgmentRow('JUDGEMENT BY DEFAULT CREDIT AGREEMENT BOSVELD PLANT HIRE (PTY) LTD'),
  { caseType: 'Judgement By Default', caseReason: 'Credit Agreement', plaintiff: 'BOSVELD PLANT HIRE (PTY) LTD', unread: null })
/* The courts spell it one way and the bureau the other. Both have to read. */
ok('both spellings of judgment are known',
  splitJudgmentRow('JUDGMENT BY DEFAULT VAT SARS').caseReason === 'VAT')
/*
 * A ROW THAT CANNOT BE SPLIT IS NOT GUESSED AT. A plaintiff that is half a case reason goes onto
 * a client report and cannot be explained afterwards, so it comes back unread and the screen says
 * so instead.
 */
const odd = splitJudgmentRow('SOMETHING NOBODY HAS SEEN BEFORE')
eq('an unrecognised row is not guessed at', odd.plaintiff, null)
eq('...and carries its own text so a person can read it', odd.unread, 'SOMETHING NOBODY HAS SEEN BEFORE')

const consumerJudgments = [
  'CASE', 'NUMBER', 'CASE', 'FILLING', 'CASE TYPE', 'CASE REASON', 'PLAINTTIFF NAME', 'CREATED', 'DATE',
  '55140/2024', '27-02-2025', 'JUDGEMENT BY', 'DEFAULT', 'CREDIT', 'AGREEMENT',
  'BOSVELD PLANT', 'HIRE (PTY) LTD', '12-03-2025',
]
const pj = readJudgments(consumerJudgments, 'consumer')
eq('the wrapped table yields one judgment', pj.length, 1)
eq('...with the case number', pj[0].caseNumber, '55140/2024')
eq('...the filing date, not the loading date', pj[0].filedOn, '2025-02-27')
eq('...and the plaintiff put back together', pj[0].plaintiff, 'BOSVELD PLANT HIRE (PTY) LTD')

/* ---------- which numbers are worth offering ---------- */

const C = (kind, value, updatedOn, peopleLinked) => ({ kind, value, updatedOn, peopleLinked })
/*
 * A collector confirming twenty-six numbers ticks none of them and rings the first one, so the
 * choice is made here or not at all. Two facts decide it and both are printed on the report: how
 * recently the bureau saw the number, and how many OTHER people it has it against.
 */
const ranked = rankContacts([
  C('mobile', '0821110001', '2026-09-07', 2),
  C('mobile', '0821110002', '2026-09-01', 1),
  C('work', '0111110003', '2026-08-01', 22),
  C('work', '0111110004', '2026-07-01', 1),
  C('phone', '0111110005', '2019-01-01', 1),
  C('email', 'someone@example.co.za', '2026-06-01', 1),
], '2026-09-16')
eq('one of each kind is offered', ranked.length, 3)
eq('...the most recent mobile', ranked[0].value, '0821110001')
/* A number the bureau has against twenty-two people is a switchboard, not this debtor's phone. */
ok('...never the one linked to twenty-two people', !ranked.some((c) => c.value === '0111110003'))
eq('...so the next work number is taken instead', ranked[1].value, '0111110004')
/* A number last seen in 2019 is not a number. */
ok('...and nothing the bureau has not seen in two years', !ranked.some((c) => c.value === '0111110005'))
ok('...an email counts as its own kind', ranked.some((c) => c.kind === 'email'))

/*
 * ONE NUMBER, OFFERED ONCE. The bureau files the same number under more than one type — one real
 * profile carries the same mobile as a Cell, a Home and a Work number. Ticked by kind alone the
 * collector is handed the same number three times and no second number at all.
 */
const sameNumber = rankContacts([
  C('mobile', '0821110001', '2026-09-07', 1),
  C('phone', '0821110001', '2026-09-06', 1),
  C('work', '0821110001', '2026-09-05', 1),
  C('work', '0111110009', '2026-09-04', 1),
], '2026-09-16')
eq('the same number is offered once', sameNumber.filter((c) => c.value === '0821110001').length, 1)
eq('...and a real second number gets the slot', sameNumber.length, 2)

/* ---------- the whole document ---------- */

const commercial = [
  'COMMERCIAL REPORT', 'TYPE', 'SUMMARY',
  'ENQUIRY DATE:', '16-9-2026',
  'Company Name', 'KOPANO FREIGHT SERVICES',
  'Registration Number', 'K2016/880431/07',
  'Status Code of Company', 'Final Liquidation',
  'COMMERCIAL JUDGMENT',
  'Case Number', '70211/2023',
  'Case Filing Date', '08-11-2023',
  'Case Type', 'JUDGEMENT BY DEFAULT',
  'Case Reason', 'VAT',
  'Plaintiff Name', 'SARS',
  'Created On Date', '25-11-2023',
  'DIRECTOR INFORMATION',
  'ID NUMBER', 'FULL NAME', 'STATUS', 'APPOINTMENT DATE', 'CREATED DATE',
  '8506105000085', 'SIPHO RADEBE', 'Active', '20-05-2016', '05-06-2016',
]
const cp = parseTrace(commercial)
eq('a company report is read as one', cp.kind, 'commercial')
eq('...naming the company', cp.subjectName, 'Kopano Freight Services')
eq('...with the registration number normalised', cp.registrationNumber, '2016/880431/07')
/*
 * THE STATUS AT CIPC. "Final Liquidation" is the single most consequential line on a commercial
 * profile: the debt is still owed but the company cannot be collected from, and the claim goes to
 * a liquidator instead. It is read off the profile and shown, never acted on automatically.
 */
eq('...and the status at CIPC', cp.companyStatus, 'Final Liquidation')
eq('...its judgments', cp.judgments.length, 1)
eq('...and its directors', cp.directors.length, 1)
/* A company report is about a company; it has no consumer contacts to offer. */
eq('a company report offers no personal numbers', cp.contacts.length, 0)

const consumer = [
  'CONSUMER REPORT - SIPHO RADEBE, 8506105000085',
  'CONSUMER REPORT',
  'ENQUIRY DATE:', '16-9-2026',
  'ID NUMBER:', '8506105000085',
  'CONTACT SCORE:', 'Fair',
  'RISK SCORE:', 'Medium Risk',
  'CONTACT INFORMATION',
  'TYPE', 'CONTACT', 'PEOPLE LINKED', 'UPDATED DATE', 'CREATED DATE',
  'Cell', '0821110001', '2', '07-09-2026', '20-03-2021',
  'Email', 'sipho@example.co.za', '1', '07-07-2026', '07-07-2021',
  'ADDRESSES',
  'ADDRESS', 'PROVINCE', 'UPDATED DATE', 'CREATED DATE',
  '14 MOROKA AVE, KLIPTOWN, 1811', 'Gauteng', '16-06-2026', '26-02-2025',
  'EMPLOYMENT HISTORY',
  'COMMERCIAL NAME', 'DESIGNATION', 'UPDATED DATE', 'CREATED DATE',
  'KOPANO FREIGHT SERVICES', 'PROFESSIONAL', '07-09-2026', '21-06-2009',
  /* A second row, so the reader has somewhere to go wrong. With one row the last column is past
     the end of the list and a reader that misreads columns cannot show it. */
  'BOSVELD PLANT HIRE', 'DRIVER', '01-03-2025', '02-03-2025',
]
const pp = parseTrace(consumer)
eq('a person report is read as one', pp.kind, 'consumer')
eq('...naming the person off the title line', pp.subjectName, 'Sipho Radebe')
eq('...with their ID number', pp.idNumber, '8506105000085')
/* The bureau's own two readings of a person. Shown as the bureau's, never recomputed. */
eq('...the bureau\'s contact score', pp.contactScore, 'Fair')
eq('...and its risk score', pp.riskScore, 'Medium Risk')
eq('...their numbers', pp.contacts.length, 2)
eq('...their address', pp.addresses.length, 1)
eq('...with the province read off the column beside it', pp.addresses[0].province, 'Gauteng')
ok('...and not swallowed into the address', !/Gauteng/.test(pp.addresses[0].value))
eq('...and where they work', pp.employment.length, 2)
/*
 * A JOB IS FOUR COLUMNS AND ALL FOUR ARE SKIPPED. Requiring only the third to be a date let the
 * reader start again on the SECOND column, so every job was read twice — once correctly, and once
 * with the job title standing in as the employer.
 */
eq('...once, not once per column', pp.employment.map((e) => e.employer),
  ['Kopano Freight Services', 'Bosveld Plant Hire'])

/*
 * THE WORD 'DEFAULT' IS NOT A SECTION HEADING. A consumer report wraps its case type across two
 * lines, so DEFAULT arrives as a token of its own. Listed as a heading — which it was — it closed
 * the judgments block halfway through the row and the judgment came out unread.
 */
const wrapped = parseTrace([
  'CONSUMER REPORT - SIPHO RADEBE, 8506105000085', 'CONSUMER REPORT',
  'CONSUMER JUDGEMENT',
  '55140/2024', '27-02-2025', 'JUDGEMENT BY', 'DEFAULT', 'CREDIT', 'AGREEMENT',
  'BOSVELD PLANT HIRE', '12-03-2025',
])
eq('a wrapped case type does not close the section', wrapped.judgments.length, 1)
eq('...and the row still reads', wrapped.judgments[0].caseReason, 'Credit Agreement')

eq('a document that is not a bureau report is not one', parseTrace(['Dear Sir', 'We refer to the above']), null)
eq('...and says so rather than guessing', traceKind(['INVOICE', 'Total due']), null)

/* ---------- what a company's status means, and what the upload proposes ---------- */

/*
 * "In Business" is nearly every profile and must cost nothing — no proposal, no banner, no tick.
 * A proposal on every upload is a proposal nobody reads.
 */
eq('a trading company prompts nothing', administrationReading('In Business'), null)
eq('...and neither does a blank status', administrationReading(null), null)
/*
 * DEREGISTRATION IS DELIBERATELY NOT ADMINISTRATION. There is no estate and no practitioner — the
 * company simply no longer exists — so proposing one would send a collector looking for somebody
 * who was never appointed.
 */
eq('a deregistered company is not under administration', administrationReading('Deregistered'), null)

const liq = administrationReading('Final Liquidation')
ok('a liquidation is read', liq !== null)
eq('...quoting what the bureau printed', liq.status, 'Final Liquidation')
eq('...and naming the office that would be appointed', liq.practitionerKind, 'liquidator')
eq('a sequestration names a trustee', administrationReading('Sequestrated').practitionerKind, 'trustee')
eq('business rescue names its practitioner', administrationReading('Business Rescue').practitionerKind, 'business_rescue')

/*
 * THE ROUND TRIP, and it is the whole reason this cannot be free text.
 *
 * The proposal writes a SUB-STATUS, and the rung an account reports on is derived from that
 * string — positions are derived, never stored. A status of 'FINLIQ' would store perfectly and
 * report to the client as "In progress", which is the exact fault of showing somebody a column
 * instead of an answer.
 */
for (const status of ['Final Liquidation', 'Provisional Liquidation', 'Business Rescue', 'Sequestrated', 'Judicial Management']) {
  const reading = administrationReading(status)
  ok(`'${status}' is read as administration`, reading !== null)
  eq(`...and the sub-status it writes reports as Under administration`,
    clientPosition({ status: 'Active', subStatus: reading.subStatus }), 'under_administration')
}

/*
 * PROPOSED FROM THE COMPANY'S PROFILE ONLY. A director being under debt review says nothing about
 * whether the company can be collected from; moving the account's rung on that basis would report
 * a solvent company to its client as under administration.
 */
ok('the rung is never proposed off a director\'s profile',
  /about === 'debtor'\s*\n?\s*\? administrationReading\(profile\?\.companyStatus\)/.test(modal))
/* Proposed, not applied: it changes what the client is told. */
ok('the proposal is a tick, not an act', /checked=\{moveRung\}/.test(modal))
ok('...and the screen says what the client will then read',
  /It will report to the client as Under administration/.test(modal))
ok('the importer only moves the rung when it was accepted',
  /administration !== null && moveRung \? administration : null/.test(modal))
ok('...and says so on the timeline', /Account moved to \$\{r\.movedTo\}/.test(importer))
/*
 * AND THEN THE ONE QUESTION THE DOCUMENT CANNOT ANSWER. A profile that says "Final Liquidation"
 * does not name the liquidator — checked end to end on a real report, where the only "Trustee Of"
 * field was a directorship. The firm asked for exactly this: "Add the practitioner or look for
 * the practitioner."
 */
ok('the upload then asks who to claim from', /Nobody is recorded to claim from/.test(modal))
ok('...only when nobody is on file', /r\.movedTo !== null && !hasPractitioner/.test(modal))
ok('...carrying the office the status implied',
  /onAddPractitioner\(administration\?\.practitionerKind \?\? null\)/.test(modal))

/* ---------- a judgment nobody could read is still a judgment ---------- */

/*
 * THE PLAINTIFF IS THE PART WORTH HAVING, and it used to be the part thrown away: a row whose
 * columns could not be split was shown and then dropped. It is a handful of characters, and the
 * firm's view was plain — "the plaintiff is important to mention as well, it's not a lot of data".
 *
 * So the row is kept in the bureau's own words and the columns stay null.
 */
ok('the row is kept as printed', /add column if not exists source_text text/.test(schema))
ok('...and the column says it is not a plaintiff',
  /comment on column public\.account_judgments\.source_text/.test(schema))
ok('the importer stores it only for a row it could not read', /source_text: j\.unread/.test(importer))
ok('the upload offers it rather than dropping it', /As printed|could not be read cleanly/.test(modal))

/* ---------- the other companies a director sits on ---------- */

/*
 * THE FIRM'S OWN SHAPE: "We could mention the active directorships. But if there are other
 * directorships where he's not active, there can be a little sign that says there are other
 * directors that he's not active anymore."
 */
ok('a director\'s other companies have a table',
  /create table if not exists public\.account_director_companies/.test(schema))
ok('...hung off the director, not the account',
  /director_id uuid not null references public\.account_directors/.test(schema))
ok('...recording whether they are still there',
  /create table if not exists public\.account_director_companies[\s\S]{0,700}status text check \(status in \('Active', 'Resigned'\)\)/.test(schema))
ok('...and a re-import cannot duplicate one', /unique \(director_id, company_name\)/.test(schema))
/*
 * ONLY EVER AGAINST A PERSON. Filed against the account a directorship would read as a company
 * the DEBTOR owns — a different and much stronger claim than the document makes.
 */
ok('directorships are stored against the person',
  /chosen\.directorships\.length > 0 && aboutDirector !== null/.test(importer))
ok('the upload offers them only on a person\'s profile',
  /about === 'director' && \(\s*\n?\s*<Found title="Other companies they direct"/.test(modal))
/* Resigned ones are not ticked: one real profile carries thirty, and they would bury the account. */
ok('a resigned directorship is not ticked by default',
  /directorships\.filter\(\(c\) => c\.status !== 'Active'\)\.forEach/.test(modal))

/* ---------- a judgment against a director is not against the company ---------- */

/*
 * A director's own profile carries their personal judgments. Filed against the account they would
 * count as the COMPANY'S — and the firm has said judgments will drive the likelihood of
 * collection it reports to clients. A clean company would read as having two.
 */
ok('a judgment can say it is against a person',
  /add column if not exists against_director_id uuid/.test(schema))
ok('...pointing at the director', /references public\.account_directors \(id\)/.test(schema))
ok('...and the column says what null means',
  /comment on column public\.account_judgments\.against_director_id/.test(schema))
/*
 * The unique key has to widen with it: the same case number can appear on a company's profile and
 * on a director's, and those are two different judgments.
 */
ok('the same case number can sit against both',
  /account_judgments_unique_case[\s\S]{0,200}coalesce\(against_director_id/.test(schema))
ok('the importer records who it is against', /against_director_id: aboutDirector/.test(importer))
/*
 * And the delete that makes a re-import replace rather than duplicate must be scoped to the same
 * subject, or a director's report wipes the company's judgment of the same number.
 */
ok('...and replaces only that subject\'s copy',
  /aboutDirector === null\s*\n?\s*\? await scoped\.is\('against_director_id', null\)/.test(importer))

/* ---------- the upload asks, stores nothing on its own, and charges nothing ---------- */

ok('the trace is read in the browser', /await import\('pdfjs-dist\/legacy\/build\/pdf\.mjs'\)/.test(reader))
/*
 * THE SMALL READER GOES FIRST. It needs no worker, no WebAssembly and no polyfill, which is the
 * entire reason it exists — see the note above. pdf.js is the fallback for a file it returns
 * nothing from.
 */
ok('...but only after the reader that needs no library', /const plain = plainPdfTokens\(data\)/.test(reader))
ok('...and an empty result is what hands over', /if \(plain\.length > 0\) return plain/.test(reader))
/* A reader that exists to avoid a crash must not become the crash. */
ok('...its own failure falls through rather than throwing',
  /try \{[\s\S]{0,200}plainPdfTokens\(data\)[\s\S]{0,120}\} catch \{/.test(reader))
/*
 * THE LEGACY BUILD, AND IT IS NOT A PREFERENCE.
 *
 * pdf.js's default build targets the newest engines and calls Promise.withResolvers,
 * structuredClone and Array.prototype.at bare — the shipped chunk contained no polyfill for any
 * of them. On an iPad it threw "undefined is not a function" from inside minified pdf.js, and
 * that sentence is what the collector was shown. The firm works this app on iPads; "works in
 * Chrome" is not a finish line here.
 *
 * The legacy build is the same library with core-js polyfills compiled in. Anyone tidying this
 * import back to the shorter 'pdfjs-dist' reintroduces the bug in a browser the checks cannot
 * run, which is why it is asserted rather than left to a comment.
 */
ok('...using the build that polyfills what Safari lacks', /legacy\/build\/pdf\.mjs/.test(reader))
/* The worker has to be the same build, or the two disagree about the API version and neither runs. */
ok('...with a worker from the same build', /legacy\/build\/pdf\.worker\.mjs\?url/.test(reader))
ok('...and never the bare package, which is the modern build',
  !/import\('pdfjs-dist'\)/.test(pdf) && !/from 'pdfjs-dist'/.test(reader))

/*
 * AND WHEN IT STILL CANNOT BE READ, THE COLLECTOR IS NOT LEFT HOLDING A PDF.
 *
 * Reading can fail for reasons nothing to do with them — a browser pdf.js cannot run on, a
 * damaged download, a scan whose words are a picture. The firm paid for that search either way
 * and the document belongs on the account, so the failure offers to file it unread instead of
 * ending the job.
 */
ok('a failed read offers to file it anyway', /File it under Documents anyway/.test(modal))
ok('...filing it as a trace', /kind: 'Trace', uploadedBy: actor\.id/.test(modal))
ok('...and says plainly that nothing was read out of it',
  /Nothing was read out of it/.test(modal))
/*
 * The minified internals of pdf.js are no use to a collector and were the whole message. They are
 * kept — they are the only thing that will identify the next browser that does this — and shown
 * small, under a sentence in words.
 */
ok('the message is in words, not in a stack', /This browser could not read the PDF/.test(modal))
ok('...with the technical detail demoted', /\{error\}<\/p>\s*\n?\s*<\/div>/.test(modal) || /text-\[11px\] text-slate-400 mt-2 break-words">\{error\}/.test(modal))
/* A scan is a different failure and deserves its own sentence: there are no words in it to read. */
ok('a scan is told apart from a broken read', /the words are a picture/.test(modal))
/*
 * ON FIRST USE. pdf.js is the largest thing in the dependency list and almost nobody opens a
 * trace on a given day; imported statically it would be in the bundle every collector downloads
 * every morning.
 */
ok('...and pdf.js is not in the bundle until it is needed', !/^import .*pdfjs-dist/m.test(reader))
ok('the upload asks who the trace is for', /Who is this trace for\?/.test(modal))
ok('...offering the company', /The company/.test(modal))
ok('...and a director', /A director/.test(modal))
/*
 * MATCHED ON THE ID NUMBER, NEVER ON THE NAME. The same person is spelled differently on the
 * company register and on their own report, so matching on the name files them twice.
 */
ok('an existing director is matched on their ID number',
  /directors\.find\(\(d\) => d\.idNumber === parsed\.idNumber\)/.test(modal))
/* Nothing is stored until somebody has read it: a bureau profile is a third party's record. */
ok('nothing is filed until the button is pressed', /File what is ticked/.test(modal))
/*
 * A ROW THAT COULD NOT BE READ IS KEPT, NOT DROPPED — but it is quoted, never reported.
 *
 * It used to be shown on screen and then thrown away, and the plaintiff went with it. The row is
 * now offered like any other; what stays empty is the three columns nobody could split, and the
 * line says it is quoting the bureau rather than stating a fact.
 */
ok('an unreadable row is still offered', /As printed: /.test(modal))
ok('...marked as quoted rather than read', /columns could not be read — kept as printed/.test(modal))
ok('...with its columns left empty, not guessed',
  /caseType: null, caseReason: null, plaintiff: null, unread: text/.test(
    readFileSync(new URL('../../src/lib/traceProfile.ts', import.meta.url), 'utf8')))
/*
 * FILING A TRACE CHARGES NOTHING. The search is Annexure B item 4(c) and is charged on the Trace
 * button where it is run; charging again for filing the PDF would put a fee on the debtor's
 * statement for an act of admin.
 */
ok('the screen says filing charges nothing', /Filing a trace charges nothing/.test(modal))
ok('...and the importer raises no fee', !/recordTrace|chargeFor|raiseFee/.test(importer))
/* The wrong PDF is invisible afterwards — the directors simply look unfamiliar. */
ok('uploading the wrong company is caught', /This profile is for a different company/.test(modal))
ok('...compared normalised, or it would fire every time', /sameRegistration\(registrationNumber, profile\.registrationNumber\)/.test(modal))
/* An account that changed and cannot say why is the complaint the timeline exists to answer. */
ok('the import lands on the timeline', /await addNote\(/.test(importer))
ok('the account page can open it', /<TraceUploadModal/.test(detail))
/*
 * AND FROM DOCUMENTS, where somebody who has just downloaded six PDFs goes to file them.
 *
 * A TRACE IS NOT A BLOB. Picking that kind opens the reader rather than putting the file in the
 * bucket unread — the firm paid for the search under item 4(c), and a trace filed without being
 * read is the waste this whole feature exists to end. It still lands as a document afterwards
 * under the same kind, so nothing is lost.
 */
ok('Documents offers a trace as a kind', /TRACE_KIND = 'Trace'/.test(workspace))
ok('...in the list people choose from', /'Court document', TRACE_KIND/.test(workspace))
ok('...and choosing it reads the trace instead of filing it blind',
  /kind === TRACE_KIND && onUploadTrace \? onUploadTrace\(\) : fileRef\.current\?\.click\(\)/.test(documentsPanel))
ok('...saying so on the button', /Read the trace/.test(documentsPanel))
ok('...wired up on the account page', /onUploadTrace=\{\(\) => setTracing\(true\)\}/.test(detail))
/* A screen with no reader to open still offers the kind and files the PDF. */
ok('the reader is optional, so the panel still works without one',
  /onUploadTrace\?: \(\) => void/.test(documentsPanel))
/*
 * ON THE PANEL ITSELF, matched inside the StandingPanel tag rather than anywhere on the page.
 * The action row carries the same prop, so a page-wide search for it goes on passing after the
 * panel's own button is deleted.
 */
ok('...from the panel the data lands in', /<StandingPanel[^>]*onUpload=/.test(detail))
/*
 * AND FROM THE TRACE BUTTON, which is the only moment a collector certainly has the files: the
 * minute after they ran the search. Offered an hour later it is a task to come back to, which is
 * how the firm ended up paying for traces whose answers were never typed in.
 */
ok('...and from the search that produced it', /onUpload=\{onUpload\}/.test(detail))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A trace PDF is read in the browser, the upload asks whether it is for the company or for a
director, and nothing is stored until somebody has read what it found. A judgment against a
director is kept apart from a judgment against the company, because one of those is the signal the
firm reports to its clients.`)
