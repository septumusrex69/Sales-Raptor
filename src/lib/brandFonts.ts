/**
 * THE FIRM'S BRAND FACES IN A PDF: Open Sans for the words, Raleway Bold for the headings (Stephan, 5 Nov, sending the
 * brand guide: "HEADINGS · RALEWAY BOLD · BODY COPY · OPEN SANS REGULAR · FALLBACK FONT · ARIAL REGULAR").
 *
 * EMBEDDED, LIKE CHARTER, FOR CHARTER'S REASON: no reader on a debtor's phone promises either face, and a PDF that
 * names a font it does not carry is drawn in whatever the reader picks -- the Helvetica samples printed
 * "STATEMENTOF" on this machine for exactly that. Subset to what the page uses, so a statement stays small.
 *
 * WHICH SPANS ARE "HEADINGS": bold at HEADING_FROM_PT and above. The statement's title and section headings are 11pt
 * and 16pt bold; its labels and figures are 10pt and under. A rule on size rather than a flag on the span, so nothing
 * new has to travel through the editor -- and a check holds the statement's bold FIGURES under the line, because
 * Raleway's numerals are old-style (they dip below the line like lowercase letters) and a balance should not.
 *
 * THE LICENCES ARE THE SIL OFL 1.1 and travel beside the files (public/fonts/open-sans/OFL.txt,
 * public/fonts/raleway/OFL.txt). Open Sans is a static instance of the project's variable font, which the OFL allows
 * because Open Sans reserves no font name; Raleway DOES reserve its name, so its file is Google Fonts' own static
 * Bold, unmodified, rather than one cut here.
 */

/** The stack a document names to be set in the brand faces. Arial, then Helvetica, is the guide's own fallback. */
export const BRAND_STACK = '"Open Sans", Arial, Helvetica, sans-serif'

export function isBrand(fontStack: string): boolean {
  return fontStack.split(',')[0].replace(/["']/g, '').trim().toLowerCase() === 'open sans'
}

/** Bold spans this size and larger are drawn in Raleway Bold; everything else in Open Sans. */
export const HEADING_FROM_PT = 11

export const BRAND_TTF = {
  regular: '/fonts/open-sans/open-sans-regular.ttf',
  bold: '/fonts/open-sans/open-sans-bold.ttf',
  italic: '/fonts/open-sans/open-sans-italic.ttf',
  boldItalic: '/fonts/open-sans/open-sans-bold-italic.ttf',
  heading: '/fonts/raleway/raleway-bold.ttf',
} as const

export interface BrandBytes {
  regular: Uint8Array
  bold: Uint8Array
  italic: Uint8Array
  boldItalic: Uint8Array
  heading: Uint8Array
}

/** The five files, off this deployment (the browser) or another origin (the server's fallback). Null on any failure. */
export async function fetchBrand(base = ''): Promise<BrandBytes | null> {
  try {
    const keys = ['regular', 'bold', 'italic', 'boldItalic', 'heading'] as const
    const bytes = await Promise.all(keys.map(async (k) => {
      const url = `${base}${BRAND_TTF[k]}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${url}: ${res.status}`)
      return new Uint8Array(await res.arrayBuffer())
    }))
    return { regular: bytes[0], bold: bytes[1], italic: bytes[2], boldItalic: bytes[3], heading: bytes[4] }
  } catch {
    return null
  }
}
