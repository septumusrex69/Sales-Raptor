import type { SupabaseClient } from '@supabase/supabase-js'
import { planRun } from '../../../src/lib/workflowRun.js'
import { heldDays, movedOn, type HoldPeriod } from '../../../src/lib/workflowHold.js'
import { landsOn, type DayUnit, type WorkflowNode } from '../../../src/lib/workflowBuilder.js'

/**
 * DATING THE STEPS OF A RUN THAT HAS JUST STARTED.
 *
 * The allocation trigger creates a run and stops, because dating its steps means knowing which
 * days are working days -- Easter, and the Monday a public holiday moves to when it falls on a
 * Sunday -- and that calendar is workingDays.ts. The schema's own note on workflow_run_steps says
 * why a second copy in SQL is refused: it would be the one that is wrong about Heritage Day in
 * the year nobody checks, on a sequence whose intervals are statutory.
 *
 * So a run arrives here with no steps at all, and this is the half that has the calendar.
 *
 * DATED ONCE, WHEN THE RUN STARTS, AND NOT RE-DERIVED. `planRun` resolves every day number to a
 * real date and those dates are stored -- so two files that entered on the same day stay in step,
 * a collector sees the whole sequence on day one, and nothing moves when somebody edits a draft.
 * That is also what lets the morning run be a date comparison rather than a calendar.
 */
export interface PlannedRun {
  runId: string
  steps: number
  /** Null where it planned, or why it could not. */
  problem: string | null
}

/**
 * Plan every running run that has no steps yet.
 *
 * `accountId` narrows it to one account, which is what the app asks for the moment somebody is
 * allocated -- so the handover goes out in minutes rather than waiting for the morning. Left out,
 * it sweeps, which is the cron's job and the backstop for anything the app missed.
 */
export async function planUnplannedRuns(
  admin: SupabaseClient, accountId?: string,
): Promise<PlannedRun[]> {
  let query = admin
    .from('workflow_runs')
    .select('id, account_id, version_id, started_on, workflow_run_steps(id)')
    .eq('state', 'running')
    .order('created_at', { ascending: true })
    .limit(200)
  if (accountId) query = query.eq('account_id', accountId)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  /*
   * A RUN WITH NO STEPS IS ONE NOBODY HAS DATED YET, and it is distinguishable from a finished
   * one: `isFinished` is false for an empty run, deliberately. Filtered here rather than in the
   * query because PostgREST cannot ask for "no related rows" without a view.
   */
  const unplanned = (data ?? []).filter((r) => ((r.workflow_run_steps ?? []) as unknown[]).length === 0)
  const out: PlannedRun[] = []

  for (const run of unplanned) {
    try {
      out.push(await planOne(admin, run as unknown as RunRow))
    } catch (e) {
      /* One run's failure is not the sweep's: a version somebody deleted the nodes of must not
         stop every other account being dated. */
      out.push({ runId: (run as { id: string }).id, steps: 0, problem: e instanceof Error ? e.message : String(e) })
    }
  }
  return out
}

/**
 * MOVE WHAT IS STILL TO COME, ON A RUN THAT HAS BEEN PAUSED AND LET GO.
 *
 * THE OTHER HALF OF THE PAUSE, AND WITHOUT IT THE FIRST HALF IS A LIE. workflow_resume_account
 * sets the run running again and closes the hold; the steps keep the dates they were given when
 * it started. So a section 129 paused on day 1 for six weeks would resume with its reminder due
 * five weeks ago, and the very next sweep would fire four notices at once -- which is the
 * opposite of what the pause was for, and what the screen promises: "upcoming dates
 * recalculated".
 *
 * ONLY WHAT HAS NOT GONE. A step that was SENT keeps its date for ever: it is the record of a
 * notice that reached a debtor, and moving it would be rewriting the file an attorney reads.
 * Cancelled steps are left alone for the same reason.
 *
 * IT IS IDEMPOTENT, WHICH IS WHY IT CAN LIVE IN THE SWEEP. Every step's date is computed from the
 * run's start, its day number and the total of its closed holds -- three things that do not
 * change between two runs of this -- so re-running it writes nothing the second time. That is
 * what makes it safe to do on every pass rather than only on the resume, which matters because
 * the resume happens in a database trigger the app never sees.
 */
