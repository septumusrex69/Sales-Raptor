/**
 * WHERE EVERY LINE OF THE LETTER LANDS ON PAPER.
 *
 * WHY THIS IS CHECKED WITHOUT A PDF LIBRARY IN THE ROOM. The firm needs the section 129 to go out
 * as a PDF attached to an email, and a PDF has no layout engine in it — something has to decide
 * the line breaks, the page breaks and the height of a table row. planLetter is that something,
 * and it takes its font metrics as an argument precisely so this file can hand it a ruler it
 * controls and assert where the breaks land.
 *
 * The faults it guards are all of one kind: RIGHT ON THE PAGE SOMEBODY LOOKED AT, WRONG ON PAGE
 * THREE. A line that overruns the right margin runs off the letterhead. A table row split across
 * a page break reads as two different statements. A page break as the first block opens the
 * notice with a blank sheet. None of those is visible in the preview of page one.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-letter-pdf.mjs
 */
import { readFileSync } from 'node:fs'
import {
  HEADING_SCALE, footTextFor, mmToPt, planLetter, ptToMm,
} from '../../src/lib/letterLayout.ts'
import { hexToRgb, letterFilename, standardFamilyFor, toBase64 } from '../../src/lib/letterPdf.ts'
import { A4_LETTERHEAD, blankLetter, letterCss, parseLetter } from '../../src/lib/letterDocument.ts'
import { sampleValues } from '../../src/lib/messageTemplates.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const near = (a, b, tol = 0.05) => Math.abs(a - b) < tol

/**
 * A RULER THIS FILE CONTROLS.
 *
 * Every character is the same width, so the wrap points are arithmetic rather than a guess about
 * what Times does with a lowercase f. The real one asks the embedded font, which is the whole
 * reason `measure` is a parameter — a layout that could only be checked against a real font could
 * only be checked in a browser, and would be checked once.
 */
const MM_PER_PT = 0.2
const measure = (text, sizePt) => text.length * sizePt * MM_PER_PT

const values = sampleValues()
const plan = (doc, page = A4_LETTERHEAD) =>
  planLetter(doc, page, { measure, filled: true, values })
const p = (text, o = {}) => ({ kind: 'paragraph', spans: [{ text }], ...o })
const cell = (t) => ({ spans: [{ text: t }] })
const texts = (pl) => pl.pages.flatMap((pg) => pg.ops.filter((o) => o.op === 'text'))

/**
 * The x of a run, or NaN if there is no such run.
 *
 * READ DEFENSIVELY. CLAUDE.md names this trap and this file walked into it twice: indexing the
 * result of a `find` that matched nothing throws a TypeError several lines below the check that
 * should have reported it, so a real failure is reported as a crash in the test. Found by
 * dropping the full stop from the section numbering and watching the file die instead of fail.
 * NaN compares false against everything, which is exactly what a missing run should do.
 */
const xOf = (ops, text) => ops.find((o) => o.text === text)?.xMm ?? NaN
const firstX = (ops) => ops[0]?.xMm ?? NaN

/* ---------- millimetres, not points ---------- */

check('a point is 1/72 of an inch', near(ptToMm(72), 25.4), true)
check('...and back again', near(mmToPt(25.4), 72), true)

/* ---------- nothing leaves the text frame ---------- */

/*
 * THE MARGIN IS THE LETTERHEAD'S FRAME. A line that overruns the right margin is text running
 * off the artwork; one that starts left of the left margin is text under the rule down the side.
 * Checked over a paragraph long enough to wrap many times, not over one line.
 */
/* Long enough to overrun a page with the ruler above: 235mm of text frame at 5.4mm a line is
   about 43 lines, and 2 000 words is roughly three times that. Sized deliberately rather than
   guessed -- a "long" paragraph that happens to fit makes every pagination check below vacuous. */
