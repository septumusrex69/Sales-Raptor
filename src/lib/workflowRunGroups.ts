/**
 * THE THREE GROUPS A WORKFLOW PANE IS READ IN, AND THE ORDER THEY GO IN.
 *
 * THE FIRM, looking at the pane on a debtor's file: "on the workflow, I think the current
 * workflow should be on top. And then the workflow queued should be, or waiting, should be at the
 * bottom, right below that. And then other workflows have been completed, chronological order
 * below that -- from the newest to the oldest going down. Also, that's really bulky and big. Can
 * we make it smaller so you don't have to scroll all the way down?"
 *
 * WHAT IT REPLACED WAS A DATED RAIL OF EVENTS, one row per thing that happened, newest first.
 * That is the right shape for a history and the wrong one for a question: a section 129 started in
 * March, paused in April and resumed in May is three rows, and the live one is wherever its latest
 * event happens to fall among a finished handover's rows. Somebody opening this pane is asking
 * "what is running on this debtor" -- so what is running is the top of the pane, and what is over
 * is underneath it in the order it ended. The event stream is still there, under Past workflow
 * history, which is where a story belongs.
 *
 * PURE, SO A CHECK CAN HOLD THE ORDER. The ordering IS the firm's instruction, and an ordering
 * written inside a component can only be tested by driving a browser. It takes the shape of a run
 * rather than AccountRun itself for the same reason: accountRun.ts imports the Supabase client,
 * which scripts/qa cannot resolve.
 */

/** Only the parts of a run that decide which group it is in and where in the group it sits. */
export interface GroupableRun {
  /** running | held | finished | left. */
  state: string
  startedOn: string
  steps: { dueOn: string; sentAt: string | null }[]
  holds: { startedOn: string; endedOn: string | null }[]
}

export type RunGroup = 'running' | 'waiting' | 'done'

/**
 * WHICH OF THE THREE A RUN BELONGS IN.
 *
 * HELD IS "WAITING", AND THAT IS THE FIRM'S OWN WORD for it: a paused sequence is not running --
 * nothing will go out tomorrow morning -- and it is not over either, because the thing that paused
 * it will end and it will carry on. A promise being kept, a dispute being answered: the sequence
 * is queued behind an event.
 *
 * ANYTHING UNRECOGNISED IS DONE rather than running. A state this does not know about must not put
 * a dead sequence at the top of the pane under the heading "Running now", which is the one piece
 * of this pane somebody acts on.
 */
export function groupOf(run: GroupableRun): RunGroup {
  if (run.state === 'running') return 'running'
  if (run.state === 'held') return 'waiting'
  return 'done'
}

/**
 * THE LAST DATE ANYTHING ON THIS RUN HAPPENED, which is as close as the data comes to "when it
 * ended".
 *
 * THERE IS NO `ended_on` ON A RUN. It has a start, its steps have dates and its holds have dates,
 * and the end of it is simply the last of those -- a final notice sent, a hold closed, a step that
 * was never reached and still carries the day it was due. Taking the maximum means a run that
 * finished in May sorts after one that finished in March whichever of those three things carries
 * the date.
 *
 * STRINGS, COMPARED AS STRINGS. Every date here is yyyy-mm-dd, which sorts lexically exactly as it
 * sorts chronologically, and building Dates to compare them would be the one place in this file a
 * timezone could get in.
 */
export function lastActivityOn(run: GroupableRun): string {
  let last = run.startedOn
  for (const s of run.steps) {
    /* The day it was SENT where it went, the day it was DUE where it did not. A step nobody
       reached is still evidence of how far the sequence got. */
    const on = (s.sentAt ?? '').slice(0, 10) || s.dueOn
    if (on > last) last = on
  }
  for (const h of run.holds) {
    if (h.startedOn > last) last = h.startedOn
    if (h.endedOn && h.endedOn > last) last = h.endedOn
  }
  return last
}

/**
 * THE PANE'S THREE LISTS, IN THE ORDER THEY ARE DRAWN.
 *
 * Running and waiting keep the order they came in, which is newest-started first -- fetchAccountRuns
 * orders by started_on descending and an account rarely has two of either. The completed list is
 * sorted here, because the question it answers ("what has this debtor already been through") is
 * read from the most recent backwards, and its own start dates are not the order it ended in: a
 * handover started the day the account arrived can finish after a section 129 started months later.
 */
export function groupRuns<T extends GroupableRun>(runs: T[]): {
  running: T[]
  waiting: T[]
  done: T[]
} {
  const running = runs.filter((r) => groupOf(r) === 'running')
  const waiting = runs.filter((r) => groupOf(r) === 'waiting')
  const done = runs.filter((r) => groupOf(r) === 'done')
    .slice()
    .sort((a, b) => lastActivityOn(b).localeCompare(lastActivityOn(a)))
  return { running, waiting, done }
}

/**
 * THE HEADINGS, written once.
 *
 * THE FIRM'S OWN WORDS where they used them. "Running now" rather than "Active" because the pane
 * is read in sentences and the question is what is happening today; "Waiting" is theirs; and
 * "Completed" covers a sequence that ran out of steps and one that was taken out by a promise
 * alike -- both are over, and which one it was is on the row itself.
 */
export const GROUP_HEADINGS: Record<RunGroup, string> = {
  running: 'Running now',
  waiting: 'Waiting',
  done: 'Completed',
}
