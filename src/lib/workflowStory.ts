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
   * NEWEST FIRST, AND TIES BROKEN BY WHAT IS STILL RUNNING.
   *
   * SEVERAL EVENTS LAND ON ONE DAY and they are not equally interesting. The firm's own case is
   * the one that showed it: an arrangement agreed this afternoon starts the Promise to pay AND
   * pauses the section 129, both dated today -- and the pane put the PAUSED sequence on top,
   * because the tiebreak was the event id and "hold:" sorts before "start:". The firm, reading
   * it back: "I see a promise made like a PTP workflow in place. But I think that should be on
   * top."
   *
   * THEY ARE RIGHT, AND THE RULE IS WHAT IS HAPPENING BEFORE WHAT HAS STOPPED. A sequence that
   * started or resumed today is live and is the answer to "what is going on with this account";
   * one that paused, left or finished the same day is the account's history, however recent.
   *
   * AND THE ID STILL BREAKS THE LAST TIE, because two events of the same rank on one day would
   * otherwise come back in whatever order the array happened to be in -- which is how a pane
   * reshuffles itself between two loads. It is the only thing here that never moves; the contacts
   * panel learned that the hard way.
   */
  return out.sort((a, b) => (
    b.on.localeCompare(a.on) || RANK[a.kind] - RANK[b.kind] || a.id.localeCompare(b.id)
  ))
}

/**
 * WHICH EVENT ON ONE DAY IS READ FIRST: the live ones, then the ones that stopped.
 *
 * `resumed` ABOVE `started` because on the day both happen, the resume is the newer fact about an
 * older sequence -- a section 129 let go this morning is further along than a workflow that began
 * this morning, and the pane is read to find out where things stand.
 */
const RANK: Record<StoryKind, number> = {
  resumed: 0,
  started: 1,
  paused: 2,
  left: 3,
  finished: 4,
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

/*
 * THE FOLD IS GONE, AND SO IS THE RAIL IT FOLDED.
 *
 * `railEvents` and `isCurrentState` lived here to answer one question: which of a run's several
 * rows on a dated rail was the row carrying its track, so the bare "Section 129 started" beside it
 * could be dropped. THE FIRM REMOVED THE RAIL -- "the current workflow should be on top, and then
 * the workflow queued or waiting right below that, and then other workflows that have been
 * completed, chronological order below that... that's really bulky and big" -- and the pane is now
 * one row per RUN, grouped by state, which cannot echo itself. See workflowRunGroups.ts.
 *
 * SO THE STREAM IS ONLY THE HISTORY NOW. workflowStory still makes it, unfolded, and PastHistory
 * draws it one line per event, oldest first, shut until somebody opens it -- which is what the
 * firm drew it for and the one place a story is the right shape. Nothing reads a folded version of
 * it any more, and a fold kept for nothing is a rule the next person has to work out is dead.
 */

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
