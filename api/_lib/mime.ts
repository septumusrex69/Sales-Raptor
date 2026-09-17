/**
 * Taking a message apart, without downloading all of it.
 *
 * WHY THIS IS ITS OWN MODULE. An IMAP server will tell you what a message is MADE of — its MIME
 * tree, with each part's type, size and encoding — for a fraction of what it costs to send you
 * the message. Everything here works off that description, so Raptor can ask for the three
 * paragraphs a collector wants to read and leave the four-megabyte scanned mandate where it is.
 *
 * That is worth the separation. The mail server is in Johannesburg and these functions run in
 * Paris: every IMAP round trip costs the better part of a fifth of a second before the server has
 * done any work, and the code this replaced spent one of those round trips carrying the ENTIRE
 * message, attachments and all, so that somebody could read three paragraphs.
 *
 * Pure and dependency-free — no IMAP, no database — so it can be tested directly against messages
 * built by hand: see scripts/qa/check-mime-parts.mjs. That is not tidiness. Getting
 * quoted-printable or a part number wrong here does not throw; it renders a debtor's email as
 * mojibake, or as nothing at all, which is the sort of bug that ships.
 */

/** One leaf of a message's MIME tree, flattened out of BODYSTRUCTURE. */
export interface MessagePart {
  /** IMAP part number — '1', '1.2' — which is what BODY[...] takes. */
  part: string
  /** Lowercased content type, e.g. 'text/html'. */
  type: string
  /** Content-Transfer-Encoding, so we can undo it: base64, quoted-printable, 7bit… */
  encoding: string
  charset?: string
  /** Size as it sits on the wire, i.e. still encoded. base64 inflates by about a third. */
  size: number
  filename?: string
  /** Content-ID without its angle brackets — how HTML refers to an embedded picture. */
  cid?: string
  disposition?: string
}

/** A picture that was part of the message body rather than attached to it. */
export interface InlineImage {
  /** The cid the HTML referred to it by, where it had one. */
  cid: string
  filename: string
  /** data: rather than a URL — see assembleBody for why that matters. */
  dataUri: string
}

export interface MessageBody {
  text: string
  html: string
  images: InlineImage[]
  /**
   * Pictures that were in the message but were left behind for being too big.
   *
   * Reported rather than swallowed. A signature that silently fails to appear is indistinguishable
   * from a message that never had one, and somebody then reports the feature as broken — which is
   * exactly what happened. If a picture is not shown, the page says so.
   */
  imagesSkipped: number
}

/** A ceiling on one text part. Prose does not run to a megabyte; a dumped log does. */
const MAX_TEXT_PART = 1024 * 1024
/** Enough for a plain/HTML alternative pair plus an inline forward or two. */
const MAX_TEXT_PARTS = 4
/*
 * Inline pictures, capped three ways.
 *
 * Below the floor is a tracking pixel or a table spacer, not a signature.
 *
 * THE CEILINGS WERE TOO MEAN. They started at 250 KB a picture and half a megabyte in total, on
 * the reasoning that no signature needs more than that. A real one does: a designed sign-off with
 * a photograph, a logo and a banner, exported at the resolution a retina screen wants, runs to
 * several hundred kilobytes an image — so the first signature this was built for was thrown away
 * by its own size limit and the message rendered blank exactly as before.
 *
 * These are set where a genuine signature always fits and a photo album still does not, and the
 * worst case stays well inside what one response can carry. It is a real trade against the speed
 * this module exists for, made deliberately: the pictures are the thing somebody asked to see.
 */
const MIN_INLINE_IMAGE = 1024
const MAX_INLINE_IMAGE = 1024 * 1024
const MAX_INLINE_IMAGE_TOTAL = 2 * 1024 * 1024
const MAX_INLINE_IMAGES = 8

/**
 * Every leaf of a message's MIME tree, in order, with its part number.
 *
 * message/rfc822 is treated as a leaf on purpose. Recursing into a forwarded .eml would pull the
 * forwarded message's own text into the body a collector reads, where it looks as though the
 * sender wrote it. It stays an attachment, which is what it is.
 */
export function flattenParts(node: unknown, out: MessagePart[] = [], depth = 0): MessagePart[] {
  const n = node as {
    part?: string; type?: string; encoding?: string; size?: number; id?: string
    disposition?: string; childNodes?: unknown[]
    parameters?: Record<string, string>; dispositionParameters?: Record<string, string>
  } | null
  if (!n || depth > 12 || out.length > 200) return out

  const type = String(n.type ?? '').toLowerCase()
  if (Array.isArray(n.childNodes) && n.childNodes.length > 0 && type !== 'message/rfc822') {
    for (const child of n.childNodes) flattenParts(child, out, depth + 1)
    return out
  }

  out.push({
    // A single-part message has no part number at its root; its body is section 1.
    part: n.part || '1',
    type,
    encoding: String(n.encoding ?? '7bit').toLowerCase(),
    charset: n.parameters?.charset,
    size: Number(n.size) || 0,
    filename: n.dispositionParameters?.filename || n.parameters?.name,
    cid: typeof n.id === 'string' ? n.id.replace(/^<|>$/g, '') : undefined,
    disposition: String(n.disposition ?? '').toLowerCase(),
  })
  return out
}

