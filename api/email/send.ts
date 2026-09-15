import type { VercelRequest, VercelResponse } from '@vercel/node'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import { adminClient, requireCaller } from '../_lib/auth.js'
import { decrypt, credentialsKeyProblem } from '../_lib/crypto.js'
import { appendToSent } from '../_lib/emailSync.js'
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

  const { to, cc, bcc, subject, bodyHtml, inReplyTo, attachments } = (req.body ?? {}) as {
    to?: string; cc?: string; bcc?: string; subject?: string; bodyHtml?: string
    /**
     * Files to send with the message.
     *
     * Base64 in the request body rather than uploaded to storage first, which is the trade this
     * project's twelve-function cap forces: a storage round trip would want its own endpoint to
     * hand back a signed upload URL, and there is no thirteenth slot. See the size guard below
     * for what that costs.
     */
    attachments?: { filename?: string; contentType?: string; dataBase64?: string }[]
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
   * The attachments, decoded and bounded.
   *
   * WHY THERE IS A CEILING AT ALL. Vercel caps the request body of a serverless function (4.5 MB
   * at the time of writing) and base64 inflates whatever it carries by about a third, so roughly
   * 3 MB of actual file is what fits with room for the message around it. Past that the platform
   * rejects the request before this code runs, and the agent sees a generic failure with no idea
   * which of their four attachments was the problem.
   *
   * So it is checked here, in bytes, and refused by name. A collector who has just typed a demand
   * letter needs to be told "that scan is too big", not "send failed".
   */
  const MAX_ATTACHMENTS = 10
  const MAX_TOTAL_BYTES = 3 * 1024 * 1024

  const wanted = Array.isArray(attachments) ? attachments : []
  if (wanted.length > MAX_ATTACHMENTS) {
    res.status(400).json({ error: `A message can carry at most ${MAX_ATTACHMENTS} attachments.` })
    return
  }

  const files: { filename: string; content: Buffer; contentType?: string }[] = []
  let totalBytes = 0
  for (const file of wanted) {
    if (!file?.filename || !file?.dataBase64) {
      res.status(400).json({ error: 'Every attachment needs a filename and its contents.' })
      return
    }
    // Strip any path the browser handed us. A filename is a label on a MIME part here, and one
    // carrying slashes is either a mistake or someone being clever.
    const filename = file.filename.replace(/[\\/]/g, '_').slice(0, 200)
    const content = Buffer.from(file.dataBase64, 'base64')
    if (content.length === 0) {
      res.status(400).json({ error: `${filename} came through empty and was not sent.` })
      return
    }
    totalBytes += content.length
    if (totalBytes > MAX_TOTAL_BYTES) {
      res.status(400).json({
        error: `Those attachments come to more than ${Math.round(MAX_TOTAL_BYTES / (1024 * 1024))} MB `
          + 'together, which is more than can be sent in one message. Send the largest separately, '
          + 'or put it on the account as a document and send a link.',
      })
      return
    }
    files.push({ filename, content, contentType: file.contentType || undefined })
  }

  const { data: conn } = await admin.from('email_connections').select('*').eq('user_id', caller.id).maybeSingle()
  if (!conn) {
    res.status(400).json({ error: 'Connect your email account in Settings before sending email.' })
    return
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('email_signature, email_signature_image_url, email_signature_image_width, email_signature_image_align')
    .eq('id', caller.id)
    .maybeSingle()
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
   * The signature rides with the files, and keeps its cid.
   *
   * Only the signature carries one: a cid is what makes a part an INLINE image the HTML points
   * at, and giving a debtor's statement one would hide it from the attachment list in their mail
   * client while leaving it in the message.
   */
  const outgoing = [
    ...(embedded
      ? [{ filename: 'signature', content: embedded.content, contentType: embedded.contentType, cid: SIGNATURE_CID }]
      : []),
    ...files,
  ]
  const mailAttachments = outgoing.length > 0 ? outgoing : undefined

  const fullHtml = composeBody(bodyHtml, signatureHtml(signatureText, image, imageSrc))

  let sentMessageId: string | null = null
  try {
    const transporter = nodemailer.createTransport({
      host: conn.smtp_host as string,
      port: conn.smtp_port as number,
      secure: (conn.smtp_port as number) === 465,
      auth: { user: conn.email as string, pass: decrypt(conn.encrypted_password as string) },
    })
    const info = await transporter.sendMail({
      from: conn.email as string, to, subject, html: fullHtml, attachments: mailAttachments,
      ...(cc ? { cc } : {}),
      ...(bcc ? { bcc } : {}),
      ...(inReplyTo ? { inReplyTo, references: [inReplyTo] } : {}),
    })
    // Kept so an inbound reply carrying this value in In-Reply-To can be threaded back to the
    // exact deal the message was sent from. Without it a reply can only be matched on the
    // sender's address, which finds the client but not which of its deals is being discussed.
    sentMessageId = info.messageId ?? null
  } catch (err) {
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
      from: conn.email as string, to, subject, html: fullHtml, attachments: mailAttachments,
      /*
       * Cc travels; Bcc deliberately does NOT.
       *
       * A blind copy that appears in the Sent folder is no longer blind — anybody who is later
       * shown that message, in Outlook or through Raptor's own Sent tab, can read who else got
       * it. The recipient's copy never carried the header, and neither should ours.
       */
      ...(cc ? { cc } : {}),
      ...(inReplyTo ? { inReplyTo, references: [inReplyTo] } : {}),
    }).compile().build()
    await appendToSent(
      { email: conn.email as string, imap_host: conn.imap_host as string, imap_port: conn.imap_port as number, encrypted_password: conn.encrypted_password as string },
      raw,
    )
  } catch {
    // ignore -- the send itself already succeeded
  }

  // `from` is returned so the caller can record WHICH mailbox the message left by. That decides
  // where the reply will land, which is the thing that matters when an agent leaves the firm.
  // attachmentNames so the account's copy can record what went with the message — a statement
  // sent and not recorded is a statement nobody can prove was sent.
  res.status(200).json({
    ok: true,
    messageId: sentMessageId,
    from: conn.email as string,
    attachmentNames: files.map((f) => f.filename),
  })
}
