import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../auth.js'
import { todayInJohannesburg } from './locale.js'
import { runOneStep, type DueStep } from './step.js'

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
    .select('id, node_id, due_on, state, note, run_id, workflow_runs!inner(id, account_id, version_id, started_on, state)')
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

  if (!await mayRelease(admin, caller.id, run.account_id)) {
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
  const outcome = await runOneStep(admin, step, todayInJohannesburg(), caller.id)
  res.status(200).json({ ok: true, ...outcome })
}

/**
 * Whose account this is, and who else may act on it.
 *
 * THE COLLECTOR HOLDING IT, OR SOMEBODY WHO LEADS THE FLOOR. The schema's own note on
 * workflow_run_steps says as much -- "a collector releases a held step on their own account,
 * which the library's Administrator-and-team-leader rule would refuse" -- so the row-level policy
 * is deliberately wide and this is where the narrowing happens.
 *
 * NOT ANY PRE-LEGAL AGENT. The write policy admits every agent, because RLS cannot see which
 * account a step belongs to without a join it would have to do on every row. Left at that, any of
 * thirty-two agents could issue a statutory demand on any of twenty-three thousand accounts --
 * and the record would name them, having never seen the file.
 */
async function mayRelease(
  admin: ReturnType<typeof adminClient>, userId: string, accountId: string,
): Promise<boolean> {
  if (!admin) return false
  const [{ data: profile }, { data: account }] = await Promise.all([
    admin.from('profiles').select('role').eq('id', userId).maybeSingle(),
    admin.from('debtor_accounts').select('assigned_to').eq('id', accountId).maybeSingle(),
  ])
  if (!profile) return false
  /*
   * canLeadCollections' roles, named here rather than imported: permissions.ts is browser code
   * and reaching into it from a route would put the app's module graph inside a function.
   *
   * A COPY, SO IT HAS TO BE KEPT. Adding 'Call Centre Manager' to canLeadCollections left this
   * one behind -- the manager could hand accounts out and lead the floor everywhere except here,
   * where releasing a held notice would have refused them with no explanation. check-departments
   * holds the two lists against each other now, which is the only reason it was found.
   */
  if (profile.role === 'Administrator' || profile.role === 'Call Centre Manager'
    || profile.role === 'Pre-legal Team Leader') return true
  return Boolean(account?.assigned_to) && account?.assigned_to === userId
}
