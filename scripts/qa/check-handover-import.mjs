/**
 * Reading a handover sheet back, from either sheet, without anybody declaring which.
 *
 * THE FIRM: "any import should work on the old import file from Swordfish and from this one that
 * I currently gave you ... I don't know if we have to indicate that it comes from Swordfish or
 * that it's a Raptor template."
 *
 * The answer this file holds: nobody declares it, because the header row already says. The cost
 * of getting that wrong is not an error message — on the OLD sheet "Debtor Initials" holds the
 * SURNAME, so a file read as the new one puts a surname in the initials column and addresses
 * every notice to nobody. Both sheets are therefore read here, the same rows, and the same
 * debtor has to come out of both.
 */
import {
  checkPhone, dateFault, detectDateOrder, displayDate, looksLikeEmail, parseMoney, parseSheetDate,
  planHandover, spellDate,
} from '../../src/lib/handoverImport.ts'
import { validateNewDebtor } from '../../src/lib/newDebtor.ts'
import { suggestedDesk } from '../../src/lib/linkedAccount.ts'

let pass = 0
const failures = []
/*
 * READ DEFENSIVELY, and this file is why CLAUDE.md says so.
 *
 * Break-testing the ambiguous-date guard, this check did not report a failure -- it threw a
 * TypeError on `.problems[0].message` two lines BELOW the assertion that should have caught it,
 * and the run died before printing anything. A check that crashes instead of failing is a check
 * whose result nobody reads. Every reach into a row goes through these.
 */
