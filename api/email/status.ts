import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../_lib/auth'

/** Whether the caller has a connected mailbox, its address, and when it last synced — never returns the password. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
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
  const { data: conn } = await admin.from('email_connections').select('email, last_synced_at').eq('user_id', caller.id).maybeSingle()
  res.status(200).json({ connected: !!conn, email: conn?.email ?? null, lastSyncedAt: conn?.last_synced_at ?? null })
}
