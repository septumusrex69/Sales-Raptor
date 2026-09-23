/**
 * CHARTER: THE FACE THE FIRM'S NOTICES ARE SET IN.
 *
 * The firm, looking at their own section 129: "do you have the font charter? I like that… I think
 * we should use this font in our writing."
 *
 * THIS REVERSES A DECISION THIS CODEBASE MADE ON PURPOSE, so the reasoning is written down here
 * rather than left to be rediscovered. `letterPdf` draws in the fourteen standard PDF faces
 * because a PDF either embeds a font or uses one every reader already has, and embedding was
 * rejected for two reasons: the licence, and the size. Both were measured again for Charter and
 * neither survived.
 *
 *   - THE LICENCE. Bitstream contributed the four Charter outlines to the X Consortium under a
 *     grant to "use, copy, modify, sublicense, sell, and redistribute … for any purpose and
 *     without restriction", provided the notice stays with the files. Georgia could not be
 *     shipped in a public repository; Charter can, and the notice is checked in beside it.
 *   - THE SIZE. "An embedded Unicode font would add a megabyte to every notice" is true of a full
 *     Unicode embed and wrong by a factor of sixty here: a four-page notice carrying three
 *     subsetted Charter faces measures under 17 kB. The letterhead image behind it is larger than
 *     the font by an order of magnitude.
 *
 * WHAT DID NOT CHANGE is the repertoire. Charter is embedded as a subset of Windows-1252, not as
 * a Unicode font, so `winAnsi.ts` still decides what a letter may contain — and Charter is
 * missing three characters that Windows-1252 can write, which is what GAPS below exists for.
 * A letter set in anything else still draws in the fourteen standard faces and is untouched.
 */
import type { FaceGaps } from './winAnsi.ts'

/** What the font picker stores, and what a document whose font is Charter has in `defaults.font`. */
export const CHARTER_STACK = '"Charter", "Bitstream Charter", Georgia, serif'

/**
 * Is this document set in Charter?
 *
 * READS THE FIRST FAMILY, like `standardFamilyFor` does, because that is the one the browser
 * draws in and therefore the one the PDF has to match. The fallbacks after it are what happens
 * when the file has not loaded, and a letter is not laid out for those.
 */
export function isCharter(fontStack: string): boolean {
  const first = fontStack.split(',')[0].replace(/["']/g, '').trim().toLowerCase()
  return first === 'charter' || first === 'bitstream charter'
}

/** The four files pdf-lib embeds, in the order `letterPdf` asks for them. */
export const CHARTER_TTF = {
  regular: '/fonts/charter/charter-regular.ttf',
  bold: '/fonts/charter/charter-bold.ttf',
  italic: '/fonts/charter/charter-italic.ttf',
  boldItalic: '/fonts/charter/charter-bold-italic.ttf',
} as const

export interface CharterBytes {
  regular: Uint8Array
  bold: Uint8Array
  italic: Uint8Array
  boldItalic: Uint8Array
}

/**
 * THE THREE CHARACTERS CHARTER CANNOT DRAW, and they are not treated alike.
 *
 * Every other character Windows-1252 can write, Charter has a glyph for — check-charter.mjs asks
 * the font itself, face by face, so this list cannot quietly go stale when the files are replaced.
 *
 *   - THE NON-BREAKING SPACE IS THE ONE THAT MATTERS. en-ZA groups thousands with U+00A0, so it
 *     is in the middle of every Rand amount on every notice. Charter has no glyph at it, and a
 *     missing glyph in a subsetted embed is drawn as .notdef — a hollow box, in the middle of
 *     "R 12 345,67", on a statutory demand. It is substituted with an ordinary space, which is
 *     what it is; the non-breaking part is a LAYOUT property and the layout keeps it (see the
 *     word splitting in letterLayout.ts, which does not break at U+00A0).
 *   - THE SOFT HYPHEN never reaches here: winAnsi drops it before anything is measured, because
 *     Windows-1252 draws it as a real hyphen mid-word.
 *   - THE EURO IS REPORTED, not substituted. A currency symbol is a word — a notice that quietly
 *     turned €400 into 400 would be telling a debtor something the attorney did not approve. It
 *     is the one character a letter can lose by choosing Charter, and somebody is told so.
 */
export const CHARTER_GAPS: FaceGaps = {
  substitute: { 0x00a0: ' ' },
  unprintable: new Set([0x20ac]),
}

/**
 * Fetch the four faces.
 *
 * FETCHED BY THE CALLER'S SIDE OF THE WALL, like the letterhead, and for the same reason:
 * letterPdf has to run in a check with no network. Nothing here runs on import, so a check may
 * import this module freely — it only ever reaches the network if somebody actually makes a PDF.
 *
 * A face that will not load is not fatal. `letterToPdf` falls back to Times, which is a serif
 * every reader has; a notice that prints in the wrong face is a nuisance, and a notice that
 * refuses to attach because a font file 404ed is a demand that did not go out.
 */
export async function fetchCharter(): Promise<CharterBytes | null> {
  try {
    const [regular, bold, italic, boldItalic] = await Promise.all(
      [CHARTER_TTF.regular, CHARTER_TTF.bold, CHARTER_TTF.italic, CHARTER_TTF.boldItalic]
        .map(async (url) => {
          const res = await fetch(url)
          if (!res.ok) throw new Error(`${url}: ${res.status}`)
          return new Uint8Array(await res.arrayBuffer())
        }),
    )
    return { regular, bold, italic, boldItalic }
  } catch {
    return null
  }
}
