import type { VercelRequest, VercelResponse } from '@vercel/node'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import { adminClient, requireCaller } from '../_lib/auth.js'
import { decrypt, credentialsKeyProblem } from '../_lib/crypto.js'
import { openSentAppender } from '../_lib/emailSync.js'
import { SIGNATURE_CID, composeBody, fetchSignatureImage, signatureHtml } from '../_lib/signature.js'

/** Sends an email through the caller's own connected mailbox via SMTP, with their saved signature appended. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const admin = adminClient()
  if (!admin) {
    res.status(500).json({ error: 'Server is missing Supabase configuration.' })
    return
  }
  // Same guard as connect: a missing key is a server problem and has to say so, not surface as
  // an empty 500 the client renders as a generic failure.
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) {
    res.status(500).json({ error: keyProblem })
    return
  }
  const caller = await requireCaller(req, admin)
  if (!caller) {
    res.status(401).json({ error: 'Invalid or expired session.' })
    return
  }

  const { to, cc, subject, bodyHtml, inReplyTo, attachments: sent, calendarReply } = (req.body ?? {}) as {
    to?: string; subject?: string; bodyHtml?: string
    /**
     * An iTIP reply to a meeting request, as a whole ICS file.
     *
     * Carried as `icalEvent` rather than as an ordinary attachment, because the two are not the
     * same thing on the wire: nodemailer gives this one `Content-Type: text/calendar; method=REPLY`
     * inside a multipart/alternative, which is what makes Outlook and Google fold the answer into
     * the organiser's own meeting instead of showing them a file to open. Attached the other way
     * it arrives as invite.ics sitting at the bottom of an email, and the organiser's tracking
     * list still says nobody has answered.
     */
    calendarReply?: string
    /**
     * Files travelling with the message, base64 in this same JSON body.
     *
     * Not a separate upload: a file that reaches storage and then fails to send is a file nobody
     * asked for sitting in a bucket. The browser caps the total before it gets here and says the
     * number out loud; this is the second guard, because the platform's own limit arrives as an
     * empty 413 that the client can only report as "could not reach the server".
     */
    attachments?: { filename?: string; contentType?: string; content?: string }[]
    /**
     * Everyone else who was on the message being answered.
     *
     * Reply-all only. The firm: "I also can't respond to all recipients" — a debtor who copies
     * their attorney was answered privately, so the attorney never saw the answer to the question
     * they had been copied on. Who ends up here is decided by replyAllTo, which takes the sender
     * out of the list and the agent's own addresses with them.
     */
    cc?: string
    /**
     * The Message-ID this is a reply to, where it is one.
     *
     * Sets the In-Reply-To and References headers so the debtor's own mail client shows our
     * answer inside the thread they started, rather than as a new message that happens to begin
     * "Re:". Not needed for Raptor's own matching — their reply threads on the Message-ID we
     * recorded, which their client fills in — this is about what the debtor sees.
     */
    inReplyTo?: string
  }
  if (!to || !subject || !bodyHtml) {
    res.status(400).json({ error: 'to, subject, and bodyHtml are required.' })
    return
  }

  /*
   * BOTH LOOKUPS AT ONCE. They are two independent round trips to the same database for two
   * unrelated rows, and run one after the other they were the first two of five waits a person
   * sat through before the message even started going out. Nothing here depends on the other.
   */
  const [{ data: conn }, { data: profile }, { data: firm }] = await Promise.all([
    admin.from('email_connections').select('*').eq('user_id', caller.id).maybeSingle(),
    admin
      .from('profiles')
      .select('email_signature, email_signature_image_url, email_signature_image_width, email_signature_image_align')
      .eq('id', caller.id)
      .maybeSingle(),
    /* The firm's font. One row, read alongside the other two rather than after them -- see the
       note above; this costs nothing because it waits inside a wait that was already happening. */
    admin.from('firm_settings').select('email_font, email_size_pt').maybeSingle(),
  ])
  if (!conn) {
    res.status(400).json({ error: 'Connect your email account in Settings before sending email.' })
    return
  }
  const signatureText = profile?.email_signature as string | null | undefined
  const signatureImageUrl = profile?.email_signature_image_url as string | null | undefined
  const signatureImageWidth = (profile?.email_signature_image_width as number | null | undefined) ?? 160
  const signatureImageAlign = (profile?.email_signature_image_align as 'left' | 'center' | 'right' | null | undefined) ?? 'left'

  /*
   * The signature image travels INSIDE the message.
   *
   * Linked from a URL it is a remote image, which Outlook and Gmail refuse to load until the
   * reader asks — so the block carrying the sender's face, numbers and branding shows up as a
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
  const files = (sent ?? [])
    .filter((f) => f?.filename && f?.content)
    .map((f) => ({
      filename: f.filename as string,
      content: Buffer.from(f.content as string, 'base64'),
      contentType: f.contentType || 'application/octet-stream',
    }))

  /* Guarded again server-side: the browser's limit is a courtesy, not a control. */
  const total = files.reduce((n, f) => n + f.content.length, 0)
  if (total > 4 * 1024 * 1024) {
    res.status(400).json({ error: 'Those attachments are too large to send in one message.' })
    return
  }

  const attachments = [
    ...(embedded
      ? [{ filename: 'signature', content: embedded.content, contentType: embedded.contentType, cid: SIGNATURE_CID }]
      : []),
    ...files,
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
  const fullHtml = composeBody(bodyHtml, signatureHtml(signatureText, image, imageSrc), emailStyle)

  /* Built once and used for both the outgoing message and the Sent copy, so what the organiser
     got and what the sender can see afterwards are the same bytes. */
  const ical = calendarReply
    ? { icalEvent: { method: 'REPLY', filename: 'invite.ics', content: calendarReply } }
    : {}

  /*
   * The mailbox this copy will be filed in, opened WHILE the message is going out.
   *
   * The two talk to different servers, so the IMAP connect, TLS handshake, login and mailbox
   * list happen for free inside the time SMTP is already taking. Started before the try below
   * rather than inside it because a mailbox that will not open must not fail the send — the
   * message still goes, and the Sent copy is what is lost.
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
    const info = await transporter.sendMail({
      from: conn.email as string, to, subject, html: fullHtml, attachments, ...ical,
      /*
       * BOTH PLACES, or the Sent copy shows a message that reached fewer people than it did.
       * Absent rather than empty: nodemailer accepts an empty Cc and mail servers vary.
       */
      ...(cc && cc.trim() ? { cc } : {}),
      ...(inReplyTo ? { inReplyTo, references: [inReplyTo] } : {}),
    })
    // Kept so an inbound reply carrying this value in In-Reply-To can be threaded back to the
    // exact deal the message was sent from. Without it a reply can only be matched on the
    // sender's address, which finds the client but not which of its deals is being discussed.
    sentMessageId = info.messageId ?? null
  } catch (err) {
    /* The Sent connection was opened ahead of the send and nothing is going to be filed in it
       now. Left open it would hold one of the mailbox's few concurrent slots until it timed out,
       which is exactly the contention this change exists to remove. */
    void appenderSoon.then((a) => a?.close())
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to send email.' })
    return
  }

  // Best-effort: file a copy in the connected mailbox's Sent folder so it shows up in the
  // person's own mail client too, not just the CRM timeline. A failure here doesn't undo the
  // send above -- the message already went out -- so it's never surfaced as a send error.
  try {
    // The Sent copy carries the same attachment, so the person's own mail client shows the
    // message exactly as the recipient got it rather than with a broken image in it.
    const raw = await new MailComposer({
      from: conn.email as string, to, subject, html: fullHtml, attachments, ...ical,
      /*
       * BOTH PLACES, or the Sent copy shows a message that reached fewer people than it did.
       * Absent rather than empty: nodemailer accepts an empty Cc and mail servers vary.
       */
      ...(cc && cc.trim() ? { cc } : {}),
      ...(inReplyTo ? { inReplyTo, references: [inReplyTo] } : {}),
    }).compile().build()
    const appender = await appenderSoon
    if (appender) {
      try { await appender.append(raw) } finally { await appender.close() }
    }
  } catch {
    // ignore -- the send itself already succeeded
  }

  // `from` is returned so the caller can record WHICH mailbox the message left by. That decides
  // where the reply will land, which is the thing that matters when an agent leaves the firm.
  res.status(200).json({ ok: true, messageId: sentMessageId, from: conn.email as string })
}
