/**
 * KEEPING A MESSAGE SO READING IT NEEDS NO MAIL SERVER.
 *
 * THE FIRM: "doing anything on the mailbox is super slow except writing -- reading something is
 * super slow... isn't there some way we can mimic the way Outlook works to make it super fast?"
 *
 * OUTLOOK IS A CACHE, AND THAT IS THE WHOLE TRICK. It is not faster at IMAP than we are; it keeps
 * a local copy of the mailbox and reads out of that, going to the server only to find out what is
 * NEW. Raptor already has the copy -- user_emails -- and it was missing the one column that
 * mattered. Opening a message asked /api/email/attachment for its body, which opened a TLS
 * connection, logged in, selected a folder and fetched the message, every time, for every message,
 * including one read a minute before.
 *
 * AND THE BODY WAS ALREADY IN OUR HANDS AT SYNC TIME. The sync fetches each message whole
 * (`source: true`) and parses it to cut a 240-character snippet out of it. Keeping the rest costs
 * NOTHING at the mail server and nothing in parse time. The original decision -- "metadata and a
 * snippet only" -- was a storage decision, and this is the part of it that was wrong.
 *
 * WHAT STAYS TRUE. The attachments are still not stored, which is the decision that was right: at
 * this mailbox's volume they are roughly 4 GB a year of files nobody opens. The pictures drawn
 * INTO a message are not stored either -- see needsPictures.
 *
 * Pure: no database, no network. Both ends of the cache -- the sync that fills it and the browser
 * that reads it -- apply the same limits from here, because a cap written twice is two caps.
 */

/**
 * HOW MUCH OF A MESSAGE IS WORTH KEEPING.
 *
 * AT 3 750 MESSAGES A DAY the arithmetic is the whole argument. An ordinary business email is a
 * couple of kilobytes of text and twenty or thirty of markup; a marketing one is hundreds. Keeping
 * every byte of every newsletter is the one way this table becomes a problem, and a newsletter is
 * also the message nobody minds waiting two seconds for.
 *
 * TEXT IS KEPT MORE GENEROUSLY THAN MARKUP because it is what a reply quotes and what the search
 * will one day read, and because text is small: 100 kB of prose is a 15 000-word message.
 *
 * MEASURED IN CHARACTERS, not bytes, because that is what both ends can count without encoding
 * anything. Postgres then compresses what it stores -- a text column over about 2 kB is compressed
 * before it is written -- so the figures here are the raw size and not the cost.
 */
export const TEXT_LIMIT = 100_000
/* A MILLION, NOT 200 000 (10 Oct): a long reply thread with text pasted from ChatGPT carries an
   inline style on nearly every word and every quoted message under it, and passed 200 000 with
   ordinary content. The same ceiling the mailbox read uses for one text part (MAX_TEXT_PART). */
export const HTML_LIMIT = 1_000_000
/** An ICS is a few hundred lines at most. A bigger one is not a meeting request. */
export const CALENDAR_LIMIT = 50_000

export interface MailBody {
  text: string
  html: string
  calendar: string
}

/** The columns to write, or null where there is nothing worth keeping. */
export interface BodyPatch {
  body_text: string | null
  body_html: string | null
  body_calendar: string | null
  body_cached_at: string
}

/**
 * What to store for this message.
 *
 * TRUNCATION IS NOT AN OPTION. A body cut off at the cap would be a message that READS as though
 * the sender stopped mid-sentence, and the person reading it has no way to tell that from a
 * message that really did. Over the cap the part is simply not kept, `body_cached_at` still says
 * the message was looked at, and the reader falls back to the mailbox for that one -- which is
 * what every message did before this existed.
 *
 * AN EMPTY MESSAGE IS STILL A CACHED MESSAGE. A one-line reply with nothing but "ok" above the
 * quote, or a message that is only an attachment, must not be fetched again on every open just
 * because there was nothing in it the first time.
 */