/**
 * Undo a Content-Transfer-Encoding.
 *
 * Needed because we fetch raw parts rather than handing the whole message to mailparser, which
 * was doing this for us. Only three encodings appear in practice; anything else is already bytes.
 */
export function decodeTransfer(raw: Buffer, encoding: string): Buffer {
  if (encoding === 'base64') return Buffer.from(raw.toString('ascii'), 'base64')
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(raw.toString('ascii'))
  return raw
}

/** =3D back to '=', and soft line breaks away. Fifteen lines, and it saves fetching megabytes. */
export function decodeQuotedPrintable(input: string): Buffer {
  const joined = input.replace(/=\r?\n/g, '')
  const bytes: number[] = []
  for (let i = 0; i < joined.length; i += 1) {
    const hex = joined.slice(i + 1, i + 3)
    if (joined[i] === '=' && /^[0-9a-f]{2}$/i.test(hex)) {
      bytes.push(parseInt(hex, 16))
      i += 2
    } else {
      bytes.push(joined.charCodeAt(i) & 0xff)
    }
  }
  return Buffer.from(bytes)
}

/**
 * Bytes to characters, in whatever the part says it is.
 *
 * Not academic: a good deal of South African business mail still goes out as windows-1252, and
 * reading that as UTF-8 turns every apostrophe and rand sign into a replacement character.
 */
export function toText(buf: Buffer, charset?: string): string {
  try {
    return new TextDecoder(charset || 'utf-8').decode(buf)
  } catch {
    // An unknown or misspelt charset label. UTF-8 is right far more often than not.
    return buf.toString('utf8')
  }
}

/**
 * The parts worth fetching in order to READ a message: its text, and the pictures drawn into it.
 *
 * `skippedImages` counts pictures that belong in the body but were left behind for being too
 * large, so the page can say so instead of showing a gap somebody has to guess at.
 */
export function readableParts(parts: MessagePart[]): { parts: MessagePart[]; skippedImages: number } {
  const text: MessagePart[] = []
  const images: MessagePart[] = []
  let imageBytes = 0
  let skippedImages = 0

  for (const p of parts) {
    if (p.type === 'text/plain' || p.type === 'text/html') {
      // A .txt or .html somebody genuinely attached is a file, not the message.
      if (p.disposition === 'attachment') continue
      if (p.size <= MAX_TEXT_PART && text.length < MAX_TEXT_PARTS) text.push(p)
      continue
    }
    if (!p.type.startsWith('image/')) continue
    // Either the HTML points at it by cid, or the sender's client marked it inline. Both mean the
    // picture is part of what was written, which is exactly what a signature is.
    if (!p.cid && p.disposition !== 'inline') continue
    // A spacer or a tracking pixel was never going to be looked at, so it is not "skipped".
    if (p.size < MIN_INLINE_IMAGE) continue
    if (p.size > MAX_INLINE_IMAGE
      || images.length >= MAX_INLINE_IMAGES
      || imageBytes + p.size > MAX_INLINE_IMAGE_TOTAL) {
      skippedImages += 1
      continue
    }
    imageBytes += p.size
    images.push(p)
  }

  // No text at all means the walk did not understand this message; the caller falls back.
  if (text.length === 0) return { parts: [], skippedImages: 0 }
  return { parts: [...text, ...images], skippedImages }
}

/**
 * One line describing what a message is made of, for the log.
 *
 * Types, sizes and dispositions only — never a filename, an address or a byte of content. When a
 * signature does not appear, this is the difference between reading why in ten seconds and asking
 * somebody to reproduce it.
 */
export function describeParts(parts: MessagePart[]): string {
  return parts
    .map((p) => `${p.part}:${p.type}/${p.encoding}/${p.size}b${p.cid ? '/cid' : ''}${p.disposition ? `/${p.disposition}` : ''}`)
    .join(' ')
}

/** Pull one requested part out of a fetch response, decoded. */
export function partContent(
  msg: { bodyParts?: Map<string, Buffer>; binaryParts?: Set<string> } | false | undefined,
  p: MessagePart,
): Buffer | null {
  if (!msg || !msg.bodyParts) return null
  const raw = msg.bodyParts.get(p.part)
    ?? msg.bodyParts.get(p.part.toLowerCase())
    ?? msg.bodyParts.get(p.part.toUpperCase())
  if (!raw) return null
  // A part the server sent via FETCH BINARY is already decoded; decoding twice would corrupt it.
  return msg.binaryParts?.has(p.part) ? raw : decodeTransfer(raw, p.encoding)
}

/**
 * Turn the fetched parts into a readable message, or null if none of them arrived.
 *
 * PICTURES COME BACK AS data: URIs, and that is a deliberate choice rather than a convenience.
 * A signature is routinely one image, and showing it means its bytes have to reach the browser
 * somehow. Serving them inline means the browser never makes a request to anybody else's server
 * — so a remote image cannot report back that this mail was opened, by whom, or when, which is
 * precisely what a tracking pixel in a debtor's email is for.
 */
