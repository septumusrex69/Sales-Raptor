/**
 * How wide each of the forty columns has to be to SHOW WHAT IS IN IT.
 *
 * THE FIRM: "if there's written things like that, that goes into like a hidden state, just make
 * the thing longer so that the column is longer so I can actually see that stuff." The screenshot
 * was an email column reading "kagiso.molefe@" with the rest of the address off the end of it.
 *
 * WHY THE BROWSER DID NOT ALREADY DO THIS. `table-layout: auto` sizes a column to its widest
 * cell, which is exactly what is wanted — but every cell here holds an `<input>`, and an input's
 * intrinsic width is its `size` attribute, not its value. Forty columns each declared one fixed
 * minimum came out forty identical widths: wrong for an email address and wasteful for a title.
 * So the measuring the browser would have done for plain text is done here instead.
 *
 * THIS IS THE SAME RULE AS `autoColumnWidths` IN A LETTER, and deliberately so: never narrower
 * than the heading, never wider than the longest value, and a ceiling so that one debtor with a
 * fifty-character address does not push every other column off the screen. What differs is the
 * unit — `ch`, because this sizes boxes of text in a browser rather than shares of an A4 page.
 */

/**
 * The box's own chrome — border, padding, and the caret's room at the end.
 *
 * Without it the last character sits hard against the border and reads as clipped, which is the
 * complaint this exists to answer rather than a smaller version of it.
 */
const CHROME = 3

/**
 * Nothing is narrower than this.
 *
 * A column of empty cells still has to be a box somebody can click into and type an address. The
 * old fixed 7rem was about eleven characters at this size; this is deliberately close to it, so
 * the columns that were never the problem do not move.
 */
export const MIN_CH = 11

/**
 * And nothing wider.
 *
 * Forty columns unbounded is a table nobody can scroll to the end of. An address longer than this
 * is still fully there — it is an input, so it scrolls inside itself and the whole value is one
 * click away — where a column sized to it would push the other thirty-nine out of reach for every
 * row in the file.
 */
export const MAX_CH = 32

/** The longest thing in a column, in characters, heading included. */
export function columnWidthCh(
  heading: string,
  values: Iterable<string | null | undefined>,
): number {
  let longest = heading.length
  for (const v of values) {
    /*
     * Measured on the TRIMMED value. A trailing space out of a spreadsheet is not something
     * anybody needs to see, and a column widened by one is a column widened for no reason.
     */
    const n = (v ?? '').trim().length
    if (n > longest) longest = n
  }
  return Math.min(MAX_CH, Math.max(MIN_CH, longest + CHROME))
}