export function bodyToStore(body: MailBody, at: string): BodyPatch {
  const keep = (s: string, limit: number) => {
    const t = s ?? ''
    return t.length > 0 && t.length <= limit ? t : null
  }
  /* The pictures come out BEFORE anything is measured -- see withoutEmbeddedPictures. Measured
     first, a signature logo counted against the markup limit and pushed ordinary mail out of the
     cache for the sake of a picture the cache was never going to hold. */
  body = { ...body, html: withoutEmbeddedPictures(body.html ?? '') }
  /*
   * MARKUP TOO BIG TO KEEP MEANS KEEP NO WORDS EITHER (10 Oct). Kept alone, the plain text made the
   * cache answer every later open with the flat version -- no bold, no paragraphs -- and the
   * reader never went back to the mailbox for the real message (the firm: "this email came out
   * funny in Raptor and fine in Spark"). With nothing kept, hasCachedBody is false and the message
   * is read out of the mailbox, as written, every time; slower, and right.
   */
  if ((body.html ?? '').length > HTML_LIMIT) {
    return { body_text: null, body_html: null, body_calendar: keep(body.calendar, CALENDAR_LIMIT), body_cached_at: at }
  }
  return {
    body_text: keep(body.text, TEXT_LIMIT),
    body_html: keep(body.html, HTML_LIMIT),
    body_calendar: keep(body.calendar, CALENDAR_LIMIT),
    body_cached_at: at,
  }
}

/**
 * WHAT A PICTURE TAKEN OUT ON 24 OCT WAS REPLACED WITH, before the picture store existed. Rows
 * cleaned that day still carry it; nothing writes it any more. A message that has it goes to the
 * mailbox once, and the write-back stores it again the new way -- so these heal as they are read.
 */
export const DROPPED_PICTURE = 'cid:raptor-picture-not-kept'

/**
 * WHAT A PICTURE IS REPLACED WITH NOW: a cid: naming its FINGERPRINT, the SHA-256 of its bytes.
 * The picture itself is saved once, under that fingerprint, in the mail-pictures store.
 */
export const PICTURE_PREFIX = 'cid:raptor-pic-'

/** One picture taken out of a message, to be saved once in the picture store. */
export interface StoredPicture {
  /** SHA-256 of the base64 text, hex. The same logo on a thousand messages is one hash. */
  hash: string
  contentType: string
  base64: string
}

/**
 * THE PICTURES WERE BEING KEPT ALL ALONG, and they were 96% of the database (24 Oct, S11).
 *
 * mailparser's simpleParser, by default, REWRITES every `cid:` reference into a `data:` URI
 * carrying the picture itself in base64, so by the time the sync or the read route handed
 * `parsed.html` here, the signature logo was no longer a reference to an attachment -- it was the
 * attachment, inside the markup. On staging that was 645 MB of a 710 MB database: 1 710 messages,
 * each carrying the same handful of logos again, until the disk filled and Postgres refused writes.
 *
 * AND THEN THE FIRM ASKED FOR IT THE WAY OUTLOOK DOES IT (24 Oct): "save one image somewhere and
 * then always go and check it and take it back, like Microsoft, and then delete it after 30 days".
 * So each picture is taken out of the markup, FINGERPRINTED, and saved once in Supabase Storage
 * (`mail-pictures`, see api/_lib/mailPictures.ts). The markup keeps `cid:raptor-pic-<fingerprint>`
 * where the picture was. The BF logo on two thousand messages is one 40 kB file, and opening any
 * of them reads the picture from the store -- no mail server, which is the speed the firm asked
 * for in the first place. A picture nobody has opened for 30 days is deleted; if an old message
 * is opened after that, the mailbox still has it and it is saved again.
 *
 * TAKEN OUT HERE, at the one door both ends of the cache go through, rather than at the three
 * places the parser is called: a fourth caller would bring the leak back, and a picture PASTED
 * into a message (Outlook on a phone sends those as data: URIs with no attachment behind them)
 * would never have been a cid in the first place.
 *
 * NO WHITESPACE IN THE CLASS. An unquoted src= followed by a space and `alt=` would otherwise be
 * swallowed whole -- letters and `=` are both base64 -- taking the next attribute with it.
 */
export function extractPictures(html: string): { html: string; pictures: StoredPicture[] } {
  if (!html || !/data:image\//i.test(html)) return { html, pictures: [] }
  const found = new Map<string, StoredPicture>()
  const out = html.replace(/data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]*)/gi, (_m, type: string, b64: string) => {
    const hash = sha256Hex(b64)
    if (!found.has(hash)) found.set(hash, { hash, contentType: type.toLowerCase(), base64: b64 })
    return PICTURE_PREFIX + hash
  })
  return { html: out, pictures: [...found.values()] }
}

/** The markup as it is stored: every embedded picture replaced by its fingerprint. */
export function withoutEmbeddedPictures(html: string): string {
  return extractPictures(html).html
}