const long = { ...blankLetter(), blocks: [p('word '.repeat(2000).trim())] }
{
  const ops = texts(plan(long))
  ok(`a long paragraph wraps (${ops.length} runs)`, ops.length > 50)
  const left = Math.min(...ops.map((o) => o.xMm))
  const right = Math.max(...ops.map((o) => o.xMm + measure(o.text, o.sizePt)))
  check('nothing starts left of the left margin', near(left, A4_LETTERHEAD.marginLeftMm), true)
  ok(`nothing runs past the right margin (${right.toFixed(1)}mm of ${A4_LETTERHEAD.widthMm - A4_LETTERHEAD.marginRightMm})`,
    right <= A4_LETTERHEAD.widthMm - A4_LETTERHEAD.marginRightMm + 0.01)
  /* And nothing below the bottom margin, which is what the page break is FOR. */
  const lowest = Math.max(...ops.map((o) => o.yMm))
  ok(`nothing sits below the bottom margin (${lowest.toFixed(1)}mm)`,
    lowest <= A4_LETTERHEAD.heightMm - A4_LETTERHEAD.marginBottomMm + 1)
}

/*
 * TRAILING SPACE DOES NOT COUNT TOWARDS A LINE'S WIDTH.
 *
 * ASSERTED THROUGH CENTRING, because asserting it directly is vacuous and was: the drawing loop
 * never emits a whitespace piece as a text op at all, so "no run ends with a space" can only ever
 * pass, on any implementation. Removing the code that strips trailing space left it green.
 *
 * Centring is where the fault actually shows. A line whose width still includes the space that
 * followed its last word centres half a space to the left, on every line, down the page.
 */
{
  const centred = (text) => firstX(texts(plan({
    ...blankLetter(), blocks: [{ kind: 'paragraph', spans: [{ text }], align: 'center' }],
  })))
  check('a trailing space does not push a centred line off centre',
    near(centred('word word'), centred('word word   ')), true)
  /* And the leading space that followed the word which ended the previous line is swallowed, or
     every wrapped line is indented by one space down the whole left edge. */
  const wrapped = texts(plan({
    ...blankLetter(), blocks: [p('word '.repeat(60).trim())],
  }))
  /* The FIRST run on each line, found by grouping on the baseline -- every word is its own op,
     so the x of all of them says nothing about where the lines start. */
  const firstOnLine = new Map()
  for (const o of wrapped) {
    const key = Math.round(o.yMm * 10)
    if (!firstOnLine.has(key) || o.xMm < firstOnLine.get(key)) firstOnLine.set(key, o.xMm)
  }
  const lefts = [...new Set([...firstOnLine.values()].map((x) => Math.round(x * 10) / 10))]
  ok(`the paragraph wrapped (${firstOnLine.size} lines)`, firstOnLine.size > 3)
  check('every wrapped line starts at the same left edge', lefts, [A4_LETTERHEAD.marginLeftMm])
  /*
   * AND A SPACE AFTER A HARD BREAK IS SWALLOWED, which is the only way the guard for it is
   * reached at all: an ordinary wrap consumes that space into the line it ends and strips it
   * there. An address typed with the second line indented would otherwise print indented.
   */
  const afterBreak = texts(plan({ ...blankLetter(), blocks: [p('14 Protea Street\n   Wonderboom')] }))
  check('a space after a hard break does not indent the next line',
    [...new Set(afterBreak.map((o) => Math.round(o.xMm * 10) / 10))].includes(A4_LETTERHEAD.marginLeftMm)
      && xOf(afterBreak, 'Wonderboom') === A4_LETTERHEAD.marginLeftMm,
    true)
}

/* ---------- pages ---------- */

ok('a short letter is one page', plan({ ...blankLetter(), blocks: [p('Short.')] }).pages.length === 1)
ok(`a long one is more (${plan(long).pages.length})`, plan(long).pages.length > 1)

/*
 * A HARD PAGE BREAK STARTS A PAGE, and does NOT open the letter with a blank one. A page break as
 * the first block is the trailing-blank-page bug in reverse and it is just as easy to ship.
 */
