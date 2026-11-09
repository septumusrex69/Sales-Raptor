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

/*
 * The block itself, and the function that puts it under the body, live in src/lib/emailSignature.ts so the
 * compose box can draw exactly what goes out (S21 · Raptor H19). Re-exported, so every sender is unchanged.
 */
export { SIGNATURE_CID, composeBody, signatureHtml, type SignatureImage } from '../../src/lib/emailSignature.js'

/**
 * The image bytes, or null if they cannot be had.
 *
 * Null is not a failure worth reporting: the caller falls back to linking the image, which is
 * what it did before and is still better than dropping the signature. A send must not fail
 * because a picture was slow.
 */
/**
 * ONLY THE FIRM'S OWN STORAGE IS FETCHED (security audit C-04, 5 Oct; built 18 Oct).
 *
 * The URL is whatever a person saved on their profile, and this runs on the SERVER, so an unchecked
 * fetch is a door into whatever the server can reach (a metadata address, an internal service) --
 * server-side request forgery. A signature image only ever comes from the email-signatures bucket,
 * so the rule is narrow rather than a deny-list of private ranges that has to be complete to work:
 * https, on a Supabase host (the project's own or any *.supabase.co), no credentials in the URL, no
 * port. Anything else is not fetched and the caller links the image instead, as it does when a fetch
 * fails. Redirects are refused too, or an allowed host could hand the request on somewhere that is not.
 */
export function isFetchableSignatureUrl(url: string, projectUrl = process.env.VITE_SUPABASE_URL ?? ''): boolean {
  let u: URL
  try { u = new URL(url) } catch { return false }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false
  const host = u.hostname.toLowerCase()
  let own = ''
  try { own = projectUrl ? new URL(projectUrl).hostname.toLowerCase() : '' } catch { own = '' }
  return host === own || /^[a-z0-9-]+\.supabase\.co$/.test(host)
}

export async function fetchSignatureImage(
  url: string,
): Promise<{ content: Buffer; contentType: string } | null> {
  if (!isFetchableSignatureUrl(url)) return null
  try {
    // Bounded, because this sits in the path of every send and the storage host is not ours to
    // rely on.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(url, { signal: controller.signal, redirect: 'error' })
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
