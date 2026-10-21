/**
 * The rows that could not be opened, as the client's own sheet.
 *
 * THE FIRM: "those ones that were rejected, they should be attached in the email sent to the
 * client liaison. Only the rejected ones. And it should also be downloaded automatically for the
 * user, should also be in the query ticket."
 *
 * A CLIENT SENT A LIST OF PROBLEMS HAS TO RETYPE THEIR FILE. The email's table says what is
 * wrong with row 7 and nothing about the other thirty-nine columns of row 7, so correcting it
 * means going back to the original spreadsheet and finding the row again. Sent their own sheet
 * back with only the refused rows on it, they fix the cells and send it on — and what comes back
 * is a file the importer already reads.
 *
 * EVERY COLUMN OF THE SHEET, IN THE SHEET'S ORDER, not only the ones with something wrong. A
 * sheet missing the columns that were fine is not the sheet they sent; it is a new form to fill
 * in, and the import would refuse it for the required columns it no longer has.
 *
 * ONE EXTRA COLUMN AT THE END, saying what we need. At the end rather than the front so the
 * columns the importer reads are where they were, and it is harmless on the way back: an unknown
 * heading is ignored, so the client may leave it or delete it.
 */
import { HANDOVER_COLUMNS } from './handoverSheet.ts'
import type { Cell } from './xlsxWrite.ts'

/** The heading of the column this adds. Read back on import as nothing, which is intended. */
export const WHAT_WE_NEED = 'What we need'

export interface RejectedRow {
  values: Record<string, string | null>
  /** `key` is the column the problem is about, and is null where it is about the whole row. */
  problems: { message: string; key?: string | null }[]
}

/**
 * The sheet as rows of text, header first.
 *
 * Pure, and returns rows rather than bytes so a check can read what is in the file without
 * unzipping one.
 */
export function rejectedSheetRows(rows: RejectedRow[]): Cell[][] {
  const keys = HANDOVER_COLUMNS.map((c) => c.key)
  const header: Cell[] = [...HANDOVER_COLUMNS.map((c) => c.label), WHAT_WE_NEED]
    .map((v) => ({ v, style: 'head' as const }))
  const body: Cell[][] = rows.map((r) => {
    /*
     * ---- THE CELLS TO CHANGE ARE COLOURED ----
     *
     * THE FIRM: "can't we just highlight the fields that need attention on that sheet and give it
     * to the client? If the client fixes it and sends it back and we import it, even if it's
     * still yellow, will it still import?"
     *
     * IT WILL. A fill is styling and the reader in xlsx.ts reads VALUES -- the only thing it ever
     * looks up a style for is whether a number is meant to be a date. So the client can correct
     * the red cells and send the file straight back with the colour still on it, and it imports
     * exactly as though it were plain.
     *
     * RED RATHER THAN YELLOW, and it is Excel's own red: the "Bad" style, #FFC7CE on #9C0006.
     * Excel's yellow is "Neutral", which reads as "have a look at this" -- and these are not
     * suggestions, they are the reason the account could not be opened. Borrowing the colour the
     * client's own spreadsheet already uses means it needs no explaining in the covering email.
     *
     * THE COLOUR IS NEVER THE MESSAGE. It does not survive a monochrome print, a paste-as-values
     * or a red-green colourblind reader, so every problem is still written out in words in the
     * last column. The fill only says WHICH cell the words are about, which is the part a
     * sentence under a forty-column sheet cannot say.
     */
    const bad = new Set(r.problems.map((p) => p.key).filter((k): k is string => !!k))
    return [
      ...keys.map((k): Cell => {
        const v = (r.values[k] ?? '').toString()
        /* Marked even when EMPTY, which is the case that matters: a row refused for a missing
           value has nothing in the box, and that box is the one they have to find. */
        return bad.has(k) ? { v, style: 'bad' } : v
      }),
      /*
       * EVERY PROBLEM, not the first. A row refused for two things fixed once comes straight back,
       * and the client would rightly say they did what they were asked.
       */
      r.problems.map((p) => p.message).join(' '),
    ]
  })
  return [header, ...body]
}

/**
 * What to call the file.
 *
 * NAMED FOR THEIR OWN SHEET, because the client has to recognise it among their own files a week
 * later — "handover 3 (refusals) — to correct.xlsx" is obviously about the file they sent, where
 * "rejected.xlsx" is about us. The extension is replaced rather than appended, or a client gets
 * something called `.xlsx.xlsx` and Windows hides the half that matters.
 */
export function rejectedSheetName(originalFilename: string): string {
  const base = originalFilename.replace(/\.[^.]+$/, '').trim() || 'handover'
  return `${base} — to correct.xlsx`
}
