/**
 * WHAT A RUN'S STEPS ARE CALLED, AND WHICH OF THEM ARE ANYBODY'S WORK.
 *
 * HELD APART FROM accountRun.ts SO A CHECK CAN IMPORT IT. That file reaches the database and so
 * pulls in the Supabase client, which a QA script cannot resolve -- it can only be read back as
 * text. The same split, for the same reason, as emailStyle.ts beside firmSettings.ts: the words
 * and the rules are the part worth asserting on, so they live where an assertion can run them.
 *
 * Pure: no database, no clock, no network.
 */
import type { RunStepState } from './workflowRun.ts'

/* Re-exported so the screen side can name a step's state without reaching past this file into
   the runner's own module -- which is where the state vocabulary is DEFINED, and which has no
   business being imported by a panel. */
export type { RunStepState }

/** One step of a run, as a screen shows it. */
export interface RunStep {
  id: string
  /** The step in the firm's words -- "Final notice", never a node key. */
  label: string
  channel: string | null
  dueOn: string
  state: RunStepState
  /** Why it is held, or why it failed. Null on everything that is simply waiting for its day. */
  note: string | null
  sentAt: string | null
  /** The day number off the firm's own chart. The unit it is counted in is on the run. */
  day: number
}

/**
 * What a step's state is called on a screen, and what it means.
 *
 * THE FIRM'S WORDS, NOT THE COLUMN'S. `held` describes how a row got into that state; "Waiting on
 * you" is what the collector has to know. CLAUDE.md's first rule, applied to the one vocabulary
 * this table adds.
 */
export const RUN_STEP_WORDS: Record<RunStepState, { label: string; tone: 'done' | 'wait' | 'attention' | 'off' }> = {
  sent: { label: 'Sent', tone: 'done' },
  pending: { label: 'Due', tone: 'wait' },
  held: { label: 'Waiting on you', tone: 'attention' },
  failed: { label: 'Did not send', tone: 'attention' },
  cancelled: { label: 'Cancelled', tone: 'off' },
}

/**
 * The steps that need a person, which is the only part of a run that is anybody's work.
 *
 * TAKES THE STEPS, NOT THE RUN. A run is defined beside the query that fetches it, and reaching
 * for that type here would put this file back on the Supabase side of the split it exists to be
 * on. The steps are all this needs.
 */
export function needsAttention(steps: RunStep[]): RunStep[] {
  return steps.filter((s) => s.state === 'held' || s.state === 'failed')
}
