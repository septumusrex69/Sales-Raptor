/**
 * THE LETTER AS A PDF, MADE WHEN IT IS SENT AND KEPT NOWHERE.
 *
 * The firm's instruction: "we need to be able to send a PDF through the system through an email…
 * Now the PDF doesn't necessarily need to be saved to Raptor. It can be loaded, for example, what
 * was saved. So I mean, just to save space on the database."
 *
 * So nothing is stored. The bytes exist between pressing Attach and the message leaving, and what
 * IS kept is what it was made from — the template, the account, the date — which is smaller,
 * reproducible, and the thing somebody would actually want to look up. A notice the firm has to
 * produce again is regenerated from those.
 *
 * IN THE BROWSER, NOT ON THE SERVER, and that is a constraint rather than a preference. Vercel
 * Hobby caps serverless functions at twelve and api/ is at exactly twelve; a renderer endpoint
 * would mean removing one. The existing api/email/send.ts already takes base64 attachments, so
 * generating here and handing it over costs no endpoint at all. pdf-lib is loaded by dynamic
 * import, so it is in its own chunk and nobody who never sends a letter ever downloads it.
 *
 * THE FONTS ARE SUBSTITUTED, AND THAT IS WORTH KNOWING. A PDF either embeds a font or uses one of
 * the fourteen every reader has. Embedding Georgia would mean shipping a licensed font file in a
 * public repository; so Georgia and Times New Roman are drawn as Times, and Arial, Calibri and
 * Verdana as Helvetica. The metrics differ slightly from the on-screen preview, which is why the
 * layout is measured against the FACE IT WILL BE DRAWN IN rather than against the browser's --
 * the line breaks in the PDF are the PDF's own, so nothing wraps differently from what it shows.
 *
 * WITH ONE EXCEPTION, AND IT IS THE FIRM'S OWN FACE. Charter is embedded rather than substituted
 * -- Bitstream's grant allows a public repository to ship it, and a subsetted embed costs a
 * four-page notice about 17 kB, not the megabyte the standard-faces decision was taken to avoid.
 * See charter.ts, which has the whole argument. The bytes arrive from the CALLER, like the
 * letterhead and for the same reason, and a letter set in Charter whose files did not load falls
 * back to Times rather than refusing: a notice in the wrong serif went out, and a notice that
 * would not attach did not.
 */
import {
  footTextFor, mmToPt, planLetter, type DrawOp, type LetterPlan, type Measure,
} from './letterLayout.js'
import type { LetterDocument, PageSetup } from './letterDocument.ts'
import { printableForPdf, unprintableMessage, type FaceGaps } from './winAnsi.js'
import { CHARTER_GAPS, isCharter, type CharterBytes } from './charter.js'

