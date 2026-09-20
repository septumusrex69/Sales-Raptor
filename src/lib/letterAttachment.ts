/**
 * A letter, as the PDF that travels with an email.
 *
 * WHY THIS IS A FUNCTION AND NOT A COMPONENT. The firm asked for the library to be reachable from
 * inside an account — "everything that we have in the library, to be in the account as well as an
 * option" — and an email template in that library can CARRY a letter (`attachment_id`). So two
 * different screens now need to turn a letter into bytes: the "Attach a letter" picker, where
 * somebody chooses one, and the template picker, where choosing the covering email has to bring
 * its letter with it. Written twice they would drift, and the drift would be silent: both would
 * produce a PDF, and only one of them would be the letter the firm approved.
 *
 * THE BYTES ARE NOT SAVED ANYWHERE, at the firm's instruction: "the PDF doesn't necessarily need
 * to be saved to Raptor." They are made here, handed to the composer, and gone when it closes.
 * What survives is the email and the record of which template went out — smaller than the PDF,
 * and the thing somebody asking "what did we send them?" actually wants, because it can be
 * regenerated against the same account.
 */
import { defaultOf, fetchLetterheads, type Letterhead } from './letterheads'
import { A4_LETTERHEAD, canUseLetter, letterProblems, parseLetter } from './letterDocument.ts'
import { letterFilename, letterToPdf, toBase64 } from './letterPdf.ts'
import type { LibraryTemplate } from './templateLibrary.ts'

export interface AttachedFile {
  filename: string
  contentType: string
  size: number
  /** base64, because it travels in the same JSON body as the message. */
  content: string
}

/**
 * Turn one letter template into an attachable PDF.
 *
 * THROWS RATHER THAN RETURNING NULL, and the message is the one to show. Every failure here is
 * something the person has to know about before they press send: a letter that will not parse, a
 * letter asking for a field nothing on this account can fill. Silently attaching nothing would
 * send a covering email that says "please find attached" and attaches nothing.
 */
export async function buildLetterAttachment({ template, values, reference, letterhead }: {
  template: LibraryTemplate
  /** Merge values resolved against the account. See mergeValuesFor. */
  values: Record<string, string>
  /** What the debtor knows the account by. Goes in the filename, not in the letter. */
  reference: string | null
  /**
   * The paper, where the caller already has it. Fetched here when it does not — so a caller with
   * one letterhead in hand does not pay for the round trip twice.
   */
  letterhead?: Letterhead | null
}): Promise<AttachedFile> {
  const doc = parseLetter(template.body)
  if (!doc) throw new Error(`${template.name} could not be read back, so nothing was attached.`)

  /*
   * REFUSED BEFORE IT IS DRAWN, not after. canUseLetter is what says a letter's merge fields can
   * all be filled from this side; a notice that posts "{{firm_bank}}" over a director's name is
   * a defective statutory demand, and the cost of catching it is one sentence on screen.
   */
  const problems = letterProblems(doc, template.scope)
  if (!canUseLetter(problems)) {
    /* The reason, not a shrug. "It could not be attached" sends somebody hunting; naming the
       field they have to go and fill in tells them where to go. */
    const why = problems.find((p) => p.level === 'refuse')?.message ?? 'it is not fit to send'
    throw new Error(`${template.name} was not attached: ${why}`)
  }

  const head = letterhead !== undefined ? letterhead : defaultOf(await fetchLetterheads())

  /*
   * THE LETTERHEAD IS FETCHED AS BYTES, not pointed at. A PDF embeds its images; a URL in a PDF
   * is a picture that is only there while the reader is online, which a posted notice cannot rely
   * on and an emailed one should not.
   */
  let image: { bytes: Uint8Array; type: 'png' | 'jpg' } | null = null
  if (head) {
    const res = await fetch(head.url)
    if (res.ok) {
      image = {
        bytes: new Uint8Array(await res.arrayBuffer()),
        type: /\.jpe?g($|\?)/i.test(head.url) ? 'jpg' : 'png',
      }
    }
  }

  const bytes = await letterToPdf({
    doc,
    page: head?.page ?? A4_LETTERHEAD,
    /* Always filled. A notice posted with {{balance}} in it is not a notice. */
    filled: true,
    values,
    letterhead: image,
  })
  return {
    filename: letterFilename(template.name, reference),
    contentType: 'application/pdf',
    size: bytes.length,
    content: toBase64(bytes),
  }
}
