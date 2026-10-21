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
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
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
  /* Kin 2 is now carried -- the firm asked for a second next-of-kin number. The third is still
     dropped: nobody has ever filled in three. */
  'Next of Kin Number 3',
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

/*
 * THE ADDRESS IS NOT FOR POSTING, AND NOTHING ON THIS SHEET MAY SAY IT IS.
 *
 * THE FIRM: "we will never be posting something. Never ever we will post a letter. We will send
 * everything via email." The note here used to say a section 129 is posted to an address, which
 * was the app telling a client something untrue about how the firm works -- on the document the
 * client fills in, which is the worst place to be wrong about it.
 *
 * The column stays: a summons is served at a physical address and a trace starts from one.
 */
ok('a street address column exists', by('street_1') !== undefined)
ok('...and says what it is actually for', /summons|trace/i.test(by('street_1')?.note ?? ''))
const noteText = HANDOVER_COLUMNS.map((c) => c.note).join(' ')
ok('...and no column tells a client we post anything', !/\bpost(ed|ing)?\b/i.test(noteText))
/* The email is what a notice goes out on, so a client has to be asked for it plainly. */
ok('an email column exists', by('email_1') !== undefined)

/* ---------- 4. every column can be explained to a client ---------- */

check('every required column has a note saying what goes in it',
  HANDOVER_COLUMNS.filter((c) => c.required && !c.note.trim()).map((c) => c.key), [])
check('every choice column offers choices',
  HANDOVER_COLUMNS.filter((c) => c.kind === 'choice' && !(c.choices ?? []).length).map((c) => c.key), [])

/* ---------- 5. the file the generator actually writes ---------- */

/*
 * THE COLUMN TABLE BEING RIGHT IS NOT THE SAME AS THE FILE BEING RIGHT, and everything above this
 * line only reads the table. A converted sheet goes to a client and comes back; if a cell number
 * were written as a NUMBER rather than as text the leading zero would be gone again, which is the
 * exact failure the whole sheet was rewritten over, and the table would still pass.
 *
 * So the generator is run, and the .xlsx it writes is unzipped and read.
 */
const dir = mkdtempSync(join(tmpdir(), 'handover-'))
try {
  const rowsPath = join(dir, 'rows.json')
  const out = join(dir, 'filled.xlsx')
  writeFileSync(rowsPath, JSON.stringify({
    rows: [{
      client_reference: 'GPS3/10103', capital: 48250.75, default_date: '2026-09-17',
      debtor_kind: 'Person', name: 'Van Der Westhuizen', first_name: 'Johannes',
      /* The leading zero is the point. */
      cell_1: '0821234567',
    }, {
      /* A client who writes words where a figure goes. */
      client_reference: 'GPS3/10104', capital: 'to be advised', default_date: '2026-09-17',
      debtor_kind: 'Person', name: 'Buitendag',
    }],
    notes: [['A heading', 'Something we changed.']],
  }))
  execFileSync(process.execPath, ['scripts/handover-template.mjs', out, '--rows', rowsPath],
    { cwd: new URL('../..', import.meta.url).pathname, stdio: 'pipe' })

  /* Enough of a zip reader to find one entry: the local header is 30 bytes plus the name plus an
     extra field, and the body is raw deflate. */
  const buf = readFileSync(out)
  const entry = (name) => {
    for (let i = 0; i < buf.length - 4; i += 1) {
      if (buf.readUInt32LE(i) !== 0x04034b50) continue
      const nameLen = buf.readUInt16LE(i + 26)
      const extraLen = buf.readUInt16LE(i + 28)
      const at = i + 30
      if (buf.toString('utf8', at, at + nameLen) !== name) continue
      const from = at + nameLen + extraLen
      return inflateRawSync(buf.subarray(from, from + buf.readUInt32LE(i + 18))).toString('utf8')
    }
    return null
  }

  const sheet = entry('xl/worksheets/sheet1.xml')
  ok('the generator writes a first sheet', typeof sheet === 'string' && sheet.length > 0)
  const body = (sheet ?? '').split('<row r="2">')[1]?.split('</row>')[0] ?? ''
  ok('...with the account on row 2', body.includes('Van Der Westhuizen'))
  /* PRESENCE BEFORE SHAPE: asserting only that the number is not in a <v> passes on a file that
     does not contain the number at all. */
  ok('the cell number is in the file', body.includes('0821234567'))
  ok('...as text, not as a quantity', !/<v>0?821234567<\/v>/.test(body))
  ok('...keeping its leading zero', /<t[^>]*>0821234567<\/t>/.test(body))
  /* 46282 is 17 September 2026 counted from Excel's 1899-12-30 epoch -- the same serial
     check-handover-import.mjs reads back as that day. A wrong epoch is two days out and looks
     entirely plausible on screen. */
  ok('a date is written as the serial the importer reads', body.includes('<v>46282</v>'))
  ok('money is written as a number', body.includes('<v>48250.75</v>'))
  /*
   * AND WORDS IN THE AMOUNT COLUMN STAY WORDS. Stripping to digits made "to be advised" the empty
   * string, Number('') is 0, and 0 is finite -- so the sheet was written carrying an amount of
   * nought that nobody typed, and the importer refused it as "nought or less" instead of as "not
   * a number". A client's own words have to reach them back.
   */
  const words = (sheet ?? '').split('<row r="3">')[1]?.split('</row>')[0] ?? ''
  ok('an amount that is words is kept as words', words.includes('to be advised'))
  ok('...and is not written as nought', !/<v>0<\/v>/.test(words))

  const notes = entry('xl/worksheets/sheet3.xml')
  ok('a conversion carries its own account of itself', (notes ?? '').includes('Something we changed.'))

  /* And the blank sheet has no such tab -- a "What we changed" heading on a file nobody converted
     sends somebody looking for a change that was never made. */
  const plain = join(dir, 'blank.xlsx')
  execFileSync(process.execPath, ['scripts/handover-template.mjs', plain],
    { cwd: new URL('../..', import.meta.url).pathname, stdio: 'pipe' })
  const blank = readFileSync(plain).toString('latin1')
  ok('a blank sheet has no "what we changed" tab', !blank.includes('sheet3.xml'))
} finally {
  rmSync(dir, { recursive: true, force: true })
}

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
