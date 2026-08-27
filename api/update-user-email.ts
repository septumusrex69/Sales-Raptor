import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

/**
 * Changes a user's actual login email (auth.users), not just the display
 * copy in profiles -- those two are separate columns that only match up at
 * signup time, so editing profiles.email alone would silently break their
 * login while showing a different address on screen. Runs server-side only
 * because it needs the service_role secret key. Only an Administrator's own
 * session can trigger it -- verified here, not trusted from the client.
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
    res.status(403).json({ error: 'Only administrators can change a user’s email.' })
    return
  }

  const { userId, email } = (req.body ?? {}) as { userId?: string; email?: string }
  if (!userId || !email) {
    res.status(400).json({ error: 'userId and email are required.' })
    return
  }

  const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, { email })
  if (authUpdateError) {
    res.status(400).json({ error: authUpdateError.message })
    return
  }

  const { error: profileUpdateError } = await admin.from('profiles').update({ email }).eq('id', userId)
  if (profileUpdateError) {
    res.status(400).json({ error: profileUpdateError.message })
    return
  }

  res.status(200).json({ ok: true })
}
