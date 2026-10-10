import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient, requireCaller } from '../auth.js'
import { firmClock } from './clock.js'
import { planUnplannedRuns, redateResumedRuns } from './plan.js'
import { expireDefaultedPromises } from './promises.js'
import { runOneStep, type DueStep } from './step.js'

/**
 * THE MORNING RUN: every workflow step that has come due, sent or held.
 *
 * The firm: "I'll send every letter by hand once and every SMS once. And then I want these things
 * working automatically in the workflow." This is the second half of that sentence.
 *
 * ONCE A DAY FOR THE WHOLE BOOK, AND ON DEMAND FOR ONE ACCOUNT. Every step of the section 129
 * sequence is a whole day apart, so a daily sweep is the right grain for it -- a Vercel cron in
 * vercel.json, like the mail sync beside it. But the HANDOVER is an email and then an SMS five to
 * ten minutes later, and a daily sweep cannot do "ten minutes later": an account allocated at ten
 * in the morning would be introduced to the firm the following dawn. So the app asks for one
 * account the moment somebody is allocated, with a session rather than the cron's secret, and the
 * daily sweep is the backstop for anything it missed.
 *
 * IT PLANS BEFORE IT SENDS. The allocation trigger creates a run with NO STEPS, because dating
 * them needs the working-day calendar and that lives in the app rather than in SQL. This is where
 * the two meet: plan whatever is unplanned, then send whatever is due -- which on a handover is
 * the same pass.
 *
 * WHAT IT DOES NOT DO IS DECIDE. `planSend` decides, and it is pure and checked; this fetches
 * what planSend needs, does what it says, and writes down what happened. The division matters
 * because everything interesting is in the decision and none of it is testable through a mailbox.
 *
 * NOTHING IS RETRIED BLINDLY. A step that could not be sent goes to `held` with the reason in the
 * firm's words, where a person sees it on the account -- it does not go to `failed` and it is not
 * attempted again tomorrow as though nothing happened. The one exception is a send the PROVIDER
 * refused, which is `failed`: that is not something a collector can fix by filling in a field.
 */
/**
 * How long one pass may spend SENDING before it stops and says what is left.
 *
 * `maxDuration` in vercel.json asks for 60 seconds rather than the platform's old ten, and the
 * reason lives here because vercel.json is schema-validated JSON with nowhere to say it: a pass
 * opens an SMTP connection to the collector's own mailbox for EVERY email it sends, so
 * twenty-five accounts is about a minute's work and ten seconds would be a 504 with nothing
 * reported.
 *
 * This leaves a quarter of that spare, because the planning and
 * the re-dating above have already spent some of the function's life and a single SMTP send can
 * take several seconds on its own. Overshooting the function's own limit costs the pass its
 * report -- see the note at the loop.
 */
