import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

/**
 * Permanently deletes a user's login (auth.users) -- their profiles row
 * cascades with it. Runs server-side only because it needs the service_role
 * secret key. Only an Administrator's own session can trigger it, and never
 * against their own account (so an admin can't lock themselves out).
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
    res.status(403).json({ error: 'Only administrators can remove a user.' })
    return
  }

  const { userId } = (req.body ?? {}) as { userId?: string }
  if (!userId) {
    res.status(400).json({ error: 'userId is required.' })
    return
  }
  if (userId === callerData.user.id) {
    res.status(400).json({ error: 'You can’t remove your own account.' })
    return
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
  if (deleteError) {
    res.status(400).json({ error: deleteError.message })
    return
  }

  res.status(200).json({ ok: true })
}
