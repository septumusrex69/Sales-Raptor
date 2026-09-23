import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '../crypto.js'
import { openSentAppender } from '../emailSync.js'
import { SIGNATURE_CID, composeBody, fetchSignatureImage, signatureHtml } from '../signature.js'

/**
 * SEND ONE EMAIL THROUGH ONE PERSON'S CONNECTED MAILBOX.
 *
 * Lifted out of the /api/email/send handler unchanged, for the reason CLAUDE.md gives about the
 * clause builder: the workflow runner sends the SAME templates through the SAME mailboxes with
 * nobody watching, and written twice the two would drift. The one that drifted would be the
 * unattended one -- the firm would find out from a debtor.
 *
 * TAKES A USER ID RATHER THAN A REQUEST. That is the whole difference between the two callers:
 * the handler resolves the sender from a session, and the runner resolves it from the account the
 * step belongs to. Everything below this line is the same either way.
 *
 * NOT A SESSION CHECK. Whoever calls this has already decided that this user may send; it holds
 * no opinion about that, and must not be reached from anything that has not.
 */
export interface OutgoingEmail {
  to: string
  subject: string
  bodyHtml: string
  cc?: string | null
  inReplyTo?: string | null
  /** An iTIP reply to a meeting request, as a whole ICS file. See the handler for why. */
  calendarReply?: string | null
  /** Files travelling with the message. Already decoded; the caller owns the size limit. */
  attachments?: { filename: string; content: Buffer; contentType: string }[]
}

export type SendResult =
  | { ok: true; messageId: string | null; from: string }
  | { ok: false; error: string }