const BUDGET_MS = 45_000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = adminClient()
  if (!admin) {
    res.status(500).json({ error: 'Server is missing Supabase configuration.' })
    return
  }

  /*
   * TWO CALLERS, AND THE NARROWER ONE IS THE ONE A PERSON MAKES.
   *
   * The cron sweeps the whole book and proves itself with CRON_SECRET, which Vercel sends on a
   * cron-triggered request. The app asks for ONE account, proves itself with the caller's own
   * session, and gets only that account -- so a signed-in user nudging their own allocation
   * cannot set the floor's sends going. Everything either of them touches is a step that was
   * already due; this hurries the work, it never invents any.
   */
  /*
   * ONE ACCOUNT OR A LIST OF THEM, AND THE LIST IS THE ORDINARY CASE.
   *
   * THE FIRM: "I handed people over as new handovers, but they didn't go the handover." They had
   * handed out EIGHT. This took a single id, so the hand-out only nudged when exactly one account
   * was allocated -- a limit written to stop a five-hundred-account hand-out becoming five
   * hundred calls out of somebody's browser, which it did by making eight of them zero.
   *
   * NO CAP ON HOW MANY, A CAP ON HOW LONG. The firm, asked: "there shouldn't be a cap... we could
   * hand over like 1,000 accounts." They are right that the total must not be limited -- a
   * handover notice that never goes is worse than one that goes late. What has to be bounded is
   * one INVOCATION, because a function has a wall clock; so this does as much as it can in the
   * time it has and reports what is left, and the caller comes back for the rest.
   */
  const body = (req.body ?? {}) as { accountId?: unknown; accountIds?: unknown }
  const accounts = [
    ...(typeof body.accountId === 'string' ? [body.accountId] : []),
    ...(Array.isArray(body.accountIds) ? body.accountIds.filter((v): v is string => typeof v === 'string') : []),
  ]
  /* De-duplicated, so a caller passing the same account twice does not make it two of the budget
     below -- and `.in()` would ask the database the same question twice for nothing. */
  const accountIds = [...new Set(accounts)]
  /*
   * AND A MISSING SECRET IS NOT A PASS.
   *
   * THIS READ `!cronSecret || ...`, so an environment with CRON_SECRET unset treated EVERY caller
   * as the timer: an unauthenticated POST to this route would date and send every due step on the
   * whole book. CRON_SECRET is unset on the deployment today, which makes that a live hole rather
   * than a theoretical one, and the fallback was the wrong way round -- an unconfigured
   * environment should refuse more, not less.
   *
   * WITHOUT THE SECRET, ONLY A SESSION AND ONLY ONE ACCOUNT. The sweep stops until somebody sets
   * it, which is visible and mendable; the app's own nudge -- a handover, an arrangement just
   * agreed -- keeps working, because it carries a session and names its account. Setting
   * CRON_SECRET restores the sweep and nothing else changes.
   */
  const cronSecret = process.env.CRON_SECRET
  const isCron = Boolean(cronSecret) && req.headers.authorization === `Bearer ${cronSecret}`
  if (!isCron) {
    const caller = await requireCaller(req, admin)
    if (!caller) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    if (accountIds.length === 0) {
      res.status(400).json({
        error: cronSecret
          ? 'Say which accounts. Only the timer sweeps the whole book.'
          : 'Say which accounts. The timer cannot sweep the book until CRON_SECRET is set.',
      })
      return
    }
  }

  /*
   * THE FIRM'S TODAY, NOT THE SERVER'S. The function runs in Paris (vercel.json pins cdg1) and
   * the firm is in Johannesburg, two hours ahead in winter and one in summer. Around midnight the
   * two disagree about what day it is, and a step dated tomorrow would go out tonight.
   *
   * AND ON STAGING, THE STAGING CLOCK'S (prompt 10). The database decides -- raptor_today() is the
   * real Johannesburg day everywhere but a staging database whose clock has been moved. Read off
   * the server's own clock instead, the 06:00 cron on a staging clock standing at 11 July would
   * send every step dated up to the real October morning.
   */
  const clock = await firmClock(admin)
  const result = await sweep(admin, { accountIds, today: clock.today, now: clock.now })
  if ('error' in result) {
    res.status(500).json({ error: result.error })
    return
  }
  res.status(200).json({ ok: true, ...result })
}

export interface SweepOptions {
  accountIds: string[]
  /** The firm's day, yyyy-mm-dd -- firmClock's, so the staging clock's on staging. */
  today: string
  /** The firm's now, for the stamps a send writes. */
  now: Date
  /**
   * A STAGING CLOCK JUMP: everything that would have happened on the day happens -- promises run
   * out, runs are planned and re-dated, steps fall due -- except that nothing is SENT. A due step is
   * recorded 'skipped' instead (staging has a live SMS gateway, and a debtor's real inbox may be on
   * a test account). See api/_lib/workflow/clock.ts.
   */
  skipSends?: boolean
  budgetMs?: number
}

/**
 * ONE MORNING'S PASS, for whichever day the caller says it is. The cron and the app's nudge call it
 * for today; the staging clock calls it once for every day it jumps over, in date order.
 */
