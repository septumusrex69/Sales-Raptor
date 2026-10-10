import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../auth.js'
import { firmClock } from './clock.js'
import { runOneStep, type DueStep } from './step.js'
import { mayActOnAccount } from './who.js'

/**
 * A PERSON SAYS SEND IT.
 *
 * The firm's own rule for the two steps that carry `needsRelease`: day 39 tells a debtor their
 * default HAS been reported and quotes the listing reference; day 49 tells them their file HAS
 * gone to the attorneys. Sending either before it is true is a misrepresentation, and the firm's
 * note says it is the kind of thing the Council for Debt Collectors acts on. So the morning run
 * prepares them and stops, and this is the person who has checked.
 *
 * IT LIFTS ONE REFUSAL AND NOTHING ELSE. `planSend` stops waiting for a person; every other
 * guard still applies to whoever pressed the button. Pressed on a listing notice whose reference
 * is still missing, the step holds again with the same reason -- which is why the button is safe
 * to offer on EVERY held step rather than only the statutory ones. A person cannot supply a fact
 * by clicking.
 *
 * THE SAME PATH AS THE CRON, deliberately: one `runOneStep`, so the wording, the fee, the Sent
 * copy and the record are identical whether a notice went out at six in the morning or because
 * somebody pressed a button at four in the afternoon. Written twice, the drift would show up as
 * a debtor charged differently depending on who sent the notice.
 */
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
  /* A SESSION, NOT THE CRON SECRET. This is the one route in the group a person calls, and the
     whole point of it is that a named person takes responsibility for the send. */
  const caller = await requireCaller(req, admin)
  if (!caller) {
    res.status(401).json({ error: 'Invalid or expired session.' })
    return
  }

  const { stepId } = (req.body ?? {}) as { stepId?: string }
  if (!stepId) {
    res.status(400).json({ error: 'Which step is being released?' })
    return
  }

  const { data: row, error } = await admin
    .from('workflow_run_steps')
    .select('id, node_id, due_on, state, note, run_id, instalment_no, workflow_runs!inner(id, account_id, version_id, started_on, state)')
    .eq('id', stepId)
    .maybeSingle()
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  if (!row) {
    res.status(404).json({ error: 'That step is not there any more.' })
    return
  }

  const step = row as unknown as DueStep
  /*
   * ONLY A HELD STEP. A sent one is the record of a notice that reached a debtor and pressing a
   * button must not send it twice; a cancelled one belongs to a run the account has left, which
   * is the firm's rule -- "a cancelled node must not fire later". Refused by name rather than
   * quietly ignored, because a button that appears to work and does nothing is worse than one
   * that says why it will not.
   */
  if (step.state !== 'held') {
    res.status(409).json({
      error: step.state === 'sent'
        ? 'That notice has already gone out.'
        : 'That step is not waiting to be sent.',
    })
    return
  }
  const run = step.workflow_runs as unknown as { state: string; account_id: string }
  if (run.state !== 'running') {
    res.status(409).json({
      error: 'This account has left the workflow, so nothing more goes out on it.',
    })
    return
  }

  /*
   * AND NOT BEFORE THE DAY IT FALLS ON.
   *
   * A release lifts the one refusal that waits for a person; it must not also move the date. The
   * intervals in this sequence are statutory — ten business days to answer the demand, twenty
   * before a bureau listing — and a step sent early does not merely arrive early: day 39 says the
   * default HAS been reported and day 49 says the file HAS gone to the attorneys, so sending
   * either before its day is a misrepresentation, which the firm's own note calls the kind of
   * thing the Council for Debt Collectors acts on.
   *
   * THE FIRM MET THIS. Starting a section 129 drew four notices "waiting on you" with a button
   * under each, the furthest dated two and a half months out, because planRun used to mark every
   * needs-release step held on day one. That is fixed where it was made — but a guard that only
   * lives in the planner is a guard one bad row gets past, and the row here decides whether a
   * debtor is told something untrue.
   *
   * OVERDUE IS FINE, and is most of the point: a step that came due on Tuesday and was held goes
   * out today, which is why this is `>` and not `!==`.
   */
  /* The firm's day as the database keeps it -- the staging clock's, on staging (prompt 10). */
  const { today, now } = await firmClock(admin)
  if (step.due_on > today) {
    res.status(409).json({
      error: `That step is not due until ${step.due_on}. It says something that is not true yet, `
        + 'so it cannot be sent early.',
    })
    return
  }

  if (!await mayActOnAccount(admin, caller.id, run.account_id)) {
    res.status(403).json({
      error: 'This account is not yours, and you do not lead the floor it is on.',
    })
    return
  }

  /*
   * TODAY, NOT THE STEP'S DUE DATE. A notice released three days late goes out today and says so
   * -- {{today}} is merged from here. Its CHARGE is still priced on the step's own due date,
   * which planSend decides and which is CLAUDE.md's rule about the action's date.
   */
  const outcome = await runOneStep(admin, step, today, caller.id, { now })

  /*
   * AND THE SMS THAT GOES WITH IT, ON THE SAME PRESS.
   *
   * THE FIRM: "you need to send the SMS manually, all right? And you need to, even after you've
   * sent this 129." Their chart has six steps and Raptor stored eleven, because every step is a
   * notice AND the text message telling the debtor to go and read it -- so releasing the letter
   * left the SMS sitting there needing a second press, on a screen that had just said the step was
   * done. Six steps on the chart and eleven presses in the work.
   *
   * THE PAIRING RULE IS THE RUNNER'S OWN, and it is why no column was added for this: a step whose
   * node carries `after_minutes` follows the one on the same day that does not, which is exactly
   * how planSend already decides whether the message before this one went out.
   *
   * ONLY AFTER THE LETTER ACTUALLY WENT. The SMS says "we have emailed you"; sending it behind a
   * letter that held would tell the debtor to go and read something that was never sent. planSend
   * would refuse it anyway on `afterStepSent` -- this is the same rule, applied before the attempt
   * rather than after it, so the outcome reported is the truth rather than a second failure.
   *
   * AND PENDING COUNTS, NOT ONLY HELD. The follower is usually pending: the morning sweep passed
   * over it because the letter it follows was still waiting for a person. It is the same press.
   */
  const companions: typeof outcome[] = []
  if (outcome.result === 'sent') {
    const { data: behind } = await admin
      .from('workflow_run_steps')
      .select('id, node_id, due_on, state, note, run_id, instalment_no, workflow_nodes!inner(after_minutes), workflow_runs!inner(id, account_id, version_id, started_on, state)')
      .eq('run_id', step.run_id)
      .eq('due_on', step.due_on)
      /* AND THE SAME INSTALMENT, or releasing one arrangement notice would drag another
         instalment's SMS out behind it -- see slotOf in stepPairs.ts for the day they collide. */
      .eq('instalment_no', step.instalment_no ?? 0)
      .neq('id', step.id)
      .in('state', ['pending', 'held'])
      .not('workflow_nodes.after_minutes', 'is', null)
      .order('due_on', { ascending: true })
    for (const s of (behind ?? []) as unknown as DueStep[]) {
      try {
        companions.push(await runOneStep(admin, s, today, caller.id, { now }))
      } catch (e) {
        /* One message's failure is not the other's: the notice HAS gone, and saying so while
           reporting what happened to the SMS is the honest account of the press. */
        companions.push({
          result: 'failed',
          note: e instanceof Error ? e.message : String(e),
        } as typeof outcome)
      }
    }
  }

  res.status(200).json({
    ok: true,
    ...outcome,
    /* What went with it, so the screen can say "the notice and the SMS went" rather than leaving
       somebody to wonder whether the second one is still waiting. */
    alsoSent: companions.filter((c) => c.result === 'sent').length,
    alsoHeld: companions.filter((c) => c.result !== 'sent').length,
    alsoNotes: companions.filter((c) => c.result !== 'sent').map((c) => c.note).filter(Boolean),
  })
}