export async function sendAsUser(
  admin: SupabaseClient, userId: string, message: OutgoingEmail,
): Promise<SendResult> {
  /*
   * ALL THREE LOOKUPS AT ONCE. They are independent round trips to the same database, and run one
   * after the other they were the first three of five waits a person sat through before the
   * message even started going out.
   */
  const [{ data: conn }, { data: profile }, { data: firm }] = await Promise.all([
    admin.from('email_connections').select('*').eq('user_id', userId).maybeSingle(),
    admin
      .from('profiles')
      .select('email_signature, email_signature_image_url, email_signature_image_width, email_signature_image_align')
      .eq('id', userId)
      .maybeSingle(),
    admin.from('firm_settings').select('email_font, email_size_pt').maybeSingle(),
  ])
  if (!conn) {
    return { ok: false, error: 'Connect your email account in Settings before sending email.' }
  }

  const signatureText = profile?.email_signature as string | null | undefined
  const signatureImageUrl = profile?.email_signature_image_url as string | null | undefined
  const signatureImageWidth = (profile?.email_signature_image_width as number | null | undefined) ?? 160
  const signatureImageAlign = (profile?.email_signature_image_align as 'left' | 'center' | 'right' | null | undefined) ?? 'left'

  /*
   * The signature image travels INSIDE the message.
   *
   * Linked from a URL it is a remote image, which Outlook and Gmail refuse to load until the
   * reader asks -- so the block carrying the sender's face, numbers and branding shows up as a
   * grey box on every first email to somebody new. Fetched here and attached, the client already
   * has the bytes and just draws them.
   *
   * If the fetch fails the message still goes, with the image linked as before. A picture is not
   * worth failing a send over.
   */
  const image = signatureImageUrl ? { width: signatureImageWidth, align: signatureImageAlign } : null
  const embedded = signatureImageUrl ? await fetchSignatureImage(signatureImageUrl) : null
  const imageSrc = signatureImageUrl ? (embedded ? `cid:${SIGNATURE_CID}` : signatureImageUrl) : null

  /*
   * The signature image and the sender's own files, in one list.
   *
   * The signature carries a cid and is referenced from the HTML, so it renders inline; the others
   * carry none and land as attachments. Same array, different role, which is how nodemailer tells
   * them apart -- and why the signature must not be dropped when somebody attaches something.
   */
  const attachments = [
    ...(embedded
      ? [{ filename: 'signature', content: embedded.content, contentType: embedded.contentType, cid: SIGNATURE_CID }]
      : []),
    ...(message.attachments ?? []),
  ]

  /*
   * THE FIRM'S FONT, AROUND THE WHOLE MESSAGE.
   *
   * Number() on the size because numeric(4,1) comes back from PostgREST as the STRING "10.5" --
   * the silent-drop trap CLAUDE.md names. Concatenated into a CSS font-size it reads correctly,
   * which is exactly why nobody would notice it was not a number.
   *
   * Falls back to nothing rather than to a guess: if the row cannot be read, the message goes out
   * the way it always did instead of in a face nobody chose.
   */
  const emailStyle = firm?.email_font
    ? `font-family:${firm.email_font as string};`
      + `font-size:${Number(firm.email_size_pt ?? 10.5)}pt;line-height:1.5;color:#1f2937`
    : null
  const fullHtml = composeBody(message.bodyHtml, signatureHtml(signatureText, image, imageSrc), emailStyle)

  /* Built once and used for both the outgoing message and the Sent copy, so what the recipient
     got and what the sender can see afterwards are the same bytes. */
  const ical = message.calendarReply
    ? { icalEvent: { method: 'REPLY', filename: 'invite.ics', content: message.calendarReply } }
    : {}
  const envelope = {
    from: conn.email as string,
    to: message.to,
    subject: message.subject,
    html: fullHtml,
    attachments,
    ...ical,
    /* BOTH PLACES, or the Sent copy shows a message that reached fewer people than it did.
       Absent rather than empty: nodemailer accepts an empty Cc and mail servers vary. */
    ...(message.cc && message.cc.trim() ? { cc: message.cc } : {}),
    ...(message.inReplyTo ? { inReplyTo: message.inReplyTo, references: [message.inReplyTo] } : {}),
  }

  /*
   * The mailbox this copy will be filed in, opened WHILE the message is going out.
   *
   * The two talk to different servers, so the IMAP connect, TLS handshake, login and mailbox list
   * happen for free inside the time SMTP is already taking. Started before the try below rather
   * than inside it because a mailbox that will not open must not fail the send -- the message
   * still goes, and the Sent copy is what is lost.
   */
  const appenderSoon = openSentAppender({
    email: conn.email as string,
    imap_host: conn.imap_host as string,
    imap_port: conn.imap_port as number,
    encrypted_password: conn.encrypted_password as string,
  }).catch(() => null)

  let sentMessageId: string | null = null
  try {
    const transporter = nodemailer.createTransport({
      host: conn.smtp_host as string,
      port: conn.smtp_port as number,
      secure: (conn.smtp_port as number) === 465,
      auth: { user: conn.email as string, pass: decrypt(conn.encrypted_password as string) },
    })
    const info = await transporter.sendMail(envelope)
    /* Kept so an inbound reply carrying this value in In-Reply-To can be threaded back to the
       exact record the message was sent from. */
    sentMessageId = info.messageId ?? null
  } catch (err) {
    /* The Sent connection was opened ahead of the send and nothing is going to be filed in it
       now. Left open it would hold one of the mailbox's few concurrent slots until it timed out. */
    void appenderSoon.then((a) => a?.close())
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to send email.' }
  }

  /* Best-effort: file a copy in the connected mailbox's Sent folder so it shows up in the
     person's own mail client too, not just the CRM timeline. A failure here does not undo the
     send above -- the message already went out -- so it is never surfaced as a send error. */
  try {
    const raw = await new MailComposer(envelope).compile().build()
    const appender = await appenderSoon
    if (appender) {
      try { await appender.append(raw) } finally { await appender.close() }
    }
  } catch {
    // ignore -- the send itself already succeeded
  }

  /* `from` is returned so the caller can record WHICH mailbox the message left by. That decides
     where the reply will land, which is the thing that matters when an agent leaves the firm. */
  return { ok: true, messageId: sentMessageId, from: conn.email as string }
}
