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
import { shortDate } from './dateLabels.ts'
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
  /**
   * Does this step wait for a PERSON, as opposed to waiting for a fact?
   *
   * What the button on a held step is allowed to say. On a `needsRelease` step the person IS the
   * gate, so "Send it now" is the truth; on any other hold the gate is something missing from the
   * account, and a button promising to send it would be a lie -- there it offers to try again,
   * which is what pressing it actually does.
   */
  needsRelease: boolean
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

/**
 * HOW A STEP IS DRAWN ON THE TRACK — filled, hollow, or crossed off.
 *
 * THE FIRM DREW THIS. The sequence is a row of dots joined by a line, and what a dot looks like
 * is the whole message: "it'll be little things and it'll have different like colours if it's
 * been successful or not successful."
 *
 * FOUR SHAPES AND NOT FIVE. `held` and `failed` are different rows in the database -- one is a
 * step the runner would not send and the other is a step a provider refused -- and on the track
 * they are the same dot, because the reading is identical: this one stopped, go and look. The
 * difference is a sentence in the detail underneath, where there is room to say it.
 */
export type StepShape = 'sent' | 'stopped' | 'waiting' | 'cancelled'

export function shapeOf(step: RunStep): StepShape {
  if (step.state === 'sent') return 'sent'
  if (step.state === 'held' || step.state === 'failed') return 'stopped'
  if (step.state === 'cancelled') return 'cancelled'
  return 'waiting'
}

/**
 * WHICH STEP THE TRACK OPENS ON.
 *
 * THE ONE SOMEBODY CAME HERE FOR, in the order they would ask for it. Anything stopped comes
 * first: a held section 129 is the reason the notification sent them to this account, and a
 * track that opens on the finished handover at the far left makes them hunt for it.
 *
 * THEN THE NEXT THING DUE, which answers "what happens next and when" — the question on a run
 * where nothing is wrong. Only when a sequence is over does it fall back to the LAST thing sent,
 * because on a finished run the useful fact is what the debtor last received.
 *
 * ITS OWN FUNCTION, AND PURE, so the choice can be asserted without a browser. Written inline in
 * the component it would be a useState initialiser nothing can reach.
 */
export function stepInFocus(steps: RunStep[]): string | null {
  const stopped = steps.find((s) => shapeOf(s) === 'stopped')
  if (stopped) return stopped.id
  const next = steps.find((s) => s.state === 'pending')
  if (next) return next.id
  /* Last SENT, not last of all: a cancelled tail is not what the debtor received. */
  const sent = steps.filter((s) => s.state === 'sent')
  return sent.length > 0 ? sent[sent.length - 1].id : (steps[0]?.id ?? null)
}

/**
 * WHAT A DOT SAYS WHEN IT IS READ RATHER THAN LOOKED AT.
 *
 * THE FIRM WANTED TO KNOW WHEN A STEP WENT OUT, and in the rail a dot has no room for a date --
 * it is twice the width of the dot itself. So the date rides on the dot's own label, which is
 * both the tooltip and what a screen reader announces, and is spelled out in full in the detail
 * under the track as soon as the dot is pressed.
 *
 * SENT SAYS WHEN IT WENT, everything else says when it is FOR. Those are different facts and
 * printing them in the same words is how a step that never went comes to look like one that did.
 */
export function words(step: RunStep): string {
  const when = step.sentAt
    ? `sent ${shortDate(step.sentAt.slice(0, 10))}`
    : `due ${shortDate(step.dueOn)}`
  return `${step.label} — ${RUN_STEP_WORDS[step.state].label}, ${when}`
}

export function markerIndex(steps: RunStep[], today: string): number {
  let i = 0
  while (i < steps.length && steps[i].dueOn <= today) i += 1
  return i
}
