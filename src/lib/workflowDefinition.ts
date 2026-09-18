/**
 * What a workflow IS, as data.
 *
 * WHY DATA AND NOT CODE. The firm's 160-day pre-legal workflow already exists on paper and is
 * going to keep moving — the rotation rule changed the week it was handed over. A workflow
 * written as code is a deployment every time a waiting period changes, and a waiting period
 * changes because an attorney read something, not because an engineer did. Written as data it is
 * a row somebody edits, and the same shape carries a sales follow-up sequence or a client
 * servicing sequence without a second engine.
 *
 * WHY NOT A GENERAL WORKFLOW BUILDER. "Any workflow for anything" is a product, and it stays
 * half-built. The step vocabulary here is CLOSED and it is the firm's own: their chart's legend
 * reads notice generated, decision point, flag raised, task created, clerk rotation, collection
 * stops, closes the file, rejoins the spine, terminal write-off, opens a new file. That is the
 * list. A step type that is not on it does not exist, which is what stops this becoming a
 * programming language nobody can review.
 *
 * TWO TRACKS. Nothing in a definition rotates a clerk. Rotation is a calendar rule on the 5th and
 * lives in workflowSchedule.ts; a notice is anchored to the FILE and goes out on its day whoever
 * is holding it. The firm's chart drew them as one thing — "Phase 2 · Clerk 2 · day 40-80" — and
 * they came apart the moment rotation stopped being a day count. Keeping them apart is what stops
 * an allocation decision moving the date of a section 129.
 *
 * Pure: no database, no clock, no network. A definition is inert until something runs it.
 */
import type { WhenSpec, NonWorkingDay } from './workflowSchedule.ts'
import { dueDate, spineDay } from './workflowSchedule.ts'

/* ---------------------------------------------------------------- what a step does */

/**
 * The closed list. Every one of these is a line on the firm's own legend.
 *
 * `notice` carries the TEMPLATE it sends, by seed key, or null where the wording has not been
 * written yet — which is most of them, and saying so is the point. A workflow that names its
 * notices turns "I don't have the content" into a numbered list of exactly what to write.
 */
export type Action =
  | {
    kind: 'notice'
    /** A message_templates.seed_key, or null while the wording is still to be written. */
    template: string | null
    channel: 'email' | 'sms' | 'post' | 'registered_post' | 'hand'
    /**
     * A notice the Act or the firm's mandate requires, rather than one the firm chooses to send.
     *
     * It changes two behaviours and both matter. A statutory notice is never re-issued when a
     * file rejoins the spine — the firm's own rule — and proof of dispatch is captured against it.
     */
    statutory?: boolean
  }
  | { kind: 'task'; title: string }
  | { kind: 'flag'; flag: string }
  | { kind: 'decision'; question: string }
  /** The file stops being collected but is not closed: sequestration, liquidation, a moratorium. */
  | { kind: 'stop_collection'; reason: string }

export interface Step {
  id: string
  label: string
  /**
   * WHEN, relative to something.
   *
   * `after` is 'start' or another step's id. The firm described their workflows this way without
   * being asked — "send handover, then add a waiting period of two days, then send handover
   * notice, then one day later send section 129, then wait 10 days" — and it is also the only
   * shape that survives editing: move one step and everything behind it follows, instead of
   * fourteen day numbers needing to be renumbered by hand.
   */
  after: string
  when: WhenSpec
  /** A debtor's deadline stays where it falls; a job for a person moves to a working day. */
  onNonWorkingDay?: NonWorkingDay
  action: Action
  /** What the chart says under the box: "Registered post", "20 business days". */
  note?: string
  /** The chart's own grouping. A LABEL ONLY — it no longer says who holds the file. */
  phase?: string
}

/* ---------------------------------------------------------------- how a branch ends */

export type Effect =
  /** Back onto the spine at the day it left. The firm's rule, and the reason spineDay exists. */
  | { kind: 'rejoin' }
  /** The branch carries on where it is: a first default cured, an arrangement still running. */
  | { kind: 'continue' }
  /**
   * Kept, but not collected, and looked at again later.
   *
   * Neither an ending nor a return, which is why it needs its own kind. A business rescue waits on
   * a creditors' vote; "trace and hold" keeps the listing and reviews at six months. Forcing
   * either into `close` loses a live claim, and forcing it into `rejoin` starts collecting against
   * a company under moratorium.
   */
  | { kind: 'hold'; reason: string; reviewIn?: string }
  /** Straight into another branch, without passing through the spine. */
  | { kind: 'goto_branch'; branch: string }
  | { kind: 'close'; reason: string }
  | { kind: 'write_off'; reason: string }
  /** A surety is not this file. It is a new one, and it runs the spine from day zero. */
  | { kind: 'new_file'; of: string }

export interface Outcome {
  id: string
  /** The chart's own word, in its own capitals: KEPT, MISSED, UPHELD IN PART. */
  label: string
  detail: string
  effect: Effect
}

export interface Branch {
  id: string
  name: string
  /** "Any file · any day · any phase", or a narrower condition once one is written. */
  entry: string
  steps: Step[]
  outcomes: Outcome[]
}

export interface WorkflowDefinition {
  id: string
  name: string
  /** What the workflow is for. Collections, communications, sales — nothing here is specific. */
  domain: 'collections' | 'communications' | 'sales'
  /** One sentence, as the firm would describe it. */
  summary: string
  spine: Step[]
  branches: Branch[]
  /** The rules the firm wrote at the foot of their chart, kept as text against the definition. */
  rules: string[]
}

