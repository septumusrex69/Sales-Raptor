import {
  ArrowRight, CalendarClock, ClipboardCheck, FileText, MessageSquare, UserCog, Zap,
} from 'lucide-react'
import {
  nodesOfPhase, type Workflow, type WorkflowNode, type WorkflowPhase, type WorkflowProblem,
  landsOn, type DayUnit,
} from '../../lib/workflowBuilder.ts'
import { shortDate } from '../../lib/dateLabels.ts'

/**
 * The workflow, drawn.
 *
 * ONE ROW PER PHASE, which is the firm's own chart and is also the only layout that reads at a
 * glance: a workflow drawn as a graph needs following, a workflow drawn as a line needs looking
 * at, and this one is a line. The branch-heavy version that used to hang underneath is gone —
 * payment arrangement, dispute, sequestration and the rest are workflows of their own now, and
 * showing them here made the main line look like the exception.
 *
 * DRIVEN BY DATA, ENTIRELY. Nothing here knows what day 35 is: it is handed nodes and draws them.
 * That is what makes the thing editable rather than a picture of an edit.
 */
export function WorkflowCanvas({ workflow, selected, onSelect, problems, from }: {
  workflow: Workflow
  selected: string | null
  onSelect: (id: string) => void
  problems: WorkflowProblem[]
  /**
   * The handover the card dates are counted from.
   *
   * WHY A DATE AT ALL. "Day 110" is unreadable against a calendar — it tells nobody whether the
   * viability review lands in the December shutdown, and that is the kind of error somebody spots
   * in a second and never spots in a day number. Carried in from the read-only page this canvas
   * replaced, which existed for exactly this.
   */
  from: string
}) {
  /* The version's own unit, carried down rather than looked up per card: every card on a chart
     counts the same way, and reading it once is what makes that true rather than hoped for. */
  const dayUnit = workflow.version.dayUnit
  return (
    <div className="space-y-6">
      {workflow.phases.map((phase) => (
        <PhaseRow key={phase.id} phase={phase} nodes={nodesOfPhase(workflow, phase.id)}
          selected={selected} onSelect={onSelect} problems={problems} from={from}
          dayUnit={dayUnit} />
      ))}
    </div>
  )
}

function PhaseRow({ phase, nodes, selected, onSelect, problems, from, dayUnit }: {
  phase: WorkflowPhase
  nodes: WorkflowNode[]
  selected: string | null
  onSelect: (id: string) => void
  problems: WorkflowProblem[]
  from: string
  dayUnit: DayUnit
}) {
  return (
    <section>
      {/*
        The dark bar. Its day range is the PHASE's, typed by the firm, and not derived from the
        steps inside it — so a step dragged outside the range is a warning rather than a bar that
        silently stretches to cover whatever it is given.
      */}
      <div className="rounded-xl bg-navy-950 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gold-400 text-[11px] font-semibold text-navy-950">
          {phase.ordinal}
        </span>
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-white">{phase.name}</p>
          <p className="text-[11px] text-white/50">Day {phase.fromDay} &ndash; {phase.toDay}</p>
        </div>
        {phase.subtitle && (
          <p className="ml-auto hidden sm:block text-[11px] uppercase tracking-[0.18em] text-gold-400/80">
            {phase.subtitle}
          </p>
        )}
      </div>

      {/* Scrolls sideways rather than squeezing: a card narrow enough to fit six on a laptop is a
          card nobody can read, and the brief says so. */}
      <div className="mt-4 overflow-x-auto pb-2">
        <div className="flex items-stretch gap-2 min-w-max">
          {nodes.map((node, i) => (
            <div key={node.id} className="flex items-center gap-2">
              <NodeCard node={node} selected={node.id === selected} onSelect={() => onSelect(node.id)}
                dayUnit={dayUnit}
                problems={problems.filter((p) => p.nodeId === node.id)} from={from} />
              {i < nodes.length - 1 && <ArrowRight size={15} className="shrink-0 text-slate-300" />}
            </div>
          ))}
          {nodes.length === 0 && (
            <p className="text-sm text-slate-400 py-6">No steps in this phase yet.</p>
          )}
        </div>
      </div>
    </section>
  )
}

const ICONS = {
  action: Zap,
  communication: MessageSquare,
  document: FileText,
  task: ClipboardCheck,
  assignment: UserCog,
  wait: CalendarClock,
}

function NodeCard({ node, selected, onSelect, problems, from, dayUnit }: {
  node: WorkflowNode
  selected: boolean
  onSelect: () => void
  problems: WorkflowProblem[]
  from: string
  dayUnit: DayUnit
}) {
  const Icon = ICONS[node.kind]
  const refused = problems.some((p) => p.level === 'refuse')
  const warned = problems.some((p) => p.level === 'warn')
  return (
    <button type="button" onClick={onSelect}
      className={`w-[168px] shrink-0 rounded-xl border bg-white px-3.5 py-3 text-left shadow-sm
        transition hover:shadow-md ${
        refused ? 'border-rose-300 ring-1 ring-rose-200'
          : selected ? 'border-gold-400 ring-2 ring-gold-200'
            : 'border-slate-200'
      }`}>
      <Icon size={16} className={refused ? 'text-rose-500' : selected ? 'text-gold-500' : 'text-brand-500'} />
      {/* The day number and the date it lands on, together. The number is what the step IS; the
          date is what makes it checkable against a calendar. Neither on its own does both. */}
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Day {node.day}
      </p>
      <p className="text-[11px] text-slate-400 tabular-nums">{shortDate(landsOn(from, node.day, dayUnit))}</p>
      <p className="text-[13px] font-medium text-slate-800 leading-snug mt-0.5">{node.label}</p>
      {/*
        The one line under the label is the step's own second fact — "Registered post", "7 days to
        settle" — rather than its description, which is a paragraph and belongs in the drawer.
      */}
      <p className="text-[11px] text-slate-400 mt-1 leading-snug">{secondLine(node)}</p>
      {(refused || warned) && (
        <span className={`mt-2 inline-block h-1.5 w-1.5 rounded-full ${refused ? 'bg-rose-500' : 'bg-amber-400'}`} />
      )}
    </button>
  )
}

/** "Registered post · 7 days to settle". Empty where the step has nothing more to say. */
function secondLine(node: WorkflowNode): string {
  const parts: string[] = []
  if (node.channel) parts.push(CHANNEL_WORDS[node.channel])
  if (node.deadlineDays !== null && node.deadlineUnit !== null) {
    parts.push(`${node.deadlineDays} ${node.deadlineUnit === 'business' ? 'business days' : 'days'} to respond`)
  }
  if (node.kind === 'assignment' && node.assignTo) parts.push(node.assignTo)
  return parts.join(' · ')
}

/**
 * `from` plus N calendar days, as a yyyy-mm-dd key.
 *
 * UTC, deliberately. Local-time date arithmetic moves by an hour across a daylight-saving
 * boundary, which is enough to land a step on the day before — South Africa has no DST, but the
 * browser reading this screen might not be in South Africa.
 */

const CHANNEL_WORDS: Record<string, string> = {
  email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp', post: 'Post',
  registered_post: 'Registered post', call: 'Telephone call', hand: 'By hand',
}
