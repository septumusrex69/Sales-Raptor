import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from '../_lib/auth.js'
import { syncConnection, type EmailConnectionRow } from '../_lib/emailSync.js'

/**
 * How long an email nobody has filed is kept.
 *
 * The firm's number. Linked mail is exempt and always will be: once a message is on an account
 * it is part of that account's record and the fee raised against it, so it is not housekeeping's
 * to throw away. This is what keeps the mailbox at a steady ~112 000 rows and ~54 MB instead of
 * growing by 1.37 million rows a year.
 */
const RETENTION_DAYS = 30

/** Drop unlinked mail older than the retention window. Never touches the real mailbox. */
async function pruneOldMail(admin: NonNullable<ReturnType<typeof adminClient>>): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString()
  const { data, error } = await admin
    .from('user_emails')
    .delete()
    .is('linked_account_id', null)
    .lt('occurred_at', cutoff)
    .select('id')
  if (error) {
    console.error('[sync-all] prune failed:', error.message)
    return 0
  }
  return data?.length ?? 0
}

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

  /*
   * The prune runs FIRST, before any syncing.
   *
   * Deliberate: this one invocation has to sync every connected mailbox, and at 50 mailboxes
   * that is the part most likely to run out of time. Housekeeping that is cheap and matters for
   * storage should not be the thing that gets cut off. See the note below about that limit.
   */
  const pruned = await pruneOldMail(admin)

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
  res.status(200).json({ ok: true, pruned, syncedMailboxes: results.length, results })
}
