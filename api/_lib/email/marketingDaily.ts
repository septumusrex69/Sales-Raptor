import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../auth.js'
import { firmClock } from '../workflow/clock.js'
import { marketingDailyTick } from '../marketing.js'
import { can } from '../../../src/lib/capabilities.js'

/**
 * EVERY MORNING: CAMPAIGN FOLLOW-UPS AND RESULTS EMAILS THAT ARE DUE (S14, for Ryno's campaign work).
 *
 * Vercel's timer calls it at 07:13 Johannesburg time (vercel.json) and proves itself with CRON_SECRET, as the
 * other timed routes do; somebody holding marketing.send may also press it, to see what is due. What it does is
 * marketingDailyTick in api/_lib/marketing.ts -- see the note there: until Ryno's sending code lands it reports
 * what is due and sends nothing.
 */
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
    const { data: me } = await admin.from('profiles').select('role, grants, revokes').eq('id', caller.id).maybeSingle()
    if (!can(me as never, 'marketing.send')) {
      res.status(403).json({ error: 'Only somebody who may send campaigns can run this.' })
      return
    }
  }
  /* The firm's today, as the database keeps it -- the staging clock's day on staging. */
  const { today } = await firmClock(admin)
  try {
    const result = await marketingDailyTick(admin, today)
    console.log(`[marketing-daily] ${today}: ${result.stepsDue.length} follow-up(s) due, ${result.resultsDue.length} results email(s) due, `
      + `${result.sent.steps + result.sent.results} sent`)
    res.status(200).json({ today, ...result })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
}
