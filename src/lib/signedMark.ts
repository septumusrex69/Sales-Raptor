/**
 * THE MARK A SIGNER MADE, AND WHERE ON THE DOCUMENT IT BELONGS.
 *
 * THE FIRM, looking at the first acknowledgement of debt somebody signed online: "he signs it, but
 * the signature just like randomly hangs down there. The signature is not signed on the document.
 * It's not put in the right place. It should be put in the block where it's being put in the right
 * place." The page drew the document, and then drew the PNG underneath it in a card of its own --
 * so what the firm had was an agreement with empty signature rules and a picture of a squiggle
 * below it. That is not a signed document; it is a document and a photograph.
 *
 * PURE, AND IN ITS OWN FILE FOR THAT REASON. Both renderers need this -- letterToHtml for the
 * screen and planLetter for the PDF -- and a check has to be able to import it without a browser,
 * a database or pdf-lib. The same split signingRules.ts already has, and for the same reason.
 */
import type { SignatureBlock } from './letterDocument.ts'

/** What came back from the signing page: the drawing, the typed name, and when. */
export interface SignedMark {
  /** The drawn mark, as a `data:image/png;base64,` URL. What SignaturePad produces. */
  signaturePng: string
  /** Typed, because ECTA s13 wants a method that IDENTIFIES as well as one that assents. */
  name: string
  /** ISO timestamp, as the database recorded it. */
  signedAt: string
  /**
   * THE INITIALS, WHICH ARE A SEPARATE MARK AND GO IN A SEPARATE PLACE.
   *
   * THE FIRM ASKED FOR THEM FROM THE START -- "make space for where there can be signatures like
   * at the bottom of the pages for initials and stuff" -- and then, reading a signed copy: "the
   * initials also don't appear on the page." They were captured and drawn nowhere.
   *
   * A PAGE INITIAL IS NOT A SMALL SIGNATURE. It is what somebody puts on every page to say they
   * read that page, so it is captured separately on the signing form and drawn once per page
   * rather than scaled down and reused on the rules. Null where the signer did not give one: it
   * is not required, and a nine-page agreement signed at the end is still signed.
   */
  initialsPng?: string | null
}

/**
 * WHOSE RULE A SIGNATURE BLOCK IS.
 *
 * AN ACKNOWLEDGEMENT OF DEBT HAS THREE OF THEM and the debtor signs two: their own in Part B and
 * the Defendant's on the consent to judgment in Annexure A. The third is the CREDITOR's, which the
 * firm signs as agent -- stamping the debtor's mark on it would show a court an agreement where
 * one person signed for both sides.
 *
 * THE ROLE IS ON THE BLOCK, and the text is the fallback. `signer` is what aod.mjs writes and what
 * travels through the page editor as `data-signer`. The text test is for the documents already
 * FROZEN onto signing requests that went out before this existed: their blocks have no role, and a
 * block whose words name the Creditor is the firm's. Reading the words is a guess; it is a guess
 * made only about documents nothing can go back and re-tag, and the alternative is stamping those
 * on every rule.
 */
export function signerOf(block: SignatureBlock): 'debtor' | 'creditor' {
  if (block.signer) return block.signer
  return /creditor/i.test(block.spans.map((s) => s.text).join(' ')) ? 'creditor' : 'debtor'
}

/** Does this block get the mark? */
export function marked(block: SignatureBlock, signed: SignedMark | null | undefined): boolean {
  return !!signed && signerOf(block) === 'debtor'
}

/**
 * WHAT IS WRITTEN UNDER THE RULE, which is the half that makes the drawing mean anything.
 *
 * A squiggle identifies nobody. ECTA s13(3) asks for a method that identifies the person AND
 * indicates their approval, so the name they typed and the moment the database recorded go under
 * their mark, in the document, rather than in a row on a screen inside Raptor. A court reading the
 * PDF should not have to be told where it came from.
 *
 * en-ZA, like every other date the firm reads. Note that it renders September as "Sept" -- see
 * CLAUDE.md; that is the locale's own spelling and not something to correct here.
 */