/** Which of the fourteen standard faces a document's font stack is drawn in. */
export function standardFamilyFor(fontStack: string): 'Times' | 'Helvetica' | 'Courier' {
  const first = fontStack.split(',')[0].replace(/["']/g, '').trim().toLowerCase()
  if (/courier|mono/.test(first)) return 'Courier'
  /* `charter` is here for the FALLBACK only: a Charter letter whose font files did not load is
     still a serif letter, and drawing it in Helvetica would be a second surprise on top of the
     first. When the files do load it never reaches this function. */
  if (/charter|georgia|times|garamond|book|serif/.test(first)) return 'Times'
  return 'Helvetica'
}

/** #rrggbb to the 0..1 triple pdf-lib wants. Anything else is drawn black rather than guessed. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 0, g: 0, b: 0 }
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  }
}

export interface LetterPdfInput {
  doc: LetterDocument
  page: PageSetup
  /** Always true in practice: a notice posted with {{balance}} in it is not a notice. */
  filled: boolean
  values: Record<string, string>
  /**
   * The letterhead, already fetched as bytes.
   *
   * FETCHED BY THE CALLER rather than here, because this module has to run in a check with no
   * network. A letter with no letterhead prints on plain paper, which is what a firm that has not
   * uploaded one actually has.
   */
  letterhead?: { bytes: Uint8Array; type: 'png' | 'jpg' } | null
  /**
   * Charter's four faces, already fetched as bytes -- see charter.ts. Null or absent and a letter
   * set in Charter prints in Times, which is the fallback its own font stack names anyway.
   */
  charter?: CharterBytes | null
}

type Pdf = Awaited<ReturnType<typeof import('pdf-lib').PDFDocument.create>>
type Faces = {
  regular: import('pdf-lib').PDFFont
  bold: import('pdf-lib').PDFFont
  italic: import('pdf-lib').PDFFont
  boldItalic: import('pdf-lib').PDFFont
}

/**
 * Charter's four faces, embedded.
 *
 * SUBSET: TRUE IS THE WHOLE ECONOMY. Embedded whole, one face is 35 kB and four are 140; subset
 * to the characters a notice actually uses, a four-page section 129 in three faces measures under
 * 17 kB altogether -- less than the letterhead PNG drawn behind it. It is also what keeps the
 * repertoire honest: what is embedded is what was drawn, so a character the layout never emitted
 * cannot be sitting in the file.
 *
 * FONTKIT IS IMPORTED HERE, NOT AT THE TOP. pdf-lib cannot read a TrueType file without it, and
 * it is the larger half of the download -- so the letter that does not use Charter never fetches
 * it. The whole module is already behind a dynamic import; this is one level further in.
 *
 * A FAILURE RETURNS NULL RATHER THAN THROWING, and the caller falls back to Times. The firm sends
 * statutory demands from this button. A corrupt font file is a reason for a notice to look wrong,
 * never a reason for it not to go.
 */
async function embedCharter(pdf: Pdf, bytes: CharterBytes): Promise<Faces | null> {
  try {
    const fontkit = (await import('@pdf-lib/fontkit')).default
    pdf.registerFontkit(fontkit)
    const embed = (b: Uint8Array) => pdf.embedFont(b, { subset: true })
    return {
      regular: await embed(bytes.regular),
      bold: await embed(bytes.bold),
      italic: await embed(bytes.italic),
      boldItalic: await embed(bytes.boldItalic),
    }
  } catch {
    return null
  }
}

/**
 * Build the PDF. Resolves to the bytes; stores nothing anywhere.
 *
 * The plan comes from letterLayout.ts, which knows nothing about PDFs — so what is drawn here is
 * exactly what a check can assert about without a PDF library in the room.
 */
export async function letterToPdf(input: LetterPdfInput): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()

  /*
   * EMBEDDED ONLY WHEN THE LETTER ASKS FOR IT AND THE BYTES ARRIVED. Both halves matter: fontkit
   * and the four files are a quarter of a megabyte of work nobody sending a Georgia letter should
   * pay for, and a Charter letter with no bytes has to print in something.
   */
  const embedded = isCharter(input.doc.defaults.font) && input.charter
    ? await embedCharter(pdf, input.charter)
    : null
  const family = standardFamilyFor(input.doc.defaults.font)
  /*
   * WRITTEN OUT, ONE FAMILY AT A TIME. This was built by concatenation -- `${family}Roman`,
   * `${family}Bold` -- and the names it produced mostly do not exist: pdf-lib calls Times's
   * regular face TimesRoman but its bold TimesRomanBold, so `TimesBold` was undefined and every
   * bold run in a Times letter fell through to the HELVETICA default beside it. The firm's
   * notices have been going out with Times body text under Helvetica headings. Courier was worse:
   * three of its four faces were Helvetica. Found while embedding Charter, because the fallback
   * had to be asserted and the assertion said Helvetica.
   */
  const STANDARD = {
    Times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
    Helvetica: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
    Courier: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
  } as const
  const [reg, bld, ital, bi] = STANDARD[family]
  const faces = embedded ?? {
    regular: await pdf.embedFont(StandardFonts[reg]),
    bold: await pdf.embedFont(StandardFonts[bld]),
    italic: await pdf.embedFont(StandardFonts[ital]),
    boldItalic: await pdf.embedFont(StandardFonts[bi]),
  }
  /* Which characters THIS face cannot draw. Empty for the standard fourteen, three long for
     Charter -- and it has to follow the face actually used, not the one asked for, or a fallback
     to Times would start refusing euros for no reason. */
  const gaps = embedded ? CHARTER_GAPS : undefined
  const faceFor = (bold: boolean, italic: boolean) =>
    (bold && italic ? faces.boldItalic : bold ? faces.bold : italic ? faces.italic : faces.regular)

  /*
   * MEASURED AGAINST THE FACE IT WILL BE DRAWN IN. Measuring in one font and drawing in another
   * is how a line that fits in the preview overruns the margin on paper -- and on a notice with a
   * right margin, an overrun is text running off the letterhead.
   */
  /*
   * MADE PRINTABLE BEFORE IT IS MEASURED, not only before it is drawn. The standard PDF faces
   * speak Windows-1252 and nothing else, and a tab -- which is what a Word table copied as plain
   * text puts between its cells -- throws here rather than at the draw. Measuring the original
   * and drawing the cleaned text would also disagree about the width of every line with one in
   * it, which is how a line that fit in the plan overruns the margin on paper.
   */
  const measure: Measure = (text, sizePt, bold, italic) =>
    faceFor(bold, italic).widthOfTextAtSize(printableForPdf(text, gaps).text, sizePt) / (72 / 25.4)

  const plan = planLetter(input.doc, input.page, {
    measure, filled: input.filled, values: input.values,
  })

  /*
   * AND REFUSED IF ANYTHING REAL CANNOT BE PRINTED.
   *
   * The firm met this as "WinAnsi cannot encode ' ' (0x0009)" -- a library talking to itself
   * about a character nobody can see. A tab is now fixed quietly; what reaches here is a
   * character that is a WORD -- an arrow, a >=, something from another alphabet -- and for those
   * refusing is right. Substituting would change what the debtor is told, and a section 129 that
   * says something the attorney did not approve is a defective demand.
   *
   * COLLECTED ACROSS THE WHOLE LETTER BEFORE ANY OF IT IS DRAWN, so the message names every
   * offending character at once rather than sending somebody back four times.
   */
  const unprintable: string[] = []
  const note = (text: string) => {
    for (const ch of printableForPdf(text, gaps).unprintable) {
      if (!unprintable.includes(ch)) unprintable.push(ch)
    }
  }
  for (const sheet of plan.pages) {
    for (const op of sheet.ops) if (op.op === 'text') note(op.text)
  }
  /* The running line is an op of its own shape, not a string — see LetterPlan. */
  if (plan.runningFoot) note(plan.runningFoot.text)
  if (unprintable.length > 0) throw new Error(unprintableMessage(unprintable))

  const image = input.letterhead
    ? input.letterhead.type === 'png'
      ? await pdf.embedPng(input.letterhead.bytes)
      : await pdf.embedJpg(input.letterhead.bytes)
    : null

  const wPt = mmToPt(input.page.widthMm)
  const hPt = mmToPt(input.page.heightMm)
  /* mm from the TOP to PDF's points from the BOTTOM. The one place the two systems meet. */
  const yPt = (mm: number) => hPt - mmToPt(mm)

  plan.pages.forEach((planned, i) => {
    const sheet = pdf.addPage([wPt, hPt])
    /* The letterhead is drawn FIRST and full-bleed, so the text lands on top of it. Every page
       gets one: page two of a two-page notice on plain paper is a page that looks forged. */
    if (image) sheet.drawImage(image, { x: 0, y: 0, width: wPt, height: hPt })

    const foot = footTextFor(plan, {
      page: i + 1, pages: plan.pages.length, filled: input.filled, values: input.values,
    })
    if (foot && plan.runningFoot) {
      const c = hexToRgb(plan.runningFoot.colour)
      sheet.drawText(foot, {
        x: mmToPt(plan.runningFoot.xMm),
        y: yPt(plan.runningFoot.yMm),
        size: plan.runningFoot.sizePt,
        font: faces.regular,
        color: rgb(c.r, c.g, c.b),
      })
    }

    for (const op of planned.ops) draw(sheet, op, { faceFor, rgb, yPt, gaps })
  })

  return pdf.save()
}

