/**
 * Matching a pile of PDFs to the accounts in a handover sheet, by their filenames.
 *
 * THE FIRM: "most handovers only have one PDF, which is usually an account. Now some handovers
 * and some people give us 200 handovers ... uploading 200 handovers one by one is a tedious
 * task." So the file names have to do the work, because nobody is going to do it by hand 200
 * times — and the alternative, asking the client to put a URL in the sheet, moves the problem to
 * them and the link dies the day somebody tidies a folder.
 *
 * ONE ACCOUNT MAY HAVE SEVERAL DOCUMENTS and that is not an error: an invoice and a signed
 * agreement are two files about one debt. What IS an error is one FILE that could belong to two
 * accounts, and that is reported rather than resolved.
 *
 * NOTHING IS MATCHED BY POSITION OR BY ORDER. A folder listing is not a manifest: it sorts
 * differently on every machine, a client's zip may be missing three files, and a PDF attached to
 * the wrong debtor is the exact failure the firm named — one debtor's notice going out under
 * another debtor's name.
 */

/**
 * A reference or a filename reduced to what can be compared.
 *
 * A reference is written GPS3/10103 and a filename cannot contain a slash, so clients substitute
 * a dash, an underscore, a space, or nothing at all — and they are not consistent about it within
 * one folder. Stripping everything that is not a letter or a digit makes all five spellings the
 * same string, which is the whole trick.
 */
export const fold = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** The name without its extension. "Invoice GPS3-10103.pdf" -> "Invoice GPS3-10103". */
const stem = (name: string): string => name.replace(/\.[a-z0-9]+$/i, '')

export interface DocumentMatch {
  filename: string
  reference: string
}

export interface MatchPlan {
  matched: DocumentMatch[]
  /** A file whose name contains no reference from the sheet. Named, never guessed at. */
  unmatched: string[]
  /** A file that could belong to more than one account. Named, never resolved. */
  ambiguous: { filename: string; references: string[] }[]
  /** Accounts in the sheet that no file mentions. Not an error — most handovers have one PDF. */
  withoutDocument: string[]
}

/**
 * SHORT REFERENCES ARE MATCHED WHOLE, NOT AS A SUBSTRING.
 *
 * A reference of "47" appears inside "Invoice 2047.pdf", inside a date, and inside half the
 * filenames in a folder. Below this length the reference has to BE the filename rather than
 * appear in it, which is the only reading that cannot be a coincidence.
 */
const SUBSTRING_FLOOR = 4

/**
 * Which file belongs to which account.
 *
 * LONGEST MATCH WINS WHERE ONE REFERENCE CONTAINS ANOTHER. With BF-04 and BF-047 both on the
 * book, "BF-047.pdf" contains both — and it contains the shorter one only incidentally. The
 * longer is the more specific reading and the only one a person would have meant.
 *
 * TWO REFERENCES OF THE SAME LENGTH matching one file is a genuine coin-toss, and this does not
 * toss it: the file is reported as ambiguous and left for somebody to place. A document attached
 * to the wrong account is worse than a document not attached at all — the second is visible.
 */
export function matchDocuments(input: {
  filenames: string[]
  references: string[]
}): MatchPlan {
  const refs = input.references
    .map((reference) => ({ reference, folded: fold(reference) }))
    .filter((r) => r.folded !== '')

  const matched: DocumentMatch[] = []
  const unmatched: string[] = []
  const ambiguous: { filename: string; references: string[] }[] = []
  const used = new Set<string>()

  for (const filename of input.filenames) {
    const folded = fold(stem(filename))
    if (!folded) { unmatched.push(filename); continue }

    const hits = refs.filter((r) => (r.folded.length >= SUBSTRING_FLOOR
      ? folded.includes(r.folded)
      : folded === r.folded))

    if (hits.length === 0) { unmatched.push(filename); continue }

    const longest = Math.max(...hits.map((h) => h.folded.length))
    const best = hits.filter((h) => h.folded.length === longest)
    if (best.length > 1) {
      ambiguous.push({ filename, references: best.map((h) => h.reference) })
      continue
    }
    matched.push({ filename, reference: best[0].reference })
    used.add(best[0].reference)
  }

  return {
    matched,
    unmatched,
    ambiguous,
    withoutDocument: refs.map((r) => r.reference).filter((r) => !used.has(r)),
  }
}
