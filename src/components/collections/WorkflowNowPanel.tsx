import { Link } from 'react-router-dom'
import { ArrowRight, GitBranch } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { needsAttention, shapeOf, stepInFocus } from '../../lib/runSteps.ts'
import { dayLabel, dayNumberOn } from '../../lib/workflowBuilder.ts'
import { shortDate } from '../../lib/dateLabels.ts'
import { todayIso } from '../../lib/reminderTime.ts'
import type { AccountRun } from '../../lib/accountRun.ts'

/**
 * WHICH SEQUENCE THIS DEBTOR IS IN, IN FOUR LINES, ON THE OVERVIEW.
 *
 * THE FIRM, once the workflow moved to a tab of its own: "you took away the current workflow. So
 * it can show like just the current workflow that it's in, like something small, that's still on
 * the main debtor's page, somewhere below the promise and the dispute."
 *
 * WHICH IS THE RIGHT TRADE, BOTH WAYS. The eleven-step track needed the page, and the rail could
 * not give it one; but "is this account in the middle of a statutory sequence" is something you
 * have to know before you ring somebody, and it cannot be behind a tab. So the tab keeps the
 * work and the rail keeps the FACT.
 *
 * IT SITS BELOW THE PROMISE AND THE DISPUTE, at the firm's earlier asking -- "I think a promise
 * to pay and a dispute holds more weight than that" -- and it is deliberately smaller than both.
 *
 * NOTHING AT ALL WHERE NO SEQUENCE IS RUNNING, which is most of the book. A card saying "no
 * workflow" on twenty-three thousand accounts pushes the figures down the page to say nothing.
 * A run that has FINISHED is not drawn either: what the debtor was sent is history, and history
 * lives on the tab.
 */
export function WorkflowNowPanel({ accountId, runs }: { accountId: string; runs: AccountRun[] }) {
  const live = runs.filter((r) => r.state === 'running')
  if (live.length === 0) return null

  const today = todayIso()
  return (
    <Card>
      <CardHeader title="Workflow"
        subtitle={live.length === 1 ? 'The sequence running on this account.' : `${live.length} sequences running.`}
        action={
          <Link to={`/accounts/${accountId}?tab=Workflow`}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800">
            Open <ArrowRight size={12} />
          </Link>
        } />
      <div className="space-y-3">
        {live.map((run) => {
          const waiting = needsAttention(run.steps)
          /* The same step the track opens on, from the same function, so the rail and the tab
             cannot name two different "next things" on one account. */
          const focus = run.steps.find((s) => s.id === stepInFocus(run.steps)) ?? null
          const next = run.steps.find((s) => s.state === 'pending') ?? null
          return (
            <div key={run.id}>
              <p className="flex items-start gap-2 text-[13px] font-medium text-slate-800">
                <GitBranch size={13} className="mt-0.5 shrink-0 text-slate-400" />
                <span className="min-w-0">{run.workflowName}</span>
              </p>
              {/* WHERE IT IS, in the unit the run counts in. The same arithmetic the track's
                  caret uses, so the two can never put today on opposite sides of a step. */}
              <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                {dayLabel(dayNumberOn(run.startedOn, today, run.dayUnit), run.dayUnit)}
                {' of '}
                {run.steps.length} {run.steps.length === 1 ? 'step' : 'steps'}
              </p>
              {/*
                AND THE ONE SENTENCE SOMEBODY ACTS ON. What has stopped comes first: that is the
                reason the notification sent them to this account, and it must not need a tab to
                be discovered. Otherwise, what goes next and when.
              */}
              {waiting.length > 0 ? (
                <p className="mt-1 text-[11px] font-medium text-[var(--c-gold-deep)]">
                  {waiting.length === 1
                    ? `Waiting on you: ${waiting[0].label}`
                    : `${waiting.length} steps are waiting on you`}
                </p>
              ) : next ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  Next: {next.label}, {shortDate(next.dueOn)}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-slate-400">
                  {focus && shapeOf(focus) === 'sent' ? 'Everything has gone out.' : 'Nothing left to send.'}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
