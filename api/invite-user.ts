import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

/**
 * Sends a real Supabase invite email. Runs server-side only because it
 * needs the service_role secret key (never exposed to the browser) to call
 * Supabase's admin API. Only an Administrator's own session can trigger it —
 * verified here, not trusted from the client.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: 'Server is missing Supabase configuration.' })
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization token.' })
    return
  }
  const token = authHeader.slice('Bearer '.length)

  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: callerData, error: callerError } = await admin.auth.getUser(token)
  if (callerError || !callerData.user) {
    res.status(401).json({ error: 'Invalid or expired session.' })
    return
  }

  const { data: callerProfile, error: profileError } = await admin.from('profiles').select('role').eq('id', callerData.user.id).single()
  if (profileError || callerProfile?.role !== 'Administrator') {
    res.status(403).json({ error: 'Only administrators can invite new users.' })
    return
  }

  const { email, name } = (req.body ?? {}) as { email?: string; name?: string }
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'Email is required.' })
    return
  }

  // Hardcoded rather than derived from the request's Origin header: this
  // email's redirect link must always point at the real production site,
  // never wherever the inviting admin happened to be browsing from.
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: 'https://sales-raptor.vercel.app/login',
    ...(name ? { data: { name } } : {}),
  })
  if (error) {
    res.status(400).json({ error: error.message })
    return
  }

  res.status(200).json({ ok: true, userId: data.user?.id })
}
