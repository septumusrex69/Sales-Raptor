/**
 * A STEP OF THE FIRM'S CHART IS A NOTICE AND THE TEXT MESSAGE THAT FOLLOWS IT.
 *
 * THE FIRM, LOOKING AT AN ELEVEN-DOT SECTION 129: "we can possibly make that one. So there'll be
 * much less steps in here. You know, it'll look smaller and better."
 *
 * THEY ARE READING THEIR OWN CHART, AND THEIR CHART HAS SIX STEPS. Raptor stores eleven because
 * every one of those six is two rows -- the letter and the SMS telling the debtor to go and read
 * it -- which is the firm's own rule for every sequence they have drawn: "the email sends 5 to 10
 * minutes before the SMS at every step." Two rows is right in the database: they are two messages,
 * two channels, two Annexure B charges and two things that can fail separately. Two DOTS is wrong
 * on a screen, because the debtor received one notice.
 *
 * SO THE PAIRING IS DERIVED AND NOTHING IS STORED. `afterMinutes` already says which row is the
 * follower -- the runner reads it exactly this way to decide whether the message before this one
 * actually went -- so there is no new column, no migration, and no second opinion about what
 * belongs with what. A grouping flag would be a third place the same fact lives.
 *
 * WHAT IS NOT HIDDEN: the drop-down under the track still lists every row, which is the firm's own
 * condition on the track in the first place -- "you can also like extend it to show every single
 * step in the process." This collapses the PICTURE, not the record.
 *
 * Pure: no database, no clock.
 */
import { shapeOf, type RunStep, type StepShape } from './runSteps.ts'

/** One step of the firm's chart: the notice, and the message that follows it where there is one. */
export interface Notice {
  /** The row the firm means by "the step" -- the letter, not the SMS behind it. */
  lead: RunStep
  /** The SMS that goes out behind it, or null on a step that is one message. */
  follower: RunStep | null
  /** Both, in the order they go out. What the detail pane and the drop-down walk. */
  steps: RunStep[]
}

/**
 * GROUP THE ROWS INTO THE STEPS THE FIRM DREW.
 *
 * THE RULE IS THE RUNNER'S OWN: a row whose node carries `afterMinutes` follows the row on the
 * SAME DAY that does not. Same day and same run, which is how step.ts finds the message a follower
 * is waiting on.
 *
 * ORDER IS PRESERVED EXACTLY. The steps arrive sorted by date and then by day number, and the
 * notices come back in that order -- a chart redrawn in a different order from the list beneath it
 * is two accounts of the same sequence.
 *
 * A FOLLOWER WITH NOTHING TO FOLLOW STANDS ALONE rather than being dropped. It should not happen;
 * a version could be drawn that way, and a step that exists and is invisible is the failure the
 * whole track was built to stop.
 *
 * TWO FOLLOWERS ON ONE DAY ARE NOT MERGED INTO ONE DOT: the first takes the lead and the second
 * stands on its own, because a dot that silently swallows a third message is worse than a dot too
 * many. The firm has drawn none, and this decides what happens the day they do.
 */
export function noticesOf(steps: RunStep[]): Notice[] {
  const out: Notice[] = []
  /* The notice each day is still waiting for a follower, so a follower can find its lead without
     scanning backwards and without assuming they are adjacent. */
  const open = new Map<string, Notice>()
  for (const step of steps) {
    if (step.afterMinutes === null) {
      const notice: Notice = { lead: step, follower: null, steps: [step] }
      open.set(step.dueOn, notice)
      out.push(notice)
      continue
    }
    const waiting = open.get(step.dueOn)
    if (waiting && waiting.follower === null) {
      waiting.follower = step
      waiting.steps.push(step)
      open.delete(step.dueOn)
      continue
    }
    /* Nothing to follow: draw it as its own step rather than losing it. */
    out.push({ lead: step, follower: null, steps: [step] })
  }
  return out
}

/**
 * WHAT ONE DOT LOOKS LIKE WHEN IT STANDS FOR TWO MESSAGES.
 *
 * THE WORSE OF THE TWO, AND THAT IS THE WHOLE POINT. A notice whose letter went and whose SMS is
 * waiting on somebody is not a notice that has gone: drawn green it would tell a collector the
 * debtor has been dealt with, and the one message still needing a press would be the one nobody
 * presses. Ranked so the thing that needs a person outranks the thing that is merely ahead.
 *
 * CANCELLED IS BOTTOM, not top: a notice half of which was cancelled with an account that left the
 * workflow has still had its other half sent, and the sending is the fact that matters.
 */
const RANK: Record<StepShape, number> = { stopped: 3, waiting: 2, sent: 1, cancelled: 0 }

export function noticeShape(notice: Notice): StepShape {
  return notice.steps.reduce<StepShape>(
    (worst, s) => (RANK[shapeOf(s)] > RANK[worst] ? shapeOf(s) : worst),
    shapeOf(notice.steps[0]),
  )
}

/**
 * THE CHANNELS ONE DOT CARRIES, in the order they go out and without repeats.
 *
 * WHAT THE ICONS INSIDE THE DOT ARE FOR: an envelope and a speech bubble together say "a letter
 * and a text went", which is exactly what the firm's chart means by one step. Before this they
 * were two dots that looked identical apart from the icon, and the day number under each read
 * "1 1" -- which is what sent the firm looking for a way to make it smaller.
 */
export function noticeChannels(notice: Notice): string[] {
  const seen: string[] = []
  for (const s of notice.steps) {
    if (s.channel && !seen.includes(s.channel)) seen.push(s.channel)
  }
  return seen
}

/**
 * THE SMS THAT GOES WITH A NOTICE, given the notice's own row.
 *
 * FOR THE RELEASE, which is the other half of what the firm asked for: "you need to send the SMS
 * manually... even after you've sent this 129." One press on one step has to send both, or the
 * chart says six steps and the work is still eleven presses.
 *
 * RETURNS NULL WHERE THERE IS NONE, and null is not a failure: most steps of most sequences are
 * one message.
 */
export function followerOf(steps: RunStep[], leadId: string): RunStep | null {
  const notice = noticesOf(steps).find((n) => n.lead.id === leadId)
  return notice?.follower ?? null
}
