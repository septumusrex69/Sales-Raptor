/**
 * TURNING A LETTER INTO PAGES.
 *
 * WHY THIS IS A SEPARATE, PURE MODULE. The firm needs the section 129 to go out as a PDF attached
 * to an email, and a PDF has no layout engine in it: something has to decide where every line of
 * text sits, where the page breaks, and how tall a table row is. That decision is the one thing
 * that must be identical to what the preview showed, because a statutory notice is only valid if
 * what the debtor receives is what somebody approved.
 *
 * So the deciding happens HERE, with no PDF library anywhere near it, and the drawing happens in
 * letterPdf.ts. Two consequences worth the split:
 *
 *   - It can be checked in Node with no browser and no dependency. Pagination is exactly the kind
 *     of thing that is right on the page you looked at and wrong on page three.
 *   - `measure` is handed in. The real one asks the embedded font how wide a string is; a check
 *     can hand in a fixed width per character and assert where the breaks land.
 *
 * EVERYTHING IS IN MILLIMETRES FROM THE TOP-LEFT of the page, which is how the letterhead and the
 * margins are already expressed. PDF's own coordinate system is bottom-left in points; converting
 * once, at the drawing edge, beats carrying two systems through the arithmetic.
 */
import { documentWithoutOptional } from './letterDocument.js'
import type { Block, LetterDocument, PageSetup, Span } from './letterDocument.ts'
import { autoColumnWidths } from './tableWidths.js'
import { markBox, marked, stampLine, type SignedMark } from './signedMark.js'
import { renderTemplate } from './messageTemplates.js'

/** A run of text on a line, already positioned. */
export interface TextOp {
  op: 'text'
  xMm: number
  /** The BASELINE, not the top of the line. */
  yMm: number
  text: string
  sizePt: number
  bold: boolean
  italic: boolean
  colour: string
}

/** A rule: a table border, or an underline under a run. */
export interface LineOp {
  op: 'line'
  x1Mm: number
  y1Mm: number
  x2Mm: number
  y2Mm: number
  widthMm: number
  colour: string
}

/**
 * A RECTANGLE, filled or outlined or both: the track and the fill of a drawn progress bar.
 *
 * ITS OWN OP RATHER THAN FOUR LINES. A filled bar drawn as lines is a bar drawn as hatching, and a
 * five-millimetre one would need a couple of hundred of them; pdf-lib fills a rectangle in one
 * operator either way.
 *
 * yMm IS THE TOP, like every other measurement here. PDF's own origin is the bottom of the page and
 * the drawer converts -- which is exactly why this says which end it means.
 */
export interface RectOp {
  op: 'rect'
  xMm: number
  yMm: number
  wMm: number
  hMm: number
  /** Null for an outline with nothing in it -- which is what an empty bar's track is. */
  fill: string | null
  stroke: string | null
  strokeMm: number
}

/**
 * A PICTURE DRAWN ON THE PAGE: the signer's own mark, on the rule they signed.
 *
 * ITS OWN OP RATHER THAN SOMETHING THE DRAWER WORKS OUT. Every decision in this file is made in
 * the plan and the drawer is deliberately dumb -- so where a signature sits, how big it is and
 * which rule it belongs to are all settled here, and letterPdf only embeds bytes and places them.
 *
 * `src` IS A data: URL and nothing else. The signature came out of a canvas and travels in JSON
 * next to the document it belongs to; a PDF embeds its images, so a http:// URL here would be a
 * signature that is only there while the reader is online.
 *
 * yMm IS THE TOP, like every other measurement here.
 */
export interface ImageOp {
  op: 'image'
  xMm: number
  yMm: number
  wMm: number
  hMm: number
  src: string
}

export type DrawOp = TextOp | LineOp | RectOp | ImageOp

export interface PlannedPage {
  ops: DrawOp[]
}

/** How wide this string is, in millimetres, in the face it will actually be drawn in. */
export type Measure = (text: string, sizePt: number, bold: boolean, italic: boolean) => number

