import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../_lib/auth.js'
import { syncConnection, type EmailConnectionRow } from '../_lib/emailSync.js'

/** On-demand "Sync now" for the caller's own connection — the same logic Vercel Cron runs for everyone via sync-all. */
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

  const { data: conn } = await admin.from('email_connections').select('*').eq('user_id', caller.id).maybeSingle()
  if (!conn) {
    res.status(400).json({ error: 'Connect your email account in Settings first.' })
    return
  }

  try {
    const result = await syncConnection(admin, conn as EmailConnectionRow)
    res.status(200).json({ ok: true, logged: result.logged })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Sync failed.' })
  }
}
