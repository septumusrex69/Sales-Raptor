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
  checkPhone, detectDateOrder, looksLikeEmail, parseMoney, parseSheetDate, planHandover,
} from '../../src/lib/handoverImport.ts'

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

const rows = (...data) => planHandover({
  rows: [['Your reference', 'Handover amount', 'Date of default', 'Person or business',
    'Surname, or the business name', 'ID number', 'Cell number 1', 'Street address 1'], ...data],
  today: TODAY,
})

/* REFUSALS: nothing here can open a correct ledger. */
const noName = rows(['A1', '100', '2026-01-01', 'Person', '', '', '082 123 4567', 'x'])
ok('a row with no name is refused', noName.refused.length === 1)
const noMoney = rows(['A1', '', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'x'])
ok('a row with no handover amount is refused', noMoney.refused.length === 1)
const badDate = rows(['A1', '100', '31/02/2026', 'Person', 'Dube', '', '082 123 4567', 'x'])
ok('a row whose date does not exist is refused', badDate.refused.length === 1)
ok(`...and names the order it was read in (${firstMessage(badDate.rows[0])})`,
  /day\/month\/year/.test(firstMessage(badDate.rows[0])))

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
const dodgyId = rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '0821234567', '082 123 4567', 'x'])
check('an ID that is not an ID warns rather than refuses',
  [dodgyId.refused.length, problemsOf(dodgyId.ready[0]).filter((p) => p.level === 'warn').length], [0, 1])
ok('...and says what will happen to it', /rather than guessed at/.test(firstMessage(dodgyId.ready[0])))
/*
 * THIRTEEN DIGITS THAT FAIL THE CHECKSUM ARE A DIFFERENT WRONG, and worth saying differently: a
 * transposed pair is something a person can find and correct, where the wrong column is not.
 * The checksum is isValidSaId, the same one the by-hand form uses, so the two cannot drift.
 */
const transposed = rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '8503125009098', '082 123 4567', 'x'])
ok(`a transposed ID is named as one (${firstMessage(transposed.ready[0])})`,
  /transposed pair/.test(firstMessage(transposed.ready[0])))
const goodId = rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '8503125009089', '082 123 4567', 'x'])
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
const noAddress = rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', ''])
ok('no street address warns, because a section 129 cannot be posted',
  problemsOf(noAddress.ready[0]).some((p) => p.level === 'warn' && /section 129/.test(p.message)))
const noContact = rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '', '', 'x'])
ok('a debtor nobody can reach warns',
  problemsOf(noContact.ready[0]).some((p) => /nobody can be contacted/.test(p.message)))

/* ---------- 6. one debt, one ledger ---------- */

const twice = rows(
  ['A1', '100', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'x'],
  ['A1', '200', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'x'],
)
check('the same reference twice in one file opens one ledger, not two',
  [twice.ready.length, twice.refused.length], [1, 1])
const already = planHandover({
  rows: [['Your reference', 'Handover amount', 'Date of default', 'Person or business',
    'Surname, or the business name'], ['A1', '100', '2026-01-01', 'Person', 'Dube']],
  existingReferences: new Set(['A1']),
  today: TODAY,
})
ok(`a reference the client has already handed over is refused (${firstMessage(already.refused[0])})`,
  already.refused.length === 1 && /already on this client/.test(firstMessage(already.refused[0])))

/* Blank rows under the data are the template's formatting, not debtors with nothing filled in. */
const padded = rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '', '082 123 4567', 'x'],
  ['', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', ''])
check('the blank rows the template carries are not read as debtors', padded.rows.length, 1)

/* The line number is the one Excel shows, so "row 7" means row 7 on the person's screen. */
check('a problem names the row as the spreadsheet numbers it', twice.refused[0]?.line, 3)

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
