/**
 * A workflow as the builder holds it, and what is wrong with one.
 *
 * PURE. No database, no clock, no network — which is what lets the rules below be broken on
 * purpose in a test. Everything the screen needs to draw is derived here rather than in the
 * component, because a figure computed in JSX is a figure nothing can check.
 *
 * THE ONE RULE WORTH READING BEFORE THE REST. A node carries an absolute DAY and the connections
 * carry the ORDER, and those are two different facts: the day says when, the edge says what
 * follows. They only contradict each other in one way — an edge pointing at a step with an
 * earlier day — and that contradiction is refused rather than resolved, because there is no
 * honest way to pick a winner. The firm's own mockup had three ways of saying when on one form
 * (an absolute day, a wait after completion, and a next step) and any two of those can disagree
 * silently; this is the same shape with the disagreement made illegal.
 */
import { addWorkingDays } from './workingDays.ts'

/* ---------------------------------------------------------------- what starts it */

/**
 * THE EVENT A WORKFLOW WAITS FOR.
 *
 * The builder could say what happens to a file and not how the file got there, so every workflow
 * was implicitly "an account is handed over" -- which is the only one the day numbers were ever
 * written for. The firm's next four are not: an arrangement workflow starts when an arrangement
 * breaks, a dispute workflow when a dispute is raised.
 *
 * A CLOSED LIST, AND IT IS THE DIARY'S. Every one of these is an event Raptor already records and
 * already raises diary work for, which is what makes it a trigger something could honour rather
 * than a sentence somebody wrote. Inventing a wider vocabulary here would be inventing events
 * nothing can ever fire.
 *
 * `review` IS THE ONE DIARY KIND DELIBERATELY MISSING. CLAUDE.md: a routine review is the last
 * rung and the only kind with no event behind it. There is nothing for a workflow to wait for.
 */
export type TriggerKind =
  | 'handover' | 'allocated' | 'promise_due' | 'promise_broken' | 'arrangement_broken'
  | 'payment_received' | 'dispute_logged' | 'no_contact' | 'trace_returned' | 'callback'
  | 'by_hand'

export interface TriggerMeta {
  /** What the firm would call it, on the button. */
  label: string
  /**
   * WHAT DAY 0 IS, and this is the load-bearing half.
   *
   * A node carries an ABSOLUTE day, and until now the schema could say "days from the handover"
   * because a handover was the only way in. With a trigger, day 0 is the day the trigger fired --
   * so the same "day 10" means ten days after a broken promise in one workflow and ten days after
   * a handover in another. The builder prints this sentence beside the day column rather than
   * leaving somebody to assume, because assuming it is a handover is how a section 129 goes out
   * five months early.
   */
  dayZero: string
}

export const TRIGGERS: Record<TriggerKind, TriggerMeta> = {
  handover: { label: 'An account is handed over', dayZero: 'the day the account was handed over' },
  allocated: { label: 'The account is given to a collector', dayZero: 'the day it was allocated' },
  promise_due: { label: 'A promise to pay falls due', dayZero: 'the day the promise was due' },
  promise_broken: { label: 'A promise to pay is broken', dayZero: 'the day the promise was broken' },
  arrangement_broken: { label: 'An arrangement is broken', dayZero: 'the day the arrangement broke' },
  payment_received: { label: 'A payment comes in', dayZero: 'the day the payment was received' },
  dispute_logged: { label: 'A dispute is raised', dayZero: 'the day the dispute was raised' },
  no_contact: { label: 'Nobody can be reached', dayZero: 'the day the last attempt failed' },
  trace_returned: { label: 'A trace comes back', dayZero: 'the day the trace came back' },
  callback: { label: 'A callback is asked for', dayZero: 'the day it was asked for' },
  by_hand: { label: 'Somebody starts it on a file', dayZero: 'the day somebody started it' },
}

/** The order the buttons are offered in: a file's life, roughly, and by hand last. */
export const TRIGGER_ORDER: TriggerKind[] = [
  'handover', 'allocated', 'promise_due', 'promise_broken', 'arrangement_broken',
  'payment_received', 'dispute_logged', 'no_contact', 'trace_returned', 'callback', 'by_hand',
]

/**
 * How the day column is labelled for this workflow.
 *
 * ONE SENTENCE, BUILT IN ONE PLACE. The same phrase belongs on the builder, on the step drawer
 * and eventually on a file's own timeline; written out at each of those it drifts, and a day
 * column labelled two ways is a day column nobody trusts.
 */
export function dayZeroLabel(trigger: TriggerKind): string {
  return `Day 0 is ${triggerMeta(trigger).dayZero}.`
}

