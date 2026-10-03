/**
 * WHY THE IDENTITY NUMBERS DID NOT PULL IN — ANSWERED, RATHER THAN LEFT AS A NULL.
 *
 * THE FIRM, told what Raptor held: "I don't know why the ID numbers didn't pull in, but usually we
 * have like 80% or 90% of all the ID numbers. It's not a problem usually, it's here and there that
 * we don't have an ID number or a company registration number."
 *
 * RAPTOR'S BOOK HAD THEM ON 3% — 19 668 of 19 912 live accounts with none — and nothing anywhere
 * said why. That gap matters twice over: an account with no identity number cannot be traced at a
 * bureau at all, and every one of the 32 collections templates quotes it.
 *
 * THREE REASONS, AND THEY WANT THREE DIFFERENT PEOPLE TO DO THREE DIFFERENT THINGS:
 *
 *   no column at all      a mapping fault. The sheet goes back to be exported again.
 *   column, mostly blank  Swordfish's own data is thinner than the firm believes, and the firm
 *                         needs to know that before working the book rather than after.
 *   column, rejected      our own rule is refusing what is there -- and the twelve-digit count
 *                         says how much of that is a spreadsheet eating a leading zero, which is
 *                         a real identity number Raptor is throwing away.
 *
 * A SILENT NULL LOOKS IDENTICAL FOR ALL THREE. This is CLAUDE.md's standing complaint about
 * hand-written mappers, met in the one place where it costs a whole book.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-id-coverage.mjs
 */
import { readDebtorsPerClient } from '../../src/lib/swordfishDebtors.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const says = (out, re) => [...out.problems, ...out.notes].some((n) => re.test(n))

const NOW = new Date('2026-10-03T00:00:00Z')
/* Every row of a parsed sheet carries every header, so a blank cell is an empty string and a
   MISSING COLUMN is an absent key. That difference is the whole of what this file turns on. */
const row = (over = {}) => ({
  'Swordfish Reference': 'SW-1', 'First Name': 'Promise', 'Surname': 'Sikelele',
  'ID Number': '8806045286087', ...over,
})

/* ---------------------------------------------------------------------------------------------
 * THE COLUMN IS NOT THERE AT ALL
 * ------------------------------------------------------------------------------------------- */

const noColumn = readDebtorsPerClient(
  [{ 'Swordfish Reference': 'SW-1', 'First Name': 'Promise', 'Surname': 'Sikelele' }], NOW)
check('a sheet with no ID column is seen as having none', noColumn.stats.idColumnPresent, false)
/*
 * A PROBLEM, NOT A NOTE. The import's problems are what somebody reads before deciding to go
 * ahead, and a book that cannot be traced at all is not a footnote.
 */
ok('...and it is raised as a problem', noColumn.problems.some((p) => /no "ID Number" column/.test(p)))
ok('...saying what it costs', says(noColumn, /Nothing on these accounts can be traced/))
/* AND IT DOES NOT ALSO REPORT A COVERAGE PERCENTAGE, which would be 0% of a column that does not
   exist -- a true number that sends somebody looking at the client's data instead of the export. */
ok('...and does not blame the data as well', !says(noColumn, /came with a usable identity number/))

/* ---------------------------------------------------------------------------------------------
 * THE COLUMN IS THERE AND THE DATA IS THIN
 * ------------------------------------------------------------------------------------------- */

/* Nine of ten blank: 10%, far under what the firm expects. */
const thin = readDebtorsPerClient(
  [row(), ...Array.from({ length: 9 }, (_, i) => row({ 'Swordfish Reference': `SW-${i + 2}`, 'ID Number': '' }))],
  NOW)
check('the column is seen', thin.stats.idColumnPresent, true)
check('...the blanks are counted', thin.stats.idsBlank, 9)
ok('...the coverage is reported', says(thin, /1 of 10 debtors \(10%\) came with a usable identity number/))
/*
 * THE FIRM'S OWN EXPECTATION IS THE THRESHOLD. Below it this is something to look at before the
 * book is worked, which makes it a problem; at or above it, it is a figure for the record.
 */
