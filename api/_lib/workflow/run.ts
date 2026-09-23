import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from '../auth.js'
import { todayInJohannesburg } from './locale.js'
import { runOneStep, type DueStep } from './step.js'

/**
 * THE MORNING RUN: every workflow step that has come due, sent or held.
 *
 * The firm: "I'll send every letter by hand once and every SMS once. And then I want these things
 * working automatically in the workflow." This is the second half of that sentence.
 *
 * ONCE A DAY, AND THAT IS THE RIGHT GRAIN. Every step is dated to a DAY -- `landsOn` resolves
 * "business day 32" to a date when the run starts -- so nothing in the firm's sequence is finer
 * than daily, and a runner that woke every five minutes would spend the day asking a question
 * whose answer changes at midnight. It is a Vercel cron in vercel.json, like the mail sync
 * beside it, rather than pg_cron reaching back out over HTTP: one scheduler, already in the repo,
 * already understood.
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
export default async function handler(req: VercelRequest, res: VercelResponse) {
  /* Vercel sends `Authorization: Bearer $CRON_SECRET` on cron-triggered requests when the env var
     is set. Same guard as the mail sync, which is the only other thing on a timer. */
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

  /*
   * THE FIRM'S TODAY, NOT THE SERVER'S. The function runs in Paris (vercel.json pins cdg1) and
   * the firm is in Johannesburg, two hours ahead in winter and one in summer. Around midnight the
   * two disagree about what day it is, and a step dated tomorrow would go out tonight.
   */
  const today = todayInJohannesburg()

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
  const { data: due, error } = await admin
    .from('workflow_run_steps')
    .select('id, node_id, due_on, state, note, run_id, workflow_runs!inner(id, account_id, version_id, started_on, state)')
    .in('state', ['pending', 'held'])
    .lte('due_on', today)
    .eq('workflow_runs.state', 'running')
    .order('due_on', { ascending: true })
    .limit(200)
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const steps = (due ?? []) as unknown as DueStep[]
  /* `held` is a NEW hold or one whose reason changed; `stillHeld` is one that has not moved.
     Counted apart because the first is news and the second is the state of the floor -- a run
     reporting "held: 40" every morning would read as forty things going wrong daily. */
  const outcome = {
    considered: steps.length, sent: 0, held: 0, stillHeld: 0, failed: 0,
    told: 0, notes: [] as string[],
  }

  for (const step of steps) {
    try {
      const what = await runOneStep(admin, step, today)
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

  res.status(200).json({ ok: true, today, ...outcome })
}

