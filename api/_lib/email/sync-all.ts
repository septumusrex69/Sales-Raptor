import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from '../auth.js'
import { claimSync, releaseSync, syncConnection, type EmailConnectionRow } from '../emailSync.js'

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

  const results: { userId: string; logged?: number; error?: string; skipped?: boolean }[] = []
  for (const conn of (connections ?? []) as EmailConnectionRow[]) {
    /*
     * THE CRON DEFERS TO A PERSON. If somebody has their mailbox open and Raptor is already
     * pulling it, the nightly run must not open a second connection to the same account — mail
     * servers cap those per account, and the collision slows down the person who is actually
     * sitting there. Skipping costs nothing: this mailbox was being synced anyway.
     */
    if (!(await claimSync(admin, conn.user_id))) {
      results.push({ userId: conn.user_id, skipped: true })
      continue
    }
    /*
     * THE ATTEMPT IS RECORDED WHETHER IT WORKS OR NOT, and the reason is kept when it does not.
     *
     * This used to collect each failure into `results` and return 200, which meant a mailbox that
     * failed every night said nothing to anybody: one was connected on 24 September and had still
     * never been read four nightly runs later, and the only sign was a debtor's reply that never
     * arrived. `last_synced_at` alone cannot tell "never connected" from "nobody ran the job".
     */
    await admin.from('email_connections')
      .update({ last_sync_attempt_at: new Date().toISOString() })
      .eq('user_id', conn.user_id)
    try {
      const result = await syncConnection(admin, conn)
      /* Cleared on success, so it never describes a mailbox that has since recovered. */
      await admin.from('email_connections').update({ sync_error: null }).eq('user_id', conn.user_id)
      results.push({ userId: conn.user_id, logged: result.logged })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed.'
      await admin.from('email_connections')
        .update({ sync_error: message.slice(0, 500) })
        .eq('user_id', conn.user_id)
      results.push({ userId: conn.user_id, error: message })
    } finally {
      await releaseSync(admin, conn.user_id)
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