/**
 * One op, in PDF coordinates. Deliberately dumb: every decision was made in the plan.
 *
 * Typed against pdf-lib's own PDFPage through the call site rather than against a hand-written
 * shape — the hand-written one drifted from PDFPageDrawLineOptions the moment it was written.
 */
type Sheet = Awaited<ReturnType<typeof import('pdf-lib').PDFDocument.create>> extends never
  ? never : ReturnType<Awaited<ReturnType<typeof import('pdf-lib').PDFDocument.create>>['addPage']>

function draw(sheet: Sheet, op: DrawOp, k: {
  faceFor: (bold: boolean, italic: boolean) => import('pdf-lib').PDFFont
  rgb: (r: number, g: number, b: number) => import('pdf-lib').RGB
  yPt: (mm: number) => number
  gaps?: FaceGaps
}) {
  const c = hexToRgb(op.colour)
  if (op.op === 'text') {
    /* Cleaned again at the draw rather than trusted to have been cleaned upstream: this is the
       one place bytes are actually written, and an uncaught character here is an exception
       thrown halfway through building a document. */
    sheet.drawText(printableForPdf(op.text, k.gaps).text, {
      x: mmToPt(op.xMm),
      y: k.yPt(op.yMm),
      size: op.sizePt,
      font: k.faceFor(op.bold, op.italic),
      color: k.rgb(c.r, c.g, c.b),
    })
    return
  }
  sheet.drawLine({
    start: { x: mmToPt(op.x1Mm), y: k.yPt(op.y1Mm) },
    end: { x: mmToPt(op.x2Mm), y: k.yPt(op.y2Mm) },
    thickness: mmToPt(op.widthMm),
    color: k.rgb(c.r, c.g, c.b),
  })
}

/** Base64, which is what api/email/send.ts wants an attachment's content as. */
export function toBase64(bytes: Uint8Array): string {
  let s = ''
  /* In chunks: String.fromCharCode(...a_hundred_thousand_bytes) overflows the call stack, and a
     two-page notice with a letterhead in it is comfortably over that. */
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(s)
}

/**
 * A filename a person can find again in their downloads.
 *
 * The reference rather than a timestamp: somebody looking for the notice they sent has the
 * account reference in front of them and not the minute they pressed send.
 */
export function letterFilename(templateName: string, reference: string | null): string {
  const clean = (s: string) => s.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')
  const ref = reference ? `-${clean(reference)}` : ''
  return `${clean(templateName) || 'letter'}${ref}.pdf`.slice(0, 120)
}

export type { LetterPlan }