export async function redateResumedRuns(
  admin: SupabaseClient, accountId?: string,
): Promise<{ runId: string; moved: number }[]> {
  let query = admin
    .from('workflow_runs')
    .select(`id, started_on, version_id,
      workflow_versions!inner(day_unit),
      workflow_run_holds!inner(started_on, ended_on),
      workflow_run_steps(id, due_on, state, workflow_nodes!inner(day, ordinal))`)
    .eq('state', 'running')
    .limit(200)
  if (accountId) query = query.eq('account_id', accountId)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const out: { runId: string; moved: number }[] = []
  /* eslint-disable @typescript-eslint/no-explicit-any -- rows arrive as untyped JSON. */
  for (const run of (data ?? []) as any[]) {
    const unit = (run.workflow_versions?.day_unit ?? 'calendar') as DayUnit
    const holds: HoldPeriod[] = (run.workflow_run_holds ?? [])
      .map((h: any) => ({ startedOn: h.started_on, endedOn: h.ended_on ?? null }))
    const lost = heldDays(holds, unit)
    if (lost <= 0) continue

    let moved = 0
    for (const step of (run.workflow_run_steps ?? []) as any[]) {
      if (step.state !== 'pending' && step.state !== 'held') continue
      const should = movedOn(
        landsOnFor(run.started_on, step.workflow_nodes?.day ?? 0, unit), lost, unit,
      )
      if (should === step.due_on) continue
      const { error: bad } = await admin.from('workflow_run_steps')
        .update({ due_on: should }).eq('id', step.id)
      if (!bad) moved += 1
    }
    if (moved > 0) out.push({ runId: run.id, moved })
  }
  return out
}

/* Named apart so the import stays honest about which module owns the day-number calendar. */
function landsOnFor(from: string, day: number, unit: DayUnit): string {
  return landsOn(from, day, unit)
}

interface RunRow { id: string; account_id: string; version_id: string; started_on: string }

async function planOne(admin: SupabaseClient, run: RunRow): Promise<PlannedRun> {
  const [{ data: version }, { data: nodes }] = await Promise.all([
    admin.from('workflow_versions').select('id, day_unit').eq('id', run.version_id).maybeSingle(),
    admin.from('workflow_nodes')
      .select('id, day, ordinal, needs_release, statutory')
      .eq('version_id', run.version_id),
  ])
  if (!version) return { runId: run.id, steps: 0, problem: 'The version this run follows is gone.' }
  if (!nodes || nodes.length === 0) {
    /*
     * A VERSION WITH NO STEPS IS NOT AN ERROR TO RETRY FOR EVER. It finishes: there was nothing
     * to do. Left running and empty it would be re-read by every sweep, and it would read on the
     * account as a workflow that has started and never does anything.
     */
    await admin.from('workflow_runs').update({ state: 'finished' }).eq('id', run.id)
    return { runId: run.id, steps: 0, problem: 'The workflow has no steps in it. Marked finished.' }
  }

  /*
   * A RUN DATED AFTER IT HAS ALREADY BEEN PAUSED STARTS BEHIND. Rare but real: a section 129
   * begun, held by a promise the same afternoon, and the sweep reaching it the next morning. Its
   * day numbers still count from started_on, and the pause still happened, so both apply.
   */
  const { data: holds } = await admin.from('workflow_run_holds')
    .select('started_on, ended_on').eq('run_id', run.id)
  const unit = ((version.day_unit as string) ?? 'calendar') as DayUnit
  const lost = heldDays(
    (holds ?? []).map((h) => ({ startedOn: h.started_on as string, endedOn: (h.ended_on as string | null) ?? null })),
    unit,
  )

  const planned = planRun({
    /* Only what planRun reads. The rest of a WorkflowNode is about how it is drawn and what it
       sends, neither of which decides a date. */
    nodes: nodes.map((n) => ({
      id: n.id as string,
      day: n.day as number,
      ordinal: (n.ordinal as number) ?? 0,
      needsRelease: Boolean(n.needs_release),
      statutory: Boolean(n.statutory),
    })) as unknown as WorkflowNode[],
    dayUnit: unit,
    startedOn: run.started_on,
  })

  /*
   * INSERTED IN ONE GO, and a second sweep cannot double them: (run_id, node_id) is unique, so a
   * planner racing itself -- the app nudging while the cron sweeps -- is refused by the database
   * rather than left to be noticed at month end.
   */
  const { error } = await admin.from('workflow_run_steps').insert(
    planned.map((s) => ({
      run_id: run.id, node_id: s.nodeId, due_on: movedOn(s.dueOn, lost, unit), state: s.state, note: s.note,
    })),
  )
  if (error) {
    /* A duplicate key here means somebody else planned it first, which is the right outcome and
       not a failure -- report it as planned by another pass rather than as a fault. */
    if (/duplicate key/i.test(error.message)) {
      return { runId: run.id, steps: 0, problem: null }
    }
    return { runId: run.id, steps: 0, problem: error.message }
  }
  return { runId: run.id, steps: planned.length, problem: null }
}