const PT_PER_MM = 72 / 25.4
export const ptToMm = (pt: number) => pt / PT_PER_MM
export const mmToPt = (mm: number) => mm * PT_PER_MM

/**
 * The type scale, taken from letterCss so the PDF and the preview agree.
 *
 * DUPLICATED ON PURPOSE AND SAID SO. letterCss emits a stylesheet for a browser; this is
 * arithmetic for a page. Deriving one from the other would mean parsing CSS, which is a worse
 * coupling than two constants with a check holding them together — see check-letter-pdf.mjs,
 * which asserts these against the stylesheet's own numbers.
 */
export const HEADING_SCALE: Record<1 | 2 | 3, number> = { 1: 1.15, 2: 1.02, 3: 1 }
/** Space above and below each heading level, in mm. Matches .ltr-h1/2/3 margins. */
const HEADING_SPACE: Record<1 | 2 | 3, { before: number; after: number }> = {
  1: { before: 0, after: 4 },
  2: { before: 6, after: 2.5 },
  3: { before: 4, after: 1.5 },
}
const PARA_AFTER_MM = 3
const LIST_INDENT_MM = 6
const LIST_ITEM_GAP_MM = 1.5
const NUMBER_GUTTER_MM = 7
const CELL_PAD_MM = 2
const CELL_PAD_Y_MM = 1.4
const RULE_MM = 0.2
const RULE_COLOUR = '#d8dee6'
/*
 * THE DRAWN BAR, and the same four numbers the sheet's own CSS uses -- see the .ltr-bar rules in
 * letterDocument.ts. Written in both places rather than shared because one is a CSS string and the
 * other is millimetres of PDF, and check-page-editor holds them against each other.
 *
 * MONOCHROME, because a schedule gets photocopied: a bar that differs from its track only in hue
 * disappears the first time it does. The track keeps a hairline border so the part NOT paid still
 * reads as part of a bar rather than as white paper.
 */
const BAR_MM = 5
const BAR_GAP_MM = 1.2
const BAR_TRACK = '#eef1f5'
const BAR_EDGE = '#9ca3af'
const BAR_FILL = '#1f2937'
const BAR_NOTE_SCALE = 0.86

/* ------------------------------------------------------------------ words on a line */

interface Piece {
  text: string
  sizePt: number
  bold: boolean
  italic: boolean
  underline: boolean
  colour: string
  widthMm: number
}

/**
 * One span, broken into the smallest things that can end a line.
 *
 * SPACES TRAVEL WITH THE WORD BEFORE THEM. A word and its trailing space measured separately and
 * rejoined drift by a fraction of a millimetre per word, which over a justified paragraph is a
 * visible ragged edge. Splitting with a capturing group keeps them together.
 */
function pieces(spans: Span[], base: { sizePt: number; colour: string }, measure: Measure): Piece[] {
  const out: Piece[] = []
  for (const s of spans) {
    const sizePt = s.size ?? base.sizePt
    const colour = s.colour ?? base.colour
    /* Newlines are hard breaks inside a span -- an address is one paragraph on four lines -- and
       are kept as their own piece so the layout can act on them rather than measure them. */
    for (const chunk of s.text.split(/(\n)/)) {
      if (chunk === '') continue
      if (chunk === '\n') {
        out.push({ text: '\n', sizePt, bold: false, italic: false, underline: false, colour, widthMm: 0 })
        continue
      }
      /*
       * SPLIT ON WHITESPACE, EXCEPT THE NON-BREAKING KIND. \s includes U+00A0 in JavaScript, so
       * the obvious /(\s+)/ made "R 12 345,67" four pieces and gave the wrapper three places to
       * end a line inside one Rand amount -- which is precisely what en-ZA uses that character to
       * prevent. It travels with the word instead, and the PDF draws it as a plain space because
       * Charter has no glyph for it (see CHARTER_GAPS); the non-breaking part was never the
       * glyph, it was this line.
       */
      for (const word of chunk.split(/((?:(?!\u00a0)\s)+)/)) {
        if (word === '') continue
        out.push({
          text: word,
          sizePt,
          bold: s.bold ?? false,
          italic: s.italic ?? false,
          underline: s.underline ?? false,
          colour,
          widthMm: measure(word, sizePt, s.bold ?? false, s.italic ?? false),
        })
      }
    }
  }
  return out
}

