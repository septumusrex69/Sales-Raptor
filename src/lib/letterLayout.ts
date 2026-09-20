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
import type { LetterDocument, PageSetup, Span } from './letterDocument.ts'
import { renderTemplate } from './messageTemplates.ts'

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

export type DrawOp = TextOp | LineOp

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
      for (const word of chunk.split(/(\s+)/)) {
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
  /** Where the running header goes on every page, if there is one. */
  runningHeader: { text: string; xMm: number; yMm: number; sizePt: number; colour: string } | null
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
}): LetterPlan {
  const { measure, filled, values } = input
  const left = page.marginLeftMm
  const right = page.widthMm - page.marginRightMm
  const textWidth = right - left
  const bottom = page.heightMm - page.marginBottomMm
  const base = { sizePt: doc.defaults.size, colour: doc.defaults.colour }
  const lineHeight = doc.defaults.lineHeight

  /* The running header sits in the TOP MARGIN, above the text frame, which is where the
     letterhead leaves room for it. Inside the frame it would push page one's first paragraph
     down a line and no other page's, so the two would not start at the same height. */
  const headerSize = doc.defaults.size * 0.78
  const headerY = Math.max(ptToMm(headerSize), page.marginTopMm - 8)
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

  let counter = 0

  for (const block of doc.blocks) {
    const spacing = 'spacing' in block ? block.spacing : undefined
    y += spacing?.before ?? 0

    switch (block.kind) {
      case 'heading': {
        const scale = HEADING_SCALE[block.level]
        const size = doc.defaults.size * scale
        const space = HEADING_SPACE[block.level]
        y += spacing?.before === undefined ? space.before : 0
        const spans = fill(block.spans).map((s) => ({ ...s, bold: true, size: s.size ?? size }))
        const number = block.numbered ? `${++counter}` : null
        const indent = number === null ? 0 : NUMBER_GUTTER_MM
        const lines = wrap(pieces(spans, { ...base, sizePt: size }, measure), textWidth - indent, lineHeight)
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
        const widths = (block.widths ?? Array.from({ length: cols }, () => 100 / cols))
          .map((pc) => (pc / 100) * textWidth)
        const xs: number[] = []
        let cx = left
        for (const w of widths) { xs.push(cx); cx += w }

        block.rows.forEach((row, ri) => {
          const headerRow = block.headerRow === true && ri === 0
          const pad = block.borders === 'all' ? CELL_PAD_MM : 0
          /* Every cell is wrapped first so the row's height is known before anything is drawn --
             a row is kept whole across a page break, and half the legal-process table at the foot
             of a page reads as two different statements. */
          const cells = row.map((cell, ci) => wrap(
            pieces(
              fill(cell.spans).map((s) => (headerRow ? { ...s, bold: true } : s)),
              base, measure,
            ),
            widths[ci] - pad * 2,
            lineHeight,
          ))
          const heights = cells.map((ls) => ls.reduce((n, l) => n + l.heightMm, 0))
          const rowHeight = Math.max(...heights, ptToMm(base.sizePt) * lineHeight) + CELL_PAD_Y_MM * 2
          room(rowHeight)
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
      case 'pagebreak':
        /* Only if something is already on this page. A page break as the first block would open
           the letter with a blank sheet, which is the trailing-blank-page bug in reverse. */
        if (at().ops.length > 0) newPage()
        break
    }
  }

  return {
    pages,
    runningHeader: doc.runningHeader
      ? {
        text: doc.runningHeader,
        xMm: left,
        yMm: headerY,
        sizePt: headerSize,
        colour: '#6b7280',
      }
      : null,
  }
}

/**
 * The running header for one page, with the printer's own two fields filled in.
 *
 * `{{page}}` and `{{pages}}` are answered here and nowhere else, because nothing but a printer
 * knows them — which is exactly why letterProblems refuses them in the body.
 */
export function headerTextFor(plan: LetterPlan, input: {
  page: number
  pages: number
  filled: boolean
  values: Record<string, string>
}): string | null {
  if (!plan.runningHeader) return null
  const withPages = plan.runningHeader.text
    .replace(/\{\{page\}\}/g, String(input.page))
    .replace(/\{\{pages\}\}/g, String(input.pages))
  return input.filled ? renderTemplate(withPages, input.values).text : withPages
}
