import type { VercelRequest, VercelResponse } from '@vercel/node'
import nodemailer from 'nodemailer'
import { adminClient, requireCaller } from '../_lib/auth.js'
import { decrypt } from '../_lib/crypto.js'

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

  let signatureHtml = ''
  if (signatureText) signatureHtml += signatureText.replace(/\n/g, '<br>')
  if (signatureImageUrl) {
    const margin = signatureImageAlign === 'right' ? 'margin:8px 0 0 auto' : signatureImageAlign === 'center' ? 'margin:8px auto 0' : 'margin:8px 0 0 0'
    signatureHtml += `<img src="${signatureImageUrl}" width="${signatureImageWidth}" style="display:block;max-width:100%;${margin}" alt="" />`
  }
  const fullHtml = signatureHtml ? `${bodyHtml}<br><br>${signatureHtml}` : bodyHtml

  try {
    const transporter = nodemailer.createTransport({
      host: conn.smtp_host as string,
      port: conn.smtp_port as number,
      secure: (conn.smtp_port as number) === 465,
      auth: { user: conn.email as string, pass: decrypt(conn.encrypted_password as string) },
    })
    await transporter.sendMail({ from: conn.email as string, to, subject, html: fullHtml })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to send email.' })
    return
  }

  res.status(200).json({ ok: true })
}