export function stampLine(signed: SignedMark): string {
  const when = new Date(signed.signedAt)
  const date = Number.isNaN(when.getTime())
    ? signed.signedAt
    : when.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
  return `Signed electronically by ${signed.name} on ${date}`
}

/**
 * HOW BIG THE DRAWING IS, READ OUT OF THE PNG ITSELF.
 *
 * The layout has to know the aspect before it can place the mark, and a data URL carries no
 * dimensions. Rather than storing them beside it -- a second fact about the same picture, which
 * can disagree with it -- the IHDR chunk is read: a PNG is an 8-byte signature, then a 4-byte
 * length, then "IHDR", then width and height as big-endian 32-bit integers. Those offsets are
 * fixed by the format; IHDR is required to be the first chunk.
 *
 * NULL RATHER THAN A GUESS where it cannot be read. A square default would draw somebody's
 * signature stretched, and a stretched signature on an instrument the firm would sue on is worse
 * than one drawn at the rule's own proportions.
 */
export function pngSize(dataUrl: string): { width: number; height: number } | null {
  const comma = dataUrl.indexOf(',')
  if (comma < 0 || !/^data:image\/png/i.test(dataUrl)) return null
  let bytes: Uint8Array
  try {
    const binary = atob(dataUrl.slice(comma + 1))
    bytes = new Uint8Array(24)
    for (let i = 0; i < 24; i += 1) bytes[i] = binary.charCodeAt(i)
  } catch {
    return null
  }
  /* The eight bytes every PNG starts with. Anything else is not one, whatever the URL claims. */
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (signature.some((b, i) => bytes[i] !== b)) return null
  const at = (o: number) => (bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]
  const width = at(16)
  const height = at(20)
  return width > 0 && height > 0 ? { width, height } : null
}

/**
 * THE MARK'S BOX ON THE RULE, in millimetres.
 *
 * IT SITS IN THE AIR ABOVE THE LINE, which is already there: a signature block reserves 10mm above
 * its rule and the comment on it says why -- "room for a pen". That is exactly the space a pen
 * would have used, so the drawing goes in it and the block's height does not change. A mark that
 * needed its own space would move every page break after it on a nine-page agreement.
 *
 * CAPPED BOTH WAYS. 10mm tall is the air it has; the rule's own width is the other bound, because
 * a wide flat signature scaled to the height alone runs off the end of the line it is signed on.
 * Whichever bites first decides, and the aspect is kept.
 */
export const MARK_MAX_MM = 10

export function markBox(signed: SignedMark, ruleWidthMm: number): { wMm: number; hMm: number } | null {
  const size = pngSize(signed.signaturePng)
  if (!size) return null
  const scale = Math.min(MARK_MAX_MM / size.height, ruleWidthMm / size.width)
  return { wMm: size.width * scale, hMm: size.height * scale }
}

/**
 * THE INITIALS' BOX, AND IT IS SMALL BECAUSE OF WHERE IT HAS TO FIT.
 *
 * They are drawn in the BOTTOM MARGIN, beside the running line, and that band is narrow: on the
 * firm's A4 letterhead the text frame ends at 273mm and the printed footer -- the phone number,
 * the company and VAT numbers -- starts at 279.8mm. Five millimetres is what sits between them
 * with clearance at both ends.
 *
 * AND THAT IS WHY THEY COST NO PAGINATION. Given their own strip inside the text frame, a signed
 * copy would break a nine-page agreement in different places from the one the debtor read; drawn
 * in the margin, every page is exactly where it was. The width cap is the text frame, which only
 * bites on initials somebody scrawled across the whole pad.
 */
export const INITIALS_MAX_MM = 5

export function initialsBox(signed: SignedMark, maxWidthMm: number): { wMm: number; hMm: number } | null {
  if (!signed.initialsPng) return null
  const size = pngSize(signed.initialsPng)
  if (!size) return null
  const scale = Math.min(INITIALS_MAX_MM / size.height, maxWidthMm / size.width)
  return { wMm: size.width * scale, hMm: size.height * scale }
}