check('a page break starts a new page',
  plan({ ...blankLetter(), blocks: [p('one'), { kind: 'pagebreak' }, p('two')] }).pages.length, 2)
check('...and one at the very start does not leave a blank sheet',
  plan({ ...blankLetter(), blocks: [{ kind: 'pagebreak' }, p('one')] }).pages.length, 1)

/*
 * A TABLE ROW IS KEPT WHOLE. Half the legal-process table at the foot of a page, with its other
 * half at the top of the next, is a table that reads as two different statements about what
 * happens to the debtor.
 */
{
  const rows = Array.from({ length: 40 }, (_, i) => [cell(`Row ${i}`), cell('word '.repeat(30))])
  const pl = plan({ ...blankLetter(), blocks: [{ kind: 'table', rows, borders: 'all' }] })
  ok(`the table runs over pages (${pl.pages.length})`, pl.pages.length > 1)
  /*
   * NOTHING IS DRAWN OFF THE SHEET, which is what a split row actually produces.
   *
   * Two weaker versions of this check were written first and both were vacuous. "Each page holds
   * an even number of horizontal rules" passes because the rules are pushed after the cells are
   * drawn, so on a split they both land on the page the row ENDS on. "The rules run down the
   * page" passes because each broken page ends up with only two of them, in order.
   *
   * What removing the row's page-break guard really does is unmistakable once looked at: the
   * cursor keeps counting from the old row's top, so a forty-row table becomes SIXTY-SIX pages
   * and rules are drawn at y = 1 223mm on a 297mm sheet. The invariant worth asserting is the
   * obvious one nobody wrote down.
   */
  const off = pl.pages.flatMap((page, i) => page.ops
    .filter((o) => (o.op === 'text' ? o.yMm : Math.max(o.y1Mm, o.y2Mm)) > A4_LETTERHEAD.heightMm)
    .map((o) => `page ${i + 1} at ${(o.op === 'text' ? o.yMm : o.y1Mm).toFixed(0)}mm`))
  check(`nothing is drawn past the foot of the sheet (${off.slice(0, 2).join('; ') || 'nothing is'})`,
    off.length, 0)
  /* And the table takes about the room it needs. Sixty-six pages for forty rows is what a broken
     row guard produces, and a page count nobody bounds is a page count that can run away. */
  ok(`forty rows take a sensible number of pages (${pl.pages.length})`, pl.pages.length < 12)
}

/* ---------- the running header ---------- */

const withHeader = {
  ...blankLetter(),
  runningFoot: 'Ref {{reference}} · Page {{page}} of {{pages}}',
  blocks: [p('word '.repeat(2000).trim())],
}
{
  const pl = plan(withHeader)
  check('the running line counts this page and the total',
    footTextFor(pl, { page: 2, pages: pl.pages.length, filled: true, values }),
    `Ref ${values.reference} · Page 2 of ${pl.pages.length}`)
  /*
   * AT THE FOOT, at the firm's instruction, and BELOW the text frame -- inside it, it would push
   * the last line of every page up by its own height. It also has to stay clear of the
   * letterhead's own footer block, which on the firm's sheet starts at 279.8mm.
   */
  ok(`...below the text frame (${pl.runningFoot.yMm.toFixed(1)}mm)`,
    pl.runningFoot.yMm > A4_LETTERHEAD.heightMm - A4_LETTERHEAD.marginBottomMm)
  ok('...and clear of the letterhead\u2019s own footer', pl.runningFoot.yMm < 279.8)
  check('a letter with no running line has none',
    plan({ ...blankLetter(), blocks: [p('x')] }).runningFoot, null)
}

/* ---------- headings ---------- */

