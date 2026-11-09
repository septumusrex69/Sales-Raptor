/**
 * THE SIGNATURE BLOCK, SHARED BY THE SEND AND THE SCREEN (S21 · Raptor H19).
 *
 * Moved here out of api/_lib/signature.ts, which re-exports it unchanged, because the compose box now SHOWS the
 * signature under the message (Stephan, 5 Nov: "show me the email signature that I uploaded ... how it will look
 * relative to the text"). A preview written a second time is a preview of what somebody thinks the send does; one
 * function is what the send does. Pure: no fetch, no Buffer, no process -- the browser bundles it.
 *
 * Why the image travels inside the message rather than as a link is said in api/_lib/signature.ts.
 */

export interface SignatureImage {
  width: number
  align: 'left' | 'center' | 'right'
}

/** The identifier the html and the attachment agree on. Local to one message. */
export const SIGNATURE_CID = 'raptor-signature'

/**
 * The signature as html.
 *
 * `imageSrc` is whatever the image should point at: "cid:raptor-signature" when it could be
 * embedded, the original URL when it could not. A signature that half-loads is better than a
 * message that goes out without one.
 */
export function signatureHtml(
  text: string | null | undefined,
  image: SignatureImage | null,
  imageSrc: string | null,
): string {
  let html = ''
  if (text) html += text.replace(/\n/g, '<br>')
  if (image && imageSrc) {
    const margin = image.align === 'right' ? 'margin:8px 0 0 auto'
      : image.align === 'center' ? 'margin:8px auto 0'
      : 'margin:8px 0 0 0'
    // alt carries something, because a signature image holds the sender's name and numbers. An
    // empty alt says "this picture means nothing", which is true of a divider and false here.
    html += `<img src="${imageSrc}" width="${image.width}" style="display:block;max-width:100%;${margin}" alt="Email signature" />`
  }
  return html
}

/**
 * Body and signature, with the two blank lines a person expects between them — and the firm's
 * font around the pair of them.
 *
 * AT THE FIRM'S QUESTION: "which font is it put into the emails?" Until `style` existed the
 * answer was NONE. This function concatenated two strings of HTML and `send.ts` handed the result
 * to nodemailer, so the message went out unstyled and every reader's mail client picked its own
 * default — Gmail draws unstyled HTML in Arial, Outlook in Calibri, Apple Mail in Helvetica. The
 * firm's letters are Georgia and its emails were whatever the reader happened to run.
 *
 * AN INLINE STYLE ON A WRAPPER, not a <style> block, because Gmail strips <head> and every
 * stylesheet in it before it draws anything. An inline style on a containing element is the only
 * thing every mail client honours, which is why every newsletter in the world is built this way.
 *
 * THE SIGNATURE IS INSIDE THE WRAPPER, deliberately. Styling only the body would leave the
 * sender's name and numbers in the reader's default face — the two halves of one message set in
 * two different fonts, which looks like a fault rather than a choice.
 *
 * Empty `style` leaves the HTML exactly as it was. A send must never fail, or change shape, over
 * a font.
 */
export function composeBody(bodyHtml: string, signature: string, style?: string | null): string {
  const joined = signature ? `${bodyHtml}<br><br>${signature}` : bodyHtml
  return style ? `<div style="${style}">${joined}</div>` : joined
}

