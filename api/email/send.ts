import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string) {
  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'offline_access User.Read Mail.Send openid email profile',
    }),
  })
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string }
  if (!res.ok || !body.access_token) throw new Error(body.error_description ?? 'Failed to refresh Microsoft access token.')
  return body as { access_token: string; refresh_token?: string; expires_in: number }
}

/** Sends an email through the caller's own connected Outlook inbox via Microsoft Graph — never a shared/company address. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret) {
    res.status(500).json({ error: 'Server is missing Microsoft OAuth configuration.' })
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization token.' })
    return
  }
  const token = authHeader.slice('Bearer '.length)
  const admin = createClient(supabaseUrl, serviceRoleKey)
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  if (userError || !userData.user) {
    res.status(401).json({ error: 'Invalid or expired session.' })
    return
  }

  const { to, subject, bodyHtml } = (req.body ?? {}) as { to?: string; subject?: string; bodyHtml?: string }
  if (!to || !subject || !bodyHtml) {
    res.status(400).json({ error: 'to, subject, and bodyHtml are required.' })
    return
  }

  const { data: conn, error: connError } = await admin.from('email_connections').select('*').eq('user_id', userData.user.id).maybeSingle()
  if (connError || !conn) {
    res.status(400).json({ error: 'Connect your Outlook account in Settings before sending email.' })
    return
  }

  let accessToken = conn.access_token as string | null
  const expiresAt = conn.access_token_expires_at ? new Date(conn.access_token_expires_at as string).getTime() : 0
  if (!accessToken || Date.now() > expiresAt - 60_000) {
    try {
      const refreshed = await refreshAccessToken(clientId, clientSecret, conn.refresh_token as string)
      accessToken = refreshed.access_token
      await admin
        .from('email_connections')
        .update({
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token ?? conn.refresh_token,
          access_token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userData.user.id)
    } catch {
      res.status(400).json({ error: 'Your Outlook connection has expired. Please reconnect it in Settings.' })
      return
    }
  }

  const sendRes = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: { subject, body: { contentType: 'HTML', content: bodyHtml }, toRecipients: [{ emailAddress: { address: to } }] },
      saveToSentItems: true,
    }),
  })

  if (!sendRes.ok) {
    const errBody = (await sendRes.json().catch(() => ({}))) as { error?: { message?: string } }
    res.status(400).json({ error: errBody.error?.message ?? 'Failed to send email.' })
    return
  }

  res.status(200).json({ ok: true })
}
