/**
 * HOW WIDE EACH COLUMN OF A TABLE IS, when the letter does not say.
 *
 * THE FAULT THIS FIXES, in the firm's words: "we pasted, [it] generated, but the generation
 * didn't work like the pasting." A bulleted list pasted out of Word arrives as a table whose
 * first cell holds the bullet and whose second holds the sentence. The EDITOR draws that the way
 * a browser draws any table with no widths on it — the bullet column shrinks to fit a bullet —
 * so on screen it reads as a list. The PDF split the columns EVENLY, so the same table printed
 * with a bullet alone in the left half of the page and the sentence squeezed into the right.
 *
 * Both were drawing the same document. Only one of them was sizing the columns.
 *
 * SO THIS IS CSS `table-layout: auto`, near enough. The real algorithm is a page of the CSS 2.1
 * specification and browsers disagree about its corners; what matters here is the shape of it,
 * which every browser does agree on:
 *
 *   - a column is never narrower than its widest WORD, or the text has nowhere to go;
 *   - a column never wants to be wider than its longest cell on one line;
 *   - what is left over is shared out in proportion to what each column wanted.
 *
 * MEASURED, NOT GUESSED. The caller passes the same `measure` the rest of the layout uses, so the
 * columns are sized in the face the PDF will actually be drawn in.
 *
 * PURE, so the checks beside this folder can exercise it with a measure of their own and no PDF
 * library in the room.
 */

export interface ColumnCell {
  /** The cell's text, already merged. Wrapping happens later; this is only for measuring. */
  text: string
  /** Points, because a header row is drawn bold and bold is wider. */
  sizePt: number
  bold: boolean
  italic: boolean
}

export interface ColumnInput {
  /** Every row, every cell, in order. Ragged rows are tolerated — see `columns`. */
  rows: ColumnCell[][]
  /** How wide the whole table is, in millimetres. */
  totalMm: number
  /** Padding inside each cell, in millimetres, counted on both sides. */
  padMm: number
  /** The same measurer the rest of the layout uses. Millimetres. */
  measure: (text: string, sizePt: number, bold: boolean, italic: boolean) => number
}

/**
 * Column widths in millimetres, adding up to `totalMm`.
 *
 * ALWAYS ADDING UP. A set of widths that does not fill the table leaves a ragged right edge on
 * every rule the renderer draws under a row, and one that overflows prints past the margin.
 */
export function autoColumnWidths(input: ColumnInput): number[] {
  const { rows, totalMm, padMm, measure } = input
  /* Ragged rows are possible in a pasted document. The widest row decides how many columns there
     are, and a short row simply contributes nothing to the columns it does not reach. */
  const columns = rows.reduce((n, r) => Math.max(n, r.length), 0)
  if (columns === 0) return []
  if (!(totalMm > 0)) return Array.from({ length: columns }, () => 0)

  const min = Array.from({ length: columns }, () => 0)
  const max = Array.from({ length: columns }, () => 0)

  for (const row of rows) {
    row.forEach((cell, c) => {
      if (c >= columns) return
      const whole = measure(cell.text, cell.sizePt, cell.bold, cell.italic)
      /*
       * THE WIDEST SINGLE WORD is the narrowest a column may be. Below that the word cannot be
       * laid on a line at all, and the wrapper either overflows the cell or drops it.
       */
      let widest = 0
      for (const word of cell.text.split(/\s+/)) {
        if (word === '') continue
        widest = Math.max(widest, measure(word, cell.sizePt, cell.bold, cell.italic))
      }
      min[c] = Math.max(min[c], widest + padMm * 2)
      max[c] = Math.max(max[c], whole + padMm * 2)
    })
  }

  const totalMax = max.reduce((a, b) => a + b, 0)
  const totalMin = min.reduce((a, b) => a + b, 0)

  /*
   * EVERYTHING FITS ON ONE LINE. Each column takes what it wanted, and the slack is shared in
   * proportion — which is what keeps a two-column table looking like a two-column table rather
   * than two words huddled at the left margin with a page of white after them.
   */
  if (totalMax <= totalMm) {
    if (totalMax <= 0) return Array.from({ length: columns }, () => totalMm / columns)
    const slack = totalMm - totalMax
    return max.map((w) => w + (slack * w) / totalMax)
  }

  /*
   * IT DOES NOT ALL FIT, so something must wrap. Every column keeps its minimum and the room
   * that is left goes to the columns that wanted the most — CSS's own rule, and the reason a
   * bullet stays a bullet's width while the sentence beside it takes the rest of the line.
   */
  if (totalMin < totalMm) {
    const want = max.map((w, i) => Math.max(0, w - min[i]))
    const totalWant = want.reduce((a, b) => a + b, 0)
    const room = totalMm - totalMin
    if (totalWant <= 0) return min.map((w) => w + room / columns)
    return min.map((w, i) => w + (room * want[i]) / totalWant)
  }

  /*
   * NOT EVEN THE MINIMUMS FIT: a table of long unbreakable words wider than the page. Scaled down
   * in proportion rather than allowed to run off the paper. Something will be clipped either way;
   * this at least keeps it on the sheet and inside the margins.
   */
  if (totalMin <= 0) return Array.from({ length: columns }, () => totalMm / columns)
  return min.map((w) => (w * totalMm) / totalMin)
}
