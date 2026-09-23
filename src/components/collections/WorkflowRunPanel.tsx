import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Clock, Minus } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { fetchAccountRuns, type AccountRun } from '../../lib/accountRun.ts'
import { RUN_STEP_WORDS, needsAttention, type RunStep } from '../../lib/runSteps.ts'
import { dayLabel } from '../../lib/workflowBuilder.ts'
import { shortDate } from '../../lib/dateLabels.ts'

/**
 * WHAT THE WORKFLOW HAS SENT THIS DEBTOR, AND WHAT IT IS WAITING FOR.
 *
 * The runner has written to `workflow_run_steps` every morning since the transport went in, and
 * nothing read it back. A held step carried its reason in a column nobody opens; the notification
 * raised beside it said "go to the account", and the account said nothing about it. This is the
 * screen that notification points at.
 *
 * THE HELD STEPS ARE THE POINT, and they are lifted out of the list rather than left in it. A
 * collector opening an account is not auditing a sequence -- they want to know whether anything
 * is waiting on them, and "nothing on the account fills {{listing_reference}}" is a sentence that
 * says exactly what to go and do. The rest of the run is underneath, because "what have we
 * actually sent this person" is the other question anybody asks here.
 *
 * NOT SHOWN AT ALL WHERE THERE IS NO RUN, which is most of the book today. An empty "Workflow"
 * card on every account pushes the figures down the page in order to say nothing.
 */
export function WorkflowRunPanel({ accountId }: { accountId: string }) {
  const [runs, setRuns] = useState<AccountRun[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = await fetchAccountRuns(accountId)
        if (!cancelled) setRuns(rows)
      } catch (e) {
        if (!cancelled) { setRuns([]); setError(e instanceof Error ? e.message : String(e)) }
      }
    })()
    return () => { cancelled = true }
  }, [accountId])

  /* Nothing at all while it loads, and nothing when there is nothing: a card that appears and
     then vanishes moves everything below it twice. */
  if (runs === null || (runs.length === 0 && !error)) return null

  return (
    <Card>
      <CardHeader title="Workflow"
        subtitle={runs.length === 1
          ? 'What has gone out, and what is waiting.'
          : `${runs.length} runs on this account.`} />
      {error && <p className="text-xs text-negative-700">{error}</p>}
      <div className="space-y-4">
        {runs.map((run) => <RunBlock key={run.id} run={run} />)}
      </div>
    </Card>
  )
}

function RunBlock({ run }: { run: AccountRun }) {
  const waiting = needsAttention(run.steps)
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-[13px] font-medium text-slate-800">{run.workflowName}</p>
        <p className="text-[11px] text-slate-400">
          {/* The date it started, because every day number on the list below counts from it. */}
          Started {shortDate(run.startedOn)}
          {run.state === 'left' && run.leftReason && (
            /* WHY IT STOPPED, IN THE FIRM'S WORDS. "left" is how the row got into that state;
               "A promise to pay was made" is the thing somebody needs to know. */
            <> &middot; <span className="text-slate-500">{run.leftReason}</span></>
          )}
          {run.state === 'finished' && <> &middot; finished</>}
        </p>
      </div>

      {/*
        WHAT IS WAITING ON A PERSON, FIRST AND IN FULL. Buried in the sequence with everything
        else, the one line that needs doing reads as a row in a table.
      */}
      {waiting.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {waiting.map((s) => (
            <li key={s.id}
              className="rounded-lg border border-[var(--c-gold-deep)]/30 bg-gold-50 px-3 py-2">
              <p className="text-[12px] font-medium text-navy-950">
                {s.label} &middot; {RUN_STEP_WORDS[s.state].label}
              </p>
              {s.note && <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">{s.note}</p>}
            </li>
          ))}
        </ul>
      )}

      <ul className="mt-2 divide-y divide-slate-100">
        {run.steps.map((s) => <StepRow key={s.id} step={s} run={run} />)}
      </ul>
    </section>
  )
}

const ICONS = {
  done: Check,
  wait: Clock,
  attention: AlertTriangle,
  off: Minus,
} as const

const TONES = {
  done: 'text-positive-600',
  wait: 'text-slate-400',
  attention: 'text-[var(--c-gold-deep)]',
  off: 'text-slate-300',
} as const

function StepRow({ step, run }: { step: RunStep; run: AccountRun }) {
  const word = RUN_STEP_WORDS[step.state]
  const Icon = ICONS[word.tone]
  return (
    <li className="flex items-baseline gap-2.5 py-1.5">
      <Icon size={12} className={`shrink-0 translate-y-0.5 ${TONES[word.tone]}`} />
      <span className={`min-w-0 flex-1 text-[12px] leading-snug ${
        step.state === 'cancelled' ? 'text-slate-400 line-through' : 'text-slate-700'
      }`}>
        {step.label}
      </span>
      {/*
        THE DAY NUMBER WITH ITS UNIT, AND THE DATE IT LANDS ON. The same rule as the builder: a
        number read as calendar days on a business-day chart is a fortnight out, and this is the
        screen where somebody checks what actually happened against what was meant to.
      */}
      <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">
        {dayLabel(step.day, run.dayUnit)}
      </span>
      <span className="shrink-0 w-[68px] text-right text-[11px] text-slate-400 tabular-nums">
        {shortDate(step.sentAt ? step.sentAt.slice(0, 10) : step.dueOn)}
      </span>
    </li>
  )
}
