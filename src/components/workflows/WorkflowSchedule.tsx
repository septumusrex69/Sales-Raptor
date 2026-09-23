import type React from 'react'
import { ArrowRight } from 'lucide-react'
import {
  CHANNELS, DAY_UNITS, NODE_KINDS, dayLabel, dayZeroLabel, landsOn, nodesOfPhase, orderedNodes,
  triggerMeta, type Workflow, type WorkflowNode, type WorkflowProblem,
} from '../../lib/workflowBuilder.ts'
import { EXIT_EVENTS } from '../../lib/workflowRun.ts'
import { shortDate } from '../../lib/dateLabels.ts'

/**
 * THE SEQUENCE AS THE FIRM DRAWS IT: what starts it, then a day and a step on each line.
 *
 * REPLACES A HORIZONTAL STRIP OF CARDS. That drew eleven steps in a row you scrolled sideways
 * through, which is fine for a diagram and wrong for a chart somebody reads down -- the firm's
 * own document is a table of days, and "what happens on day 32" was a question you answered by
 * dragging. Read down, the intervals are visible: seven days, then five, then twenty.
 *
 * THE DAY IS THE ROW'S OWN LABEL, with its unit, because that is the number the firm types off
 * their chart and the one that was misread. The date it lands on sits beside it -- a number
 * cannot tell you the listing notice falls in the December shutdown and a date can.
 *
 * NUMBERED INSTEAD WHERE EVERY STEP SHARES A DAY. The handover is three steps inside ten minutes,
 * and a rail reading "Day 0 / Day 0 / Day 0" says only that somebody printed the same number
 * three times. There the order is the fact, so it is drawn as 1, 2, 3.
 */
