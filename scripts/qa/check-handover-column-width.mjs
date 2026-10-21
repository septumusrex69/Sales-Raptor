/**
 * The forty columns are as wide as what is in them.
 *
 * THE FIRM: "if there's written things like that, that goes into like a hidden state, just make
 * the thing longer so that the column is longer so I can actually see that stuff." An email
 * column reading "kagiso.molefe@" with the rest of the address off the end of it.
 *
 * THE BUG WAS NOT THE WIDTH, IT WAS WHO WAS MEASURING. `table-layout: auto` sizes a column to its
 * widest cell and would have got this right on its own -- but every cell holds an `<input>`, and
 * an input's intrinsic width is its `size` attribute, not its value. One fixed minimum on all
 * forty gave forty identical columns: too narrow for an address, too wide for a title.
 *
 * WHAT IS WORTH CHECKING IS THE CEILING AND THE FLOOR, not the arithmetic in between. A missing
 * ceiling is the failure that hurts -- one debtor with a long address, and the other
 * thirty-nine columns go off the end of the screen for every row in the file.
 */
import { readFileSync } from 'node:fs'
import {
  MAX_CH, MIN_CH, columnWidthCh, foldableColumns,
} from '../../src/lib/handoverColumnWidth.ts'

let pass = 0
const failures = []
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass += 1; return }
  failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (label, actual) => check(label, actual, true)

/* The real case, with the real value out of the firm's own test sheet. */
const email = 'kagiso.molefe@example.co.za'
const emailCol = columnWidthCh('Email address', [email, 'devi.pillay@example.co.za'])
ok('an email column is wide enough for the address in it', emailCol >= email.length)
ok('...which is wider than its heading', emailCol > 'Email address'.length)

/* A column of nothing is still a box somebody types an address into. */
check('an empty column keeps a usable width',
  columnWidthCh('Title', [null, undefined, '', '   ']), MIN_CH)
check('...and so does one holding only short values',
  columnWidthCh('Title', ['Mr', 'Mrs']), MIN_CH)

/* THE CEILING IS THE ONE THAT MATTERS. Without it, one long value costs every other column. */
const runaway = columnWidthCh('Street address 1', ['x'.repeat(400)])
check('one enormous value cannot push the other columns off the screen', runaway, MAX_CH)
ok('...and the ceiling is a width somebody can still read in', MAX_CH >= 24)
ok('...and leaves room for forty of them', MAX_CH <= 40)

/* The heading is a floor of its own: a column narrower than its own name is unreadable. */
ok('a column is never narrower than its heading',
  columnWidthCh('Second email address', ['a@b.c']) >= 'Second email address'.length)

/*
 * Trailing whitespace out of a spreadsheet is not something anybody needs to see.
 *
 * ON A VALUE LONG ENOUGH TO CLEAR THE FLOOR, which is the whole assertion. Written first on
 * 'Mr   ' against 'Mr' it passed with the trim deleted: both are under MIN_CH, both clamp up to
 * it, and the check proved the floor works rather than that the trim does.
 */
check('a trailing space does not widen a column',
  columnWidthCh('Email address', ['zanele.sithole@example.co.za    ']),
  columnWidthCh('Email address', ['zanele.sithole@example.co.za']))
ok('...and that value really is past the floor, or the line above proves nothing',
  'zanele.sithole@example.co.za'.length > MIN_CH)

/* Monotone: a longer value never produces a narrower column. Cheap, and it catches a clamp
   written the wrong way round -- which reads perfectly and inverts the whole thing. */
let monotone = true
let previous = 0
for (const n of [0, 5, 12, 20, 30, 50, 200]) {
  const w = columnWidthCh('x', ['y'.repeat(n)])
  if (w < previous) monotone = false
  previous = w
}
ok('a longer value never makes a narrower column', monotone)
ok('...and Math.min/Math.max are not the wrong way round', MIN_CH < MAX_CH)

/* ---------- it is actually wired to the table ---------- */

