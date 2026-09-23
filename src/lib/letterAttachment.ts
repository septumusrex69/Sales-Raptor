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
import {
  A4_LETTERHEAD, canUseLetter, letterProblems, parseLetter, type LetterDocument,
} from './letterDocument.ts'
import type { TemplateScope } from './messageTemplates'
import { letterFilename, letterToPdf, toBase64 } from './letterPdf.ts'
import { fetchCharter, isCharter } from './charter.ts'
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
/**
 * The PDF bytes for a letter, letterhead and all.
 *
 * SEPARATE FROM THE ATTACHMENT because a letter is now drawn for two different reasons. One is to
 * send it. The other is to LOOK at it: the firm asked for "an option to preview what the PDF
 * would look like... once you've done everything, just a preview" — and that has to work on a
 * draft in the editor that has never been saved, so it cannot take a template row.
 *
 * TAKES A DOCUMENT, NOT A TEMPLATE, for exactly that reason.
 */
export async function letterPdfBytes({ doc, scope, values, filled, letterhead, name }: {
  doc: LetterDocument
  scope: TemplateScope
  values: Record<string, string>
  /**
   * Whether the merge fields are filled in.
   *
   * FALSE IS FOR LOOKING AT, TRUE IS FOR SENDING. A preview of the wording wants to show
   * {{balance}} standing so somebody can see which words are the template's; a notice going to a
   * debtor with {{balance}} in it is not a notice.
   */
  filled: boolean
  letterhead?: Letterhead | null
  /** Only for the message when it is refused, so it names the letter. */
  name?: string
}): Promise<Uint8Array> {
  /*
   * REFUSED BEFORE IT IS DRAWN, not after. canUseLetter is what says a letter's merge fields can
   * all be filled from this side; a notice that posts "{{firm_bank}}" over a director's name is
   * a defective statutory demand, and the cost of catching it is one sentence on screen.
   *
   * ONLY WHEN IT IS BEING SENT. An unfilled preview is somebody looking at their own wording, and
   * refusing to show it because a field is not yet fillable would be refusing to show them the
   * thing they are trying to fix.
   */
  if (filled) {
    const problems = letterProblems(doc, scope)
    if (!canUseLetter(problems)) {
      const why = problems.find((p) => p.level === 'refuse')?.message ?? 'it is not fit to send'
      throw new Error(`${name ?? 'That letter'} was not attached: ${why}`)
    }
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

  /*
   * AND SO IS THE FONT, when the letter is set in Charter -- same reason as the letterhead, plus
   * one of its own: letterPdf has to stay runnable in a check with no network, so anything it
   * needs off the wire is fetched out here. Only for a Charter letter; everything else draws in
   * the fourteen faces every reader already has and fetches nothing.
   */
  const charter = isCharter(doc.defaults.font) ? await fetchCharter() : null

  return letterToPdf({
    doc,
    page: head?.page ?? A4_LETTERHEAD,
    filled,
    values,
    letterhead: image,
    charter,
  })
}

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

  const bytes = await letterPdfBytes({
    doc,
    scope: template.scope,
    values,
    /* Always filled. A notice posted with {{balance}} in it is not a notice. */
    filled: true,
    letterhead,
    name: template.name,
  })
  return {
    filename: letterFilename(template.name, reference),
    contentType: 'application/pdf',
    size: bytes.length,
    content: toBase64(bytes),
  }
}