/**
 * A trigger's label and day zero, without taking the page down if the column is not there.
 *
 * NOT A SILENT DEFAULT DRESSED UP. The real protection against a dropped column is
 * check-workflow-triggers, which holds the select, the mapper, the union and the database's own
 * CHECK against each other in both directions — a drift there is a failed build. This is the
 * other half: a row that somehow arrives without one must not throw inside a render, because the
 * page it takes down with it is the whole library. Falling back to "by hand" is the honest
 * reading of a version nothing says the trigger of.
 */
export function triggerMeta(trigger: TriggerKind): TriggerMeta {
  return TRIGGERS[trigger] ?? TRIGGERS.by_hand
}

export type NodeKind = 'action' | 'communication' | 'document' | 'task' | 'assignment' | 'wait'

export const NODE_KINDS: Record<NodeKind, { label: string; hint: string }> = {
  action: { label: 'Action', hint: 'Something happens on the file' },
  communication: { label: 'Communication', hint: 'Something goes to the debtor' },
  document: { label: 'Document', hint: 'Something is drawn up' },
  task: { label: 'Task', hint: 'Somebody is given a job' },
  assignment: { label: 'Assignment', hint: 'The file moves to somebody else' },
  wait: { label: 'Wait', hint: 'Nothing happens, on purpose' },
}

export type Channel = 'email' | 'sms' | 'whatsapp' | 'post' | 'registered_post' | 'call' | 'hand'

export const CHANNELS: Record<Channel, string> = {
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  post: 'Post',
  registered_post: 'Registered post',
  call: 'Telephone call',
  hand: 'By hand',
}

/** Calendar days are the debtor's clock. Business days are the statutory one. */
export type DeadlineUnit = 'calendar' | 'business'

export interface WorkflowNode {
  id: string
  phaseId: string | null
  key: string
  kind: NodeKind
  label: string
  description: string | null
  /** Absolute, from the handover. What the firm's chart is labelled with. */
  day: number
  /** The period this step gives the DEBTOR. Null where it gives none, which is most of them. */
  deadlineDays: number | null
  deadlineUnit: DeadlineUnit | null
  channel: Channel | null
  templateId: string | null
  /**
   * THE SAME STEP, WRITTEN FOR A COMPANY.
   *
   * Every template in the firm's collections library exists twice -- "Dear" against "To the
   * directors of", an ID number against a registration number, summons against liquidation. One
   * step, two wordings, chosen from the debtor record. Null where one version serves both.
   *
   * A SECOND TEMPLATE RATHER THAN A SECOND NODE, and rather than a runner that swaps
   * "-individual" for "-company" in a key: string-matching the wording of a statutory demand is
   * not a thing to do, and a chart with every step drawn twice reads as though both send.
   */
  templateCompanyId: string | null
  /**
   * Minutes after the step before it, within the same day.
   *
   * The firm's rule and not a preference: the SMS says "we emailed you", so an SMS that arrives
   * first is a message about something that has not happened. Their document says 5 to 10
   * minutes. A day number cannot hold that.
   */
  afterMinutes: number | null
  /**
   * Prepared on its day, then held for a person to send.
   *
   * Day 32 tells a debtor their default HAS been reported and quotes the listing reference; day
   * 37 tells them their file HAS gone to the attorneys. Sending either before it is true is a
   * misrepresentation, and the firm's own note says it is the kind of thing the Council for Debt
   * Collectors acts on. Separate from `statutory`, which means something else -- never re-issued
   * when a file rejoins, and proof of dispatch kept.
   */
  needsRelease: boolean
  statutory: boolean
  assignTo: string | null
  /** Where the card sits on the canvas. Read by nothing that decides what runs. */
  x: number | null
  y: number | null
  ordinal: number
}

export interface WorkflowPhase {
  id: string
  ordinal: number
  name: string
  subtitle: string | null
  fromDay: number
  toDay: number
}

export interface WorkflowConnection {
  id: string
  fromNodeId: string
  /** Null where the edge leaves this workflow for another one. */
  toNodeId: string | null
  toWorkflowId: string | null
  label: string | null
}

export type VersionState = 'draft' | 'active' | 'archived'

/**
 * WHAT KIND OF DAY A STEP'S DAY NUMBER IS.
 *
 * The firm, about the section 129 sequence: "this is all working days, not normal days. Business
 * days, not normal days." The number carried no unit and the whole table was read as calendar
 * days, so "day 32" meant a month where the firm meant a month and a half -- and every statutory
 * interval in the sequence was a third short.
 *
 * NOT THE SAME AS a node's `deadlineUnit`, and confusing the two is the trap. deadlineUnit is the
 * period a step gives the DEBTOR ("twenty business days to pay"); this is how far down the
 * workflow the step itself sits. One is the debtor's clock, the other is the firm's.
 */