/*
 * THE NUMBERS ARE COUNTED HERE TOO, and they have to agree with the HTML renderer's — the same
 * letter previewed and posted, numbered differently, is the fault this whole model exists to
 * prevent.
 */
{
  const h = (text, numbered) => ({ kind: 'heading', level: 2, spans: [{ text }], numbered })
  const pl = plan({ ...blankLetter(), blocks: [h('ONE', true), h('ASIDE', false), h('TWO', true)] })
  const ops = texts(pl)
  check('headings number themselves, with a full stop',
    ops.filter((o) => /^\d+\.$/.test(o.text)).map((o) => o.text), ['1.', '2.'])
  /* The number sits in the margin gutter, at the left margin, with its heading indented past it
     -- so a heading that wraps keeps its second line under its first rather than under the digit. */
  const oneX = xOf(ops, '1.')
  const wordX = xOf(ops, 'ONE')
  check('...in the gutter at the left margin', near(oneX, A4_LETTERHEAD.marginLeftMm), true)
  ok(`...with the heading indented past it (${wordX}mm)`, wordX > oneX + 5)
  ok('a heading is drawn bold', ops.find((o) => o.text === 'ONE')?.bold === true)
}

/*
 * THE TYPE SCALE IS DUPLICATED BETWEEN THE STYLESHEET AND THE PAGE, and this is what holds the
 * two copies together. letterCss emits CSS for a browser; letterLayout does arithmetic for paper.
 * Deriving one from the other would mean parsing CSS, which is a worse coupling than two
 * constants with this check between them.
 */
{
  const doc = blankLetter()
  const css = letterCss(doc, A4_LETTERHEAD)
  for (const level of [1, 2, 3]) {
    const want = (doc.defaults.size * HEADING_SCALE[level]).toFixed(1)
    ok(`the h${level} size matches the stylesheet (${want}pt)`,
      css.includes(`.ltr-h${level} { font-size: ${want}pt`))
  }
}

/* ---------- alignment ---------- */

{
  const line = 'word word word'
  const at = (align) => firstX(texts(plan({ ...blankLetter(), blocks: [p(line, { align })] })))
  const width = A4_LETTERHEAD.widthMm - A4_LETTERHEAD.marginLeftMm - A4_LETTERHEAD.marginRightMm
  const used = measure(line, blankLetter().defaults.size)
  check('left is at the margin', near(at('left'), A4_LETTERHEAD.marginLeftMm), true)
  check('centred is centred',
    near(at('center'), A4_LETTERHEAD.marginLeftMm + (width - used) / 2, 0.2), true)
  check('right ends at the right margin',
    near(at('right') + used, A4_LETTERHEAD.widthMm - A4_LETTERHEAD.marginRightMm, 0.2), true)
}

/* A newline inside a span is a hard break: an address is one paragraph on four lines. */
{
  const ops = texts(plan({ ...blankLetter(), blocks: [p('14 Protea Street\nWonderboom\nPretoria')] }))
  const ys = [...new Set(ops.map((o) => Math.round(o.yMm * 10)))]
  check('a newline puts the next words on their own line', ys.length, 3)
}

/* ---------- the PDF edge ---------- */

/*
 * THE FONT IS SUBSTITUTED and the substitution has to be the right way round. A PDF either embeds
 * a font or uses one of the fourteen every reader has; Georgia is not one of them, and drawing a
 * serif letter in Helvetica is a notice that does not look like the firm's.
 */
check('Georgia is drawn as Times', standardFamilyFor('Georgia, "Times New Roman", serif'), 'Times')
check('Times New Roman too', standardFamilyFor('"Times New Roman", Times, serif'), 'Times')
check('Arial is Helvetica', standardFamilyFor('Arial, Helvetica, sans-serif'), 'Helvetica')
check('Calibri is Helvetica', standardFamilyFor('Calibri, Candara, Segoe, Arial, sans-serif'), 'Helvetica')
check('a monospace stack is Courier', standardFamilyFor('"Courier New", monospace'), 'Courier')
/* An unknown face falls to Helvetica rather than to nothing: a letter drawn in no font is a
   blank page, and a letter drawn in the wrong one is still a letter. */