export async function sweep(admin: SupabaseClient, options: SweepOptions) {
  const { accountIds, today, now, skipSends = false, budgetMs = BUDGET_MS } = options

  /*
   * END ANY 48 HOURS THAT HAVE RUN OUT, BEFORE ANYTHING ELSE IN THE PASS.
   *
   * ORDER IS LOAD-BEARING, AND IT IS THE SAME REASON THE RE-DATING SITS WHERE IT DOES. Breaking a
   * promise fires workflow_resume_on_promise_broken, which lets the paused section 129 go; the
   * re-dating below then moves whatever had not gone by the working days the hold lasted. Run
   * after it, the resume would happen with nothing left in the pass to move the dates, and the
   * next morning's sweep would find four notices overdue and send them at once -- which is the
   * failure the pause exists to prevent.
   */
  const expired = await expireDefaultedPromises(admin, accountIds, now)

  /*
   * DATE WHATEVER HAS NOT BEEN DATED, NEXT. A run created by the allocation trigger has no steps
   * at all until this happens -- so on a handover, planning and sending are the same pass and the
   * debtor hears from the firm within minutes rather than the next morning.
   */
  const planned = await planUnplannedRuns(admin, accountIds)

  /*
   * AND MOVE WHAT A PAUSE PUSHED BACK, BEFORE ANYTHING IS PICKED AS DUE.
   *
   * ORDER IS THE WHOLE POINT OF THIS LINE. A section 129 paused on day 1 for six weeks resumes
   * with its reminder still dated five weeks ago, because workflow_resume_account sets the run
   * running and touches no step -- the working-day calendar it would need lives here, not in the
   * database. Picked up before re-dating, `due_on <= today` would fire four notices at once on
   * the morning after a promise broke, which is the opposite of what the pause was for.
   *
   * IT IS IDEMPOTENT, so running it on every sweep costs one read and writes nothing where
   * nothing moved. That is what lets it live here at all: the resume happens in a database
   * trigger the app never sees, so there is no moment to hook other than the next pass.
   */
  const redated = await redateResumedRuns(admin, accountIds)

  /*
   * EVERY STEP DUE, AND OVERDUE ONES WITH IT. `due_on <= today` rather than `= today`: a day the
   * cron did not fire, or a step whose account was only reachable later, must not be skipped for
   * ever. The order is oldest first so a sequence that fell behind goes out in the order it was
   * written -- the reminder before the final notice, never the other way round.
   *
   * AND HELD STEPS ARE ASKED AGAIN, which is what makes the notification worth sending. A hold is
   * "nothing on the account fills {{listing_reference}}" -- a sentence that tells somebody what to
   * go and do. Looked at once and never again, doing it would change nothing and the notice would
   * sit held for ever; asked each morning, filling the field is all the collector has to do.
   *
   * A STEP THAT WAITS FOR A PERSON STILL WAITS. planSend refuses a `needsRelease` step every time
   * it is asked, so re-asking cannot send a section 129 nobody released -- it costs one decision
   * a day and changes nothing until a person acts, which is the correct behaviour rather than a
   * side effect of it.
   *
   * `failed` IS NOT RE-ASKED. That is a provider refusal, not something the account is missing,
   * and quietly retrying a message the network rejected is how a debtor gets four copies.
   */
  let query = admin
    .from('workflow_run_steps')
    .select('id, node_id, due_on, state, note, run_id, instalment_no, workflow_nodes!inner(ordinal), workflow_runs!inner(id, account_id, version_id, started_on, state)')
    .in('state', ['pending', 'held'])
    .lte('due_on', today)
    .eq('workflow_runs.state', 'running')
    .order('due_on', { ascending: true })
    .limit(200)
  if (accountIds.length) query = query.in('workflow_runs.account_id', accountIds)
  const { data: due, error } = await query
  if (error) return { error: error.message }

  /*
   * THE NOTICE BEFORE THE SMS BEHIND IT, IN THE SWEEP AS WELL AS ON THE SCREEN.
   *
   * THE FIRM: "SMSs and emails should go out at the same time, because the one refers to the other
   * one. You're just putting more manual work in for the person."
   *
   * ORDERED ONLY BY due_on ABOVE, and the two steps of a pair share it -- so the database was free
   * to hand the SMS over first. Attempted in that order the SMS says "we have emailed you" about an
   * email that has not gone, planSend refuses it on `afterStepSent`, and it is marked HELD. The
   * email then sends a moment later in the same sweep and nothing goes back for the SMS: it sits
   * waiting for a person until somebody presses it, which is precisely the manual work the firm is
   * describing. One press, one morning, and a debtor who got the letter and no text.
   *
   * SORTED HERE RATHER THAN IN THE QUERY, because ordering a top-level row by an embedded column is
   * PostgREST-version-dependent and this is at most two hundred rows already in hand.
   *
   * `ordinal` IS THE NODE'S OWN COLUMN and has said email-then-SMS since the workflow was built --
   * the same key accountRun was missing, found in the same week, in the other half of the system.
   */
  const steps = ((due ?? []) as unknown as (DueStep & { workflow_nodes?: { ordinal?: number } })[])
    .sort((a, b) => (
      a.due_on.localeCompare(b.due_on)
      || (a.workflow_nodes?.ordinal ?? 0) - (b.workflow_nodes?.ordinal ?? 0)
      /* And the instalment last, so two of one node's instalment steps coming due together --
         which needs a rewritten arrangement to happen at all -- still go in the debtor's order. */
      || (a.instalment_no ?? 0) - (b.instalment_no ?? 0)
    )) as DueStep[]
  /* `held` is a NEW hold or one whose reason changed; `stillHeld` is one that has not moved.
     Counted apart because the first is news and the second is the state of the floor -- a run
     reporting "held: 40" every morning would read as forty things going wrong daily. */
  const outcome = {
    considered: steps.length, sent: 0, held: 0, stillHeld: 0, failed: 0, skipped: 0,
    told: 0, notes: [] as string[],
  }

  /*
   * THE WALL CLOCK, WHICH IS THE ONLY CAP THERE IS.
   *
   * A function is killed at `maxDuration` with a 504 and nothing to show for the work it had
   * already done -- the steps it sent are sent, the ones it was mid-way through are neither sent
   * nor marked, and the caller is told nothing at all. So this stops ITSELF with time to spare
   * and says how many it did not reach, which is the difference between "come back for the rest"
   * and a timeout somebody has to guess the meaning of.
   *
   * MEASURED BEFORE EACH STEP, NOT AFTER. A send is seconds, not milliseconds -- SMTP opens a
   * connection to the collector's own mailbox -- so checking afterwards is checking one whole
   * send too late. The margin is one generous send's worth.
   */
  const startedAt = Date.now()
  let left = 0
  for (const step of steps) {
    if (Date.now() - startedAt > budgetMs) { left += 1; continue }
    try {
      const what = await runOneStep(admin, step, today, undefined, { now, skipSends })
      outcome[what.result] += 1
      outcome.told += what.told ?? 0
      /* Only what is new goes in the notes. A standing hold is already on the step. */
      if (what.note && what.result !== 'stillHeld') outcome.notes.push(`${step.id}: ${what.note}`)
    } catch (e) {
      /*
       * ONE STEP'S FAILURE IS NOT THE RUN'S. Two hundred accounts are being worked here; a single
       * unreadable row must not stop the other hundred and ninety-nine from being told anything.
       * The step stays pending and is picked up tomorrow, because an exception is not evidence
       * that the step should be held -- nobody has decided anything about it.
       */
      outcome.failed += 1
      outcome.notes.push(`${step.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return {
    today,
    /*
     * WHAT THIS PASS DID NOT REACH. Zero means finished; anything else is the caller's cue to
     * call again. The browser loops on it after a hand-out, and the timer simply picks the rest
     * up tomorrow -- neither needs to know how long a send takes.
     */
    remaining: left,
    /* Runs dated on this pass, so a handover nudge can say "it started" rather than only
       "nothing was due" -- which is what an unplanned run looks like from the outside. */
    planned: planned.filter((p) => p.problem === null).length,
    /* REPORTED FOR THE SAME REASON THE RE-DATING IS. An arrangement breaking is what lets a
       statutory sequence go again, and "whose 48 hours ran out on Tuesday" is a question asked
       long afterwards by somebody holding a file. */
    expired: expired.length,
    /* REPORTED, because a pause moving dates is a thing somebody will be asked about. "Nine
       steps moved on Tuesday" is the answer to "why did the reminder go out in November". */
    redated: redated.reduce((n, r) => n + r.moved, 0),
    planProblems: planned.filter((p) => p.problem !== null).map((p) => `${p.runId}: ${p.problem}`),
    ...outcome,
  }
}