export type DayUnit = 'calendar' | 'business'

/**
 * The date a step actually falls on.
 *
 * THE TWO UNITS COUNT DIFFERENTLY ON PURPOSE, and the difference is off-by-one country:
 *
 *   - BUSINESS is 1-BASED AND INCLUSIVE. Day 1 is the day the workflow starts, because that is
 *     how the firm writes their own chart: "the clerk triggers the section 129, workflow starts,
 *     that's day one." So day 7 is the seventh working day counting that one, not seven days
 *     later. A start that lands on a Saturday moves to the Monday first -- a workflow does not
 *     begin on a day the office is shut.
 *   - CALENDAR is 0-BASED, which is what every workflow written before this meant, and changing
 *     it would silently move every step of one already drawn.
 */
export function landsOn(
  from: string, day: number, unit: DayUnit, holidays: Record<string, string> = {},
): string {
  if (unit === 'calendar') {
    const d = new Date(`${from}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + day)
    return d.toISOString().slice(0, 10)
  }
  /* addWorkingDays(x, 0) is "the next working day on or after x", which is the normalisation. */
  const start = addWorkingDays(from, 0, holidays)
  return addWorkingDays(start, Math.max(0, day - 1), holidays)
}

export interface WorkflowVersion {
  id: string
  version: number
  state: VersionState
  publishedAt: string | null
  /** How this version's day numbers are counted. See DayUnit -- the firm's is business days. */
  dayUnit: DayUnit
  /** What this version waits for. On the version, not the workflow: a published one is frozen. */
  trigger: TriggerKind
  /** The firm's own narrowing, in their words. Null on most. */
  triggerNote: string | null
}

export interface Workflow {
  id: string
  key: string
  name: string
  description: string | null
  teamName: string | null
  version: WorkflowVersion
  phases: WorkflowPhase[]
  nodes: WorkflowNode[]
  connections: WorkflowConnection[]
}

/* ---------------------------------------------------------------- what the canvas needs */

/**
 * The steps of one phase, in the order they run.
 *
 * SORTED BY DAY, then by the node's own ordinal for the ones that share a day. Sorting by ordinal
 * alone would let a card edited to day 5 keep sitting between day 35 and day 40 until somebody
 * renumbered everything, which is the drawing disagreeing with the workflow.
 */
export function nodesOfPhase(workflow: Workflow, phaseId: string): WorkflowNode[] {
  return workflow.nodes
    .filter((n) => n.phaseId === phaseId)
    .sort((a, b) => a.day - b.day || a.ordinal - b.ordinal)
}

/** Every step in running order, whatever phase it is in. */
export function orderedNodes(workflow: Workflow): WorkflowNode[] {
  return [...workflow.nodes].sort((a, b) => a.day - b.day || a.ordinal - b.ordinal)
}

export interface WorkflowFacts {
  days: number
  steps: number
  phases: number
  /** Notices the Act or the mandate requires, which are the ones that cannot simply be moved. */
  statutory: number
  /** Communications with no wording written yet. */
  unwritten: number
}

export function workflowFacts(workflow: Workflow): WorkflowFacts {
  const days = workflow.nodes.length === 0
    ? 0
    : Math.max(...workflow.nodes.map((n) => n.day)) - Math.min(...workflow.nodes.map((n) => n.day))
  return {
    days,
    steps: workflow.nodes.length,
    phases: workflow.phases.length,
    statutory: workflow.nodes.filter((n) => n.statutory).length,
    unwritten: workflow.nodes.filter((n) => n.kind === 'communication' && n.templateId === null).length,
  }
}

/** What follows this step, or null at the end of the line. */
export function nextOf(workflow: Workflow, nodeId: string): WorkflowNode | null {
  const edge = workflow.connections.find((c) => c.fromNodeId === nodeId && c.toNodeId !== null)
  if (!edge) return null
  return workflow.nodes.find((n) => n.id === edge.toNodeId) ?? null
}

/* ---------------------------------------------------------------- is it sound */

export type ProblemLevel = 'refuse' | 'warn'

export interface WorkflowProblem {
  level: ProblemLevel
  nodeId: string | null
  message: string
}

/**
 * What is wrong with this workflow.
 *
 * TWO LEVELS, AND THE DIFFERENCE IS WHO IT IS FOR. A `refuse` cannot be saved: it is the workflow
 * contradicting itself, and there is no reading of it that produces a sensible date. A `warn` is
 * the firm's business and is shown rather than blocked — an unwritten notice is a to-do list, not
 * an error, and a form that blocks on one teaches people to ignore the ones that matter.
 */
export function workflowProblems(workflow: Workflow): WorkflowProblem[] {
  const out: WorkflowProblem[] = []
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]))

  /*
   * A WORKFLOW WITH NO STEPS. Refused rather than warned, and it is really about PUBLISHING --
   * canSave is what the Publish button asks. Every new workflow starts here, so without this the
   * first thing the firm can do with one is make it live and have it do nothing to every account
   * that triggers it. A draft with no steps is fine; a published one is a promise nothing keeps.
   */
  if (workflow.nodes.length === 0) {
    out.push({ level: 'refuse', nodeId: null, message: 'A workflow with no steps does nothing. Add the first step.' })
  }

  for (const node of workflow.nodes) {
    if (!node.label.trim()) {
      out.push({ level: 'refuse', nodeId: node.id, message: 'A step needs a name somebody can read.' })
    }
    if (!Number.isInteger(node.day) || node.day < 0) {
      out.push({ level: 'refuse', nodeId: node.id, message: 'A workflow day is a whole number of days from the handover.' })
    }
    /*
     * A DEADLINE IS TWO FACTS OR IT IS NONE. "20" on its own is not a period: it is twenty
     * calendar days or twenty business days, and on a statutory notice the difference is four
     * weeks and a notice that has to be served again.
     */
    if ((node.deadlineDays === null) !== (node.deadlineUnit === null)) {
      out.push({
        level: 'refuse',
        nodeId: node.id,
        message: 'A period given to the debtor needs both a number of days and the kind of day it is counted in.',
      })
    }
    if (node.deadlineDays !== null && node.deadlineDays <= 0) {
      out.push({ level: 'refuse', nodeId: node.id, message: 'A period given to the debtor has to be more than nothing.' })
    }
    if (node.kind === 'communication' && node.channel === null) {
      out.push({ level: 'refuse', nodeId: node.id, message: 'Say how this goes out — post, email, SMS.' })
    }
    /* A channel on a step that sends nothing is a step somebody has half-changed. */
    if (node.kind !== 'communication' && node.channel !== null) {
      out.push({ level: 'refuse', nodeId: node.id, message: `A ${NODE_KINDS[node.kind].label.toLowerCase()} step does not send anything, so it has no channel.` })
    }
    if (node.kind === 'communication' && node.templateId === null) {
      out.push({
        level: 'warn',
        nodeId: node.id,
        message: node.statutory
          ? 'No wording yet. Statutory — the attorney settles this one.'
          : 'No wording yet.',
      })
    }
    /* A step outside its own phase's day range is a chart nobody can read. */
    const phase = workflow.phases.find((p) => p.id === node.phaseId)
    if (phase && (node.day < phase.fromDay || node.day > phase.toDay)) {
      out.push({
        level: 'warn',
        nodeId: node.id,
        message: `Day ${node.day} is outside ${phase.name}, which runs day ${phase.fromDay} to ${phase.toDay}.`,
      })
    }
  }

  /*
   * THE ONE THAT MATTERS: an edge may not point backwards.
   *
   * The day says when and the edge says what follows. They are independent facts and they agree
   * about everything except this — an edge from day 35 to day 21 is a workflow that cannot be run
   * either way round, and picking one silently is how a statutory notice goes out in the wrong
   * order on four hundred files.
   */
  for (const edge of workflow.connections) {
    if (edge.toNodeId === null) continue
    const from = byId.get(edge.fromNodeId)
    const to = byId.get(edge.toNodeId)
    if (!from || !to) {
      out.push({ level: 'refuse', nodeId: from?.id ?? null, message: 'This step points at something that is not in the workflow.' })
      continue
    }
    if (to.day < from.day) {
      out.push({
        level: 'refuse',
        nodeId: from.id,
        message: `${from.label} is day ${from.day} and points at ${to.label} on day ${to.day}. A step cannot be followed by an earlier one.`,
      })
    }
    if (to.id === from.id) {
      out.push({ level: 'refuse', nodeId: from.id, message: 'A step cannot follow itself.' })
    }
  }
  return out
}

/** Whether this workflow can be saved at all. Warnings do not stop anything. */
export function canSave(problems: WorkflowProblem[]): boolean {
  return !problems.some((p) => p.level === 'refuse')
}

/**
 * Whether changing one node's day or next step would contradict the workflow.
 *
 * Run BEFORE the change is committed, on a copy, so the form can refuse in place rather than
 * saving something and then reporting that it was wrong.
 */
export function problemsAfterEdit(workflow: Workflow, edit: Partial<WorkflowNode> & { id: string }): WorkflowProblem[] {
  const next: Workflow = {
    ...workflow,
    nodes: workflow.nodes.map((n) => (n.id === edit.id ? { ...n, ...edit } : n)),
  }
  return workflowProblems(next)
}