check('something nobody has heard of falls back', standardFamilyFor('Wingdings'), 'Helvetica')

check('hex becomes a colour', hexToRgb('#ffffff'), { r: 1, g: 1, b: 1 })
check('...short hex too', hexToRgb('#000'), { r: 0, g: 0, b: 0 })
check('...and anything else is drawn black rather than guessed',
  hexToRgb('rgb(1,2,3)'), { r: 0, g: 0, b: 0 })

/*
 * BASE64 IN CHUNKS. String.fromCharCode(...bytes) overflows the call stack somewhere around a
 * hundred thousand arguments, and a two-page notice with a letterhead embedded is comfortably
 * over that -- so the naive version works on every test document and fails on every real one.
 */
{
  const big = new Uint8Array(300_000).fill(65)
  const encoded = toBase64(big)
  ok(`a letterhead-sized document encodes (${encoded.length} chars)`, encoded.length > 390_000)
  check('...and round-trips', atob(encoded).length, big.length)
}

check('the filename carries the reference',
  letterFilename('Section 129 notice (National Credit Act)', 'GPS3/10103'),
  'Section-129-notice-National-Credit-Act-GPS310103.pdf')
check('...and survives having none', letterFilename('Final notice', null), 'Final-notice.pdf')
ok('...and a name of nothing but punctuation still names a file',
  letterFilename('///', null) === 'letter.pdf')

/* ---------- nothing is stranded at the foot of a page ---------- */

/*
 * A HEADING ALONE AT THE FOOT OF A PAGE tells the reader there is nothing under it, and they turn
 * the page having decided the letter is over. The firm found this on their own notice: "how to
 * resolve this kind of was at the bottom of the page and it just said the one thing."
 */
{
  /* A paragraph sized to leave just enough room for a heading and nothing else. */
  /*
   * SIZED SO THAT WITHOUT THE GUARD THE HEADING IS ACTUALLY STRANDED -- found by removing the
   * guard and sweeping lengths, not guessed. 1 300 words does NOT strand it, so the first version
   * of this check passed on an implementation with no widow control at all. 1 316 sits in the
   * middle of a 32-word band that does.
   */
  const filler = 'word '.repeat(1316).trim()
  const doc = {
    ...blankLetter(),
    blocks: [
      p(filler),
      { kind: 'heading', level: 2, spans: [{ text: 'STRANDED' }], numbered: true },
      p('The body that belongs under it.'),
    ],
  }
  const pl = plan(doc)
  const pageOf = (needle) => pl.pages.findIndex((pg) =>
    pg.ops.some((o) => o.op === 'text' && o.text === needle))
  ok(`the letter runs over pages (${pl.pages.length})`, pl.pages.length > 1)
  check('a heading is not left at the foot of a page without its body',
    pageOf('STRANDED') === pageOf('The'), true)
}

/*
 * AND "YOURS FAITHFULLY" IS NOT LEFT WITHOUT ITS SIGNATURE, which is the same fault one block
 * later: a letter that appears to end without being signed. A paragraph only keeps with what
 * follows it when it says so, because most paragraphs should break freely.
 */
{
  /* Sized so that WITHOUT the flag the two land on different pages -- found by sweeping lengths
     rather than guessed, because a filler that does not actually strand it makes the assertion
     below pass on any implementation. 1 300 is the middle of a 64-word-wide band that does. */
  const filler = 'word '.repeat(1300).trim()
  const sig = (keep) => plan({
    ...blankLetter(),
    blocks: [
      p(filler),
      { kind: 'paragraph', spans: [{ text: 'Yours faithfully' }], keepWithNext: keep },
      { kind: 'signature', widthMm: 70, spans: [{ text: 'J Bredell' }] },
    ],
  })
  const sigPage = (pl) => pl.pages.findIndex((pg) =>
    pg.ops.some((o) => o.op === 'line' && near(o.y1Mm, o.y2Mm, 0.01) && near(o.x2Mm - o.x1Mm, 70, 1)))
  const yoursPage = (pl) => pl.pages.findIndex((pg) =>
    pg.ops.some((o) => o.op === 'text' && o.text === 'faithfully'))
  const kept = sig(true)
  check('a paragraph that keeps with the next stays with its signature',
    yoursPage(kept) === sigPage(kept), true)
  /* And without the flag it breaks freely, or every paragraph in the letter would drag the next
     one around with it. */
  const loose = sig(false)
  check('...and one that does not, does not',
    yoursPage(loose) === sigPage(loose), false)
}

