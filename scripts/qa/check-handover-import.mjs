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
import { planHandover, parseMoney, parseSheetDate } from '../../src/lib/handoverImport.ts'

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
 * A SLASH DATE THAT CAN ONLY MEAN ONE THING IS READ; ONE THAT COULD MEAN TWO IS REFUSED.
 * 18/03/2026 has an 18 in it, so it can only be a day. 02/09/2024 is 9 February to one person
 * and 2 September to another, and on a date of default that is whether the debt has prescribed.
 */
check('an unambiguous slash date reads', parseSheetDate('18/03/2026'), '2026-03-18')
check('an ambiguous one is refused rather than guessed', parseSheetDate('02/09/2024'), null)
check('a reference number is not a date', parseSheetDate('929228801'), null)
check('nothing is not a date', parseSheetDate(''), null)

/* ---------- 3. the same debtor, out of either sheet ---------- */

/** One row, written as the firm's current sheet has it. */
const NEW_SHEET = [
  ['Your reference', 'Handover amount', 'Date of default', 'Person or business',
    'Surname, or the business name', 'First name', 'ID number', 'Cell number 1', 'Street address 1'],
  ['GPS3/10103', '48250.00', '2026-03-18', 'Person', 'Van Der Westhuizen', 'Johannes',
    '8503125009087', '082 123 4567', '14 Protea Street'],
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
    '8503125009087', '082 123 4567', '14 Protea Street'],
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
  ['client_reference', 'GPS3/10103'], ['id_number', '8503125009087'],
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
const noName = rows(['A1', '100', '2026-01-01', 'Person', '', '', '082 1', 'x'])
ok('a row with no name is refused', noName.refused.length === 1)
const noMoney = rows(['A1', '', '2026-01-01', 'Person', 'Dube', '', '082 1', 'x'])
ok('a row with no handover amount is refused', noMoney.refused.length === 1)
const badDate = rows(['A1', '100', '02/09/2024', 'Person', 'Dube', '', '082 1', 'x'])
ok('a row whose date could mean two days is refused', badDate.refused.length === 1)
ok(`...and says which day it could not choose between (${firstMessage(badDate.rows[0])})`,
  /could be two different days/.test(firstMessage(badDate.rows[0])))

/*
 * WARNINGS: the firm can work without these and would rather know. The ID above all -- every one
 * of the 45 rows in the client's own file had a telephone number in it, so refusing would have
 * refused the whole book, and a check that refuses a whole book gets turned off.
 */
const dodgyId = rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '0821234567', '082 1', 'x'])
check('an ID that is not an ID warns rather than refuses',
  [dodgyId.refused.length, problemsOf(dodgyId.ready[0]).filter((p) => p.level === 'warn').length], [0, 1])
ok('...and says what will happen to it', /rather than guessed at/.test(firstMessage(dodgyId.ready[0])))
const noAddress = rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '', '082 1', ''])
ok('no street address warns, because a section 129 cannot be posted',
  problemsOf(noAddress.ready[0]).some((p) => p.level === 'warn' && /section 129/.test(p.message)))
const noContact = rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '', '', 'x'])
ok('a debtor nobody can reach warns',
  problemsOf(noContact.ready[0]).some((p) => /nobody can be contacted/.test(p.message)))

/* ---------- 6. one debt, one ledger ---------- */

const twice = rows(
  ['A1', '100', '2026-01-01', 'Person', 'Dube', '', '082 1', 'x'],
  ['A1', '200', '2026-01-01', 'Person', 'Dube', '', '082 1', 'x'],
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
const padded = rows(['A1', '100', '2026-01-01', 'Person', 'Dube', '', '082 1', 'x'],
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
where its surnames actually are. A heading nobody knows is named rather than mapped by position, a
date that could mean two days is refused rather than guessed, and an ID that is not an ID warns
rather than refusing a whole book.`)