/* ---------------------------------------------------------------- is it sound */

export interface DefinitionProblem {
  where: string
  message: string
}

/**
 * What is wrong with this definition.
 *
 * CHECKED BEFORE IT IS RUN, not while it is running. A step pointing at an id that does not exist
 * is a workflow that stops halfway down a file with no date for the next notice, and the account
 * it stops on is not the one somebody is looking at.
 */
export function definitionProblems(def: WorkflowDefinition): DefinitionProblem[] {
  const problems: DefinitionProblem[] = []
  const checkSteps = (steps: Step[], where: string) => {
    const seen = new Set<string>(['start'])
    for (const step of steps) {
      if (seen.has(step.id)) {
        problems.push({ where: `${where}/${step.id}`, message: 'Two steps share this id.' })
      }
      /*
       * A step may only refer BACKWARDS. That is not tidiness: a forward reference is a step whose
       * date depends on a step that has not been dated yet, and resolving it needs either a sort
       * nobody asked for or a cycle check that will eventually miss one.
       */
      if (!seen.has(step.after)) {
        problems.push({
          where: `${where}/${step.id}`,
          message: `Waits for "${step.after}", which is not a step before it.`,
        })
      }
      seen.add(step.id)
      if (step.when.kind !== 'month_day' && step.when.days < 0) {
        problems.push({ where: `${where}/${step.id}`, message: 'A waiting period cannot be negative.' })
      }
      if (!step.label.trim()) {
        problems.push({ where: `${where}/${step.id}`, message: 'A step needs a label somebody can read.' })
      }
    }
  }
  checkSteps(def.spine, 'spine')
  const branchIds = new Set(def.branches.map((b) => b.id))
  for (const branch of def.branches) {
    checkSteps(branch.steps, branch.id)
    if (branch.outcomes.length === 0) {
      problems.push({ where: branch.id, message: 'A branch with no outcome is a file with no way back.' })
    }
    for (const outcome of branch.outcomes) {
      if (outcome.effect.kind === 'goto_branch' && !branchIds.has(outcome.effect.branch)) {
        problems.push({
          where: `${branch.id}/${outcome.id}`,
          message: `Sends the file to "${outcome.effect.branch}", which is not a branch.`,
        })
      }
    }
  }
  return problems
}

/* ---------------------------------------------------------------- when each step falls */

export interface ResolvedStep {
  step: Step
  /** The date it actually happens, after any move off a weekend or a public holiday. */
  on: string
  /** Where the offset landed before that move. What the chart calls the step's day. */
  nominal: string
  /** How far down the workflow that is, in days from the start — counted on the NOMINAL date. */
  day: number
}

/**
 * Every step with a date on it, given the day the workflow started.
 *
 * Relative offsets are resolved by walking forward, which is why a step may only refer backwards.
 *
 * THE MOVE OFF A NON-WORKING DAY DOES NOT MOVE WHAT COMES AFTER IT, and this is the part that had
 * to be got right twice. Chaining each step off the date the previous one actually happened looks
 * more truthful and is worse: the closure report at day 155 falls on a Saturday, moves to the
 * Monday, and the recommendation counted five days from THAT arrives on day 164 rather than 160.
 * Four days of drift by the end of one workflow, and it compounds — two files handed over a day
 * apart end up permanently out of step with each other, and the length of a workflow depends on
 * which weekends it happened to cross.
 *
 * So the nominal date is the anchor for everything that follows, and the adjustment applies to the
 * step itself. Day 155 stays day 155; the report still gets written on the Monday.
 *
 * The day that comes back is the workflow AS DRAWN and is not a live file's position, because a
 * live file may have been paused. spineDay() is the one that knows about pauses.
 */
export function resolveSteps(
  steps: Step[],
  startedOn: string,
  holidays: Record<string, string> = {},
): ResolvedStep[] {
  const anchors = new Map<string, string>([['start', startedOn]])
  const out: ResolvedStep[] = []
  for (const step of steps) {
    const anchor = anchors.get(step.after)
    // Unresolvable is reported by definitionProblems and skipped here rather than guessed at.
    // A step silently dated from the workflow start is a notice that goes out weeks early.
    if (anchor === undefined) continue
    const nominal = dueDate(anchor, step.when, 'keep', holidays)
    const on = step.onNonWorkingDay === 'forward'
      ? dueDate(anchor, step.when, 'forward', holidays)
      : nominal
    anchors.set(step.id, nominal)
    out.push({ step, on, nominal, day: spineDay({ startedOn, asAt: nominal }) })
  }
  return out
}

/** Every notice the workflow sends, and whether anybody has written it yet. */
export function noticesWanted(def: WorkflowDefinition): {
  where: string; step: Step; template: string | null; statutory: boolean
}[] {
  const out: { where: string; step: Step; template: string | null; statutory: boolean }[] = []
  const collect = (steps: Step[], where: string) => {
    for (const step of steps) {
      if (step.action.kind !== 'notice') continue
      out.push({ where, step, template: step.action.template, statutory: step.action.statutory === true })
    }
  }
  collect(def.spine, 'spine')
  for (const branch of def.branches) collect(branch.steps, branch.id)
  return out
}
