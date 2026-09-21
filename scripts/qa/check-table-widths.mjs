/**
 * HOW WIDE EACH COLUMN IS, when the letter does not say.
 *
 * THE FAULT THIS GUARDS, in the firm's words: "we pasted, [it] generated, but the generation
 * didn't work like the pasting."
 *
 * A bulleted list pasted out of Word arrives as a table whose first cell holds the bullet and
 * whose second holds the sentence. The EDITOR draws that the way a browser draws any table with
 * no widths on it -- the bullet column shrinks to fit a bullet -- so on screen it reads as a
 * list. The PDF split the columns EVENLY, so the same document printed with a bullet alone in
 * the left half of the page and the sentence squeezed into the right.
 *
 * Both were drawing the same letter. Only one of them was sizing the columns. That is the whole
 * bug, and it is invisible in the editor by construction: the screen is the half that was right.
 *
 * MEASURED WITH A MEASURE OF OUR OWN. autoColumnWidths takes the measurer as an argument, so
 * these run with no PDF library and no browser -- one millimetre per character, which makes every
 * expected number below something a person can check by counting.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-table-widths.mjs
 */
import { autoColumnWidths } from '../../src/lib/tableWidths.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/** One millimetre per character, so every width below can be counted off the text. */
const measure = (text) => text.length
/** Cells from plain strings, at one size, unbolded. */
const row = (...texts) => texts.map((text) => ({ text, sizePt: 10, bold: false, italic: false }))
const widths = (rows, totalMm = 100, padMm = 0) =>
  autoColumnWidths({ rows, totalMm, padMm, measure }).map((w) => Math.round(w * 10) / 10)
const sum = (ws) => Math.round(ws.reduce((a, b) => a + b, 0) * 10) / 10

/* ------------------------------------------------------------------ the fault itself */

/*
 * THE BULLET COLUMN. One character against a sentence. An even split gives the bullet 50mm of a
 * 100mm table, which is what printed.
 */
{
  const ws = widths([
    row('•', 'Pay in full. Payment of R 48 215.60 settles the account.'),
    row('•', 'Propose an arrangement. Tell us in writing what you can afford.'),
  ])
  ok(`the bullet column is narrow, not half the page (${ws.join(' / ')})`, ws[0] < 10)
  ok('...and the sentence gets what is left', ws[1] > 90)
  check('...and the two fill the table exactly', sum(ws), 100)
}

/*
 * AND THE TABLE THAT REALLY IS A TABLE is not squashed by the same rule. "Credit bureau listing"
 * against a long sentence: the label column has to be wide enough to read, and wrapping "Credit
 * bureau listing" onto three lines is what the firm's screenshot showed.
 */
{
  const ws = widths([
    row('Credit bureau listing', 'Your default is reported to the registered credit bureaux and appears on your credit profile.'),
    row('Summons', 'Issued and served on you at your home or your place of work.'),
  ])
  ok(`the label column fits its longest word (${ws.join(' / ')})`, ws[0] >= 'listing'.length)
  ok('...without taking half the page', ws[0] < 40)
  check('...and the two fill the table exactly', sum(ws), 100)
}

/* ------------------------------------------------------------------ the rules it follows */

/*
 * NEVER NARROWER THAN THE WIDEST WORD. Below that the word has nowhere to go: the wrapper either
 * overflows the cell -- printing across the next column -- or drops it.
 */
{
  /*
   * IN A TABLE TOO NARROW FOR BOTH, which is the only case that reaches the floor. The first cut
   * of this used a 100mm table where everything fitted on one line, so the widths came from the
   * other branch entirely and deleting the floor changed nothing. 40mm forces the choice.
   */
  const ws = widths([row('antidisestablishmentarianism', 'a b c d e f g h i j k')], 40)
  ok(`a long word sets its column's floor (${ws.join(' / ')})`, ws[0] >= 28)
  check('...and the table still fills exactly', sum(ws), 40)
}

/* Everything fits on one line: each column takes what it wanted and the slack is shared out, so
   a two-column table still looks like one rather than two words at the left margin. */
{
  const ws = widths([row('ab', 'cd')])
  check('a table of short cells still fills the width', sum(ws), 100)
  ok('...sharing the slack in proportion', Math.abs(ws[0] - ws[1]) < 0.001)
}
{
  const ws = widths([row('a', 'bbbbbbbbb')])
  ok(`a short cell and a long one share it in proportion (${ws.join(' / ')})`, ws[0] < ws[1] / 5)
  check('...and still fill the width', sum(ws), 100)
}

/*
 * THREE COLUMNS, because two is the case that works by accident. The date line of a section 129
 * is DATE / OUR REF / ACCOUNT with a label and a value in each.
 */
{
  const ws = widths([row('DATE', '21 September 2026', 'OUR REF')], 120)
  check('three columns fill the table too', sum(ws), 120)
  ok('...with the longest getting the most', ws[1] > ws[0] && ws[1] > ws[2])
}

/*
 * PADDING IS PART OF THE COLUMN. A bordered table pads every cell, and a column sized without it
 * is a column whose text is drawn past its own rule.
 */
{
  const bare = widths([row('•', 'a sentence of some length here')], 100, 0)
  const padded = widths([row('•', 'a sentence of some length here')], 100, 3)
  ok(`padding widens the narrow column (${bare[0]} -> ${padded[0]})`, padded[0] > bare[0])
  check('...and the table still fills exactly', sum(padded), 100)
}

/* ------------------------------------------------------------------ what must not happen */

/*
 * NOTHING EVER RUNS PAST THE MARGIN. Whatever is in the cells, the widths add up to the table --
 * a set that overflows prints off the letterhead, and one that falls short leaves every rule the
 * renderer draws under a row ending in mid-air.
 */
for (const [what, rows, total] of [
  ['an ordinary table', [row('a', 'b')], 100],
  ['one long unbreakable word per column', [row('x'.repeat(200), 'y'.repeat(200))], 100],
  /* Short row FIRST, so a count taken off rows[0] would say one column. */
  ['a ragged table', [row('d'), row('a', 'b', 'c')], 90],
  ['empty cells', [row('', '')], 100],
  ['a single column', [row('only')], 100],
]) {
  check(`${what} fills the width exactly`, sum(widths(rows, total)), total)
  ok(`...with no negative column`, widths(rows, total).every((w) => w >= 0))
}

/*
 * A RAGGED TABLE gets as many columns as its widest row. A short row contributes nothing to the
 * columns it does not reach, rather than making them zero.
 */
check('a ragged table is as wide as its widest row',
  widths([row('d'), row('a', 'b', 'c')], 90).length, 3)

/* Degenerate inputs do nothing rather than something strange. */
check('a table with no rows has no columns', widths([], 100), [])
check('a table with no width has no width', widths([row('a', 'b')], 0), [0, 0])

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Columns sized to what is in them, the way a browser sizes them. A bullet pasted out of Word lands
in a column a bullet wide instead of half the page -- which is the difference the firm saw between
what the editor showed and what the PDF printed. Whatever the cells hold, the widths add up to the
table exactly, so nothing runs past the letterhead's margin.`)
