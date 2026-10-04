/**
 * THE SIGNED AGREEMENT, AS A PDF ON THE FIRM'S LETTERHEAD.
 *
 * THE FIRM, having watched a debtor sign one: "it saves now, but it saves like the online version.
 * It doesn't save a PDF. It should save a PDF and send a PDF to the debtor and save it on the
 * document." Opening the filed row took a collector to /sign/<token> -- the page the debtor signed
 * on. That is a web page, not an instrument: it cannot be posted to an attorney, attached to a
 * summons or kept once the deployment it lives on is gone.
 *
 * ------------------------------------------------------------------------------------------------
 * WHY THE FIRM'S BROWSER DRAWS IT AND NOT THE SIGNER'S
 * ------------------------------------------------------------------------------------------------
 *
 * The signer is anonymous. The anon role has no rights on the storage bucket or on
 * account_documents -- deliberately, and signingRules.ts says why: a browser that could write a
 * document row onto an account could write anything onto any account. So the database files the
 * ROW the moment the state becomes 'signed' (signing_file_signed), with no file behind it, and the
 * first authenticated person to open it draws the PDF and points the row at it.
 *
 * ONCE, AND THEN NEVER AGAIN. account_documents_file_signed only permits an update while the path
 * is still the placeholder, so the bytes a court would be shown are written once and frozen. That
 * is the half that matters: a signed agreement redrawn months later by a changed renderer is not
 * the document that was signed, and "we regenerate it on demand" is the whole of a defence.
 *
 * NOTHING IS CHARGED HERE. Item 4(a) was raised the moment the acknowledgement was ISSUED -- see
 * chargeAcknowledgementOfDebt -- and item 6 is raised by openDocument for the reading. Filing the
 * bytes is neither; it is the same document arriving in a form that can be kept.
 */
import { supabase } from './supabase'
import { A4_LETTERHEAD, blankLetter, type LetterDocument } from './letterDocument.ts'
import { letterToPdf, letterFilename } from './letterPdf.ts'
import { fetchCharter, isCharter } from './charter.ts'
import { withFilled } from './signingBlanks.ts'
import { openSigningRequest } from './signing.ts'
import type { SignedMark } from './signedMark.ts'

const BUCKET = 'account-documents'

/** Where a row that has not been drawn yet points. The trigger writes it; this is the only reader. */
export const PLACEHOLDER = 'signing/'

export function tokenOfPlaceholder(storagePath: string): string | null {
  return storagePath.startsWith(PLACEHOLDER) ? storagePath.slice(PLACEHOLDER.length) : null
}

/**
 * Draw one, from the request alone.
 *
 * EVERYTHING IT NEEDS IS FROZEN ON THE REQUEST: the blocks as they were when the link was made,
 * the sheet they were drawn on, what the signer typed into the blanks, their mark and their name.
 * Nothing is re-merged against the account -- see signingRules.ts on why the body is a copy and
 * not a pointer. An agreement that re-read today's balance would show a court a different figure
 * from the one the debtor agreed to.
 *
 * AND IT IS NOT REFUSED FOR A MERGE PROBLEM. letterPdfBytes checks letterProblems before drawing,
 * which is right for a notice going OUT; this is a document that has already been signed, and
 * refusing to produce a copy of it would leave the firm with nothing.
 */
export async function drawSignedCopy(token: string): Promise<{
  bytes: Uint8Array
  filename: string
  title: string
} | null> {
  const request = await openSigningRequest(token)
  if (!request || request.state !== 'signed') return null

  const doc: LetterDocument = { ...blankLetter(), blocks: request.body }
  /* Plain A4 where nothing was frozen -- a request made before the sheet travelled with the
     document. The right width and the right margins is not the firm's letterhead, but it is a
     document rather than a wall of text at browser width. */
  const page = request.pageSetup ?? A4_LETTERHEAD

  /*
   * THE LETTERHEAD AS BYTES, not pointed at -- a PDF embeds its images, and a URL in one is a
   * letterhead that is only there while the reader is online. The address is the one frozen onto
   * the request, so the copy carries the paper the debtor was shown rather than whichever
   * letterhead happens to be the default today.
   */
  let letterhead: { bytes: Uint8Array; type: 'png' | 'jpg' } | null = null
  if (page.backgroundUrl) {
    try {
      const res = await fetch(page.backgroundUrl)
      if (res.ok) {
        letterhead = {
          bytes: new Uint8Array(await res.arrayBuffer()),
          type: /\.jpe?g($|\?)/i.test(page.backgroundUrl) ? 'jpg' : 'png',
        }
      }
    } catch {
      /* Plain paper rather than no document. A signed agreement on white paper is still the
         agreement; a signed agreement that would not draw is nothing. */
    }
  }
  const charter = isCharter(doc.defaults.font) ? await fetchCharter() : null

  const signed: SignedMark | null = request.signaturePng && request.signedName && request.signedAt
    ? {
      signaturePng: request.signaturePng,
      name: request.signedName,
      signedAt: request.signedAt,
    }
    : null

  const bytes = await letterToPdf({
    doc,
    page,
    filled: true,
    /* The blanks the signer filled in, merged the same way the page they signed merged them --
       withFilled is the one place that decision is made, so the copy and the screen agree. */
    values: withFilled({}, request.blanks, request.filled),
    letterhead,
    charter,
    signed,
  })
  return {
    bytes,
    /* The signer's own name is the reference on the file, because that is what somebody looking
       for a signed agreement in a folder of them searches for. */
    filename: letterFilename(`${request.title} signed`, request.signedName),
    title: request.title,
  }
}

/**
 * Draw it and put it where the row points.
 *
 * RETURNS THE PATH, so the caller can sign a URL for it straight away. Null where there is nothing
 * to draw -- a request that is no longer signed, a token that opens nothing -- and the caller then
 * falls back on the signing page, which is what it had before.
 *
 * THE FILE FIRST, THEN THE ROW, the same order uploadDocument uses and for the same reason: a row
 * pointing at a file that failed to upload is a broken link in the list, and a file with no row is
 * invisible clutter in a bucket. The first is the one somebody trips over.
 */
export async function fileSignedCopy(input: {
  documentId: string
  accountId: string
  storagePath: string
}): Promise<string | null> {
  const token = tokenOfPlaceholder(input.storagePath)
  if (!token) return input.storagePath

  const drawn = await drawSignedCopy(token)
  if (!drawn) return null

  const path = `${input.accountId}/${crypto.randomUUID()}-${drawn.filename}`
  const up = await supabase.storage.from(BUCKET).upload(
    path,
    new Blob([new Uint8Array(drawn.bytes)], { type: 'application/pdf' }),
    { contentType: 'application/pdf', upsert: false },
  )
  if (up.error) throw new Error(up.error.message)

  const { error } = await supabase
    .from('account_documents')
    .update({
      storage_path: path,
      mime_type: 'application/pdf',
      size_bytes: drawn.bytes.length,
    })
    .eq('id', input.documentId)
  if (error) {
    /* The row kept the placeholder, so the file is an orphan. Remove it rather than leave a
       private bucket filling with PDFs nothing points at; the next open draws it again. */
    await supabase.storage.from(BUCKET).remove([path])
    throw new Error(error.message)
  }
  return path
}
