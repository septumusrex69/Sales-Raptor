/**
 * THE WORKFLOW AN ACCOUNT IS IN, AS THE ACCOUNT SCREEN NEEDS TO SEE IT.
 *
 * The runner writes to `workflow_run_steps` every morning and nothing on any screen read it back.
 * A held step carried its reason -- "nothing on the account fills {{listing_reference}}" -- in a
 * column nobody opens, and the notification raised beside it pointed at an account page that
 * said nothing about it. A warning that sends somebody to a screen where the thing is not is
 * worse than no warning, for the same reason CLAUDE.md gives about warnings generally.
 *
 * READ DIRECTLY, NOT THROUGH AppStore. This is the collections side: AppStore holds the few
 * hundred sales rows a person edits, and the book is queried per account with the filters in the
 * database. One account's run is a handful of rows and belongs on that path.
 */
import { supabase } from './supabase'
import type { DayUnit } from './workflowBuilder.ts'
import type { RunStep, RunStepState } from './runSteps.ts'

export interface AccountRun {
  id: string
  workflowName: string
  /** running | finished | left -- and `leftReason` says which event took it out. */
  state: string
  leftReason: string | null
  startedOn: string
  dayUnit: DayUnit
  steps: RunStep[]
}

/**
 * Every run this account has been through, newest first.
 *
 * NOT ONLY THE LIVE ONE. "What did we send this debtor, and when?" is a question an attorney asks
 * eighteen months later, and a run that left on a promise is exactly the one somebody needs to
 * see when the promise breaks. The screen decides what to show; this does not decide it for them.
 */
export async function fetchAccountRuns(accountId: string): Promise<AccountRun[]> {
  const { data, error } = await supabase
    .from('workflow_runs')
    .select(`
      id, state, left_reason, started_on,
      workflow_versions!inner(day_unit, workflows!inner(name)),
      workflow_run_steps(id, due_on, state, note, sent_at,
        workflow_nodes!inner(label, channel, day))
    `)
    .eq('account_id', accountId)
    .order('started_on', { ascending: false })
  if (error) throw new Error(error.message)

  /* eslint-disable @typescript-eslint/no-explicit-any -- rows arrive as untyped JSON. */
  return (data ?? []).map((r: any) => ({
    id: r.id,
    workflowName: r.workflow_versions?.workflows?.name ?? 'Workflow',
    state: r.state,
    leftReason: r.left_reason ?? null,
    startedOn: r.started_on,
    dayUnit: (r.workflow_versions?.day_unit ?? 'calendar') as DayUnit,
    /*
     * ORDERED BY THE DATE IT LANDS ON, then by the day number. Not by the order PostgREST handed
     * them over, which is whatever the planner chose -- a sequence drawn out of order reads as a
     * final notice before the reminder that precedes it.
     */
    steps: (r.workflow_run_steps ?? [])
      .map((s: any): RunStep => ({
        id: s.id,
        label: s.workflow_nodes?.label ?? 'Step',
        channel: s.workflow_nodes?.channel ?? null,
        day: s.workflow_nodes?.day ?? 0,
        dueOn: s.due_on,
        state: s.state as RunStepState,
        note: s.note ?? null,
        sentAt: s.sent_at ?? null,
      }))
      .sort((a: RunStep, b: RunStep) => a.dueOn.localeCompare(b.dueOn) || a.day - b.day),
  }))
}
