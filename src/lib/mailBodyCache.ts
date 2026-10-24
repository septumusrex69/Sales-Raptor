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
 * WHAT A KEPT PICTURE IS REPLACED WITH: a cid: reference, which is exactly what the message had
 * before the parser rewrote it, and exactly what needsPictures already reads as "go to the
 * mailbox for the pictures". Named so nobody mistakes it for a Content-ID the sender wrote.
 */
export const DROPPED_PICTURE = 'cid:raptor-picture-not-kept'

/**
 * THE PICTURES WERE BEING KEPT ALL ALONG, and they were 96% of the database (24 Oct, S11).
 *
 * The note at the top of this file says the pictures drawn into a message are not stored. They
 * were. mailparser's simpleParser, by default, REWRITES every `cid:` reference into a `data:`
 * URI carrying the picture itself in base64, so by the time the sync or the read route handed
 * `parsed.html` here, the signature logo was no longer a reference to an attachment -- it was the
 * attachment, inside the markup. needsPictures then found no `cid:` and said nothing was missing.
 * On staging that was 645 MB of a 710 MB database: 1 710 messages, each carrying the same handful
 * of logos again, until the disk filled and Postgres refused writes.
 *
 * SO THEY ARE TAKEN OUT HERE, at the one door both ends of the cache go through, rather than at
 * the three places the parser is called: a fourth caller would bring the leak back, and a
 * picture PASTED into a message (Outlook on a phone sends those as data: URIs with no
 * attachment behind them) would never have been a cid in the first place.
 *
 * THE WORDS STILL OPEN AT ONCE. What replaces each picture is a cid:, which needsPictures reads,
 * so the page shows the message out of the cache and then fetches it from the mailbox for the
 * pictures -- the Gmail-shaped trade this file already chose, now actually in force.
 *
 * Small pictures are not spared. The bloat was never one big image; it was a 40 kB logo on
 * every message a firm sends, which is the case a size threshold keeps.
 *
 * AND THE PARSER IS ALSO TOLD NOT TO DO IT (S11, the other half, merged the same day): the sync and
 * the fallback read pass `keepCidLinks: true`, so a cid: picture stays the sender's own Content-ID
 * and the reader can match it to the attachment. This door is what catches everything else.
 */
export function withoutEmbeddedPictures(html: string): string {
  if (!html || !/data:image\//i.test(html)) return html
  /* NO WHITESPACE IN THE CLASS. An unquoted src= followed by a space and `alt=` would otherwise be
     swallowed whole -- letters and `=` are both base64 -- taking the next attribute with it. */
  return html.replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]*/gi, DROPPED_PICTURE)
}

/** Why a message is still read out of the mailbox, for the log the sync writes. */
export function tooBigFor(body: MailBody): string | null {
  const over: string[] = []
  if ((body.text ?? '').length > TEXT_LIMIT) over.push('text')
  if (withoutEmbeddedPictures(body.html ?? '').length > HTML_LIMIT) over.push('html')
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
