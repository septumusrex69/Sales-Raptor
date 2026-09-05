import type { VercelRequest, VercelResponse } from '@vercel/node'
import nodemailer from 'nodemailer'
import { adminClient, requireCaller } from '../_lib/auth'
import { decrypt } from '../_lib/crypto'

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

  const { data: profile } = await admin.from('profiles').select('email_signature').eq('id', caller.id).maybeSingle()
  const signature = profile?.email_signature as string | null | undefined
  const fullHtml = signature ? `${bodyHtml}<br><br>${signature.replace(/\n/g, '<br>')}` : bodyHtml

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
