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

  const { to, subject, bodyHtml } = (req.body ?? {}) as { to?: string; subject?: string; bodyHtml?: string }
  if (!to || !subject || !bodyHtml) {
    res.status(400).json({ error: 'to, subject, and bodyHtml are required.' })
    return
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
  const attachments = embedded
    ? [{ filename: 'signature', content: embedded.content, contentType: embedded.contentType, cid: SIGNATURE_CID }]
    : undefined

  const fullHtml = composeBody(bodyHtml, signatureHtml(signatureText, image, imageSrc))

  let sentMessageId: string | null = null
  try {
    const transporter = nodemailer.createTransport({
      host: conn.smtp_host as string,
      port: conn.smtp_port as number,
      secure: (conn.smtp_port as number) === 465,
      auth: { user: conn.email as string, pass: decrypt(conn.encrypted_password as string) },
    })
    const info = await transporter.sendMail({ from: conn.email as string, to, subject, html: fullHtml, attachments })
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
    const raw = await new MailComposer({ from: conn.email as string, to, subject, html: fullHtml, attachments }).compile().build()
    await appendToSent(
      { email: conn.email as string, imap_host: conn.imap_host as string, imap_port: conn.imap_port as number, encrypted_password: conn.encrypted_password as string },
      raw,
    )
  } catch {
    // ignore -- the send itself already succeeded
  }

  res.status(200).json({ ok: true, messageId: sentMessageId })
}
