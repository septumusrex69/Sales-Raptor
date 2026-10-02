import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../auth.js'
import { todayInJohannesburg } from './locale.js'
import { isStagingDatabase, isTestAccount, daysToNextStep } from '../../../src/lib/testClock.js'
import run from './run.js'

/**
 * THE TEST CLOCK: PULL THIS ACCOUNT'S NEXT STEP ONTO TODAY, THEN RUN THE ORDINARY PASS.
 *
 * THE FIRM WANTED TO WATCH A SEQUENCE HAPPEN: "everything go out one minute after the other... two
 * minutes where everything happens... and I will tick received or not received." The engine has no
 * clock, only a calendar -- see testClock.ts for why that is left alone and the ACCOUNT is moved
 * instead.
 *
 * IT DELEGATES TO `run` AND ADDS NOTHING TO THE SENDING. That is the whole point: after the dates
 * move, what happens is the same function the six o'clock cron calls, with the same planning, the
 * same ordering, the same holds and the same refusals. A test path that sent messages its own way
 * would be testing the test path.
 *
 * THREE LOCKS, AND THEY FAIL DIFFERENTLY ON PURPOSE:
 *
 *   1. STAGING ONLY, read off the Supabase URL the deployment is pointed at rather than off a
 *      NODE_ENV or a branch name -- a preview build of this branch aimed at production would pass
 *      every other test anybody thought to write.
 *   2. A TEST ACCOUNT ONLY, checked here so the refusal is a sentence rather than a database error.
 *   3. AND AGAIN IN THE DATABASE. `workflow_test_advance` refuses a non-test account itself and is
 *      granted to no role but service_role. That is the lock that actually holds -- the first two
 *      are checks somebody could one day be talked past, and this one is the ledgers' rule applied
 *      to the calendar.
 *
 * NO CRON PATH. A test clock is never a timer and never sweeps: it takes a session and one account,
 * and there is deliberately no secret that widens it.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = adminClient()
  if (!admin) {
    res.status(500).json({ error: 'Server is missing Supabase configuration.' })
    return
  }

  /* LOCK 1. Before the caller is even looked up: what makes this safe is which DATABASE the
     deployment is pointed at, and nothing about who is asking changes that. */
  if (!isStagingDatabase(process.env.VITE_SUPABASE_URL)) {
    res.status(403).json({ error: 'The test clock only runs against the staging database.' })
    return
  }

  const caller = await requireCaller(req, admin)
  if (!caller) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const body = (req.body ?? {}) as { accountId?: string }
  const accountId = typeof body.accountId === 'string' ? body.accountId : ''
  if (!accountId) {
    res.status(400).json({ error: 'Say which account. The test clock moves one at a time.' })
    return
  }

  const { data: account, error: accountError } = await admin
    .from('debtor_accounts').select('account_number, is_test_account').eq('id', accountId)
    .maybeSingle()
  if (accountError) {
    res.status(500).json({ error: accountError.message })
    return
  }
  /* LOCK 2. The sentence is the point: a collector who somehow reached this on a real account
     should read what the rule is, not a constraint name. */
  if (!isTestAccount({
    accountNumber: account?.account_number as string | null,
    isTestAccount: account?.is_test_account as boolean | null,
  })) {
    res.status(403).json({ error: 'The test clock only moves test accounts.' })
    return
  }

  /*
   * HOW FAR TO JUMP, WORKED OUT FROM WHAT IS ACTUALLY LEFT.
   *
   * RUNNING RUNS ONLY, matching the database function: a held run is paused, and pulling its steps
   * forward while it is paused fights the re-dating that happens when it is let go. A tick that
   * moves nothing because everything is held is the correct answer and the screen says so.
   */
  const today = todayInJohannesburg()
  const { data: pending, error: stepsError } = await admin
    .from('workflow_run_steps')
    .select('due_on, workflow_runs!inner(account_id, state)')
    .in('state', ['pending', 'held'])
    .eq('workflow_runs.account_id', accountId)
    .eq('workflow_runs.state', 'running')
    .limit(500)
  if (stepsError) {
    res.status(500).json({ error: stepsError.message })
    return
  }

  const jump = daysToNextStep(today, (pending ?? []).map((s) => s.due_on as string))
  let moved = 0
  if (jump > 0) {
    const { data: shifted, error: rpcError } = await admin
      .rpc('workflow_test_advance', { p_account_id: accountId, p_days: jump })
    if (rpcError) {
      res.status(403).json({ error: rpcError.message })
      return
    }
    moved = Number(shifted ?? 0)
  }

  /*
   * AND THEN THE ORDINARY PASS, with the jump reported on top of whatever it did.
   *
   * `run` writes the response itself, so the two numbers are attached to the request and read back
   * out afterwards rather than merged into its body -- wrapping `res` to edit the JSON on its way
   * past would be a second place that knows the shape of run's reply.
   */
  ;(req as VercelRequest & { testClock?: { jumpedDays: number; movedSteps: number } }).testClock =
    { jumpedDays: jump, movedSteps: moved }
  res.setHeader('x-test-clock-jumped-days', String(jump))
  res.setHeader('x-test-clock-moved-steps', String(moved))
  await run(req, res)
}
