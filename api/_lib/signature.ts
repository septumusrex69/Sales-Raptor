/**
 * The signature block, and why the image is attached rather than linked.
 *
 * A signature image referenced by URL is a remote image, and Outlook, Gmail and Apple Mail all
 * refuse to load those until the reader asks — that is what "Outlook prevented automatic download
 * of some pictures" means. So the one thing in the message carrying the sender's face, phone
 * number and branding arrives as a grey box with a red cross in it, on every first email to
 * somebody new. Which is exactly the email where it matters.
 *
 * An image embedded in the message is not a remote fetch, so none of that applies: the client
 * already has the bytes and simply draws them. That is what cid: means — the img points at a part
 * of this message rather than at a web server.
 *
 * The other reason to embed: a linked image tells us when the reader opened the mail, because
 * their client has to come and fetch it. Debt collection correspondence should not carry a
 * tracking pixel by accident.
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

/** Body and signature, with the two blank lines a person expects between them. */
export function composeBody(bodyHtml: string, signature: string): string {
  return signature ? `${bodyHtml}<br><br>${signature}` : bodyHtml
}

/**
 * The image bytes, or null if they cannot be had.
 *
 * Null is not a failure worth reporting: the caller falls back to linking the image, which is
 * what it did before and is still better than dropping the signature. A send must not fail
 * because a picture was slow.
 */
export async function fetchSignatureImage(
  url: string,
): Promise<{ content: Buffer; contentType: string } | null> {
  try {
    // Bounded, because this sits in the path of every send and the storage host is not ours to
    // rely on.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null

    const buf = Buffer.from(await res.arrayBuffer())
    // A signature is a letterhead, not a photo album. Anything past this is somebody's mistake
    // and would bloat every message they ever send.
    if (buf.length === 0 || buf.length > 2 * 1024 * 1024) return null

    const header = res.headers.get('content-type')?.split(';')[0]?.trim()
    const contentType = header?.startsWith('image/') ? header : contentTypeFromUrl(url)
    return contentType ? { content: buf, contentType } : null
  } catch {
    return null
  }
}

function contentTypeFromUrl(url: string): string | null {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'svg': return 'image/svg+xml'
    default: return null
  }
}
