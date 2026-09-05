import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

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
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) {
    res.status(401).json({ error: 'Invalid or expired session.' })
    return
  }

  await admin.from('email_connections').delete().eq('user_id', data.user.id)
  res.status(200).json({ ok: true })
}