/* A signature block draws a rule to sign above, and the words under it. */
{
  const pl = plan({
    ...blankLetter(),
    blocks: [{ kind: 'signature', widthMm: 70, spans: [{ text: 'J Bredell' }] }],
  })
  const rules = pl.pages[0].ops.filter((o) => o.op === 'line')
  check('a signature block draws one rule', rules.length, 1)
  check('...70mm wide', near((rules[0]?.x2Mm ?? 0) - (rules[0]?.x1Mm ?? 0), 70), true)
  const name = pl.pages[0].ops.find((o) => o.op === 'text')
  ok('...with the name under it, not over it', (name?.yMm ?? -1) > (rules[0]?.y1Mm ?? 0))
}

/* ---------- the firm's own section 129, laid out ---------- */

/*
 * THE REAL DOCUMENT, read out of schema.sql like check-letter-document.mjs reads it. A layout
 * that is correct on a made-up paragraph and wrong on the notice that actually goes out is the
 * failure this whole file is written against.
 */
const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const seeded = /set format = 'document',\s*\n\s*body = '([\s\S]*?)',\s*\n\s*updated_at/.exec(schema)?.[1]
const s129 = seeded ? parseLetter(seeded.replace(/''/g, "'")) : null
ok('the section 129 is there to lay out', s129 !== null)

if (s129) {
  const pl = plan(s129)
  ok(`it lays out over pages (${pl.pages.length})`, pl.pages.length >= 2)
  const ops = texts(pl)
  ok(`every page carries text (${pl.pages.map((x) => x.ops.length).join(', ')} ops)`,
    pl.pages.every((page) => page.ops.some((o) => o.op === 'text')))
  const right = Math.max(...ops.map((o) => o.xMm + measure(o.text, o.sizePt)))
  ok(`nothing runs off the letterhead (${right.toFixed(1)}mm)`,
    right <= A4_LETTERHEAD.widthMm - A4_LETTERHEAD.marginRightMm + 0.01)
  /*
   * BOLD AND AT THE LEFT MARGIN. Written first as "a number at the left margin" and it picked up
   * "18" from the date, "14" from the street address and "0860" from the Credit Regulator's
   * number -- all of which legitimately start a line. The heading number is the only one drawn
   * bold in the gutter.
   */
  check('its four sections are numbered',
    ops.filter((o) => /^\d+\.$/.test(o.text) && o.bold && near(o.xMm, A4_LETTERHEAD.marginLeftMm))
      .map((o) => o.text),
    ['1.', '2.', '3.', '4.'])
  /* Every merge field resolved. A field left standing is braces posted on the firm's letterhead
     over a director's name -- which is exactly what the unfilled toggle is FOR, and exactly what
     must never survive into a sent one. */
  const unresolved = ops.filter((o) => /\{\{|\}\}/.test(o.text))
  check('nothing goes out with braces still in it', unresolved.map((o) => o.text), [])
  /* And the statutory sentence is on the page rather than lost to a layout bug. */
  ok('the ten business days are on the page',
    ops.map((o) => o.text).join(' ').includes('10 (ten) business days'))
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A letter laid out in millimetres with nothing past the margins of the letterhead it prints on;
table rows kept whole across a page break; the section numbers counted the same way the on-screen
renderer counts them; the font substitution the fourteen standard PDF faces force; and the firm's
own section 129 laid out end to end with every merge field resolved.`)