const problemsOf = (row) => row?.problems ?? []
const firstMessage = (row) => problemsOf(row)[0]?.message ?? '(no problem was reported)'
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${label}\n    expected ${e}\n    got      ${a}`)
}
const ok = (label, actual) => check(label, actual, true)
const TODAY = '2026-09-21'

/* ---------- 1. money, including the space that is not a space ---------- */

check('a plain number reads', parseMoney('48250'), 48250)
check('...with a decimal', parseMoney('48250.55'), 48250.55)
check('...with a rand sign and spaces', parseMoney('R 48 250.00'), 48250)
/*
 * THE NON-BREAKING SPACE. en-ZA groups thousands with U+00A0, so a figure copied out of Raptor
 * and pasted back into a spreadsheet carries it. JavaScript's `\s` matches it, which is why the
 * lib strips with `\s` alone -- this check stayed green when U+00A0 was removed from the class,
 * because it was guarding a redundancy. Narrow `\s` to a literal space and it fails, which is
 * the change that would actually break a figure.
 */
check('...and with the non-breaking space en-ZA actually uses',
  parseMoney('R 48 250.00'), 48250)
/* A comma is a separator, not a decimal point, unless it is the last one with two digits after. */
check('a comma between thousands is grouping', parseMoney('48,250.00'), 48250)
check('...and a comma as the decimal is still the same money', parseMoney('48 250,00'), 48250)
check('words are not money', parseMoney('to be advised'), null)
check('an empty cell is not nought', parseMoney(''), null)

/* ---------- 2. dates, and the one that means two days ---------- */

check('an ISO date reads', parseSheetDate('2026-03-18'), '2026-03-18')
/*
 * THE SHAPE THE APP'S OWN READER PRODUCES, which is the one this file forgot.
 *
 * `readXlsxRows` renders every date cell as yyyy/mm/dd -- "the shape Swordfish's own exports
 * use", says its comment -- and only the hyphen was matched here. So every date in every .xlsx
 * that reached the importer through its own screen was refused: 45 of 45 accounts on the client
 * sheet refused on a date of default that had been read correctly out of the file two functions
 * earlier. Nothing about four leading digits is ambiguous, so the separator cannot matter.
 */
check('a year-first date with slashes reads', parseSheetDate('2026/09/17'), '2026-09-17')
check('...and with dots', parseSheetDate('2026.09.17'), '2026-09-17')
check('...and is not touched by the file order', parseSheetDate('2026/09/17', 'month-first'), '2026-09-17')
/* The year-first branch owes the same refusal as the slash branch below it. */
check('the 31st of February is not a date year-first either', parseSheetDate('2026/02/31'), null)
/* Excel hands a date over as a serial. 46282 is 17 September 2026. */
check('an Excel serial reads', parseSheetDate('46282'), '2026-09-17')
/*
 * A SLASH DATE IS READ DAY-FIRST, at the firm's correction: "South Africa reads the dates first
 * the day, then the month, then the year."
 *
 * This file used to refuse 02/09/2024 as ambiguous, which was right before the convention was
 * stated and merely timid afterwards -- a question asked of the firm once is an answer, and
 * refusing a date every South African sheet contains would have refused most files.
 */
check('a slash date reads day first', parseSheetDate('02/09/2024'), '2024-09-02')
check('...and so does one that could only ever have been a day', parseSheetDate('18/03/2026'), '2026-03-18')
check('...while month-first reads the other way when the file says so',
  parseSheetDate('02/09/2024', 'month-first'), '2024-02-09')
/* A day that does not exist in its month is a typo, not a date: Date.parse rolls 31 February
   into March, which is a wrong date that looks exactly like a date. */
check('the 31st of February is not a date', parseSheetDate('31/02/2026'), null)
check('a thirteenth month is not a date', parseSheetDate('03/13/2026'), null)
check('a reference number is not a date', parseSheetDate('929228801'), null)
check('nothing is not a date', parseSheetDate(''), null)

/*
 * ---------- 2b. a date shown back the way South Africa writes it ----------
 *
 * THE FIRM, looking at the draft table: "this date of default that it says is wrong, it's
 * actually in the right way -- first day, then month, then year. This is how we do it in South
 * Africa. So everything else is wrong, to be honest."
 *
 * And they were right about everything else. The table printed the raw cell, and readXlsxRows
 * renders an .xlsx date as yyyy/mm/dd -- so a sheet the firm fills in day-first, read correctly
 * and judged correctly, was shown back to them year-first. The app was displaying its own
 * reader's internal format to the people whose convention the file is built around.
 */
check('a date read out of a workbook is shown day first', displayDate('2026/03/18'), '18/03/2026')
check('...and one already day-first is left as it is', displayDate('18/03/2026'), '18/03/2026')
check('...and an ISO one is turned round too', displayDate('2026-03-18'), '18/03/2026')
/* A month-first FILE is shown day-first as well: the display is the firm's convention, not the
   file's, and the parse has already settled which is which. */
check('a month-first file is still shown day first',
  displayDate('03/18/2026', 'month-first'), '18/03/2026')
/*
 * UNPARSEABLE COMES BACK UNTOUCHED, which is the other half of it. 31/02/2026 is the row somebody
 * has to correct, and reformatting it would hide the very thing that is wrong with it.
 */
check('a date nobody can read is shown exactly as the sheet has it',
  displayDate('31/02/2026'), '31/02/2026')
check('...as is anything that is not a date at all',
  displayDate('when they could'), 'when they could')
check('an empty cell shows nothing', displayDate(''), '')

/*
 * ---------- 2c. WHY it could not be read, which is a different question ----------
 *
 * The message said the file's ORDER could not account for 31/02/2026, which reads as Raptor not
 * understanding the way South Africa writes a date -- and sent the firm to check the importer
 * instead of the cell. February has no 31st; that is the whole of it.
 */
check('the 31st of February is a day that does not exist',
  dateFault('31/02/2026', 'day-first'), 'no-such-day')
/* A thirteenth month under this order IS the other complaint, and still is. */
check('a thirteenth month is a file written the other way round',
  dateFault('03/13/2026', 'day-first'), 'wrong-order')
check('a real date is fine', dateFault('18/03/2026', 'day-first'), 'ok')
check('words are unreadable', dateFault('when they could', 'day-first'), 'unreadable')
check('nothing is empty, not wrong', dateFault('', 'day-first'), 'empty')

check('a bad day is spelt out in words', spellDate('31/02/2026', 'day-first'), '31 February')
check('...read the file’s own way round', spellDate('02/31/2026', 'month-first'), '31 February')
check('...and nothing is spelt where there is no date', spellDate('rubbish', 'day-first'), null)

/*
 * THE ORDER IS THE FILE'S, NOT THE ROW'S, and this is the part that matters.
 *
 * Read row by row, a sheet written by an American-locale machine comes out with most rows read
 * day-first and the handful containing a day above twelve read month-first -- every one of them
 * plausible on its own, the file internally inconsistent, and nothing reporting it.
 */
check('a file with nothing to go on is read the South African way',
  detectDateOrder(['02/09/2024', '01/01/2026']).order, 'day-first')
check('...and says it fell back rather than proved it',
  detectDateOrder(['02/09/2024']).proven, false)
check('a file that can only be day-first is read that way, and proved',
  [detectDateOrder(['18/03/2026', '02/09/2024']).order, detectDateOrder(['18/03/2026']).proven],
  ['day-first', true])
/* A day above twelve in the SECOND position can only be a month first. One such row settles the
   whole file, including its ambiguous rows -- which is the entire point of deciding once. */
check('one American date settles the whole file',
  detectDateOrder(['03/18/2026', '02/09/2024']).order, 'month-first')
/*
 * A FILE THAT PROVES BOTH IS REPORTED, NOT RESOLVED. Something has been pasted into it from
 * somewhere else, and no order is safe for the rows that could go either way.
 */
check('a file that proves both orders is reported rather than resolved',
  detectDateOrder(['18/03/2026', '03/18/2026']).contradictory, true)

/* ---------- 3. the same debtor, out of either sheet ---------- */

/** One row, written as the firm's current sheet has it. */
const NEW_SHEET = [
  ['Your reference', 'Handover amount', 'Date of default', 'Person or business',
    'Surname, or the business name', 'First name', 'ID number', 'Cell number 1', 'Street address 1'],
  ['GPS3/10103', '48250.00', '2026-03-18', 'Person', 'Van Der Westhuizen', 'Johannes',
    '8503125009089', '082 123 4567', '14 Protea Street'],
]

/**
 * The same row as the client's OLD sheet has it — and note where the surname is.
 *
 * "Debtor Initials" is not initials on that sheet: all 45 rows of the file the firm sent had the
 * surname in it and "Debtor Surname" empty. The mapping is a correction, not a rename, and it is
 * the single reason the format must never be declared by hand.
 */
const OLD_SHEET = [
  ['Client Reference', 'Capital on Default', 'Date of Default', 'Debtor Initials',
    'Debtor Firstname', 'Debtor ID', 'Cell Phone 1', 'Street Address line 1'],
  ['GPS3/10103', '48250.00', '2026-03-18', 'Van Der Westhuizen', 'Johannes',
    '8503125009089', '082 123 4567', '14 Protea Street'],
]

const fresh = planHandover({ rows: NEW_SHEET, today: TODAY })
const legacy = planHandover({ rows: OLD_SHEET, today: TODAY })

check('the current sheet is recognised as ours', fresh.kind, 'raptor')
check('the old sheet is recognised as the old one', legacy.kind, 'swordfish')
/*
 * A HEADING BOTH SHEETS USE IS EVIDENCE OF NEITHER, and this is the case that got the detection
 * wrong twice before it was right. "Date of default" was worth keeping when the sheet was
 * rewritten, so it is on both; counted as current, every old sheet comes back a "mixture" on that
 * one column. So does `client_reference`, which reduces to the same thing as the old heading
 * "Client Reference". Asserted on the old sheet, where the miscounting showed.
 */
check('a heading both sheets share is counted towards neither',
  legacy.matched.filter((m) => m.via === 'label').length, 0)
ok('...and the old-only headings are what identify it',
  legacy.matched.filter((m) => m.via === 'was').length >= 5)
ok('...and says so in words somebody can act on', /older sheet/.test(legacy.note))

/*
 * THE SAME DEBTOR OUT OF BOTH. This is the whole promise: the surname, the reference and the
 * money come out identical whichever sheet the client sent.
 */
for (const [key, expected] of [
  ['name', 'Van Der Westhuizen'], ['first_name', 'Johannes'],
  ['client_reference', 'GPS3/10103'], ['id_number', '8503125009089'],
  ['cell_1', '082 123 4567'], ['street_1', '14 Protea Street'],
]) {
  check(`both sheets give the same ${key}`,
    [fresh.ready[0]?.values[key], legacy.ready[0]?.values[key]], [expected, expected])
}
check('and the same money', [fresh.totalCapital, legacy.totalCapital], [48250, 48250])
check('neither row is refused', [fresh.refused.length, legacy.refused.length], [0, 0])
/* The old sheet's initials column is read as the NAME, which is where its contents actually are. */
check('the old sheet’s "Debtor Initials" is mapped to the name, not to initials',
  legacy.matched.find((m) => m.heading === 'Debtor Initials')?.key, 'name')

/*
 * TWO HEADINGS FOR ONE COLUMN, AND ONE OF THEM EMPTY.
 *
 * The fixture above is the client's old sheet TIDIED, and that is why it passed while the real
 * file did not. The real sheet carries "Debtor Surname" AND "Debtor Initials" -- surname empty in
 * all 45 rows, initials holding all 45 surnames -- and "Client Prefix" AND "Client Reference",
 * prefix empty and reference holding the real ones. Only one heading can own a column, and that
 * was decided by whichever came first, so the importer took both empty columns and refused every
 * account for having no name and no reference while both sat one column to the right.
 *
 * The body decides it now. Asserted on a sheet shaped like the real one rather than the clean one.
 */
const DECOY_SHEET = [
  ['Client Prefix', 'Client Reference', 'Amount', 'Date of Default',
    'Debtor Surname', 'Debtor Initials', 'Debtor Firstname'],
  ['', 'GPS3/10103', '48250.00', '2026/09/17', '', 'Van Der Westhuizen', 'Johannes'],
  ['', 'GPS3/10104', '1550.60', '2026/09/17', '', 'Buitendag', 'Maria'],
]
const decoy = planHandover({ rows: DECOY_SHEET, today: TODAY })
check('the column with the surnames in it wins, not the one that is named after them',
  decoy.ready[0]?.values.name, 'Van Der Westhuizen')
check('...and the reference comes from the column that has references',
  decoy.ready[0]?.values.client_reference, 'GPS3/10103')
check('...so nothing is refused', [decoy.refused.length, decoy.ready.length], [0, 2])
/* The loser is NAMED. A column silently dropped is a column somebody spends an afternoon on. */
ok('the empty heading that lost is reported rather than dropped',
  decoy.unrecognised.includes('Debtor Surname') && decoy.unrecognised.includes('Client Prefix'))
ok('...and the winner is the one in the mapping',
  decoy.matched.some((m) => m.heading === 'Debtor Initials' && m.key === 'name'))

/*
 * A TIE KEEPS THE FIRST, which is the old behaviour and the right one where there is nothing to
 * choose on: two columns equally full are a question for a person, not a coin toss that changes
 * between two runs of the same file.
 */
const tied = planHandover({
  rows: [
    ['Capital on Default', 'Amount', 'Client Reference', 'Date of Default', 'Debtor Surname'],
    ['48250.00', '99999.00', 'GPS3/10103', '2026/09/17', 'Van Der Westhuizen'],
  ],
  today: TODAY,
})
check('two equally full columns keep the first', tied.totalCapital, 48250)
ok('...and the second is reported', tied.unrecognised.includes('Amount'))

/* ---------- 4. a heading nobody knows is reported, never guessed ---------- */

const odd = planHandover({
  rows: [['Your reference', 'Handover amount', 'Date of default', 'Surname, or the business name',
    'Person or business', 'Mystery column'],
  ['A1', '100', '2026-01-01', 'Dube', 'Person', 'something']],
  today: TODAY,
})
check('an unknown heading is named rather than mapped by position',
  odd.unrecognised, ['Mystery column'])
ok('...and does not take a column with it', odd.matched.length === 5)

/* A sheet of nothing we know is not a sheet of nulls; it says so. */
const nonsense = planHandover({ rows: [['Alpha', 'Beta'], ['1', '2']], today: TODAY })
check('a file that is not a handover sheet is refused as one', nonsense.kind, 'unknown')
check('...naming every required column it lacks', nonsense.missingRequired.length, 5)

/* ---------- 5. refuse and warn are different things ---------- */

/*
 * The last column is the EMAIL, not the street address, and that is the change rather than a
 * tidy-up. THE FIRM: "we will never be posting something. Never ever we will post a letter. We
 * will send everything via email." So an email address is what a row needs to be free of
 * warnings, and 'x' in an address column no longer buys one anything.
 */
const rows = (...data) => planHandover({
  rows: [['Your reference', 'Handover amount', 'Date of default', 'Person or business',
    'Surname, or the business name', 'ID number', 'Cell number 1', 'Email address'], ...data],
  today: TODAY,
})

/* REFUSALS: nothing here can open a correct ledger. */
const noName = rows(['A1', '100', '2026-01-01', 'Person', '', '', '082 123 4567', 'a@b.co.za'])
ok('a row with no name is refused', noName.refused.length === 1)
const noMoney = rows(['A1', '', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'])
ok('a row with no handover amount is refused', noMoney.refused.length === 1)
/*
 * ---- A DATE NOBODY CAN READ, AND NO DATE AT ALL, ARE WARNINGS TOO ----
 *
 * THE FIRM: "it should also show you in a rejection state, but I have an option to accept it --
 * kind of like a warning -- and then make it three months before the handover. Not having the
 * date of default is not a deal breaker for starting to work the account, but it would be good
 * to confirm it. Make it three months, because most of the clients hand over on 90 days."
 *
 * The same substitute the future-date case below uses, because it is the same question asked
 * from the other end: what do we open on while the client is asked for the real one.
 */
const badDate = rows(['A1', '100', '31/02/2026', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'])
check('a date that does not exist no longer refuses the row', badDate.refused.length, 0)
check('...and it opens three months before handover',
  badDate.rows[0].defaultDateUsed, '2026-06-21')
/*
 * AND THE ROW STILL SAYS WHICH IT IS. The fixture's 31/02/2026 is a typo in the cell, and telling
 * somebody the file's order could not account for it is telling them the wrong thing to go and
 * check -- which is exactly what the firm went and checked. The substitute is ADDED to that
 * sentence, never written over it: without the diagnosis the client cannot be told what to fix.
 */
ok(`...saying there is no such day (${firstMessage(badDate.rows[0])})`,
  /there is no 31 February/.test(firstMessage(badDate.rows[0])))
ok('...and not blaming the order it was read in',
  !/order can account/.test(firstMessage(badDate.rows[0])))
ok('...and naming what it opened on instead',
  /21\/06\/2026/.test(firstMessage(badDate.rows[0])))

/* NO DATE AT ALL, which is the case the firm was actually looking at. */
const noDate = rows(['A1', '100', '', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'])
check('no date of default no longer refuses the row', noDate.refused.length, 0)
check('...and it opens three months before handover too',
  noDate.rows[0].defaultDateUsed, '2026-06-21')
ok('...still saying there was none', /No date of default/.test(firstMessage(noDate.rows[0])))
ok('...and why it matters', /in duplum runs from it/.test(firstMessage(noDate.rows[0])))
/*
 * A WARNING, SO IT STILL NEEDS A PERSON. The account opens only once somebody has read the
 * sentence and pressed Accept -- which is the whole of what makes a guessed date defensible.
 */
ok('a row with no date still has to be answered',
  noDate.rows[0].problems.some((p) => p.key === 'default_date' && p.level === 'warn'))
/*
 * AND THE 90 DAYS ARE THE FIRM'S OWN, said on the screen. A substitute nobody can account for is
 * one nobody will defend when a debtor's attorney asks where the date came from.
 */
ok('...and says where three months comes from',
  /most clients hand over/.test(firstMessage(noDate.rows[0])))
/*
 * A DATE OF DEFAULT IN THE FUTURE IS ACCEPTED ON A SUBSTITUTE, NOT REFUSED.
 *
 * THE FIRM, reversing their own instruction of two days earlier: "just say that it can be
 * accepted, but when it's accepted it will be minimum 30 days before handover. Let's make it
 * default three months before handover. However, still send a notification and make a note for
 * the client, send it to the communications department, and make a note on the system."
 *
 * The reasoning behind the refusal has not gone away -- in duplum, prescription and interest are
 * all measured from this date. What changed is who carries it: a refusal stopped the work and put
 * the whole row back on the client, and the firm would rather open the account, work it, and
 * settle the date alongside. Which is only defensible because nothing about it is silent, and
 * that is what most of this block asserts.
 */
const future = rows(['A1', '100', '15/03/2027', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'])
check('a date of default in the future no longer refuses the row', future.refused.length, 0)
check('...so the account can be opened', future.ready.length, 1)
/* A WARNING, so the row still needs a decision. It does not slip through unread. */
check('...but it still has to be answered',
  problemsOf(future.rows[0]).filter((p) => p.level === 'warn').map((p) => p.key), ['default_date'])
ok(`...saying what was wrong (${firstMessage(future.rows[0])})`,
  /in the future/.test(firstMessage(future.rows[0])))

/*
 * AND THE SUBSTITUTE IS NAMED IN THE MESSAGE, which is what carries it everywhere it has to go:
 * the draft table, the client's email, the batch query, and the account's own note through
 * noteForAccount. One sentence doing four jobs is why it has to hold BOTH dates.
 */
ok('...naming the date it will be opened on instead', /21\/06\/2026/.test(firstMessage(future.rows[0])))
ok('...and the date the client actually sent', /15\/03\/2027/.test(firstMessage(future.rows[0])))
ok('...and that the client must still confirm it',
  /client must confirm/i.test(firstMessage(future.rows[0])))

/*
 * THE SUBSTITUTE ITSELF, carried on the planned row rather than written into `values`. The draft
 * is the record of exactly what the client sent -- overwriting it there would erase the thing
 * the query is about.
 */
check('the row carries the date it will open on', future.rows[0].defaultDateUsed, '2026-06-21')
check('...while the sheet\u2019s own value is untouched',
  future.rows[0].values.default_date, '15/03/2027')
/* Every other row carries none, so a substitution cannot be applied where none was decided. */
check('a row with a good date substitutes nothing',
  rows(['A1', '100', '20/09/2026', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'])
    .rows[0].defaultDateUsed, null)

/*
 * TODAY ITSELF IS NOT THE FUTURE. An off-by-one here substitutes a date on every account a client
 * hands over on the day it defaults, which is a normal thing for a client to do -- and the
 * failure would be silent, because the row would import perfectly on the wrong date.
 */
const dueToday = rows(['A1', '100', '21/09/2026', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'])
check('an account that defaulted today is not in the future', dueToday.rows[0].defaultDateUsed, null)
const yesterday = rows(['A1', '100', '20/09/2026', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'])
check('nor is yesterday', yesterday.rows[0].defaultDateUsed, null)

/*
 * AND THE TWO DOORS NO LONGER AGREE, WHICH IS NOW THE POINT.
 *
 * validateNewDebtor still refuses a future handover date outright, and should: somebody typing
 * one account by hand has the client on the telephone and can ask. An import is forty-five rows
 * that arrived overnight from a spreadsheet, and stopping all of them to chase one date is what
 * the firm asked us to stop doing. Asserted so the difference is deliberate rather than drift.
 */
const blankDebtor = {
  accountNumber: '', clientReference: 'A1', firstName: '', surname: 'Dube', idNumber: '',
  capital: '100', handoverDate: '', interestRateAnnual: '24',
  mobile: '', workPhone: '', altNumber: '', email: '', address: '', employer: '',
  kin1Name: '', kin1Phone: '', kin2Name: '', kin2Phone: '',
}
const byHand = validateNewDebtor({ ...blankDebtor, handoverDate: '2027-03-15' }, TODAY)
ok('the by-hand form refuses a future handover date too',
  byHand.some((p) => p.field === 'handoverDate'))
/* Presence before absence: the same input dated today must pass, or the line above is satisfied
   by a form that objects to everything. */
check('...and accepts one dated today',
  validateNewDebtor({ ...blankDebtor, handoverDate: TODAY }, TODAY)
    .filter((p) => p.field === 'handoverDate').length, 0)

/*
 * A THIRTEENTH MONTH STILL NAMES THE ORDER -- but it takes a file that CONTRADICTS itself to
 * reach that message, and the first attempt at this fixture did not.
 *
 * A lone 03/13/2026 proves the file is month-first, so the date parses and nothing is wrong with
 * it at all. The message only appears where the file has already been settled the other way: one
 * row that can only be day-first, one that can only be month-first, and no order that reads both.
 */
const wrongWayRound = rows(
  ['A1', '100', '31/01/2026', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'],
  ['A2', '100', '03/13/2026', 'Person', 'Mokoena', '', '082 123 4567', 'a@b.co.za'])
ok('a file written both ways round is read day-first', wrongWayRound.dates.contradictory)
ok('...and the row that cannot be reports the order, not a missing day',
  /day\/month\/year/.test(firstMessage(wrongWayRound.rows[1])))

/*
 * AND THE ORDER REACHES THE ROWS. A plan that detects month-first and then reads its rows
 * day-first anyway would be the same bug wearing a detection routine.
 */
const american = planHandover({
  rows: [['Your reference', 'Handover amount', 'Date of default', 'Person or business',
    'Surname, or the business name'],
  ['A1', '100', '03/18/2026', 'Person', 'Dube'],
  ['A2', '100', '02/09/2024', 'Person', 'Mokoena']],
  today: TODAY,
})
check('a month-first file is detected', american.dates.order, 'month-first')
check('...and every row is read that way, including the one that reads either way',
  american.ready.map((r) => r.values.default_date), ['03/18/2026', '02/09/2024'])
ok('...with none of them refused', american.refused.length === 0)

const muddled = planHandover({
  rows: [['Your reference', 'Handover amount', 'Date of default', 'Person or business',
    'Surname, or the business name'],
  ['A1', '100', '18/03/2026', 'Person', 'Dube'],
  ['A2', '100', '03/18/2026', 'Person', 'Mokoena']],
  today: TODAY,
})
ok('a file written both ways round says so instead of picking one',
  muddled.dates.contradictory && /both ways round/.test(muddled.note))

/*
 * WARNINGS: the firm can work without these and would rather know. The ID above all -- every one
 * of the 45 rows in the client's own file had a telephone number in it, so refusing would have
 * refused the whole book, and a check that refuses a whole book gets turned off.
 */
const dodgyId = rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '0821234567', '082 123 4567', 'a@b.co.za'])
check('an ID that is not an ID warns rather than refuses',
  [dodgyId.refused.length, problemsOf(dodgyId.ready[0]).filter((p) => p.level === 'warn').length], [0, 1])
ok('...and says what will happen to it', /rather than guessed at/.test(firstMessage(dodgyId.ready[0])))
/*
 * THIRTEEN DIGITS THAT FAIL THE CHECKSUM ARE A DIFFERENT WRONG, and worth saying differently: a
 * transposed pair is something a person can find and correct, where the wrong column is not.
 * The checksum is isValidSaId, the same one the by-hand form uses, so the two cannot drift.
 */
const transposed = rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '8503125009098', '082 123 4567', 'a@b.co.za'])
ok(`a transposed ID is named as one (${firstMessage(transposed.ready[0])})`,
  /transposed pair/.test(firstMessage(transposed.ready[0])))
const goodId = rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '8503125009089', '082 123 4567', 'a@b.co.za'])
check('...and a real ID says nothing at all', problemsOf(goodId.ready[0]).length, 0)

/*
 * THE NUMBER EXCEL BROKE. 40 of 42 "Cell Phone 2" values in the firm's own import file were nine
 * digits, because Excel read 0129403445 as a number and dropped the zero. Those cannot be
 * dialled. Reported as the missing zero rather than as "invalid": the person has to know what to
 * put back, and "invalid" sends them looking for a typo that is not there.
 */
check('a good number is a good number', checkPhone('082 123 4567'), 'ok')
check('...in international form too', checkPhone('+27821234567'), 'ok')
check('...and with the brackets and dashes people type', checkPhone('(012) 348-2156'), 'ok')
check('nine digits is the leading zero Excel ate', checkPhone('821234567'), 'lost-leading-zero')
check('...and is reported as that, not as invalid',
  /missing its leading zero/.test(firstMessage(
    rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '', '821234567', 'x']).ready[0])), true)
check('a word is not a telephone number', checkPhone('no number'), 'wrong')
check('...nor is a number too short to be one', checkPhone('0821234'), 'wrong')

/*
 * AN EMAIL ADDRESS, checked for what stops it being deliverable rather than against the RFC. A
 * pattern strict enough to be correct rejects addresses that work, and an address rejected here
 * is a debtor the firm then cannot email at all.
 */
ok('an ordinary address passes', looksLikeEmail('j.vdwesthuizen@work.co.za'))
ok('...and one with a plus in it', looksLikeEmail('sue+accounts@firm.com'))
ok('a name is not an address', !looksLikeEmail('Johannes van der Westhuizen'))
ok('...nor two addresses crammed into one cell', !looksLikeEmail('a@b.co.za, c@d.co.za'))
ok('...nor one with no dot after the @', !looksLikeEmail('johannes@work'))
/*
 * NO EMAIL IS THE WARNING NOW, AND NO STREET ADDRESS IS NOT.
 *
 * THE FIRM: "we will never be posting something. Never ever we will post a letter. We will send
 * everything via email." This warned about the street address and said a section 129 could not be
 * POSTED -- wrong about the channel, and pointed at the wrong empty box.
 *
 * It was also noise. The street address was empty in all 45 rows of the file the firm sent, so
 * the screen printed the same sentence forty-five times under the table. CLAUDE.md: a warning
 * that fires when nothing is wrong is worse than no warning.
 */
const noEmail = rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', ''])
ok('no email address warns, because that is what a notice goes out on',
  problemsOf(noEmail.ready[0]).some((p) => p.level === 'warn' && /sent by email/.test(p.message)))
ok('...against the email column, so the screen can point at the box',
  problemsOf(noEmail.ready[0]).some((p) => p.key === 'email_1'))
/* Nothing anywhere may tell somebody a notice is posted. */
const everyMessage = [...noEmail.ready, ...noEmail.refused]
  .flatMap((r) => problemsOf(r).map((p) => p.message)).join(' ')
ok('...and nothing says anything is posted', !/\bpost(ed|ing)?\b/i.test(everyMessage))

/* An address that is missing is now shown as an empty box in the table, not said in a sentence. */
const noStreet = rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'])
check('an empty street address is not a problem at all', problemsOf(noStreet.ready[0]).length, 0)

const noContact = rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '', '', ''])
ok('a debtor nobody can reach warns',
  problemsOf(noContact.ready[0]).some((p) => /nobody can be contacted/.test(p.message)))

/*
 * EVERY PROBLEM SAYS WHICH COLUMN IT IS ABOUT, where it is about one. THE FIRM: "it should show
 * which data is wrong." A sentence under a forty-column table cannot be traced back to a cell.
 */
const wrong = rows(['A1', 'not money', '2026-01-01', 'Person', '', '', '082 123 4567', 'a@b.co.za'])
const keyed = problemsOf(wrong.rows[0])
ok('the amount problem points at the amount', keyed.some((p) => p.key === 'capital'))
ok('the name problem points at the name', keyed.some((p) => p.key === 'name'))
/* Null where it belongs to the row rather than to one box -- a duplicated reference is about the
   file, not about a cell anybody can correct on its own. */
const sameRefTwice = rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'],
  ['A1', '100', '2026-01-01', 'Person', 'Mokoena', '', '082 123 4567', 'a@b.co.za'])
ok('a repeated reference points at the reference',
  problemsOf(sameRefTwice.rows[1]).some((p) => p.key === 'client_reference'))
ok('...and a problem about the whole row names no column',
  problemsOf(noContact.ready[0]).some((p) => p.key === null))

/* ---------- 5b. possible duplicates ---------- */

/*
 * THE FIRM: "it's possible that a client can put the same data twice on the same sheet, or that
 * the same data has already been handed over for the same amount. So it should flag it and tell
 * you: here's a possible duplicate handover, accept or discard."
 *
 * NEITHER OF THEM REFUSES. A client can genuinely hand the same debtor over twice for two
 * different debts, and "accept or discard" is a choice, not a rule.
 */
const ID_A = '8503125009089'

/* Twice in one file, under DIFFERENT references, which is the case the existing duplicate-
   reference refusal cannot see -- it is the same debt typed twice, not the same reference. */
const twiceInFile = rows(
  ['A1', '100', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'],
  ['A2', '100', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'])
ok('the same debtor and amount twice in one file is flagged',
  problemsOf(twiceInFile.rows[1]).some((p) => /Row 2 is the other one/.test(p.message)))
check('...as a warning, not a refusal', twiceInFile.refused.length, 0)
/* THE FIRM'S OWN WORD FOR IT: "it could be like a linked account -- just call it linked account,
   not other account." The screen says what the firm calls the thing. */
ok('...and calls it a linked account',
  /linked account/.test(firstMessage(twiceInFile.rows[1])))
ok('...and says what to do about it',
  /Accept it if they genuinely owe twice/.test(firstMessage(twiceInFile.rows[1])))
check('...and the first copy is not itself flagged', problemsOf(twiceInFile.rows[0]).length, 0)

/* A THIRD COPY POINTS AT THE FIRST, not at the second: a chain of "row 4 duplicates row 3,
   row 3 duplicates row 2" is one nobody unpicks. */
const thrice = rows(
  ['A1', '100', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'],
  ['A2', '100', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'],
  ['A3', '100', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'])
ok('a third copy points at the first, not at the second',
  /Row 2 is the other one/.test(firstMessage(thrice.rows[2])))

/* Same name, different amount, and the other way round: either half alone is worthless. In the
   firm's own file fourteen accounts are for exactly R380 and three surnames appear twice. */
const sameNameOtherAmount = rows(
  ['A1', '100', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'],
  ['A2', '250', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'])
check('the same surname for a different amount is not a duplicate',
  problemsOf(sameNameOtherAmount.rows[1]).length, 0)
const sameAmountOtherName = rows(
  ['A1', '380', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'],
  ['A2', '380', '2026-01-01', 'Person', 'Mokoena', '', '082 123 4567', 'a@b.co.za'])
check('...nor the same amount for a different surname',
  problemsOf(sameAmountOtherName.rows[1]).length, 0)

/*
 * THE SAME ID FOR A DIFFERENT AMOUNT IS NOT A DUPLICATE, at the firm's correction: "it is also
 * possible for the same debtor to be handed over twice ... the same ID number. You can create
 * something called a linked account."
 *
 * This file asserted the opposite a commit ago, and the assertion was right about the code and
 * wrong about the firm. One person with two debts is the ordinary case; flagged as a duplicate it
 * would have had somebody discard a real account. It is two accounts for one debtor, which is
 * what the account page shows instead.
 */
const sameIdOtherAmount = rows(
  ['A1', '100', '2026-01-01', 'Person', 'Dube', ID_A, '082 123 4567', 'a@b.co.za'],
  ['A2', '999', '2026-01-01', 'Person', 'Dube', ID_A, '082 123 4567', 'a@b.co.za'])
check('the same ID for a different amount is a second debt, not a duplicate',
  problemsOf(sameIdOtherAmount.rows[1]).length, 0)
/* The same ID AND the same amount still is: one debt, typed twice. */
const sameIdSameAmount = rows(
  ['A1', '100', '2026-01-01', 'Person', 'Dube', ID_A, '082 123 4567', 'a@b.co.za'],
  ['A2', '100', '2026-01-01', 'Person', 'Mokoena', ID_A, '082 123 4567', 'a@b.co.za'])
ok('the same ID for the same amount is flagged',
  problemsOf(sameIdSameAmount.rows[1]).some((p) => /Row 2 is the other one/.test(p.message)))
/* THE ID BEATS THE SURNAME where the two disagree: the row above has a different surname and is
   still caught, because the identifier is the ID wherever there is a usable one. */
check('...even though the surnames differ', sameIdSameAmount.refused.length, 0)

/*
 * AND THE ID COLUMN THAT HELD A TELEPHONE NUMBER MUST NOT MATCH. Every one of the 45 rows in the
 * client's own file had a cell number there; matched on, it would have reported 45 duplicates of
 * nothing and taught the firm to ignore the whole warning on its first use.
 */
const phoneInIdColumn = rows(
  ['A1', '100', '2026-01-01', 'Person', 'Dube', '0821234567', '082 123 4567', 'a@b.co.za'],
  ['A2', '250', '2026-01-01', 'Person', 'Mokoena', '0821234567', '082 123 4567', 'a@b.co.za'])
ok('a telephone number in the ID column is never a duplicate signal',
  !problemsOf(phoneInIdColumn.rows[1]).some((p) => /duplicate/i.test(p.message)))

/* ALREADY ON THE BOOK, which is the other half of what the firm asked for. */
const onBook = (data) => planHandover({
  rows: [['Your reference', 'Handover amount', 'Date of default', 'Person or business',
    'Surname', 'ID number', 'Cell number 1', 'Email address'], data],
  existingAccounts: [
    {
      reference: 'ACF10085', clientReference: 'CR-1', idNumber: null, name: 'Dube', capital: 100,
      status: 'Active: Activated', subStatus: 'Promise To Pay',
      heldBy: 'jennifer-id', heldByName: 'Jennifer Adams',
    },
    { reference: 'ACF10086', idNumber: ID_A, name: 'Ntuli', capital: 4200 },
  ],
  today: TODAY,
})
const onBookAlready = onBook(['A9', '100', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'])
ok('a debt already on the book is flagged',
  /Already on the book/.test(firstMessage(onBookAlready.rows[0])))
ok('...and names the account to go and look at',
  /ACF10085/.test(firstMessage(onBookAlready.rows[0])))
check('...still as a warning', onBookAlready.refused.length, 0)
/*
 * AND IT SAYS ENOUGH TO DECIDE ON. THE FIRM: "there might be another one, and that's the
 * reference number for the client, and the surname is Peter, and the account is currently being
 * worked by Jennifer ... then we can see who worked on that account and allocate it to that
 * person." A reference alone is a warning somebody has to leave the screen to act on.
 *
 * THE POSITION, NOT THE STATUS COLUMN -- CLAUDE.md's first rule. "Active: Activated" describes
 * how the row got into the table; "Arranged" is what the person deciding needs.
 */
ok(`...the surname (${firstMessage(onBookAlready.rows[0])})`,
  /Dube/.test(firstMessage(onBookAlready.rows[0])))
ok('...where it stands, as a position rather than a status column',
  /Arranged/.test(firstMessage(onBookAlready.rows[0]))
  && !/Active: Activated/.test(firstMessage(onBookAlready.rows[0])))
ok('...and whose desk it is on',
  /Jennifer Adams/.test(firstMessage(onBookAlready.rows[0])))
check('...and the desk is offered as a suggestion',
  suggestedDesk(onBookAlready.rows[0].linkedTo)?.name, 'Jennifer Adams')
/* An account nobody holds suggests nobody, rather than suggesting the pile as though it were a
   person. There is no desk to follow onto. */
const unheld = planHandover({
  rows: [['Your reference', 'Handover amount', 'Date of default', 'Person or business', 'Surname'],
    ['A9', '100', '2026-01-01', 'Person', 'Dube']],
  existingAccounts: [{ reference: 'ACF10099', idNumber: null, name: 'Dube', capital: 100 }],
  today: TODAY,
})
check('an account on nobody’s desk suggests nobody',
  suggestedDesk(unheld.rows[0].linkedTo), null)
ok('...and says so rather than leaving it out',
  /nobody/.test(firstMessage(unheld.rows[0])))
const byId = onBook(['A9', '4200', '2026-01-01', 'Person', 'Someone', ID_A, '082 123 4567', 'a@b.co.za'])
ok('...matched on the ID as well as on the surname', /ACF10086/.test(firstMessage(byId.rows[0])))
/* And a second debt for somebody already on the book is not a duplicate of their first. */
const secondDebt = onBook(['A9', '77', '2026-01-01', 'Person', 'Ntuli', ID_A, '082 123 4567', 'a@b.co.za'])
check('a second debt for a debtor already on the book is not flagged',
  problemsOf(secondDebt.rows[0]).length, 0)
const notOnBook = onBook(['A9', '101', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'])
check('a rand different is not the same debt', problemsOf(notOnBook.rows[0]).length, 0)
/* A book that could not be read is not a book full of duplicates. */
const noBook = rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'a@b.co.za'])
check('no book to compare against says nothing', problemsOf(noBook.rows[0]).length, 0)

/* ---------- 6. one debt, one ledger ---------- */

const twice = rows(
  ['A1', '100', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'x'],
  ['A1', '200', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'x'],
)
/*
 * ---- THE SAME REFERENCE TWICE IS A LINKED ACCOUNT, NOT A BROKEN FILE ----
 *
 * THE FIRM: "it's the same reference number, but two accounts. It could be like a linked account
 * ... the same person with two different accounts from the same client. The first thing that
 * should happen is it should ask you: this looks like a linked account, do you want to accept it
 * or reject it? But there should be an accept option."
 *
 * BOTH OF THESE REFUSED A MOMENT AGO, and the refusal rested on a misreading: this column holds
 * the CLIENT's reference, which is theirs to reuse. What a debtor quotes when they pay is the
 * reference Raptor generates on import, so two rows sharing a client reference collide over
 * nothing -- and refusing them sent a second genuine debt back to the client to argue about.
 */
check('the same reference twice opens both, as a question rather than a refusal',
  [twice.ready.length, twice.refused.length], [2, 0])
ok('...saying it looks like a linked account',
  /linked account/.test(firstMessage(twice.rows[1])))
ok('...and naming the row it is linked to', /Row 2 is the other one/.test(firstMessage(twice.rows[1])))
/* The FIRST use is not itself flagged: a pair is one question, and asking it twice reads as two.
   Asked of the LINKED problem only -- this fixture's rows carry an unrelated email warning, and
   counting every problem would make this pass or fail for a reason that is not the subject. */
check('...and the first use is not flagged as linked',
  problemsOf(twice.rows[0]).filter((x) => /linked account/.test(x.message)).length, 0)
/* A row still has to be ANSWERED. The account opens only once somebody has pressed Accept, which
   is the whole of what makes taking a repeated reference safe. */
ok('...and it still has to be answered',
  problemsOf(twice.rows[1]).some((p) => p.key === 'client_reference' && p.level === 'warn'))

const already = planHandover({
  rows: [['Your reference', 'Handover amount', 'Date of default', 'Person or business',
    'Surname, or the business name'], ['A1', '100', '2026-01-01', 'Person', 'Dube']],
  existingReferences: new Set(['A1']),
  today: TODAY,
})
check('a reference the client has already handed over is not refused either',
  already.refused.length, 0)
ok(`...it is asked about (${firstMessage(already.rows[0])})`,
  /linked account/.test(firstMessage(already.rows[0])))

/* AND WITH THE BOOK READ IN FULL, it says which account and whose desk it is on. */
const linkedOnBook = planHandover({
  rows: [['Your reference', 'Handover amount', 'Date of default', 'Person or business', 'Surname'],
    ['CR-1', '900', '2026-01-01', 'Person', 'Dube']],
  existingAccounts: [{
    reference: 'ACF10085', clientReference: 'CR-1', idNumber: null, name: 'Dube', capital: 100,
    status: 'Active: Activated', subStatus: 'Promise To Pay',
    heldBy: 'jennifer-id', heldByName: 'Jennifer Adams',
  }],
  today: TODAY,
})
check('a client reference already on the book is a linked account, not a refusal',
  linkedOnBook.refused.length, 0)
ok(`...naming the account (${firstMessage(linkedOnBook.rows[0])})`,
  /ACF10085/.test(firstMessage(linkedOnBook.rows[0])))
check('...and suggesting the desk it is already on',
  suggestedDesk(linkedOnBook.rows[0].linkedTo)?.id, 'jennifer-id')
/*
 * ONE QUESTION, NOT TWO. This row matches on the client's reference AND would match as the same
 * debtor; saying both reads as two separate accounts to go and look at.
 */
check('...said once even when both tests would fire',
  problemsOf(linkedOnBook.rows[0]).filter((p) => /linked account/.test(p.message)).length, 1)

/* Blank rows under the data are the template's formatting, not debtors with nothing filled in. */
const padded = rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'x'],
  ['', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', ''])
check('the blank rows the template carries are not read as debtors', padded.rows.length, 1)

/* The line number is the one Excel shows, so "row 7" means row 7 on the person's screen. */
check('a problem names the row as the spreadsheet numbers it', twice.rows[1]?.line, 3)

/* ---------------------------------------------------------------- report */

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Either sheet, read without anybody declaring which -- the same debtor, the same money and the same
surname out of both, with the old sheet's "Debtor Initials" corrected to the name because that is
where its surnames actually are. A heading nobody knows is named rather than mapped by position; dates
are read day/month/year the way South Africa writes them, with the order settled ONCE for the whole
file so an American sheet cannot come out half one way and half the other; and an ID that is not an
ID warns rather than refusing a whole book.`)
