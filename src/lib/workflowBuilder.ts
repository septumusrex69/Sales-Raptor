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

export interface WorkflowVersion {
  id: string
  version: number
  state: VersionState
  publishedAt: string | null
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
