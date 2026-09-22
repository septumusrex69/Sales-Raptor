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

/**
 * The columns a sheet does not use, which the table folds away.
 *
 * THE FIRM, looking at a handover on an iPad: "why is he doing this? Is it an iPad thing or is it
 * Raptor?" Measured, it was Raptor. The table was 6 239 pixels wide and the sidebar and the
 * Settings menu leave a window on it of about 500 at iPad widths -- so reaching the six columns
 * with anything in them meant scrolling past ten screens of empty boxes. Thirty-seven of the
 * forty-three columns were empty on every row and cost 5 103 of those pixels; "Company
 * registration number" was 248 pixels of nothing, on every row.
 *
 * That is the price of the minimum width the firm asked for -- "just make the thing longer so I
 * can actually see that stuff" -- which is right for a column with something in it and wrong for
 * one with nothing.
 *
 * TWO KINDS ARE NEVER FOLDED, AND THEY ARE EXACTLY THE ONES THAT LOOK EMPTIEST.
 *
 *  - A REQUIRED column that is empty is the reason a row is refused. Folding the box somebody has
 *    to type in would hide the only thing they came to the screen to do.
 *  - A column carrying a PROBLEM is what the reason under the table is pointing at. Folded, the
 *    sentence names a box that is not on the screen -- "No email address" over a table with no
 *    email column on it.
 *
 * PURE AND HERE rather than worked out in the table, because the two exceptions are the whole of
 * it and both are invisible on a sheet that happens to fill those columns: the rule passes for
 * the wrong reason on any fixture where the required columns are populated, which is most of
 * them. Given a list to test against, they can be shown one at a time.
 */
export function foldableColumns(
  keys: readonly string[],
  rows: readonly { values: Record<string, string | null>; problemKeys: readonly (string | null)[] }[],
  required: ReadonlySet<string>,
): string[] {
  const withProblem = new Set(rows.flatMap((r) => r.problemKeys.filter((k): k is string => !!k)))
  return keys.filter((k) => !required.has(k) && !withProblem.has(k)
    /* Whitespace is empty: a column of spaces out of a spreadsheet is nothing to look at. */
    && rows.every((r) => (r.values[k] ?? '').trim() === ''))
}
