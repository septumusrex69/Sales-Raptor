import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from '../_lib/auth.js'
import { syncConnection, type EmailConnectionRow } from '../_lib/emailSync.js'

/**
 * Intended for Vercel Cron (see vercel.json) — Vercel automatically sends
 * `Authorization: Bearer $CRON_SECRET` on cron-triggered requests when that
 * env var is set, which is what's checked here instead of a user session.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const admin = adminClient()
  if (!admin) {
    res.status(500).json({ error: 'Server is missing Supabase configuration.' })
    return
  }

  const { data: connections, error } = await admin.from('email_connections').select('*')
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const results: { userId: string; logged?: number; error?: string }[] = []
  for (const conn of (connections ?? []) as EmailConnectionRow[]) {
    try {
      const result = await syncConnection(admin, conn)
      results.push({ userId: conn.user_id, logged: result.logged })
    } catch (err) {
      results.push({ userId: conn.user_id, error: err instanceof Error ? err.message : 'Sync failed.' })
    }
  }

  res.status(200).json({ ok: true, results })
}
