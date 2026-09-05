import type { VercelRequest, VercelResponse } from '@vercel/node'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import { adminClient, requireCaller } from '../_lib/auth'
import { encrypt } from '../_lib/crypto'

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

  const { email, password, smtpHost, smtpPort, imapHost, imapPort } = (req.body ?? {}) as {
    email?: string
    password?: string
    smtpHost?: string
    smtpPort?: number
    imapHost?: string
    imapPort?: number
  }
  if (!email || !password || !smtpHost || !smtpPort || !imapHost || !imapPort) {
    res.status(400).json({ error: 'Email, password, and both SMTP and IMAP host/port are required.' })
    return
  }

  // Verify the credentials actually work before saving anything -- fail fast
  // with a clear error instead of silently storing something that only
  // breaks later, at send or sync time.
  try {
    const imapClient = new ImapFlow({ host: imapHost, port: imapPort, secure: imapPort === 993, auth: { user: email, pass: password }, logger: false })
    await imapClient.connect()
    await imapClient.logout()
  } catch {
    res.status(400).json({ error: "Couldn't log in to that mailbox via IMAP — double check the host, port, and password." })
    return
  }

  try {
    const transporter = nodemailer.createTransport({ host: smtpHost, port: smtpPort, secure: smtpPort === 465, auth: { user: email, pass: password } })
    await transporter.verify()
  } catch {
    res.status(400).json({ error: "Couldn't verify the SMTP server — double check the host, port, and password." })
    return
  }

  await admin.from('email_connections').upsert({
    user_id: caller.id,
    email,
    smtp_host: smtpHost,
    smtp_port: smtpPort,
    imap_host: imapHost,
    imap_port: imapPort,
    encrypted_password: encrypt(password),
    last_seen_uid: null,
    updated_at: new Date().toISOString(),
  })

  res.status(200).json({ ok: true })
}
