import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { adminClient, requireCaller } from '../auth.js'
import { todayInJohannesburg } from './locale.js'
import { isStagingDatabase } from '../../../src/lib/testClock.js'
import { daysAfter, jumpDays } from '../../../src/lib/clock.js'
import { sweep } from './run.js'

/**
 * THE FIRM'S DAY AND MOMENT, AS THE DATABASE KEEPS THEM (prompt 10).
 *
 * raptor_today() / raptor_now() are the real Johannesburg day and now() on production, always; on a
 * staging database whose clock has been moved they are the staging day at the real time of day.
 * Every server route that decides "what is due today" asks here rather than reading its own clock,
 * so the morning cron, a release and a jump all agree with the database about what day it is.
 *
 * FALLS BACK TO THE REAL DAY if the question cannot be asked -- a database without the function
 * (production before the go-live copy reaches it) behaves exactly as it did before.
 */
export async function firmClock(admin: SupabaseClient): Promise<{ today: string; now: Date }> {
  const { data, error } = await admin.rpc('raptor_clock')
  const row = (Array.isArray(data) ? data[0] : data) as { business_today?: string; business_now?: string } | null
  if (error || !row?.business_today || !row?.business_now) {
    return { today: todayInJohannesburg(), now: new Date() }
  }
  return { today: row.business_today, now: new Date(row.business_now) }
}

/**
 * THE STAGING CLOCK'S JUMP: POST /api/workflow/clock { to: 'yyyy-mm-dd', reason?, resume? }.
 *
 * ANYTHING THAT WOULD HAVE HAPPENED ON THE SKIPPED DAYS HAPPENS, IN DATE ORDER. One day at a time:
 * the database moves the clock a day (step_staging_clock -- which on the 11th closes the cycle that
 * has just ended and refreshes the runs, as pg_cron and the queue would have), then the morning
 * sweep runs for that day -- promises whose 48 hours ran out are broken, runs are planned and
 * re-dated, and every step that fell due is decided. What it does NOT do is send: a step that would
 * have gone is recorded 'skipped (staging clock jump)'. Staging has a live SMS gateway.
 *
 * THREE LOCKS. The deployment must point at staging (read off the URL, before the caller is even
 * looked up -- the same first lock as the test clock); the caller must be signed in; and the
 * database refuses anybody but an Administrator, on a database whose deployment row says staging.
 * The database calls are made AS THE CALLER, so auth.uid() is the person who pressed the button and
 * the log says so.
 *
 * FORWARD ONLY, and logged once per jump in finance_setting_changes. Going back is Clear staging.
 *
 * A FUNCTION HAS A WALL CLOCK. A three-month jump is ninety-odd days; if the time runs out the
 * response says how far it got and the browser calls again with `resume`, which carries on from the
 * day the database is on without logging the jump a second time.
 */
const BUDGET_MS = 240_000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isStagingDatabase(process.env.VITE_SUPABASE_URL)) {
    res.status(403).json({ error: 'The staging clock only runs against the staging database.' })
    return
  }
  const admin = adminClient()
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!admin || !anonKey || !process.env.VITE_SUPABASE_URL) {
    res.status(500).json({ error: 'Server is missing Supabase configuration.' })
    return
  }
  const caller = await requireCaller(req, admin)
  if (!caller) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const as = createClient(process.env.VITE_SUPABASE_URL, anonKey, {
    global: { headers: { Authorization: req.headers.authorization as string } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const body = (req.body ?? {}) as { to?: unknown; reason?: unknown; resume?: unknown }
  const to = typeof body.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.to) ? body.to : null
  if (!to) {
    res.status(400).json({ error: 'Say which date to jump to (yyyy-mm-dd).' })
    return
  }

  let { today } = await firmClock(admin)
  if (!body.resume) {
    /* Forward only, Administrator only, staging only -- the database's refusal is the sentence. */
    const { error } = await as.rpc('begin_staging_clock_jump', {
      p_to: to, p_reason: typeof body.reason === 'string' ? body.reason : null,
    })
    if (error) {
      res.status(400).json({ error: error.message })
      return
    }
  }

  const started = Date.now()
  const days: { day: string; closed: number; skipped: number; expired: number; held: number }[] = []
  for (const day of jumpDays(today, to)) {
    if (Date.now() - started > BUDGET_MS) break
    const { data: stepped, error } = await as.rpc('step_staging_clock', { p_day: day })
    if (error) {
      res.status(400).json({ error: error.message, reached: today, days })
      return
    }
    today = day
    const { now } = await firmClock(admin)
    const pass = await sweep(admin, { accountIds: [], today: day, now, skipSends: true, budgetMs: 20_000 })
    if ('error' in pass) {
      res.status(500).json({ error: pass.error, reached: today, days })
      return
    }
    days.push({
      day,
      closed: Number((stepped as { closed?: number } | null)?.closed ?? 0),
      skipped: pass.skipped, expired: pass.expired, held: pass.held,
    })
  }

  /* The queue as it would look on opening it: every run built or rebuilt for the clock's day. */
  if (today === to) await as.rpc('refresh_payover_runs')

  res.status(200).json({
    ok: true, reached: today, to, done: today === to,
    next: today === to ? null : daysAfter(today, 1),
    days,
  })
}
