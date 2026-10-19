import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, callerIsAdmin, requireCaller } from '../auth.js'
import { firmClock } from './clock.js'
import { refreshOutOfDate } from '../../../src/lib/storedBalance.js'

/**
 * THE NIGHTLY BALANCE: /api/workflow/balances (S9), 00:05 in Johannesburg.
 *
 * EVERY ACCOUNT'S STORED BALANCE, WORKED OUT AGAIN FOR THE NEW DAY. The accounts list is sorted by
 * `account_balances.to_settle`, which is computeBalance's own answer remembered (storedBalance.ts).
 * Interest runs daily, so at midnight every one of those figures is a day old; the list catches up
 * what CHANGED during the day, and this catches up the day itself.
 *
 * THROUGH computeBalance, ON THE SERVER, not in SQL. A SQL balance is the second arithmetic the
 * stored figure exists to avoid -- engine_balances already disagrees with the account page on
 * RRC00005 by R57,01.
 *
 * THE CRON proves itself with CRON_SECRET, like `run`; an Administrator may also press it (after a
 * staging clock jump, say). Nobody else: it reads every ledger in the book.
 *
 * A FUNCTION HAS A WALL CLOCK. It works until the budget is spent and says whether any is left; the
 * next run, or the list, carries on from what is still out of date -- `accounts_needing_balance`
 * is the cursor, so there is nothing to resume.
 */
const BUDGET_MS = 240_000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = adminClient()
  if (!admin) {
    res.status(500).json({ error: 'Server is missing Supabase configuration.' })
    return
  }
  const cronSecret = process.env.CRON_SECRET
  const isCron = Boolean(cronSecret) && req.headers.authorization === `Bearer ${cronSecret}`
  if (!isCron) {
    const caller = await requireCaller(req, admin)
    if (!caller) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    if (!(await callerIsAdmin(admin, caller.id))) {
      res.status(403).json({ error: 'Only an Administrator can work out the whole book.' })
      return
    }
  }

  /* THE FIRM'S TODAY, as the database keeps it -- the staging clock's day on staging. */
  const { today } = await firmClock(admin)
  try {
    const { done, more } = await refreshOutOfDate(admin, today, {
      limit: Number.MAX_SAFE_INTEGER, until: Date.now() + BUDGET_MS,
    })
    res.status(200).json({ today, done, more })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
}