const card = readFileSync('src/components/settings/HandoverImportCard.tsx', 'utf8')
ok('the table sizes its columns with it', /columnWidthCh\(/.test(card))
ok('...and applies the result to the cell', /minWidth: `\$\{widths\[k\]\}ch`/.test(card))
/*
 * The old fixed minimum has to be GONE, not merely joined. Left in place it wins whenever it is
 * the larger of the two, which is every column that was already too narrow -- so the fix would
 * have shipped looking exactly like the bug.
 */
ok('...and the one-size-fits-all minimum is gone', !/min-w-\[7rem\]/.test(card))
/*
 * Measured on what the cell SHOWS. A date is stored as the sheet's reader produced it and drawn
 * as dd/mm/yyyy; sized on the stored form, the column is fitted to a string nobody is looking at.
 */
ok('a date column is measured on the date as drawn',
  /DATE_KEYS\.has\(k\) \? displayDate\(r\.values\[k\], order\)/.test(card))

/* ---------------------------------------------------------------- what the sheet does not use */

/*
 * AND THE OTHER HALF OF THE SAME PROBLEM. The minimum width is right for a column with something
 * in it and wrong for one with nothing, and on a real handover most of them have nothing: the
 * firm's own sheet left 37 of 43 columns empty, and those 37 cost 5 103 of the table's 6 239
 * pixels. On an iPad the window onto that table is about 500 pixels wide.
 *
 * EVERY CASE IS ASKED SEPARATELY, because the two exceptions are the whole of the rule and both
 * are invisible on a sheet that happens to fill those columns. Driven through the browser alone,
 * removing either guard changed nothing and the run stayed green -- which is the vacuous pass
 * CLAUDE.md warns about, twice over.
 */
const REQUIRED = new Set(['name', 'capital'])
const row = (values, problemKeys = []) => ({ values, problemKeys })

check('a column nothing fills is folded away',
  foldableColumns(['occupation'], [row({ occupation: null }), row({ occupation: '' })], REQUIRED),
  ['occupation'])
check('...and one with something in any row is not',
  foldableColumns(['occupation'],
    [row({ occupation: null }), row({ occupation: 'Boilermaker' })], REQUIRED),
  [])
/* A column of spaces out of a spreadsheet is nothing to look at. */
check('...and a column of nothing but spaces counts as empty',
  foldableColumns(['occupation'], [row({ occupation: '   ' })], REQUIRED), ['occupation'])

/*
 * THE FIRST EXCEPTION. An empty REQUIRED column is the reason the row is refused -- it is the box
 * somebody came to the screen to type in, and it is empty precisely because it needs filling.
 */
check('a required column is kept even with nothing in it',
  foldableColumns(['name', 'occupation'], [row({ name: '', occupation: '' })], REQUIRED),
  ['occupation'])

/*
 * THE SECOND. A column carrying a PROBLEM is what the reason under the table points at. Folded,
 * the sentence names a box that is not on the screen -- "No email address" over a table with no
 * email column on it.
 */
check('a column something is warned about is kept even with nothing in it',
  foldableColumns(['email_1', 'occupation'],
    [row({ email_1: '', occupation: '' }, ['email_1'])], REQUIRED),
  ['occupation'])
/* One row's problem speaks for the column, not just for that row. */
check('...on the strength of one row out of many',
  foldableColumns(['email_1'],
    [row({ email_1: '' }), row({ email_1: '' }, ['email_1']), row({ email_1: '' })], REQUIRED),
  [])
/*
 * A problem with no column on it -- "nobody can be contacted" is about the row, not about a box --
 * must not fold everything or nothing. It simply has no column to speak for.
 */
check('a problem that names no column keeps nothing back',
  foldableColumns(['occupation'], [row({ occupation: '' }, [null])], REQUIRED), ['occupation'])

/* And the shape the table actually uses it in: many columns, a handful in play. */
check('a whole sheet folds to the columns in play',
  foldableColumns(
    ['name', 'capital', 'email_1', 'occupation', 'employer', 'notes'],
    [row({ name: 'Dube', capital: '100', email_1: '', occupation: '', employer: '', notes: '' },
      ['email_1'])],
    REQUIRED,
  ),
  ['occupation', 'employer', 'notes'])

/* Wired to the table, not merely available to it. */
ok('the table folds through that one function', /foldableColumns\(SHOWN,/.test(card))
/* Matched on the contiguous half of the sentence: the count and the singular/plural are
   expressions, so the whole line is never a literal anywhere in the source. */
ok('...and says so on the screen', /empty on this sheet/.test(card))
ok('...with a way back', /setShowEmpty\(!showEmpty\)/.test(card)
  && /'Fold them away' : 'Show them'/.test(card))
/* Folded by default, or the fix does nothing for the person who has not found the link. */
ok('...and folded to begin with', /useState\(false\)[^\n]*\n?/.test(card)
  && /const \[showEmpty, setShowEmpty\] = useState\(false\)/.test(card))

if (failures.length > 0) {
  console.log(`${pass} passed, ${failures.length} failed\n`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Each column is now as wide as the longest thing in it, never narrower than its own heading and
never wide enough to push the other thirty-nine off the screen. The browser would have done this
itself for plain text; it cannot for an <input>, whose intrinsic width is its size attribute.`)