export function assembleBody(
  wanted: MessagePart[],
  msg: { bodyParts?: Map<string, Buffer>; binaryParts?: Set<string> } | false | undefined,
  skippedImages = 0,
): MessageBody | null {
  const texts: string[] = []
  const htmls: string[] = []
  const images: InlineImage[] = []

  for (const p of wanted) {
    const content = partContent(msg, p)
    if (!content) continue
    if (p.type === 'text/plain') texts.push(toText(content, p.charset))
    else if (p.type === 'text/html') htmls.push(toText(content, p.charset))
    else {
      images.push({
        cid: p.cid ?? '',
        filename: p.filename ?? '',
        dataUri: `data:${p.type};base64,${content.toString('base64')}`,
      })
    }
  }

  if (texts.length === 0 && htmls.length === 0) return null
  const html = htmls.join('\n')
  return {
    text: plainText(texts.join('\n\n').trim() || undefined, html),
    html,
    images,
    // A picture we asked for and did not get counts as skipped too — the gap is the same to
    // whoever is reading it.
    imagesSkipped: skippedImages + (wanted.filter((p) => p.type.startsWith('image/')).length - images.length),
  }
}

/** The same inline-picture rule, applied to what mailparser gives the whole-message fallback. */
export function inlineImagesFromParsed(
  attachments: {
    filename?: string; cid?: string; contentType?: string; contentDisposition?: string
    content?: unknown
  }[] | undefined,
): { images: InlineImage[]; skippedImages: number } {
  const images: InlineImage[] = []
  let bytes = 0
  let skippedImages = 0
  for (const att of attachments ?? []) {
    const type = (att.contentType ?? '').toLowerCase()
    if (!type.startsWith('image/')) continue
    if (!att.cid && att.contentDisposition !== 'inline') continue
    const content = att.content as Buffer | undefined
    if (!Buffer.isBuffer(content)) continue
    if (content.length < MIN_INLINE_IMAGE) continue
    if (content.length > MAX_INLINE_IMAGE
      || images.length >= MAX_INLINE_IMAGES
      || bytes + content.length > MAX_INLINE_IMAGE_TOTAL) {
      skippedImages += 1
      continue
    }
    bytes += content.length
    images.push({
      cid: att.cid ?? '',
      filename: att.filename ?? '',
      dataUri: `data:${type};base64,${content.toString('base64')}`,
    })
  }
  return { images, skippedImages }
}

/**
 * Readable text for a message, whatever parts it carries.
 *
 * Most mail has a plain-text alternative and that is used as-is. Marketing mail and a good deal
 * of Outlook often does not, so the HTML is reduced rather than shown as tags: scripts and
 * styles dropped entirely, block boundaries turned into line breaks, entities decoded. Crude on
 * purpose — the job is "can a collector read what the debtor said", not faithful rendering, and
 * putting a debtor's HTML into the page would mean sanitising someone else's markup.
 */
export function plainText(text: string | undefined, html: string | false | undefined): string {
  if (text && text.trim()) return text
  if (!html) return ''
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* ------------------------------------------------------------------ *
 * Attachments that arrive with no filename.
 * ------------------------------------------------------------------ */

/**
 * Which of a message's attachments are worth listing.
 *
 * ONE RULE, EXPORTED, because two sides read it: the sync names them and the download route has
 * to find the same one again. Written out twice they drift, and the drift is silent -- see
 * placeholderIndex.
 *
 * `related` parts are the pictures drawn into the body (a signature logo), not files somebody
 * attached; an unnamed image with no filename is the remaining tracking-pixel shape.
 */
export function listedAttachments<T extends {
  filename?: string; related?: boolean; contentDisposition?: string; contentType?: string
}>(attachments: T[] | undefined): T[] {
  return (attachments ?? []).filter(
    (att) => !att.related && !(!att.filename && (att.contentType ?? '').startsWith('image/')),
  )
}

/**
 * The name an unnamed attachment is listed under.
 *
 * A calendar invite is the common case: the .ics part carries no filename parameter at all, so
 * there is nothing to call it but its position.
 */
export const placeholderName = (index: number): string => `attachment-${index + 1}`

/**
 * Read that position back, or null where the name is a real filename.
 *
 * THE BUG THIS EXISTS TO CLOSE. The sync named an unnamed part "attachment-1" and the download
 * route looked for a part whose filename EQUALLED "attachment-1" -- in the structure walk and in
 * the mailparser fallback both. Nothing is ever called that, so every unnamed attachment was
 * listed on the message and returned 404 on every attempt, for ever. A calendar invite is the
 * shape that made it visible, but it was never about calendars.
 */
export function placeholderIndex(name: string): number | null {
  const m = /^attachment-(\d+)$/.exec(name)
  if (!m) return null
  const n = Number(m[1]) - 1
  return n >= 0 ? n : null
}