ok('...as a problem, because it is under what the firm expects',
  thin.problems.some((p) => /80–90%/.test(p)))
ok('...and the blanks are named', says(thin, /9 had the ID Number cell empty/))

/* AND A GOOD EXPORT IS NOT NAGGED AT. A warning that fires when nothing is wrong is worse than no
   warning, because people stop reading it. */
const good = readDebtorsPerClient(
  Array.from({ length: 10 }, (_, i) => row({ 'Swordfish Reference': `SW-${i + 1}` })), NOW)
ok('a full export reports its coverage', says(good, /10 of 10 debtors \(100%\) came with a usable/))
ok('...as a note rather than a problem', good.problems.length === 0)

/* NINE OF TEN IS INSIDE WHAT THE FIRM EXPECTS and must not be raised as a problem. */
const ninety = readDebtorsPerClient(
  [...Array.from({ length: 9 }, (_, i) => row({ 'Swordfish Reference': `SW-${i + 1}` })),
    row({ 'Swordfish Reference': 'SW-10', 'ID Number': '' })], NOW)
ok('90% is reported without being called a problem',
  says(ninety, /\(90%\)/) && ninety.problems.length === 0)

/* ---------------------------------------------------------------------------------------------
 * THE COLUMN IS THERE AND WE ARE REFUSING WHAT IS IN IT
 * ------------------------------------------------------------------------------------------- */

/*
 * TWELVE DIGITS IS THE ONE REJECTION WITH A KNOWN CAUSE AND A KNOWN FIX. A spreadsheet reading an
 * ID column as a NUMBER eats the leading zero, so every debtor whose number starts with 0 arrives
 * one digit short. Those debtors DO have identity numbers and Raptor is throwing them away.
 */
const eaten = readDebtorsPerClient([row({ 'ID Number': '880604528608' })], NOW)
check('a twelve-digit ID is still rejected', eaten.stats.idsRejected, 1)
check('...and counted as what it is', eaten.stats.idsTwelveDigit, 1)
ok('...and the cause is named', says(eaten, /drops the leading zero/))
ok('...with the fix', says(eaten, /Re-export that column as text/))
/*
 * AND NOTHING GUESSES THE MISSING DIGIT. Writing a 0 on the front produces a number that passes
 * every check and belongs to somebody else one time in ten -- and a bureau search on it is a
 * search the firm pays for, about a stranger.
 */
check('...and the number is not repaired by guessing', eaten.patches.get('SW-1')?.debtor_id_number, undefined)

/* A PHONE NUMBER IN THE ID FIELD IS A DIFFERENT REJECTION and must not be counted as a lost ID. */
const phone = readDebtorsPerClient([row({ 'ID Number': '0821234567' })], NOW)
check('a phone number in the ID field is rejected', phone.stats.idsRejected, 1)
check('...and is not counted as an eaten leading zero', phone.stats.idsTwelveDigit, 0)
ok('...so no re-export is suggested for it', !says(phone, /Re-export that column as text/))

/* ---------------------------------------------------------------------------------------------
 * AND A GOOD ID STILL LANDS
 * ------------------------------------------------------------------------------------------- */

check('a thirteen-digit ID is kept', good.patches.get('SW-1')?.debtor_id_number, '8806045286087')
/* SPACES ARE NOT A REJECTION. The export writes them and a human types them. */
check('...and spacing is forgiven',
  readDebtorsPerClient([row({ 'ID Number': '880604 5286 087' })], NOW)
    .patches.get('SW-1')?.debtor_id_number, '8806045286087')

/* AN EMPTY EXPORT SAYS NOTHING RATHER THAN BLAMING ANYBODY. Nought of nought is not 0% coverage
   and it is not a missing column; it is a sheet with no rows. */
const empty = readDebtorsPerClient([], NOW)
ok('an empty export raises nothing about identity numbers',
  !says(empty, /identity number/) && !says(empty, /ID Number/))

console.log(`\ncheck-id-coverage: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
