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
import { MAX_CH, MIN_CH, columnWidthCh } from '../../src/lib/handoverColumnWidth.ts'

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
