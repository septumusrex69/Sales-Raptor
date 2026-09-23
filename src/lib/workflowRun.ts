/**
 * A FILE GOING THROUGH A WORKFLOW: which steps, on which dates, and which of them wait for a
 * person.
 *
 * The firm: "I'll send every letter by hand once and every SMS once. And then I want these things
 * working automatically in the workflow."
 *
 * THE DATES ARE WORKED OUT ONCE, WHEN THE RUN STARTS, and stored. Not on the morning each step is
 * due, and this is the decision the rest of the design hangs off:
 *
 *   - THE CALENDAR LIVES IN ONE PLACE. Business days, weekends and the South African public
 *     holidays are `workingDays.ts`, and a scheduler that recomputed dates in SQL would be a
 *     second copy of that calendar — the one that is wrong about Heritage Day in the year nobody
 *     checks. Resolved here, the thing that wakes up each morning only has to compare a stored
 *     date with today, which SQL can do without knowing what a public holiday is.
 *   - A COLLECTOR SEES THE WHOLE SEQUENCE ON DAY ONE, with real dates, rather than a promise that
 *     something will be worked out later.
 *   - AND A DATED STEP CANNOT QUIETLY MOVE. A run is pinned to a frozen version, so nothing about
 *     it changes when somebody edits a draft — but even the resolution of "day 32" is fixed at
 *     the start rather than re-derived, so two files that entered on the same day stay in step.
 *
 * Pure: no database, no clock, no network. What it returns is what gets inserted.
 */
import { landsOn, type DayUnit, type WorkflowNode } from './workflowBuilder.js'

export type RunStepState = 'pending' | 'held' | 'sent' | 'cancelled' | 'failed'

export interface PlannedStep {
  nodeId: string
  /** The date it falls on, already through the version's day unit and the firm's calendar. */
  dueOn: string
  state: RunStepState
  /** Why it is held, in the words the person who has to act on it will read. */
  note: string | null
}

/**
 * Every step of a run, dated.
 *
 * SORTED BY THE DATE IT LANDS ON, then by the node's own ordinal — which is not the same as
 * sorting by day number once the unit is business days and two steps share a day. The email and
 * the SMS of one step share a day and an order within it, and the SMS says "we emailed you".
 */
export function planRun(input: {
  nodes: WorkflowNode[]
  dayUnit: DayUnit
  startedOn: string
  holidays?: Record<string, string>
}): PlannedStep[] {
  const { nodes, dayUnit, startedOn, holidays = {} } = input
  return [...nodes]
    .sort((a, b) => a.day - b.day || a.ordinal - b.ordinal)
    .map((node) => ({
      nodeId: node.id,
      dueOn: landsOn(startedOn, node.day, dayUnit, holidays),
      /*
       * HELD FROM THE START, not decided on the day. A step that needs a person is a fact about
       * the step, and saying so on day one is what lets a collector see "day 39 — waits for you"
       * beside the dates rather than discovering it when nothing happens.
       */
      state: node.needsRelease ? 'held' : 'pending',
      note: node.needsRelease ? holdReason(node) : null,
    }))
}

/**
 * Why a step waits for a person, said as the thing they have to do.
 *
 * NOT "needs release". The firm's own note on two of these steps is that sending them before they
 * are true is a misrepresentation and the kind of thing the Council for Debt Collectors acts on,
 * so the sentence names what has to be true rather than naming a state in a database.
 */
export function holdReason(node: WorkflowNode): string {
  if (node.statutory) {
    return 'A statutory demand. Check the address, the balance and that no dispute or arrangement '
      + 'is live, then send it.'
  }
  return 'Waits for you: it says something has already happened, so it may not go until it has.'
}

/**
 * THE EVENTS THAT TAKE AN ACCOUNT OUT OF A WORKFLOW.
 *
 * The firm: "if there is a dispute raised or a PTP put in place, then a new workflow starts. And
 * then that one ceases." Each of these is its own workflow the day those are built; until then
 * the account simply stops receiving messages and sits with the collector.
 *
 * PART PAYMENT IS NOT ONE OF THEM, at the firm's own instruction — "part payment without a PTP
 * does not exit the workflow. Flag those to the collector." A debtor who pays R500 off R48,000
 * and then hears nothing more is a debtor nobody is collecting from.
 */
export type ExitEvent = 'promise' | 'dispute' | 'paid_in_full' | 'tracing'

export const EXIT_EVENTS: Record<ExitEvent, string> = {
  promise: 'A promise to pay was made',
  dispute: 'A dispute was raised',
  paid_in_full: 'The account was paid in full',
  tracing: 'The contact details are wrong and the file went for tracing',
}

export interface Cancellation {
  /** The steps to cancel: everything not already done. */
  cancel: string[]
  /** What goes on the run, in the firm's words. */
  reason: string
}

/**
 * What leaving does to a run in flight.
 *
 * ONLY WHAT HAS NOT HAPPENED YET. A step that was sent stays sent — it is a record of a notice
 * that went to a debtor, and rewriting it would be rewriting the file. A HELD step is cancelled
 * with everything else: it has not gone, and leaving it sitting on a collector's list is how a
 * section 129 goes out three weeks after the debtor agreed to pay.
 *
 * THE FIRM'S RULE ABOUT WHAT COMES BACK: "a cancelled node must not fire later if the PTP is
 * broken; the broken-PTP workflow will handle that when we build it." So this cancels and does
 * not schedule anything to resume.
 */
export function cancelRemaining(
  steps: { id: string; state: RunStepState }[], event: ExitEvent,
): Cancellation {
  return {
    cancel: steps.filter((s) => s.state === 'pending' || s.state === 'held').map((s) => s.id),
    reason: EXIT_EVENTS[event],
  }
}

/**
 * Is the run over?
 *
 * FINISHED MEANS NOTHING IS WAITING, which is not the same as "everything was sent". A run whose
 * last step failed is not finished — somebody has to look at it — and one whose steps were all
 * cancelled left rather than finished, which the caller records separately.
 */
export function isFinished(steps: { state: RunStepState }[]): boolean {
  return steps.length > 0 && !steps.some((s) => s.state === 'pending' || s.state === 'held' || s.state === 'failed')
}

/**
 * The steps that are due and have nothing left to wait for.
 *
 * WHAT THE RUNNER ACTS ON, and the reason it takes `today` rather than reading a clock: a
 * function that asks the machine what day it is cannot be tested on the day that matters. Held
 * steps are NOT returned — their day may have come, and what they are waiting for is a person.
 */
export function dueNow<T extends { dueOn: string; state: RunStepState }>(
  steps: T[], today: string,
): T[] {
  return steps.filter((s) => s.state === 'pending' && s.dueOn <= today)
}
