import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { signOAuthState, currentOrigin } from '../../_lib/oauthState'

/**
 * Kicks off the "connect your Outlook inbox" flow. The browser navigates
 * here directly (not a fetch — it's a full-page redirect to Microsoft), so
 * the caller's Supabase session travels as a query param rather than an
 * Authorization header.
 */
const SCOPES = ['offline_access', 'User.Read', 'Mail.Send', 'openid', 'email', 'profile'].join(' ')

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const clientId = process.env.MICROSOFT_CLIENT_ID
  if (!supabaseUrl || !serviceRoleKey || !clientId) {
    res.status(500).send('Server is missing Microsoft OAuth configuration.')
    return
  }

  const token = typeof req.query.token === 'string' ? req.query.token : undefined
  if (!token) {
    res.status(400).send('Missing token.')
    return
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) {
    res.status(401).send('Invalid or expired session.')
    return
  }

  const origin = currentOrigin(req)
  const state = signOAuthState(data.user.id, origin)
  const redirectUri = `${origin}/api/auth/microsoft/callback`

  const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_mode', 'query')
  authUrl.searchParams.set('scope', SCOPES)
  authUrl.searchParams.set('state', state)
  // Forces Microsoft to hand back a refresh_token even if this person connected before.
  authUrl.searchParams.set('prompt', 'consent')

  res.writeHead(302, { Location: authUrl.toString() })
  res.end()
}
