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
 */
import {
  headerTextFor, mmToPt, planLetter, type DrawOp, type LetterPlan, type Measure,
} from './letterLayout.ts'
import type { LetterDocument, PageSetup } from './letterDocument.ts'

/** Which of the fourteen standard faces a document's font stack is drawn in. */
export function standardFamilyFor(fontStack: string): 'Times' | 'Helvetica' | 'Courier' {
  const first = fontStack.split(',')[0].replace(/["']/g, '').trim().toLowerCase()
  if (/courier|mono/.test(first)) return 'Courier'
  if (/georgia|times|garamond|book|serif/.test(first)) return 'Times'
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

  const family = standardFamilyFor(input.doc.defaults.font)
  const faces = {
    regular: await pdf.embedFont(StandardFonts[`${family}Roman` as 'TimesRoman'] ?? StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts[`${family}Bold` as 'TimesRomanBold'] ?? StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts[`${family}Italic` as 'TimesRomanItalic'] ?? StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts[`${family}BoldItalic` as 'TimesRomanBoldItalic'] ?? StandardFonts.HelveticaBoldOblique),
  }
  const faceFor = (bold: boolean, italic: boolean) =>
    (bold && italic ? faces.boldItalic : bold ? faces.bold : italic ? faces.italic : faces.regular)

  /*
   * MEASURED AGAINST THE FACE IT WILL BE DRAWN IN. Measuring in one font and drawing in another
   * is how a line that fits in the preview overruns the margin on paper -- and on a notice with a
   * right margin, an overrun is text running off the letterhead.
   */
  const measure: Measure = (text, sizePt, bold, italic) =>
    faceFor(bold, italic).widthOfTextAtSize(text, sizePt) / (72 / 25.4)

  const plan = planLetter(input.doc, input.page, {
    measure, filled: input.filled, values: input.values,
  })

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

    const header = headerTextFor(plan, {
      page: i + 1, pages: plan.pages.length, filled: input.filled, values: input.values,
    })
    if (header && plan.runningHeader) {
      const c = hexToRgb(plan.runningHeader.colour)
      sheet.drawText(header, {
        x: mmToPt(plan.runningHeader.xMm),
        y: yPt(plan.runningHeader.yMm),
        size: plan.runningHeader.sizePt,
        font: faces.regular,
        color: rgb(c.r, c.g, c.b),
      })
    }

    for (const op of planned.ops) draw(sheet, op, { faceFor, rgb, yPt })
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
}) {
  const c = hexToRgb(op.colour)
  if (op.op === 'text') {
    sheet.drawText(op.text, {
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
