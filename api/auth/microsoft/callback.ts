import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyOAuthState, currentOrigin } from '../../_lib/oauthState'

/**
 * Microsoft redirects back here after the person approves (or denies) the
 * connection. Exchanges the auth code for tokens, looks up their email
 * address, stores both in email_connections, then bounces the browser back
 * to wherever they started (staging or production) with a query flag
 * Settings reads to show a success/error message.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret) {
    res.status(500).send('Server is missing Microsoft OAuth configuration.')
    return
  }

  const { code, state, error: oauthError } = req.query as { code?: string; state?: string; error?: string }
  const origin = currentOrigin(req)
  const verified = typeof state === 'string' ? verifyOAuthState(state) : null
  const fallbackOrigin = verified?.returnOrigin ?? origin

  if (oauthError || !code || !verified) {
    res.writeHead(302, { Location: `${fallbackOrigin}/settings?emailConnectError=1` })
    res.end()
    return
  }

  const redirectUri = `${origin}/api/auth/microsoft/callback`

  const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri }),
  })
  const tokenBody = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (!tokenRes.ok || !tokenBody.refresh_token || !tokenBody.access_token) {
    res.writeHead(302, { Location: `${verified.returnOrigin}/settings?emailConnectError=1` })
    res.end()
    return
  }

  const meRes = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${tokenBody.access_token}` } })
  const me = (await meRes.json().catch(() => ({}))) as { mail?: string; userPrincipalName?: string }
  const email = me.mail ?? me.userPrincipalName
  if (!meRes.ok || !email) {
    res.writeHead(302, { Location: `${verified.returnOrigin}/settings?emailConnectError=1` })
    res.end()
    return
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)
  await admin.from('email_connections').upsert({
    user_id: verified.userId,
    provider: 'microsoft',
    email,
    refresh_token: tokenBody.refresh_token,
    access_token: tokenBody.access_token,
    access_token_expires_at: new Date(Date.now() + (tokenBody.expires_in ?? 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  })

  res.writeHead(302, { Location: `${verified.returnOrigin}/settings?emailConnected=1` })
  res.end()
}
