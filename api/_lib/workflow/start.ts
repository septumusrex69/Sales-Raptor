import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../auth.js'
import { todayInJohannesburg } from './locale.js'
import { planUnplannedRuns } from './plan.js'
import { runOneStep, type DueStep } from './step.js'
import { mayActOnAccount } from './who.js'

/**
 * A COLLECTOR ISSUES THE SECTION 129, AND THAT IS WHAT STARTS THE CLOCK.
 *
 * THE FIRM, ASKED HOW IT SHOULD WORK: "the moment the section 129 is sent out via email, that is
 * when the workflow is triggered." Which is the truth about the work: the statutory demand is the
 * event the whole sequence is measured from -- ten business days to answer it, the final notice
 * after that, the bureau twenty business days later -- and a file is ready for it when a person
 * says so, not when a timer says so.
 *
 * SO THIS IS THE ONLY WAY A `by_hand` WORKFLOW EVER STARTS. The other kind starts itself:
 * workflow_start_on_allocation fires in the database the first time an account lands on somebody's
 * desk, which is what the handover runs on. Before this route there was no second way in at all,
 * so the section 129 sequence was eleven steps nothing could reach -- written, dated in business
 * days, and unreachable.
 *
 * IT SENDS THE FIRST STEP IN THE SAME PRESS, and that is the point rather than a convenience.
 * Day 1 of the sequence IS the section 129, and it carries `needs_release` because a statutory
 * demand must not go out without a person having looked. The person looked: they pressed a button
 * that says what it sends. Passing the caller to runOneStep is what lifts that one refusal, and it
 * lifts it only for what is due on the day the run starts -- the listing notice on day 39 and the
 * summons on day 49 still wait for their own press, because each asserts a fact that has to be
 * true before it is said.
 *
 * WHAT IT REFUSES, AND WHY EACH ONE. A live promise or an open dispute are precisely the two
 * events that take an account OUT of a workflow (workflow_exit_on_promise, workflow_exit_on_dispute
 * in the schema) -- so starting one on top of either would issue a demand to somebody the firm has
 * an arrangement with, or who is waiting for an answer to a query. The exit triggers cannot help
 * here: they fire when the promise or the dispute is created, and this is the other order.
 *
 * AND ONCE PER ACCOUNT AND VERSION, EVER. The same rule the allocation trigger states in SQL: not
 * "no second LIVE run", which the partial unique index already enforces, but no second run at all.
 * A section 129 sequence begun twice on one account is two statutory clocks on one debt.
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
  /* A SESSION, NEVER THE CRON SECRET. Nothing about this is scheduled: the whole point is that a
     named person decided the file was ready, and the run records who. */
  const caller = await requireCaller(req, admin)
  if (!caller) {
    res.status(401).json({ error: 'Invalid or expired session.' })
    return
  }

  const { accountId, versionId } = (req.body ?? {}) as { accountId?: string; versionId?: string }
  if (!accountId || !versionId) {
    res.status(400).json({ error: 'Say which account, and which workflow.' })
    return
  }

  const [versionRes, accountRes] = await Promise.all([
    admin.from('workflow_versions')
      .select('id, state, trigger_kind, workflows!inner(name)')
      .eq('id', versionId).maybeSingle(),
    admin.from('debtor_accounts').select('id, status').eq('id', accountId).maybeSingle(),
  ])
  const version = versionRes.data as
    { id: string; state: string; trigger_kind: string; workflows?: { name?: string } } | null
  if (!version) {
    res.status(404).json({ error: 'That workflow is not there any more.' })
    return
  }
  if (!accountRes.data) {
    res.status(404).json({ error: 'That account is not there any more.' })
    return
  }

  /*
   * PUBLISHED, NOT A DRAFT. A draft is being argued about -- the wording, the days, which steps
   * exist -- and what a file went through is a question an attorney asks eighteen months later.
   * Said as the sentence somebody can act on, since publishing it is one button in the Library.
   */
  if (version.state !== 'active') {
    res.status(409).json({
      error: version.state === 'draft'
        ? 'That workflow is still a draft. Publish it in the Library before it can be started on a file.'
        : 'That version of the workflow has been archived, so nothing new starts on it.',
    })
    return
  }
  /*
   * ONLY A WORKFLOW THAT WAITS FOR A PERSON. One that starts on an event starts itself, in the
   * database; offering to start it by hand as well would give an account two runs of the same
   * sequence the day somebody pressed the button before the event arrived.
   */
  if (version.trigger_kind !== 'by_hand') {
    res.status(409).json({
      error: 'That workflow starts on its own when its event happens. It is not one a person starts.',
    })
    return
  }

  if (!await mayActOnAccount(admin, caller.id, accountId)) {
    res.status(403).json({
      error: 'This account is not yours, and you do not lead the floor it is on.',
    })
    return
  }

  /*
   * ONCE PER ACCOUNT AND VERSION, EVER -- WITH ONE NARROWING.
   *
   * A run whose DEMAND WAS DEFECTIVE may be issued again. The firm upheld a dispute, the amount
   * was corrected, and a section 129 that stated a figure the firm has since conceded was wrong
   * never started a good clock -- so the fresh sequence is one clock, not two. reissue_allowed is
   * written by the dispute trigger and by nothing else.
   *
   * EVERY RUN, NOT ANY. One good run among them means this account has had a valid demand, and
   * that is the clock the rule exists to protect.
   */
  const { data: already } = await admin.from('workflow_runs')
    .select('id, reissue_allowed').eq('account_id', accountId).eq('version_id', versionId)
  const blocking = (already ?? []).filter((r) => !(r as { reissue_allowed?: boolean }).reissue_allowed)
  if (blocking.length > 0) {
    res.status(409).json({
      error: 'This account has already been through this workflow. A second run would be a second clock on one debt.',
    })
    return
  }

  /* The two the workflow itself exits on, checked here because this is the other order: the exit
     triggers fire when a promise or a dispute is created, and cannot see one that already exists. */
  const [promiseRes, disputeRes] = await Promise.all([
    admin.from('promises_to_pay').select('id').eq('account_id', accountId).eq('status', 'open').limit(1),
    admin.from('account_queries').select('id').eq('account_id', accountId).eq('kind', 'dispute')
      .neq('status', 'closed').limit(1),
  ])
  if ((promiseRes.data ?? []).length > 0) {
    res.status(409).json({
      error: 'There is a live promise to pay on this account. A demand would go to somebody the firm has an arrangement with.',
    })
    return
  }
  if ((disputeRes.data ?? []).length > 0) {
    res.status(409).json({
      error: 'There is an open dispute on this account. It has to be answered before a demand goes out.',
    })
    return
  }

  /*
   * THE FIRM'S DAY, not the server's. The function runs in Paris and the firm is two hours ahead
   * in winter; around midnight the two disagree about the date, and started_on is what every step
   * of the sequence is counted from -- ten business days from the wrong day is the wrong day.
   */
  const today = todayInJohannesburg()
  const { data: created, error: insertError } = await admin.from('workflow_runs')
    .insert({ account_id: accountId, version_id: versionId, started_on: today, started_by: caller.id })
    .select('id').single()
  if (insertError || !created) {
    res.status(500).json({ error: insertError?.message ?? 'The workflow could not be started.' })
    return
  }

  /* Dated here, like every other run: the working-day calendar lives in the app, so the run is
     created with no steps and planUnplannedRuns gives them their dates. */
  const planned = await planUnplannedRuns(admin, accountId)
  const problem = planned.find((p) => p.runId === created.id && p.problem !== null)?.problem ?? null

  /*
   * AND WHAT IS DUE TODAY GOES NOW. Only this run's steps -- an account may have a handover run
   * of its own sitting held on something, and starting the section 129 is not a decision about
   * that one.
   */
  const { data: due } = await admin
    .from('workflow_run_steps')
    .select('id, node_id, due_on, state, note, run_id, workflow_runs!inner(id, account_id, version_id, started_on, state)')
    .eq('run_id', created.id)
    .in('state', ['pending', 'held'])
    .lte('due_on', today)
    .order('due_on', { ascending: true })

  const outcome = { sent: 0, held: 0, stillHeld: 0, failed: 0, notes: [] as string[] }
  for (const step of (due ?? []) as unknown as DueStep[]) {
    try {
      const what = await runOneStep(admin, step, today, caller.id)
      outcome[what.result] += 1
      if (what.note) outcome.notes.push(what.note)
    } catch (e) {
      /* One step's failure is not the run's: the run HAS started, and the morning sweep picks up
         whatever did not go. Reported rather than swallowed, because the person is watching. */
      outcome.failed += 1
      outcome.notes.push(e instanceof Error ? e.message : String(e))
    }
  }

  res.status(200).json({
    ok: true,
    runId: created.id,
    workflow: version.workflows?.name ?? 'Workflow',
    startedOn: today,
    planProblem: problem,
    ...outcome,
  })
}
