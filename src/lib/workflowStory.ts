import type { AccountRun } from './accountRun.ts'
import { needsAttention, type RunStep } from './runSteps.ts'

/**
 * WHAT HAS HAPPENED TO THIS DEBTOR'S SEQUENCES, IN ORDER, AS EVENTS.
 *
 * THE FIRM DREW THIS. Their mockup of the workflow pane is a dated rail with one card per thing
 * that happened -- "Promise to Pay · Broken", "Section 129 resumed", "Section 129 · Active" --
 * and a "Past workflow history" underneath listing the same events in one line each. Both read
 * off the same stream, which is this.
 *
 * WHY IT IS NOT THE RUNS. A run is a row with one state on it: today's. The pane has to say what
 * happened on the 26th, on the 10th and on the 11th, which is three different things about the
 * same two rows -- started, paused, resumed. Those moments live in workflow_run_holds and in the
 * steps, and nowhere is there a list of them. This makes one.
 *
 * PURE, AND ITS OWN FILE, for the reason every rule in this codebase ends up in one: a stream
 * assembled inside the component is a stream no check can run. What somebody sees on the day a
 * promise breaks is worth asserting.
 */

export type StoryKind =
  | 'started'
  | 'paused'
  | 'resumed'
  /** A run that ended early: a promise broken, a dispute upheld, payment in full. */
  | 'left'
  | 'finished'

export interface StoryEvent {
  id: string
  kind: StoryKind
  /** The day it happened, as yyyy-mm-dd. The rail groups on this. */
  on: string
  /** The run it happened to, so a card can draw that run's track under it. */
  runId: string
  runName: string
  /** The firm's words for the event: "Section 129 paused". */
  title: string
  /** Why, in the firm's words. Null where the event speaks for itself. */
  detail: string | null
}

/**
 * THE EVENTS, NEWEST FIRST.
 *
 * NEWEST FIRST BECAUSE THE PANE IS READ FROM THE TOP and what matters is what just happened --
 * the same order the activity timeline beside it uses, and for the same reason. The history
 * panel at the bottom of the firm's mockup reads OLDEST first, because a history is a story; it
 * reverses this rather than building its own, so the two can never disagree about what happened.
 */
export function workflowStory(runs: AccountRun[]): StoryEvent[] {
  const out: StoryEvent[] = []

  for (const run of runs) {
    out.push({
      id: `start:${run.id}`,
      kind: 'started',
      on: run.startedOn,
      runId: run.id,
      runName: run.workflowName,
      title: `${run.workflowName} started`,
      detail: null,
    })

    for (const hold of run.holds) {
      out.push({
        id: `hold:${hold.id}`,
        kind: 'paused',
        on: hold.startedOn,
        runId: run.id,
        runName: run.workflowName,
        title: `${run.workflowName} paused`,
        detail: hold.reason,
      })
      if (hold.endedOn) {
        out.push({
          id: `release:${hold.id}`,
          kind: 'resumed',
          on: hold.endedOn,
          runId: run.id,
          runName: run.workflowName,
          title: `${run.workflowName} resumed`,
          /*
           * THE FIRM'S OWN SENTENCE, off their mockup: "Continued from the paused point.
           * Completed notices are preserved; upcoming dates recalculated." It is worth saying
           * every time, because it answers the question somebody has when they see a sequence
           * start moving again after six weeks -- did we lose anything, and are the dates right.
           */
          detail: 'Continued from where it stopped. What has gone stays sent; what is still to '
            + 'come was moved on by the length of the pause.',
        })
      }
    }

    /*
     * AN ENDING IS DATED BY WHAT ENDED IT, not by today. A run that left in March must sit in
     * March on the rail -- dated now, the pane would say a promise broke this morning.
     */
    if (run.state === 'left') {
      out.push({
        id: `left:${run.id}`,
        kind: 'left',
        on: lastTouched(run) ?? run.startedOn,
        runId: run.id,
        runName: run.workflowName,
        title: `${run.workflowName} ended`,
        detail: run.leftReason,
      })
    } else if (run.state === 'finished') {
      out.push({
        id: `done:${run.id}`,
        kind: 'finished',
        on: lastTouched(run) ?? run.startedOn,
        runId: run.id,
        runName: run.workflowName,
        title: `${run.workflowName} finished`,
        detail: 'Every step has gone out.',
      })
    }
  }

  /*
   * NEWEST FIRST, AND TIES BROKEN THE SAME WAY EVERY TIME. Several events land on one day -- a
   * promise captured and the sequence paused are the same afternoon -- and two rows that sort
   * equal come back in whatever order the array happened to be in, which is how a pane reshuffles
   * itself between two loads. The id is the tiebreak because it is the only thing that never
   * moves; the contacts panel learned this the hard way.
   */
  return out.sort((a, b) => b.on.localeCompare(a.on) || a.id.localeCompare(b.id))
}

/** The last day anything actually happened on this run: the newest sent step, or the last hold. */
function lastTouched(run: AccountRun): string | null {
  const sent = run.steps
    .filter((s) => s.sentAt)
    .map((s) => (s.sentAt as string).slice(0, 10))
    .sort()
  const holds = run.holds.map((h) => h.endedOn ?? h.startedOn).sort()
  const all = [...sent, ...holds]
  return all.length > 0 ? all[all.length - 1] : null
}

/**
 * The three facts the strip across the top of the firm's mockup carries: what is running, what is
 * paused, and what happens next.
 *
 * NEXT IS ACROSS EVERY RUNNING SEQUENCE, not the first one's. An account can carry a paused
 * section 129 and a live promise at the same time -- that IS the case the firm drew -- and the
 * next thing to happen is whichever of them is soonest.
 */
export interface WorkflowHeadline {
  active: AccountRun[]
  paused: AccountRun[]
  /** The soonest step still to come anywhere, and the run it belongs to. */
  next: { run: AccountRun; step: RunStep } | null
  /** Everything waiting on a person, across every run. */
  waiting: { run: AccountRun; step: RunStep }[]
}

export function workflowHeadline(runs: AccountRun[]): WorkflowHeadline {
  const active = runs.filter((r) => r.state === 'running')
  const paused = runs.filter((r) => r.state === 'held')

  let next: { run: AccountRun; step: RunStep } | null = null
  const waiting: { run: AccountRun; step: RunStep }[] = []
  for (const run of runs) {
    for (const step of needsAttention(run.steps)) waiting.push({ run, step })
    /*
     * ONLY FROM A RUNNING SEQUENCE. A paused run's dates are the dates it had when it stopped,
     * and they will all move when it is let go -- so quoting one as "next" is quoting a date that
     * is already known to be wrong. A held run's next thing is the hold ending.
     */
    if (run.state !== 'running') continue
    for (const step of run.steps) {
      if (step.state !== 'pending') continue
      if (!next || step.dueOn < next.step.dueOn) next = { run, step }
    }
  }
  return { active, paused, next, waiting }
}