interface Line {
  pieces: Piece[]
  widthMm: number
  /** The tallest piece on the line decides how far the next baseline drops. */
  heightMm: number
}

function wrap(ps: Piece[], widthMm: number, lineHeight: number): Line[] {
  const lines: Line[] = []
  let cur: Piece[] = []
  let w = 0
  const flush = () => {
    /* Trailing whitespace does not count towards the width of a line and must not be drawn at
       the end of one -- it is what makes a centred line look half a space off centre. */
    while (cur.length > 0 && /^\s+$/.test(cur[cur.length - 1].text)) cur.pop()
    const tallest = cur.reduce((m, p) => Math.max(m, p.sizePt), 0)
    lines.push({
      pieces: cur,
      widthMm: cur.reduce((n, p) => n + p.widthMm, 0),
      heightMm: ptToMm(tallest || 10) * lineHeight,
    })
    cur = []
    w = 0
  }
  for (const p of ps) {
    if (p.text === '\n') { flush(); continue }
    /* A leading space on a fresh line is swallowed: it is the space that followed the word that
       ended the previous line, and drawing it indents every wrapped line by a space. */
    if (cur.length === 0 && /^\s+$/.test(p.text)) continue
    if (cur.length > 0 && w + p.widthMm > widthMm) flush()
    cur.push(p)
    w += p.widthMm
  }
  flush()
  return lines
}

/* ------------------------------------------------------------------ laying out the pages */

export interface LetterPlan {
  pages: PlannedPage[]
  /** Where the running line goes at the FOOT of every page, if there is one. */
  runningFoot: { text: string; xMm: number; yMm: number; sizePt: number; colour: string } | null
}

/**
 * Lay the whole letter out.
 *
 * THE PAGE BREAK IS DECIDED LINE BY LINE, and a table row is kept whole: half a row of the legal
 * process table at the foot of page one, with its other half at the top of page two, is a table
 * that reads as two different statements.
 */