/** The fingerprints a stored message draws, for the page to fetch out of the picture store. */
export function storedPictureHashes(html: string | null | undefined): string[] {
  if (!html) return []
  const re = /cid:raptor-pic-([0-9a-f]{64})/gi
  const hashes = new Set<string>()
  for (let m = re.exec(html); m; m = re.exec(html)) hashes.add(m[1].toLowerCase())
  return [...hashes]
}

/**
 * Puts the pictures a mailbox fetch handed back INTO the markup, so the write-back can fingerprint
 * them like any other. The fast read path (assembleBody) returns the markup with its original
 * `cid:image001...` references and the pictures beside it; stored like that, every later open
 * would go to the mailbox for a logo the store could have answered.
 */
export function inlinePictures(html: string, images: { cid: string; dataUri: string }[]): string {
  if (!html || images.length === 0) return html
  const byCid = new Map(images.filter((i) => i.cid && i.dataUri.startsWith('data:image/'))
    .map((i) => [i.cid.replace(/^<|>$/g, '').toLowerCase(), i.dataUri] as const))
  if (byCid.size === 0) return html
  return html.replace(/cid:([^"'\s)>]+)/gi, (whole, id: string) => byCid.get(id.toLowerCase()) ?? whole)
}

/**
 * SHA-256, written out because this file is pure and runs in both the browser and the API.
 * WebCrypto's digest is async, and bodyToStore is called inside a synchronous row builder; Node's
 * crypto is not in the browser. Hashes the base64 TEXT, which identifies the bytes just as well and
 * spares a decode. A fingerprint collision would show one sender another's logo, which is why this
 * is a real hash and not a quick checksum.
 */
export function sha256Hex(input: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  /* base64 is ASCII, so one character is one byte; anything else is UTF-8 encoded first. */
  const bytes = /^[\x00-\x7f]*$/.test(input)
    ? Uint8Array.from(input, (c) => c.charCodeAt(0))
    : new TextEncoder().encode(input)
  const bitLen = bytes.length * 8
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000))
  view.setUint32(padded.length - 4, bitLen >>> 0)
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const W = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let off = 0; off < padded.length; off += 64) {
    for (let t = 0; t < 16; t++) W[t] = view.getUint32(off + t * 4)
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3)
      const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10)
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = H
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[t] + W[t]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0
  }
  return H.map((x) => x.toString(16).padStart(8, '0')).join('')
}

/** Why a message is still read out of the mailbox, for the log the sync writes. */
export function tooBigFor(body: MailBody): string | null {
  const over: string[] = []
  if ((body.text ?? '').length > TEXT_LIMIT) over.push('text')
  if ((body.html ?? '').length > HTML_LIMIT) over.push('html')
  return over.length ? `${over.join(' and ')} over the cache limit` : null
}

export interface CachedBody {
  body_text: string | null
  body_html: string | null
  body_calendar: string | null
  body_cached_at: string | null
}

/**
 * Is there a body here to read, or does this one still need the mailbox?
 *
 * READ OFF `body_cached_at` AND NOT OFF THE TEXT. A message with nothing in it but an attachment
 * has no text and no markup, and asking "is body_text empty" would send the reader to the mail
 * server for ever on exactly the message there is nothing to fetch.
 */
export function hasCachedBody(row: CachedBody): boolean {
  if (!row.body_cached_at) return false
  /* Over the cap nothing was kept, so the row was marked and holds nothing. That one goes to the
     mailbox, which is the trade tooBigFor describes. */
  return !!(row.body_text || row.body_html || row.body_calendar)
}

/**
 * ARE THERE PICTURES DRAWN INTO THIS MESSAGE THAT THE CACHE DOES NOT HOLD?
 *
 * A signature logo is attached to the message and referenced as `cid:something` from the markup.
 * They are fetched as data: URIs -- never as links, because a remote picture in a debtor's email
 * is a tracking pixel that reports when their collector opened it -- and they are the one part of
 * a message that is genuinely big, so they are not kept.
 *
 * WHICH MAKES THIS A GMAIL-SHAPED ANSWER RATHER THAN A WAIT: the words appear at once out of the
 * cache, and the pictures arrive a moment later from the mailbox. The alternative -- waiting for
 * the whole message because a signature has a logo in it -- is the slowness this set out to fix,
 * on nearly every business email there is.
 */
export function needsPictures(html: string | null): boolean {
  return !!html && /\bsrc\s*=\s*["']?cid:/i.test(html)
}
