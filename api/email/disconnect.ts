import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../_lib/auth'

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
  await admin.from('email_connections').delete().eq('user_id', caller.id)
  res.status(200).json({ ok: true })
}
