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
       * PENDING, EVEN WHERE IT WAITS FOR A PERSON — and it used to be born `held`.
       *
       * The reasoning was that a step needing a person is a fact about the step, so saying it on
       * day one shows a collector "day 39 · waits for you" beside the dates. What it actually
       * produced: the firm started a section 129 and the account showed FOUR notices waiting on
       * them with a Send it now button under each — the credit bureau listing dated 18 November
       * and the intended summons dated 2 December, both two and a half months out. Pressing one
       * would have told a debtor their default HAS been listed before it had been.
       *
       * HELD IS A THING THAT HAPPENED, NOT A PROPERTY. Every other hold is written by the runner
       * on the morning the step comes due, from a reason that is true that morning; this one was
       * a label applied months early to steps nobody had looked at. The runner holds these the
       * same way on the day they fall due — planSend refuses a needsRelease step every time it is
       * asked — so nothing is lost but the false urgency.
       *
       * WHAT THE CHART SAYS IS UNAFFECTED: the library's schedule reads `needsRelease` off the
       * NODE and draws "Waits for you" on the row, which is where that fact belongs.
       */
      state: 'pending',
      note: null,
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
 *
 * NOR IS TRACING, and it used to be. The firm, reading the four back: "the contact details are
 * wrong and the file went for tracing — no. That can just continue... sometimes we trace and even
 * though we trace, the email address was right. So it just continues going on to the right email
 * address. The people just ignore it."
 *
 * WHICH IS THE DIFFERENCE BETWEEN UNREACHABLE AND IGNORING. A trace is lodged because a NUMBER or
 * an ADDRESS is wrong; the email the sequence runs on is usually the one thing still working, and
 * stopping a statutory sequence because somebody moved house rewards not answering it. The other
 * three are the debtor or the money doing something — a promise, an objection, payment in full —
 * and each is a reason to stop saying what the sequence says next.
 *
 * AND IF TRACING DOES TURN UP A NEW ADDRESS, the firm's own answer is to start again rather than
 * resume: "we can just shoot the new section 129 and press the button again." A fresh sequence
 * from the day the new notice goes is the honest clock; a paused one resumed weeks later quotes
 * ten business days that ran while nobody could be reached.
 */
export type ExitEvent = 'promise' | 'dispute' | 'paid_in_full'

export const EXIT_EVENTS: Record<ExitEvent, string> = {
  promise: 'A promise to pay was made',
  dispute: 'A dispute was raised',
  paid_in_full: 'The account was paid in full',
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
