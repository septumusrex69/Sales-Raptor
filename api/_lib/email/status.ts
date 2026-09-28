import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, callerIsAdmin, requireCaller } from '../auth.js'

/** Whether the caller (or, for an admin, a targetUserId query param) has a connected mailbox — never returns the password. */
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

  const targetUserId = typeof req.query.targetUserId === 'string' ? req.query.targetUserId : undefined
  let userId = caller.id
  if (targetUserId && targetUserId !== caller.id) {
    if (!(await callerIsAdmin(admin, caller.id))) {
      res.status(403).json({ error: 'Only administrators can view another user’s mailbox status.' })
      return
    }
    userId = targetUserId
  }

  const { data: conn } = await admin.from('email_connections')
    .select('email, last_synced_at, last_sync_attempt_at, sync_error')
    .eq('user_id', userId).maybeSingle()
  /*
   * THE FAILURE TRAVELS WITH THE STATUS. A mailbox that has never been read looks identical to one
   * that is quietly failing every night unless the screen can see the reason -- which is how a
   * debtor's reply to a section 129 went missing for four days with nothing anywhere saying so.
   */
  res.status(200).json({
    connected: !!conn,
    email: conn?.email ?? null,
    lastSyncedAt: conn?.last_synced_at ?? null,
    lastAttemptAt: conn?.last_sync_attempt_at ?? null,
    syncError: conn?.sync_error ?? null,
  })
}
