import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../_lib/auth.js'
import { claimSync, releaseSync, syncConnection, type EmailConnectionRow } from '../_lib/emailSync.js'

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

  /*
   * ONE SYNC PER MAILBOX AT A TIME, and the claim is made in the database rather than in the page.
   *
   * The runtime logs showed three identical POSTs landing in the same second: the mail screen
   * pulls on open, the messages menu pulls on open, and the cron pulls on its own schedule. Each
   * one opened its own IMAP connection and walked eighteen folders down one mailbox. Mail servers
   * cap concurrent connections per account, so the three did not merely repeat each other's work
   * — they queued, and everything else the person was doing queued behind them. That is what
   * "if I click on a mail it loads and loads and loads" actually was.
   *
   * A guard in the page could not have fixed it: the three callers are different components, and
   * on another day different tabs or different machines. The claim is a conditional UPDATE, which
   * is atomic — two requests race for the same row and exactly one comes back with it.
   *
   * SIXTY SECONDS, not "until it finishes". A function that is killed mid-sync never clears the
   * mark, and a mailbox that could never be synced again would be a far worse bug than a wasted
   * connection. Worst case a genuine second sync waits a minute.
   */
  const claimed = await claimSync(admin, caller.id)

  if (!claimed) {
    /*
     * 200, not an error. Nothing is wrong: somebody else asked for the same mailbox a moment ago
     * and the answer is already on its way. The caller reloads its list either way, so the person
     * still sees whatever that sync brings in.
     */
    res.status(200).json({ ok: true, logged: 0, alreadyRunning: true })
    return
  }

  try {
    const result = await syncConnection(admin, conn as EmailConnectionRow)
    res.status(200).json({ ok: true, logged: result.logged })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Sync failed.' })
  } finally {
    await releaseSync(admin, caller.id)
  }
}