export function planLetter(doc: LetterDocument, page: PageSetup, input: {
  measure: Measure
  filled: boolean
  values: Record<string, string>
  /**
   * THE MARK, WHERE THERE IS ONE. Null on everything the firm SENDS; set only when the signed copy
   * is being drawn. See signedMark.ts.
   */
  signed?: SignedMark | null
}): LetterPlan {
  const { measure, filled, values } = input
  const signed = input.signed ?? null
  /*
   * THE SAME REMOVAL THE SCREEN DOES, and before the page breaks are planned.
   *
   * This is the half that reaches the debtor: the PDF is the only page-accurate view, and a
   * paragraph dropped after the breaks were measured would move every break after it. Run here,
   * the notice is laid out on the blocks that will actually print.
   */
  if (filled) doc = documentWithoutOptional(doc, values)
  const left = page.marginLeftMm
  const right = page.widthMm - page.marginRightMm
  const textWidth = right - left
  const bottom = page.heightMm - page.marginBottomMm
  const base = { sizePt: doc.defaults.size, colour: doc.defaults.colour }
  const lineHeight = doc.defaults.lineHeight

  /*
   * THE RUNNING LINE SITS BELOW THE TEXT, in the bottom margin, at the firm's instruction. At the
   * top it competed with the letterhead's logo and pushed the date block down the page.
   *
   * Placed between the text frame and the letterhead's own footer block: 6mm under the last line
   * the text may reach, which on the firm's letterhead leaves it clear of the contact details
   * drawn at 279.8mm.
   */
  const footSize = doc.defaults.size * 0.78
  const footY = page.heightMm - page.marginBottomMm + 6
  const top = page.marginTopMm

  const pages: PlannedPage[] = [{ ops: [] }]
  let y = top
  const at = () => pages[pages.length - 1]
  const newPage = () => { pages.push({ ops: [] }); y = top }
  /** Room for `h` millimetres, or start a page. Never breaks on the first thing on a page. */
  const room = (h: number) => { if (y + h > bottom && at().ops.length > 0) newPage() }

  const fill = (spans: Span[]): Span[] =>
    filled ? spans.map((s) => ({ ...s, text: renderTemplate(s.text, values).text })) : spans

  /** Draw wrapped lines from the current cursor, breaking pages as needed. */
  function drawLines(lines: Line[], x: number, width: number, align: string, indent = 0) {
    for (const line of lines) {
      room(line.heightMm)
      const slack = width - line.widthMm
      let cx = x + indent
      if (align === 'center') cx += slack / 2
      else if (align === 'right') cx += slack
      /* Justification stretches the spaces, not the words, and never on the last line of a
         paragraph -- a stretched last line is the classic sign of a broken justifier. */
      const spaces = line.pieces.filter((p) => /^\s+$/.test(p.text)).length
      const extra = align === 'justify' && slack > 0 && spaces > 0 && line !== lines[lines.length - 1]
        ? slack / spaces
        : 0
      /* The baseline sits roughly four fifths down the line box, which is where a Latin face's
         baseline falls. Exact enough for a letter and stable across sizes. */
      const baseline = y + line.heightMm * 0.78
      for (const p of line.pieces) {
        if (!/^\s+$/.test(p.text)) {
          at().ops.push({
            op: 'text', xMm: cx, yMm: baseline, text: p.text, sizePt: p.sizePt,
            bold: p.bold, italic: p.italic, colour: p.colour,
          })
          if (p.underline) {
            const u = baseline + ptToMm(p.sizePt) * 0.12
            at().ops.push({
              op: 'line', x1Mm: cx, y1Mm: u, x2Mm: cx + p.widthMm, y2Mm: u,
              widthMm: ptToMm(p.sizePt) * 0.05, colour: p.colour,
            })
          }
        }
        cx += p.widthMm + (/^\s+$/.test(p.text) ? extra : 0)
      }
      y += line.heightMm
    }
  }

  /**
   * How much of a block has to fit for it not to be stranded — its first line, or for a signature
   * the air above the rule plus the rule plus the first line under it.
   *
   * Measured rather than guessed at a fixed number of millimetres: a signature block is three
   * times the height of a paragraph line, so one constant would either strand signatures or push
   * paragraphs onto a new page for no reason.
   */
  const firstUnitOf = (b: Block | undefined): number => {
    if (!b) return 0
    const oneLine = ptToMm(doc.defaults.size) * lineHeight
    /* The gap ABOVE it counts. Reserving the block's own height and forgetting the space it sits
       under leaves the reservation short by exactly that gap -- which is three millimetres, and
       three millimetres is the whole difference in the marginal case this exists for. */
    const before = ('spacing' in b ? b.spacing?.before : undefined) ?? 0
    if (b.kind === 'signature') return before + 10 + 2 + oneLine
    if (b.kind === 'spacer') return before + b.mm
    if (b.kind === 'pagebreak') return 0
    /*
     * A BAR HAS NO FIRST LINE: the whole of it or none of it. Split across a page boundary it is two
     * half-bars, each of which reads as a complete bar at a different length -- which is worse than
     * a wrong number, because the reader has no reason to doubt a picture.
     */
    /*
     * A TABLE'S FIRST UNIT IS ITS HEADER PLUS TWO ROWS, not one line.
     *
     * Found on the firm's own repayment schedule: the heading rule reserved "two lines of whatever
     * follows", the table's first line fitted, and page one ended with a column header and the
     * debtor's own offer while the three faster options -- the whole reason the table exists -- were
     * overleaf. The table case below refuses to strand its own header; this is the same fact said
     * where the block BEFORE it can read it.
     *
     * A FLOOR, NOT A MEASUREMENT. This has no column widths, so it cannot wrap a cell -- it returns
     * the least a row can be, which is exact for the single-line rows every table here has and too
     * small for a wrapped one. Under-reserving pushes a break one row later; over-reserving would
     * throw pages away on every letter the firm sends.
     */
    if (b.kind === 'table') {
      const rowFloor = oneLine + CELL_PAD_Y_MM * 2
      return before + rowFloor * (b.headerRow === true ? Math.min(3, b.rows.length) : 1)
    }
    if (b.kind === 'progress') {
      return before + (b.label ? oneLine + BAR_GAP_MM : 0) + BAR_MM
        + (b.note ? BAR_GAP_MM + oneLine * BAR_NOTE_SCALE : 0)
    }
    return before + oneLine
  }

  let counter = 0

  for (const [at_, block] of doc.blocks.entries()) {
    const next = doc.blocks[at_ + 1]
    const spacing = 'spacing' in block ? block.spacing : undefined
    y += spacing?.before ?? 0

    switch (block.kind) {
      case 'heading': {
        const scale = HEADING_SCALE[block.level]
        const size = doc.defaults.size * scale
        const space = HEADING_SPACE[block.level]
        y += spacing?.before === undefined ? space.before : 0
        const spans = fill(block.spans).map((s) => ({ ...s, bold: true, size: s.size ?? size }))
        /* "1." rather than "1", at the firm's request -- what makes a numbered section read as
           numbering rather than as a stray digit beside a heading. */
        const number = block.numbered ? `${++counter}.` : null
        const indent = number === null ? 0 : NUMBER_GUTTER_MM
        const lines = wrap(pieces(spans, { ...base, sizePt: size }, measure), textWidth - indent, lineHeight)
        /*
         * A HEADING IS NOT LEFT ALONE AT THE FOOT OF A PAGE.
         *
         * The firm found this on their own notice: "how to resolve this kind of was at the bottom
         * of the page and it just said the one thing". A heading that keeps company with nothing
         * reads as the end of the letter, and the reader turns the page having decided there is
         * nothing under it. Room is asked for the heading PLUS two lines of whatever follows.
         */
        /*
         * TWO LINES OF WHATEVER FOLLOWS, OR THE WHOLE OF ITS FIRST UNIT, whichever is the larger.
         *
         * IT USED TO BE firstUnitOf(next) * 2 AND THAT IS ONLY RIGHT FOR PROSE. "Two lines" is the
         * rule -- a heading with one line under it still reads as the end of the letter -- and for a
         * paragraph the first unit IS a line, so doubling it said exactly that. For a table, whose
         * first unit is now a header and two rows, doubling it reserves six rows and throws away a
         * third of a page whenever a section opens with one. Taking the larger keeps the prose case
         * to the character and asks a structural block only for what it actually needs.
         */
        const under = Math.max(ptToMm(doc.defaults.size) * lineHeight * 2, firstUnitOf(next))
        room(lines.reduce((n, l) => n + l.heightMm, 0)
          + (spacing?.after ?? HEADING_SPACE[block.level].after) + under)
        if (number !== null && lines.length > 0) {
          room(lines[0].heightMm)
          at().ops.push({
            op: 'text', xMm: left, yMm: y + lines[0].heightMm * 0.78, text: number,
            sizePt: size, bold: true, italic: false, colour: base.colour,
          })
        }
        drawLines(lines, left, textWidth - indent, block.align ?? 'left', indent)
        y += spacing?.after ?? space.after
        break
      }
      case 'paragraph': {
        const lines = wrap(pieces(fill(block.spans), base, measure), textWidth, lineHeight)
        /* KEPT WITH WHAT FOLLOWS, where it says so: "Yours faithfully" at the foot of a page with
           its signature overleaf reads as a letter that ends without being signed. */
        if (block.keepWithNext) {
          room(lines.reduce((n, l) => n + l.heightMm, 0)
            + (spacing?.after ?? PARA_AFTER_MM) + firstUnitOf(next))
        }
        drawLines(lines, left, textWidth, block.align ?? 'left')
        y += spacing?.after ?? PARA_AFTER_MM
        break
      }
      case 'list': {
        block.items.forEach((item, i) => {
          const marker = block.ordered ? `${i + 1}.` : '•'
          const lines = wrap(
            pieces(fill(item), base, measure), textWidth - LIST_INDENT_MM, lineHeight,
          )
          if (lines.length > 0) {
            room(lines[0].heightMm)
            at().ops.push({
              op: 'text', xMm: left, yMm: y + lines[0].heightMm * 0.78, text: marker,
              sizePt: base.sizePt, bold: false, italic: false, colour: base.colour,
            })
          }
          drawLines(lines, left, textWidth - LIST_INDENT_MM, 'left', LIST_INDENT_MM)
          y += LIST_ITEM_GAP_MM
        })
        y += spacing?.after ?? PARA_AFTER_MM
        break
      }
      case 'table': {
        const cols = block.rows[0]?.length ?? 0
        if (cols === 0) break
        const pad = block.borders === 'all' ? CELL_PAD_MM : 0
        /*
         * WIDTHS THE LETTER GAVE, OR THE ONES THE CONTENT ASKS FOR.
         *
         * AN EVEN SPLIT WAS THE OLD ANSWER AND IT WAS WRONG, in the firm's words: "we pasted,
         * [it] generated, but the generation didn't work like the pasting." A bulleted list
         * pasted out of Word arrives as a table whose first cell holds the bullet. A browser
         * shrinks that column to fit a bullet, so on screen it reads as a list; an even split
         * printed the bullet alone in the left HALF of the page. Both were drawing the same
         * document — only one was sizing the columns.
         */
        const widths = block.widths
          ? block.widths.map((pc) => (pc / 100) * textWidth)
          : autoColumnWidths({
            rows: block.rows.map((row, ri) => row.map((cell) => ({
              text: fill(cell.spans).map((sp) => sp.text).join(''),
              sizePt: base.sizePt,
              bold: block.headerRow === true && ri === 0,
              italic: false,
            }))),
            totalMm: textWidth,
            padMm: pad,
            measure,
          })
        const xs: number[] = []
        let cx = left
        for (const w of widths) { xs.push(cx); cx += w }

        /* Every cell is wrapped first so the row's height is known before anything is drawn --
           a row is kept whole across a page break, and half the legal-process table at the foot
           of a page reads as two different statements. */
        const measureRow = (row: typeof block.rows[number], ri: number) => {
          const headerRow = block.headerRow === true && ri === 0
          const cells = row.map((cell, ci) => wrap(
            pieces(
              fill(cell.spans).map((s) => (headerRow ? { ...s, bold: true } : s)),
              base, measure,
            ),
            widths[ci] - pad * 2,
            lineHeight,
          ))
          const heights = cells.map((ls) => ls.reduce((n, l) => n + l.heightMm, 0))
          return {
            cells,
            rowHeight: Math.max(...heights, ptToMm(base.sizePt) * lineHeight) + CELL_PAD_Y_MM * 2,
          }
        }

        /*
         * A TABLE THAT IS AN ARGUMENT RATHER THAN A LIST asks for all of itself before it starts.
         * See TableBlock.keepTogether: the repayment schedule's comparison is five rows that only
         * mean anything read together, and split after the third a debtor turns the page having
         * seen their own offer and the two smallest savings.
         *
         * `room` CARRIES ON IF IT CANNOT HAVE IT, which is what makes this safe on a table taller
         * than a page: it moves to a fresh one and then breaks there as any other table would.
         */
        if (block.keepTogether) {
          room(block.rows.reduce((n, r, ri) => n + measureRow(r, ri).rowHeight, 0))
        }

        block.rows.forEach((row, ri) => {
          const headerRow = block.headerRow === true && ri === 0
          const { cells, rowHeight } = measureRow(row, ri)
          /*
           * A HEADER ROW IS NOT LEFT ALONE AT THE FOOT OF A PAGE, and nor is it left with one row
           * under it. Same argument as the heading rule above, found on the firm's own repayment
           * schedule: the comparison table broke after its first line, so page one ended with the
           * column headings and the debtor's OWN offer, and the three faster options -- the whole
           * reason the table exists -- were overleaf. A header stranded like that does not read as a
           * table continuing; it reads as a table of one row.
           *
           * TWO ROWS, NOT ONE. One is what was already happening. Measured rather than guessed at a
           * number of millimetres, because a wrapped cell is three times the height of a plain one.
           */
          const keep = headerRow
            ? rowHeight + block.rows.slice(1, 3)
              .reduce((n, r, i) => n + measureRow(r, i + 1).rowHeight, 0)
            : rowHeight
          room(keep)
          const rowTop = y
          cells.forEach((lines, ci) => {
            y = rowTop + CELL_PAD_Y_MM
            drawLines(lines, xs[ci] + pad, widths[ci] - pad * 2, row[ci].align ?? 'left')
          })
          y = rowTop + rowHeight

          if (block.borders === 'rows') {
            at().ops.push({
              op: 'line', x1Mm: left, y1Mm: y, x2Mm: right, y2Mm: y,
              widthMm: RULE_MM, colour: RULE_COLOUR,
            })
          } else if (block.borders === 'all') {
            at().ops.push({ op: 'line', x1Mm: left, y1Mm: rowTop, x2Mm: right, y2Mm: rowTop, widthMm: RULE_MM, colour: RULE_COLOUR })
            at().ops.push({ op: 'line', x1Mm: left, y1Mm: y, x2Mm: right, y2Mm: y, widthMm: RULE_MM, colour: RULE_COLOUR })
            for (const x of [...xs, right]) {
              at().ops.push({ op: 'line', x1Mm: x, y1Mm: rowTop, x2Mm: x, y2Mm: y, widthMm: RULE_MM, colour: RULE_COLOUR })
            }
          }
        })
        y += spacing?.after ?? PARA_AFTER_MM
        break
      }
      case 'spacer':
        y += block.mm
        break
      case 'signature': {
        /*
         * A RULE TO SIGN ABOVE, then the name under it. Its own block rather than a row of
         * underscores, which wrap, break across a page and print at whatever width the font gives
         * them. 10mm of air above the rule is room for a pen.
         *
         * AND THE MARK GOES IN THAT AIR, which is the point of measuring it rather than adding
         * space for it: a signed copy has to paginate exactly as the unsigned one did, or the
         * document somebody read and the document they signed break in different places.
         */
        const lines = wrap(pieces(fill(block.spans), base, measure), textWidth, lineHeight)
        const ruleW = block.widthMm ?? 70
        const mark = marked(block, signed) && signed ? markBox(signed, ruleW) : null
        const stamp = marked(block, signed) && signed
          ? wrap(pieces([{ text: stampLine(signed), size: base.sizePt * 0.82, colour: '#6b7280' }],
            base, measure), textWidth, lineHeight)
          : []
        room(10 + 2 + lines.reduce((n, l) => n + l.heightMm, 0)
          + stamp.reduce((n, l) => n + l.heightMm, 0))
        y += 10
        if (mark) {
          /* Sitting ON the line: its BOTTOM is the rule, less a fifth of a millimetre so the ink
             does not merge into the rule itself. Clamped into the air above rather than allowed to
             ride up into the paragraph before it -- markBox caps the height at exactly that. */
          at().ops.push({
            op: 'image', src: signed!.signaturePng,
            xMm: left, yMm: y - mark.hMm - 0.2, wMm: mark.wMm, hMm: mark.hMm,
          })
        }
        at().ops.push({
          op: 'line', x1Mm: left, y1Mm: y, x2Mm: left + ruleW, y2Mm: y,
          widthMm: 0.3, colour: '#4b5563',
        })
        y += 2
        drawLines(lines, left, textWidth, 'left')
        /* Who signed and when, under their name: a drawing identifies nobody, and ECTA s13 wants
           a method that identifies as well as one that assents. See stampLine. */
        if (stamp.length > 0) { y += 0.8; drawLines(stamp, left, textWidth, 'left') }
        y += spacing?.after ?? PARA_AFTER_MM
        break
      }
      case 'progress': {
        /*
         * THE BAR ITSELF, which the firm asked for by name: "there should be an image. On the PDF
         * created like an image." They had the percentage and said so -- "the percentage is nice" --
         * and it was not what they meant.
         *
         * TWO RECTANGLES: the track, outlined and filled pale, then the paid part over it. Drawn in
         * that order because the fill sits INSIDE the track's border -- the other way round the
         * border would be drawn over the end of the fill and a full bar would read as slightly short.
         */
        const noteSize = doc.defaults.size * BAR_NOTE_SCALE
        const labelLines = block.label
          ? wrap(pieces(fill([{ text: block.label }]), base, measure), textWidth, lineHeight)
          : []
        const noteLines = block.note
          ? wrap(pieces(fill([{ text: block.note }]).map((sp) => ({ ...sp, size: noteSize, colour: '#6b7280' })),
            { ...base, sizePt: noteSize }, measure), textWidth, lineHeight)
          : []
        const labelH = labelLines.reduce((n, l) => n + l.heightMm, 0)
        const noteH = noteLines.reduce((n, l) => n + l.heightMm, 0)
        /* ROOM FOR ALL OF IT AT ONCE -- see firstUnitOf: half a bar is a bar at the wrong length. */
        room(labelH + (block.label ? BAR_GAP_MM : 0) + BAR_MM + (block.note ? BAR_GAP_MM + noteH : 0))
        if (labelLines.length > 0) {
          drawLines(labelLines, left, textWidth, 'left')
          y += BAR_GAP_MM
        }
        at().ops.push({
          op: 'rect', xMm: left, yMm: y, wMm: textWidth, hMm: BAR_MM,
          fill: BAR_TRACK, stroke: BAR_EDGE, strokeMm: RULE_MM,
        })
        /*
         * NOTHING DRAWN AT NOUGHT, rather than a rectangle of no width. A zero-width fill is a
         * hairline of ink at the left end of the track, which reads as a small payment where none
         * has been made.
         */
        const share = Math.max(0, Math.min(1, block.fraction))
        if (share > 0) {
          at().ops.push({
            op: 'rect', xMm: left + RULE_MM, yMm: y + RULE_MM,
            wMm: (textWidth - RULE_MM * 2) * share, hMm: BAR_MM - RULE_MM * 2,
            fill: BAR_FILL, stroke: null, strokeMm: 0,
          })
        }
        y += BAR_MM
        if (noteLines.length > 0) {
          y += BAR_GAP_MM
          drawLines(noteLines, left, textWidth, 'left')
        }
        y += spacing?.after ?? PARA_AFTER_MM
        break
      }
      case 'pagebreak':
        /* Only if something is already on this page. A page break as the first block would open
           the letter with a blank sheet, which is the trailing-blank-page bug in reverse. */
        if (at().ops.length > 0) newPage()
        break
    }
  }

  return {
    pages,
    runningFoot: doc.runningFoot
      ? { text: doc.runningFoot, xMm: left, yMm: footY, sizePt: footSize, colour: '#6b7280' }
      : null,
  }
}

/**
 * The running header for one page, with the printer's own two fields filled in.
 *
 * `{{page}}` and `{{pages}}` are answered here and nowhere else, because nothing but a printer
 * knows them — which is exactly why letterProblems refuses them in the body.
 */
export function footTextFor(plan: LetterPlan, input: {
  page: number
  pages: number
  filled: boolean
  values: Record<string, string>
}): string | null {
  if (!plan.runningFoot) return null
  const withPages = plan.runningFoot.text
    .replace(/\{\{page\}\}/g, String(input.page))
    .replace(/\{\{pages\}\}/g, String(input.pages))
  return input.filled ? renderTemplate(withPages, input.values).text : withPages
}
