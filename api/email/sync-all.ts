import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from '../_lib/auth.js'
import { syncConnection, type EmailConnectionRow } from '../_lib/emailSync.js'

/*
 * NOTHING IS PRUNED. Mail stays until somebody deals with it.
 *
 * There was a 30-day sweep of unmatched mail here, and the firm removed it: an email is either
 * matched to a record or it is junk to be blocked, and deleting one on a timer only means the
 * message quietly disappears before anyone gets to it. "If it doesn't work, it'll anyway be
 * deleted" — by a person, deliberately.
 *
 * THE COST, measured rather than guessed. A row averages 459 bytes and carries about 1.8x that
 * again in indexes, so ~826 bytes all told. At the firm's own 3 750 messages a day that is about
 * 3 MB a day and 1.1 GB a year, against roughly 89 MB steady-state under the old sweep. Which
 * puts Supabase's 500 MB free tier about five to six months out; on Pro's 8 GB it is years.
 *
 * Bodies are still not stored — only a ~150-character snippet — so this grows linearly and
 * slowly. If it ever needs bounding again, the honest lever is a much longer window (a year, or
 * two), not thirty days.
 */

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

  /*
   * KNOWN LIMIT, recorded where somebody will find it.
   *
   * This loops every mailbox inside one request. At the firm's real volume — 50 agents taking
   * 50-100 messages a day — that is 50 IMAP handshakes and thousands of messages in a single
   * invocation, and it will hit Vercel's function duration cap and stop partway. Mailboxes that
   * were not reached simply sync next time, or when their owner opens Raptor (the Messages menu
   * syncs the signed-in agent's own mailbox on demand), so nothing is lost — but this route is
   * the wrong shape for that many mailboxes and needs to become one invocation per mailbox.
   *
   * `results` shows how far it actually got, which is the evidence for when that matters.
   */
  res.status(200).json({ ok: true, syncedMailboxes: results.length, results })
}
