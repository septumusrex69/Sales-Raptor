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
  /**
   * WHEN SOMEBODY ESTABLISHED THAT THIS NOTICE NEVER REACHED THE DEBTOR, or null.
   *
   * It stays `sent` beside this, which is the point: a send cannot be un-sent, and the file has
   * to read "went to the wrong address on the 1st, re-issued on the 8th". What it unlocks is a
   * re-issue of the workflow -- see workflow_step_not_served.
   */
  notServedAt: string | null
  notServedReason: string | null
  /**
   * THE ADDRESS THIS NOTICE ACTUALLY WENT TO, or null where it was not an email.
   *
   * THE FIRM, on correcting a wrong address mid-sequence: "it still shows that the previous
   * workflow went out to the wrong email address." Without it a re-issued sequence reads as two
   * identical notices a week apart, and the thing that explains the second one -- that the first
   * went somewhere the debtor does not read -- is nowhere on the file.
   *
   * OFF `account_emails.workflow_step_id`, which is the link a bounce already travels back along,
   * so this is the address as SENT rather than the address the account carries today. Those are
   * different the moment somebody corrects one, which is the entire case this exists for.
   */
  sentTo: string | null
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
  /**
   * HOW LONG AFTER THE NOTICE THIS ONE FOLLOWS, or null where it IS the notice.
   *
   * THE FIRM'S RULE FOR EVERY SEQUENCE THEY HAVE DRAWN: "the email sends 5 to 10 minutes before
   * the SMS at every step." So a step of the firm's chart is actually two rows -- the notice and
   * the text message telling the debtor to go and read it -- and this is the column that says
   * which is which. The runner already reads it that way; stepPairs.ts is the same rule for the
   * screen.
   */
  afterMinutes: number | null
  /**
   * WHERE THIS STEP SITS AMONG THE OTHERS FALLING DUE THE SAME DAY.
   *
   * THE ONLY THING THAT PUTS A NOTICE BEFORE THE SMS BEHIND IT. Two steps of one pair share a day
   * number AND a due date, so a sort on those two alone leaves them in whatever order the database
   * handed them over -- and the firm found what that costs: the section 129's SMS drawn to the LEFT
   * of the section 129, the pair not collapsing into one dot at all, and the panel opening on the
   * follower with a Send it now button that can never work, because the message it refers to has
   * not gone.
   *
   * IT IS THE NODE'S OWN COLUMN, written when the workflow was built, and it already said the email
   * is 0 and the SMS is 1. Nothing was wrong with the data; it simply was not being read.
   */
  ordinal: number
  /**
   * WHICH INSTALMENT THIS STEP IS ABOUT — 1-based, or 0 where it is about the run.
   *
   * WITHOUT IT THE TRACK LIES BY REPETITION. An arrangement of three instalments plans the
   * reminder three times and the day-of message three times, every one of them labelled
   * "Arrangement reminder"; six identical dots with six different dates reads as a sequence
   * somebody has duplicated by mistake. The number is the whole difference between them, so it
   * goes in the words rather than only in the dates.
   */
  instalmentNo: number
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
/**
 * WHY A NOTICE NEVER REACHED THE DEBTOR, in the firm's words.
 *
 * A CLOSED LIST RATHER THAN FREE TEXT. The sentence lands on the step and is read months later by
 * whoever asks why a statutory sequence ran twice on one debt -- "wrong addy" typed in a hurry is
 * not an answer to that. These four are the ways it actually happens, and the first is the only
 * one the mail system can report by itself.
 *
 * NO "SOMETHING ELSE". A reason nobody can categorise is one that belongs in a note on the
 * account, where it can be a paragraph, rather than compressed into a label that will be
 * mistaken for one of these.
 */
export const NOT_SERVED_REASONS = [
  'The address does not exist',
  'The address belongs to somebody else',
  'The debtor says they never received it',
  'We had the wrong debtor',
] as const

export function words(step: RunStep): string {
  const when = step.sentAt
    ? `sent ${shortDate(step.sentAt.slice(0, 10))}`
    : `due ${shortDate(step.dueOn)}`
  /*
   * AND A NOTICE KNOWN NOT TO HAVE ARRIVED SAYS SO FIRST.
   *
   * THE FIRM: "they've basically only been served a new notice." A step that bounced reads
   * `sent` on every screen in the system, which is the firm believing a debtor has been served
   * when they have not -- and it is the one thing on a run somebody has to act on. So it leads,
   * ahead of the state, rather than being a footnote under it.
   */
  if (step.notServedAt) {
    return `${stepName(step)} — never reached them, ${when}`
  }
  return `${stepName(step)} — ${RUN_STEP_WORDS[step.state].label}, ${when}`
}

/**
 * THE STEP'S NAME, WITH THE INSTALMENT IN IT WHERE THERE IS ONE.
 *
 * "Arrangement reminder · instalment 2", because the label alone is the same on every instalment
 * and the firm's own arrangement sequence plans four of them per instalment. A MIDDLE DOT rather
 * than brackets, which is how the rest of Raptor joins a thing to which one of it this is.
 *
 * ITS OWN FUNCTION so the track, the detail panel and the screen-reader label cannot disagree
 * about what a step is called — three places drew it from `label` before this existed.
 */
export function stepName(step: RunStep): string {
  return step.instalmentNo > 0 ? `${step.label} · instalment ${step.instalmentNo}` : step.label
}

export function markerIndex(steps: RunStep[], today: string): number {
  let i = 0
  while (i < steps.length && steps[i].dueOn <= today) i += 1
  return i
}
