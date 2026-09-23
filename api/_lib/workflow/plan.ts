import type { SupabaseClient } from '@supabase/supabase-js'
import { planRun } from '../../../src/lib/workflowRun.js'
import type { WorkflowNode } from '../../../src/lib/workflowBuilder.js'

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
    dayUnit: ((version.day_unit as string) ?? 'calendar') as 'calendar' | 'business',
    startedOn: run.started_on,
  })

  /*
   * INSERTED IN ONE GO, and a second sweep cannot double them: (run_id, node_id) is unique, so a
   * planner racing itself -- the app nudging while the cron sweeps -- is refused by the database
   * rather than left to be noticed at month end.
   */
  const { error } = await admin.from('workflow_run_steps').insert(
    planned.map((s) => ({
      run_id: run.id, node_id: s.nodeId, due_on: s.dueOn, state: s.state, note: s.note,
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
