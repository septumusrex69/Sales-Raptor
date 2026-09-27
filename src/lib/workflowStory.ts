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
 * MOVED HERE FROM THE PANEL, because railEvents below has to ask it. It was always a rule about a
 * story and a run rather than about a component, and a rule a check cannot import is a rule that
 * drifts.
 */
/**
 * Is this event where the run stands today?
 *
 * ASKED OF THE EVENT AND THE RUN TOGETHER, because the same run appears several times on the
 * rail and exactly one of those appearances is the current one. A held run's latest event is the
 * hold that has not ended; a running one's is its most recent resume, or its start if it has
 * never been held.
 */
export function isCurrentState(run: AccountRun, event: StoryEvent): boolean {
  if (run.state === 'held') return event.kind === 'paused' && isLatestHoldEvent(run, event)
  if (run.state === 'left') return event.kind === 'left'
  if (run.state === 'finished') return event.kind === 'finished'
  /* running: the last resume, or the start where nothing ever held it. */
  const ended = run.holds.filter((h) => h.endedOn)
  if (ended.length === 0) return event.kind === 'started'
  return event.id === `release:${ended[ended.length - 1].id}`
}

function isLatestHoldEvent(run: AccountRun, event: StoryEvent): boolean {
  const open = run.holds.find((h) => !h.endedOn)
  return open ? event.id === `hold:${open.id}` : false
}

/**
 * THE RAIL'S OWN ROWS: the story, with the ones that say nothing the card beside them does not.
 *
 * THE FIRM, READING THE PANE BACK: "the order of how things lie here doesn't make sense to me.
 * Like, it says letter of demand started, but why is it necessary to have like two of these
 * things? Because it's already there."
 *
 * WHAT THEY WERE LOOKING AT. Everything on that account happened on one day, so the rail drew a
 * bare "Section 129 / letter of demand started" row and, two rows below it, the Section 129 card
 * with a Paused chip -- whose own second line reads "Started 27 Sep 2026 · paused since 27 Sep
 * 2026". The same fact, in the same date group, twice. The Handover did it too: "Handover
 * started", then "Handover · Finished".
 *
 * WHY THE RAIL IS STILL ONE ROW PER EVENT. When a sequence starts in March and pauses in May,
 * those are two facts on two days and both belong on the rail -- that is the shape the firm drew
 * and it is right. It is only the SAME DAY that turns the second row into an echo, because the
 * card already prints the day it started.
 *
 * SO THE FOLD IS NARROW: a `started` row goes only where another event for the same run falls on
 * the same day. Nothing else is touched -- a pause and a resume on one day are two real facts and
 * stay two rows.
 *
 * AND NEVER THE ROW THAT IS THE RUN'S CURRENT STATE, whatever else shares its day. That row is
 * the one carrying the track, the held steps and the Send it now button; folded away, the
 * sequence would vanish from the pane entirely.
 *
 * THE HISTORY BELOW THE RAIL IS NOT FOLDED and must not be. It is a log, one line per event,
 * collapsed until somebody opens it -- and "started, then paused" on one day is exactly what a
 * log is for. PastHistory reads the full story; this is only what the rail draws.
 */
export function railEvents(story: StoryEvent[], runs: AccountRun[]): StoryEvent[] {
  const byId = new Map(runs.map((r) => [r.id, r]))
  /* The days on which each run has an event that is NOT its start. */
  const elsewhere = new Map<string, Set<string>>()
  for (const e of story) {
    if (e.kind === 'started') continue
    const days = elsewhere.get(e.runId) ?? new Set<string>()
    days.add(e.on)
    elsewhere.set(e.runId, days)
  }
  return story.filter((e) => {
    if (e.kind !== 'started') return true
    const run = byId.get(e.runId)
    if (run && isCurrentState(run, e)) return true
    return !elsewhere.get(e.runId)?.has(e.on)
  })
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
