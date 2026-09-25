import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Clock, Loader2, Minus, Send } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { useAuth } from '../../store/AuthContext'
import { fetchAccountRuns, releaseStep, type AccountRun } from '../../lib/accountRun.ts'
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

  const load = useCallback(async () => {
    try {
      setRuns(await fetchAccountRuns(accountId))
    } catch (e) {
      setRuns([]); setError(e instanceof Error ? e.message : String(e))
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

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
        {runs.map((run) => <RunBlock key={run.id} run={run} onSent={load} />)}
      </div>
    </Card>
  )
}

function RunBlock({ run, onSent }: { run: AccountRun; onSent: () => Promise<void> }) {
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
            <HeldStep key={s.id} step={s} live={run.state === 'running'} onSent={onSent} />
          ))}
        </ul>
      )}

      <ul className="mt-2 divide-y divide-slate-100">
        {run.steps.map((s) => <StepRow key={s.id} step={s} run={run} />)}
      </ul>
    </section>
  )
}

/**
 * ONE HELD STEP, AND THE BUTTON THAT SENDS IT.
 *
 * THE LABEL IS THE TRUTH ABOUT WHAT PRESSING IT DOES. On a step that waits for a PERSON -- day 39
 * saying a default has been reported, day 49 saying the file has gone to the attorneys -- the
 * person is the gate, so "Send it now" is exactly what happens. On any other hold the gate is
 * something missing from the account, and a button promising to send would be lying: pressing it
 * asks again, and if the listing reference is still not there the step holds again with the same
 * reason. So there it says "Try again", which is what it does.
 *
 * AND THE ANSWER COMES BACK IN PLACE, WITHOUT THE CARD REPEATING ITSELF. A release that holds
 * again is the useful case -- somebody thought they had fixed it and had not -- so the answer
 * has to land under the same card rather than the button simply going quiet.
 *
 * IT USED TO LAND TWICE. The reason from the attempt was printed UNDER the reason already on the
 * card, and holding again for the SAME reason is the ordinary case -- so the firm read the same
 * sentence twice, in the same words, and asked whether that was a bug. It was. onSent refetches
 * the run, so the reason above is already the new one; all this line adds is what the reader
 * cannot otherwise know -- that the attempt happened just now, and whether the answer moved.
 *
 * COMPARED AGAINST THE REASON AS IT WAS BEFORE THE ATTEMPT, never against the refreshed one. By
 * the time the answer is in hand, step.note IS the answer -- so comparing the two always says
 * "the same", including on the attempt that changed it, which is the one worth pointing at.
 */
function HeldStep({ step, live, onSent }: {
  step: RunStep
  /** A run the account has already left sends nothing more, so it offers nothing. */
  live: boolean
  onSent: () => Promise<void>
}) {
  const { session } = useAuth()
  const [busy, setBusy] = useState(false)
  /* Held: it went nowhere, and whether the reason moved. Error: the request itself failed, which
     is not a reason a step holds and is not on the card above. */
  const [said, setSaid] = useState<
    { kind: 'held'; changed: boolean } | { kind: 'error'; text: string } | null
  >(null)

  async function release() {
    if (!session?.access_token) return
    /* Read BEFORE the attempt. onSent refreshes step.note to whatever the answer was. */
    const before = (step.note ?? '').trim()
    setBusy(true); setSaid(null)
    try {
      const out = await releaseStep(session.access_token, step.id)
      if (out.result === 'sent') { await onSent(); return }
      /* Still held, or the provider refused. The reason itself is drawn from the refreshed step
         above; what is said here is that it was tried and whether anything moved. */
      setSaid({ kind: 'held', changed: (out.note ?? '').trim() !== before })
      await onSent()
    } catch (e) {
      setSaid({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-lg border border-[var(--c-gold-deep)]/30 bg-gold-50 px-3 py-2">
      <p className="text-[12px] font-medium text-navy-950">
        {step.label} &middot; {RUN_STEP_WORDS[step.state].label}
      </p>
      {step.note && <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">{step.note}</p>}
      {said?.kind === 'held' && (
        <p className="text-[11px] text-slate-500 mt-1 leading-snug">
          {said.changed
            ? 'Tried just now — the reason above is new.'
            : 'Tried just now — the reason above has not changed.'}
        </p>
      )}
      {said?.kind === 'error' && (
        <p className="text-[11px] text-negative-700 mt-1 leading-snug">{said.text}</p>
      )}
      {live && (
        <button type="button" onClick={() => { void release() }} disabled={busy}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[#c9a052]
            bg-white px-2.5 py-1 text-[11px] font-medium text-navy-950
            hover:bg-gold-100 disabled:opacity-40">
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
          {step.needsRelease ? 'Send it now' : 'Try again'}
        </button>
      )}
    </li>
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
