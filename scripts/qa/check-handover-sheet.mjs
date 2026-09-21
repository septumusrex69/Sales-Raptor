/**
 * The handover sheet's columns, and the promise that an old sheet still reads.
 *
 * THE FIRM: "some clients could possibly take it some time to change the import sheet." So the
 * sheet that exists today is not history to be migrated off -- it is a second valid input, for as
 * long as it takes, and the importer has to read both. That promise is a table of aliases, and a
 * table of aliases rots silently: a heading dropped from it does not fail, it just stops being
 * recognised, and a column stops arriving.
 *
 * So the OLD sheet's fifty-five headings are written out below and every one of them must either
 * map to a column or be on the list of things deliberately not carried across. There is no third
 * answer, and "we forgot" cannot hide in either list.
 */
import { HANDOVER_COLUMNS, aliasIndex, headingKey } from '../../src/lib/handoverSheet.ts'

let pass = 0
const failures = []
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${label}\n    expected ${e}\n    got      ${a}`)
}
const ok = (label, actual) => check(label, actual, true)

const by = (key) => HANDOVER_COLUMNS.find((c) => c.key === key)
const index = aliasIndex()

/* ---------- 1. the three failures measured on the old sheet ---------- */

/*
 * Each of these is a count off the client's own 45 rows, not an opinion:
 *   - "Debtor Surname" empty 0/45, surnames all in "Debtor Initials"
 *   - "Debtor ID" 45/45 identical to Cell Phone 1, none of them 13 digits
 *   - "Cell Phone 2" 40/42 stripped of a leading zero by Excel
 */
ok('there is exactly one name column and it is required', by('name')?.required === true)
ok('...and the old sheet’s INITIALS column maps to it, because that is where the surname is',
  index.get(headingKey('Debtor Initials'))?.key === 'name')
ok('...while the new sheet’s own initials column is separate and optional',
  by('initials') !== undefined && by('initials')?.required === undefined)
/*
 * A SURNAME AND AN INITIAL CANNOT BOTH BE "Debtor Initials". The old heading is claimed by the
 * name column, so the initials column must NOT also claim it -- first-wins in aliasIndex would
 * hide the conflict, and the wrong one winning is 45 notices addressed to "Dear Sir".
 */
ok('...and does not also claim the old heading',
  !(by('initials')?.was ?? []).map(headingKey).includes(headingKey('Debtor Initials')))

ok('the ID number is its own column', by('id_number') !== undefined)
ok('...carrying the old "Debtor ID" heading, which is where the telephone numbers were',
  index.get(headingKey('Debtor ID'))?.key === 'id_number')
ok('...and its note says what it is not', /NOT a telephone number/i.test(by('id_number')?.note ?? ''))

/*
 * DIGITS THAT ARE NOT A QUANTITY ARE TEXT. This is the whole fix for the 40 undiallable numbers:
 * the generated sheet formats a `text` column as Excel's "@", which is never converted.
 */
for (const key of ['id_number', 'cell_1', 'cell_2', 'cell_3', 'home_phone', 'work_phone',
  'client_reference', 'account_number', 'street_code', 'postal_code', 'registration_number',
  'next_of_kin_phone']) {
  check(`${key} is held as text, so Excel cannot eat its leading zero`, by(key)?.kind, 'text')
}
/* And the ones that ARE quantities are not text, or the arithmetic stops working. */
check('capital is money', by('capital')?.kind, 'money')
check('the default date is a date', by('default_date')?.kind, 'date')

/* One capital column, not two. "Amount" and "Capital on Default" were identical in all 45 rows. */
check('the two old capital headings both land on one column',
  [index.get(headingKey('Amount'))?.key, index.get(headingKey('Capital on Default'))?.key],
  ['capital', 'capital'])

/*
 * THE CLIENT'S WORD AND RAPTOR'S WORD ARE DIFFERENT, ON PURPOSE.
 *
 * THE FIRM: "change that to handover amount ... we should still keep that capital on default,
 * possibly in Raptor, but the import should say handover amount, makes it easier."
 *
 * Raptor calls it capital on default because that is what in duplum is measured against; rename
 * the KEY and the ceiling stops being about the right number. The label is what a client reads.
 * So the two are asserted apart: a future tidy-up that makes them agree breaks one or the other,
 * and this says which.
 */
check('a client is asked for a handover amount', by('capital')?.label, 'Handover amount')
check('...while Raptor still calls it capital', by('capital')?.key, 'capital')
ok('...and the note keeps the precision the friendlier label gives up',
  /before interest and costs/i.test(by('capital')?.note ?? ''))

/*
 * EVERY LABEL THIS FILE HAS EVER USED STAYS READABLE, not only the client's old sheet. A sheet
 * went out headed "Capital outstanding" before the firm renamed it, and one headed "Prescription
 * last interrupted on" before that column became the last payment. A client who fills in the copy
 * they were sent is not wrong, and the importer has to read it.
 */
for (const [heading, key] of [
  ['Capital outstanding', 'capital'],
  ['Prescription last interrupted on', 'last_payment_date'],
]) {
  check(`a sheet headed "${heading}" still reads`, index.get(headingKey(heading))?.key, key)
}
/*
 * INTEREST IS NOT ASKED FOR AT ALL, at the firm's instruction, and the old sheet is the argument
 * for it: "Interest Rate" 24 and "Percentage" 0.25 in the same row, a percent and a fraction with
 * nothing saying which was which. The rate is in the agreement the firm already holds.
 */
check('no column asks a client for interest',
  HANDOVER_COLUMNS.filter((c) => /interest/i.test(c.label) || /interest/i.test(c.key)).map((c) => c.key),
  [])

/*
 * AND THE INTERRUPTOR IS NOW THE LAST PAYMENT. The firm: "remove the things about interest and
 * the interruptor -- call it the last date of payment." Same fact, in words a client's bookkeeper
 * can answer; the old heading still maps to it, so a client who has not switched sheets yet is
 * still understood.
 */
ok('the last payment is asked for in plain words',
  by('last_payment_date')?.label === 'Last date of payment')
check('...and the old interruptor heading still lands on it',
  index.get(headingKey('Interruptor Before Handover Date'))?.key, 'last_payment_date')
ok('...with no jargon left in the label or the note',
  !/interrupt|prescri/i.test(`${by('last_payment_date')?.label} ${by('last_payment_date')?.note}`))

/* ---------- 2. nothing collides, nothing is duplicated ---------- */

const labels = HANDOVER_COLUMNS.map((c) => c.label)
check('no two columns share a label', labels.filter((l, i) => labels.indexOf(l) !== i), [])
const keys = HANDOVER_COLUMNS.map((c) => c.key)
check('no two columns share a key', keys.filter((k, i) => keys.indexOf(k) !== i), [])

/*
 * AN ALIAS THAT MEANS TWO COLUMNS IS A BUG IN THE TABLE, not something to resolve at runtime --
 * aliasIndex keeps the first and drops the second in silence, which is how a column stops
 * arriving without anything failing.
 */
const claims = new Map()
for (const c of HANDOVER_COLUMNS) {
  for (const name of [c.label, c.key, ...(c.was ?? [])]) {
    const k = headingKey(name)
    if (!claims.has(k)) claims.set(k, new Set())
    claims.get(k).add(c.key)
  }
}
check('no heading is claimed by two different columns',
  [...claims].filter(([, set]) => set.size > 1).map(([k, set]) => `${k} -> ${[...set].join(', ')}`), [])

/* ---------- 3. the old sheet, every heading of it ---------- */

/** Exactly as they appear in the file the firm sent, in order. */
const OLD_SHEET = [
  'Amount', 'Interruptor Before Handover Date', 'Date of Default', 'Capital on Default',
  'Interest Rate', 'Interest Date', 'Percentage', 'Swordfish Reference', 'Client Division',
  'Client Prefix', 'Client Reference', 'Debtor ID', 'Debtor Firstname', 'Debtor Second Name',
  'Debtor Surname', 'Debtor Initials', 'Debtor Title',
  'Home Phone 1', 'Home Phone 2', 'Home Phone 3', 'Home Phone 4',
  'Cell Phone 1', 'Cell Phone 2', 'Cell Phone 3', 'Cell Phone 4',
  'Work Phone 1', 'Work Phone 2', 'Work Phone 3', 'Work Phone 4',
  'Fax Number 1', 'Fax Number 2', 'Fax Number 3',
  'Email 1', 'Email 2', 'Email 3', 'Email 4',
  'Postal Address line 1', 'Postal Address line 2', 'Postal Address line 3',
  'Postal Address line 4', 'Postal code',
  'Street Address line 1', 'Street Address line 2', 'Street Address line 3',
  'Street Address line 4', 'Street postal code',
  'Occupation', 'Nationality', 'Passport number', 'Gender', 'Marital Status',
  'Number of Children', 'Next of Kin Number 1', 'Next of Kin Number 2', 'Next of Kin Number 3',
]
check('the old sheet is written down in full', OLD_SHEET.length, 55)

/**
 * Headings the new sheet does NOT carry, and the reason, so that "not mapped" is a decision
 * somebody made rather than a gap. A heading here is READ AND IGNORED by the importer, which is
 * different from one it does not recognise -- that one is reported.
 */
const NOT_CARRIED = new Set([
  /* The fourth of anything, and the fax. Empty in all 45 rows, and a fax number in 2026 is a
     column people fill in with a telephone number. */
  'Home Phone 2', 'Home Phone 3', 'Home Phone 4',
  'Cell Phone 4', 'Work Phone 2', 'Work Phone 3', 'Work Phone 4',
  'Fax Number 1', 'Fax Number 2', 'Fax Number 3', 'Email 4',
  /* Asked of a debtor before the firm has even spoken to them. Empty in all 45 rows. */
  'Nationality', 'Passport number', 'Gender', 'Marital Status', 'Number of Children',
  'Next of Kin Number 2', 'Next of Kin Number 3',
  /* A person's name in the client's office, not a fact about the account. */
  'Client Division',
  /* Interest, dropped at the firm's instruction -- and the old sheet asked for it twice, in two
     different units, which is the argument for not asking at all. */
  'Interest Rate', 'Interest Date', 'Percentage',
])
const unmapped = OLD_SHEET.filter((h) => !index.has(headingKey(h)) && !NOT_CARRIED.has(h))
check('every old heading either maps to a column or is deliberately not carried', unmapped, [])
/* And the other direction: nothing sits on the dropped list that the table also maps, which would
   be two answers for one heading and no way to tell which the importer used. */
check('nothing is both mapped and dropped',
  [...NOT_CARRIED].filter((h) => index.has(headingKey(h))), [])

/* The address is the one that matters most and it was empty in every row of the old sheet. */
ok('a street address column exists', by('street_1') !== undefined)
ok('...and says why it is wanted', /section 129/i.test(by('street_1')?.note ?? ''))

/* ---------- 4. every column can be explained to a client ---------- */

check('every required column has a note saying what goes in it',
  HANDOVER_COLUMNS.filter((c) => c.required && !c.note.trim()).map((c) => c.key), [])
check('every choice column offers choices',
  HANDOVER_COLUMNS.filter((c) => c.kind === 'choice' && !(c.choices ?? []).length).map((c) => c.key), [])

/* ---------------------------------------------------------------- report */

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
${HANDOVER_COLUMNS.length} columns against the old sheet's 55, and all 55 of those accounted for --
mapped or deliberately dropped, with nothing in both lists and no heading claimed by two columns.
The three failures measured on the client's own 45 rows are each closed by a column: one required
name, an ID that says it is not a telephone number, and every column of digits-that-are-not-a-
quantity held as text so Excel cannot eat another leading zero.`)