export function WorkflowSchedule({
  workflow, from, selected, onSelect, problems, phases, controls,
}: {
  workflow: Workflow
  /** The day the chart is dated from, so each row can show where it actually lands. */
  from: string
  selected: string | null
  onSelect: (id: string) => void
  problems: WorkflowProblem[]
  /** The firm's phases, drawn above the rail. Passed in so this stays one column of steps. */
  phases?: React.ReactNode
  /**
   * The controls that CHANGE what starts it and how its days are counted, drawn inside the
   * banner that states them.
   *
   * IN THE BANNER BECAUSE THE TRIGGER IS SAID ONCE. Put in the page header instead, the screen
   * announced the trigger in a dropdown and then announced it again in the banner underneath --
   * two statements of the same fact, which is how they come to disagree.
   */
  controls?: React.ReactNode
}) {
  const steps = orderedNodes(workflow)
  const trigger = triggerMeta(workflow.version.trigger)
  const unit = workflow.version.dayUnit
  /* Every step on one day means the day number is not what tells them apart. */
  const spread = new Set(steps.map((n) => n.day)).size > 1

  return (
    <div className="space-y-4">
      {/*
        WHAT SETS IT OFF, ABOVE EVERYTHING, and dark so it reads as the thing the rest hangs from
        rather than as the first step. Until triggers existed every workflow was implicitly "an
        account was handed over", which is the only day zero the numbers were ever written for.
      */}
      <div className="rounded-xl bg-navy-950 px-4 py-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-400">
          {workflow.version.trigger === 'by_hand' ? 'Manual trigger' : 'Starts when'}
        </p>
        <p className="text-[15px] font-semibold text-white mt-1">{trigger.label}</p>
        <p className="text-[12px] text-white/50 mt-0.5">
          {dayZeroLabel(workflow.version.trigger)}
          {' '}Counted in {DAY_UNITS[unit].label}.
        </p>
        {/* HOW TO COUNT THEM, in full, beside the unit rather than somewhere else on the page.
            Whether weekends count and whether the first day is 0 or 1 are the two things a
            reader otherwise supplies themselves, and half of them supply the wrong one. */}
        <p className="text-[11px] text-white/35 mt-0.5">{DAY_UNITS[unit].hint}</p>
        {controls && <div className="mt-2.5 border-t border-white/10 pt-2.5">{controls}</div>}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-[15px] font-semibold text-slate-800">
            {spread ? 'Schedule' : 'What happens'}
          </p>
          {/*
            THE UNIT, ONCE, WHERE THE NUMBERS ARE. Not a chip in a corner over numbers worked out
            some other way: every row below is dated through this unit by `landsOn`, so the chip
            and the dates cannot disagree.
          */}
          <span className="rounded-full bg-[var(--tint-steel-alt)] px-2.5 py-1 text-[11px] text-slate-600">
            {spread ? DAY_UNITS[unit].label : 'Same day, in order'}
          </span>
        </div>

        {phases && <div className="mt-3">{phases}</div>}

        {steps.length === 0 ? (
          <p className="text-sm text-slate-400 py-6">Nothing in it yet.</p>
        ) : (
          <ol className="mt-3 space-y-1.5">
            {steps.map((node, i) => (
              <ScheduleRow key={node.id} node={node} ordinal={i + 1} spread={spread}
                unit={unit} from={from} workflow={workflow}
                selected={node.id === selected} onSelect={() => onSelect(node.id)}
                problems={problems.filter((p) => p.nodeId === node.id)} />
            ))}
          </ol>
        )}
      </div>

      {/*
        WHAT TAKES AN ACCOUNT OUT, at the bottom, because it is true of every row above it.
        Drawn from EXIT_EVENTS rather than typed -- the runner's own list, so a screen promising
        that a promise stops the sequence is promising what the database actually does.
      */}
      <div className="rounded-xl bg-[var(--tint-steel-alt)] px-4 py-3.5">
        <p className="text-[13px] font-semibold text-slate-800">Exit rules</p>
        <p className="text-[12px] text-slate-500 mt-0.5">
          Any of these stops the sequence. What has already gone stays sent; what has not is
          cancelled, and the account goes back to the collector.
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {Object.values(EXIT_EVENTS).map((label) => (
            <span key={label}
              className="rounded-lg bg-white px-2.5 py-1 text-[12px] text-slate-600 shadow-sm">
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function ScheduleRow({ node, ordinal, spread, unit, from, workflow, selected, onSelect, problems }: {
  node: WorkflowNode
  ordinal: number
  spread: boolean
  unit: 'calendar' | 'business'
  from: string
  workflow: Workflow
  selected: boolean
  onSelect: () => void
  problems: WorkflowProblem[]
}) {
  const refused = problems.some((p) => p.level === 'refuse')
  const warned = problems.some((p) => p.level === 'warn')
  const phase = workflow.phases.find((p) => p.id === node.phaseId)
  return (
    <li>
      <button type="button" onClick={onSelect}
        className={`w-full flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
          refused ? 'border-rose-300 bg-rose-50/40'
            : selected ? 'border-[#c9a052] bg-gold-50'
              : 'border-transparent hover:bg-slate-50'
        }`}>
        {/* The day, or the position where every step shares a day. Fixed width so the labels
            line up down the rail and the intervals can be read off the gaps. */}
        <span className="shrink-0 w-[104px] rounded-lg bg-navy-950 px-2 py-1 text-center
          text-[11px] font-semibold uppercase tracking-wide text-white tabular-nums">
          {spread ? dayLabel(node.day, unit) : `Step ${ordinal}`}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium text-slate-800">{node.label}</span>
          <span className="block text-[12px] text-slate-400 mt-0.5">{secondLine(node, phase?.name)}</span>
        </span>

        <span className="shrink-0 flex items-center gap-2">
          {/*
            WAITS FOR A PERSON, SAID ON THE ROW. The firm's rule for these: day 39 says a default
            HAS been reported and day 49 says the file HAS gone to the attorneys, so neither may
            go until somebody confirms it has. A chart that did not show which steps stop is a
            chart that reads as though the whole thing runs by itself.
          */}
          {node.needsRelease && (
            <span className="rounded-full bg-gold-100 px-2 py-0.5 text-[10px] font-medium text-[var(--c-gold-deep)]">
              Waits for you
            </span>
          )}
          {(refused || warned) && (
            <span className={`h-1.5 w-1.5 rounded-full ${refused ? 'bg-rose-500' : 'bg-amber-400'}`} />
          )}
          {spread && (
            <span className="w-[68px] text-right text-[11px] text-slate-400 tabular-nums">
              {shortDate(landsOn(from, node.day, unit))}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

/**
 * The step's second fact, in one line: what it sends, how long the debtor is given, whose phase
 * it is. Its description is a paragraph and belongs in the panel beside it, not here.
 */
function secondLine(node: WorkflowNode, phase: string | undefined): string {
  const parts: string[] = []
  if (node.channel) parts.push(CHANNELS[node.channel])
  else parts.push(NODE_KINDS[node.kind].label)
  /* The DEBTOR's clock, which is not the firm's -- "twenty business days to respond" is the
     period this step gives them, not when the next step runs. */
  if (node.deadlineDays !== null && node.deadlineUnit !== null) {
    parts.push(`${node.deadlineDays} ${node.deadlineUnit === 'business' ? 'business days' : 'days'} to respond`)
  }
  /*
   * `typeof === 'number'`, NOT `!== null`. A row whose after_minutes column is absent rather
   * than null arrives as undefined, which is not null -- and every step on the chart then read
   * "undefined min after the one before". Visible only in the browser, which is where it was
   * caught: the rule checks all passed.
   */
  if (typeof node.afterMinutes === 'number') {
    parts.push(`${node.afterMinutes} min after the one before`)
  }
  if (phase) parts.push(phase)
  return parts.join(' · ')
}

/** Kept for the phase strip the builder still draws above the rail on a multi-phase workflow. */
export function PhaseStrip({ workflow, unit }: {
  workflow: Workflow
  unit: 'calendar' | 'business'
}) {
  const phases = [...workflow.phases]
    .sort((a, b) => a.ordinal - b.ordinal)
    .filter((p) => nodesOfPhase(workflow, p.id).length > 0)
  if (phases.length < 2) return null
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {phases.map((p, i) => (
        <span key={p.id} className="flex items-center gap-2">
          {i > 0 && <ArrowRight size={13} className="text-slate-300" />}
          <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1">
            {/* The phase NAME in its own element, because it is the label of the group and
                because it is what a reader scans for -- "where does Listing start?". */}
            <p className="text-[12px] font-medium text-slate-700">{p.name}</p>
            {/* The range carries the unit, like every other number on this screen. Spaced
                around the dash so "Day 80 – 160" reads as a range rather than as a subtraction. */}
            <p className="text-[11px] text-slate-400 tabular-nums">
              {dayLabel(p.fromDay, unit)} &ndash; {p.toDay}
            </p>
          </span>
        </span>
      ))}
    </div>
  )
}
