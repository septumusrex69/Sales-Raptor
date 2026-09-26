import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Clock, Loader2, Minus, Send } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { WorkflowTrack } from './WorkflowTrack'
import { useAuth } from '../../store/AuthContext'
import {
  releaseStep, startWorkflow, type AccountRun, type StartableWorkflow,
} from '../../lib/accountRun.ts'
import { RUN_STEP_WORDS, needsAttention, shapeOf, stepInFocus, type RunStep } from '../../lib/runSteps.ts'
import { dayLabel, dayNumberOn } from '../../lib/workflowBuilder.ts'
import { shortDate } from '../../lib/dateLabels.ts'
import { todayIso } from '../../lib/reminderTime.ts'

/**
 * THE WORKFLOW TAB — WHAT IS RUNNING ON THIS DEBTOR, AND WHAT HAS ALREADY RUN.
 *
 * THE FIRM: "I think we should make like a separate little tab there for the workflow. Then we
 * have a whole pane there where we can see with the past workflows. And current ones."
 *
 * IT WAS A CARD IN THE ACCOUNT'S RAIL and the rail is two hundred pixels wide, which is what
 * every compromise in the track was paying for: dots shrunk to fit, step names dropped, dates
 * dropped. Given the page it keeps all three — the same component, the same container query,
 * more room. Nothing about the track changed to move house.
 *
 * RUNNING FIRST, THEN WHAT IS OVER, under headings that say which is which. A finished handover
 * and a live section 129 drawn one after another in the same weight is how somebody reads a
 * sequence that stopped in March as the one they are working today.
 *
 * THE HELD STEPS ARE STILL THE POINT. They are gold on the track, counted over it in words, and
 * marked on the TAB itself — because the one thing on this page that is somebody's work must not
 * be the thing you have to open a tab to discover.
 *
 * IT IS GIVEN ITS ROWS RATHER THAN FETCHING THEM. The tab only mounts when it is opened, and a
 * panel that fetched its own runs could not put a mark on the tab that opens it. The account
 * page reads them once, for the badge and for this.
 */
export function WorkflowRunPanel({ accountId, runs, offers, error, onChanged }: {
  accountId: string
  runs: AccountRun[]
  /** The workflows a person may start here. Empty is the ordinary case. */
  offers: StartableWorkflow[]
  error: string | null
  onChanged: () => Promise<void>
}) {
  /* Running, and then everything else. `left` and `finished` are different rows and the same
     fact on this screen: it is over, and nothing more goes out on it. */
  const live = runs.filter((r) => r.state === 'running')
  const past = runs.filter((r) => r.state !== 'running')

  return (
    <Card>
      <CardHeader title="Workflow"
        subtitle={runs.length === 0
          ? 'Nothing has run on this account yet.'
          : live.length === 0
            ? `${past.length === 1 ? 'One sequence has' : `${past.length} sequences have`} run on this account.`
            : `${live.length === 1 ? 'One sequence is' : `${live.length} sequences are`} running on this account.`} />
      {error && <p className="text-xs text-negative-700">{error}</p>}

      <div className="space-y-5">
        {live.length > 0 && (
          <section>
            <Heading>Running now</Heading>
            <div className="mt-3 space-y-5">
              {live.map((run) => <RunBlock key={run.id} run={run} onSent={onChanged} />)}
            </div>
          </section>
        )}

        {/*
          WHAT CAN BE STARTED, BETWEEN THE TWO. Above what is over, because starting one is a
          thing somebody does today; below what is running, because a live sequence is the more
          important fact on the page.
        */}
        {offers.length > 0 && (
          <section>
            <Heading>{runs.length === 0 ? 'Nothing has started yet' : 'Start another'}</Heading>
            <div className="mt-3 space-y-2">
              {offers.map((w) => (
                <StartWorkflow key={w.versionId} accountId={accountId} offer={w} onStarted={onChanged} />
              ))}
            </div>
          </section>
        )}

        {past.length > 0 && (
          <section>
            <Heading>Already run</Heading>
            <div className="mt-3 space-y-5">
              {past.map((run) => <RunBlock key={run.id} run={run} onSent={onChanged} />)}
            </div>
          </section>
        )}

        {/*
          AND THE EMPTY CASE SAID PLAINLY. In the rail this card drew nothing at all where there
          was no run -- an empty card on every account pushed the figures down in order to say
          nothing. A TAB somebody opened cannot do that: a blank pane reads as a screen that
          failed.
        */}
        {runs.length === 0 && offers.length === 0 && !error && (
          <p className="text-sm text-slate-500">
            No workflow has been started on this account, and there is none published for a person
            to start. Sequences are written in the Library.
          </p>
        )}
      </div>
    </Card>
  )
}

/** The one heading style these sections share, so "Running now" and "Already run" weigh alike. */
function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{children}</h4>
  )
}

/**
 * STARTING A SEQUENCE, WHICH ISSUES ITS FIRST NOTICE.
 *
 * THE FIRM, ON THE SECTION 129: "the moment the section 129 is sent out via email, that is when
 * the workflow is triggered." So this is one press, not two -- it starts the run AND sends what
 * falls on day one, which for that sequence is the demand itself. The ten business days the
 * debtor has run from today, and every step after it is dated from here.
 *
 * ASKED TWICE, BECAUSE IT CANNOT BE UNDONE. A statutory demand that has gone has gone: it is an
 * email in somebody's inbox, an SMS on their phone, a fee on the account and the start of a
 * clock. The second press says what will happen in the firm's own words rather than asking
 * "are you sure", which is a question nobody reads.
 */
function StartWorkflow({ accountId, offer, onStarted }: {
  accountId: string
  offer: StartableWorkflow
  onStarted: () => Promise<void>
}) {
  const { session } = useAuth()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  async function go() {
    if (!session?.access_token) return
    setBusy(true); setFailed(null)
    try {
      await startWorkflow(session.access_token, accountId, offer.versionId)
      setAsking(false)
      await onStarted()
    } catch (e) {
      /* The reason the server gave, verbatim -- "there is a live promise to pay on this account"
         is a sentence that says what to do, and a generic failure is not. */
      setFailed(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!asking) {
    return (
      <div>
        <button type="button" onClick={() => { setAsking(true); setFailed(null) }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#c9a052]
            bg-white px-2.5 py-1 text-[11px] font-medium text-navy-950 hover:bg-gold-100">
          <Send size={11} /> Start: {offer.name}
        </button>
        {failed && <p className="mt-1 text-[11px] text-negative-700 leading-snug">{failed}</p>}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--c-gold-deep)]/30 bg-gold-50 px-3 py-2">
      <p className="text-[12px] font-medium text-navy-950">Start {offer.name}?</p>
      <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
        The first step goes out now, and everything after it is dated from today. Later steps that
        say something has already happened still wait for you.
      </p>
      {/* The firm's own sentence about when this should be started, where they wrote it. */}
      {offer.note && <p className="text-[11px] text-slate-500 mt-1 leading-snug">{offer.note}</p>}
      {failed && <p className="mt-1 text-[11px] text-negative-700 leading-snug">{failed}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { void go() }} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#c9a052]
            bg-white px-2.5 py-1 text-[11px] font-medium text-navy-950
            hover:bg-gold-100 disabled:opacity-40">
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
          Yes, send it now
        </button>
        <button type="button" onClick={() => setAsking(false)} disabled={busy}
          className="text-[11px] font-medium text-slate-500 hover:text-slate-700 disabled:opacity-40">
          Not yet
        </button>
      </div>
    </div>
  )
}

/**
 * ONE RUN, DRAWN AS THE FIRM DRAWS IT: a row of dots, then the one step that is asking for
 * something, then everything else behind a drop-down.
 *
 * THE FIRM, OF THE LIST THIS REPLACED: "this doesn't work for me... the layout here, it's long."
 * They were right about why. An eleven-step sequence written out is eleven rows of equal weight,
 * and an account carries two runs of one — so the section 129 that had stopped was a row in a
 * twenty-row table, drawn exactly like the nine steps that were simply not due yet.
 *
 * SO THE STEPS ARE A TRACK AND THE WORDS ARE ONE AT A TIME. The dots say how far this debtor is
 * and whether anything has stopped; the detail under them says what to do about whichever dot is
 * in focus, which opens on the stopped one because that is what somebody came here for. Nothing
 * is hidden: "you can also like extend it to show every single step in the process" is the
 * drop-down, and it is the same list as before, moved out of the way rather than removed.
 *
 * THE COUNT IS ON THE HEADER, NOT ONLY IN THE COLOUR. Two steps waiting and one dot in focus
 * would otherwise leave the second one as a gold dot nobody counted — and "2 waiting on you" is
 * the sentence that makes somebody press the other one.
 */
function RunBlock({ run, onSent }: { run: AccountRun; onSent: () => Promise<void> }) {
  const waiting = needsAttention(run.steps)
  /* What the READER chose, which is null until they choose. The default is worked out from the
     run every time it is drawn, so sending the step in focus moves the focus on rather than
     leaving it on something finished. */
  const [picked, setPicked] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const focusId = picked ?? stepInFocus(run.steps)
  const inFocus = run.steps.find((s) => s.id === focusId) ?? null
  /* The firm's day, read once. Not a state: nothing here re-renders at midnight, and a panel
     open overnight is a panel somebody reloads before they act on it. */
  const today = todayIso()
  /* The first thing still to go, which is what "what happens next" means -- a held step is not
     it, because that one is not waiting for a date, it is waiting for a person. */
  const next = run.steps.find((s) => s.state === 'pending') ?? null

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-[13px] font-medium text-slate-800">{run.workflowName}</p>
        <p className="text-[11px] text-slate-400">
          {/* The date it started, because every day number below counts from it. */}
          Started {shortDate(run.startedOn)}
          {run.state === 'left' && run.leftReason && (
            /* WHY IT STOPPED, IN THE FIRM'S WORDS. "left" is how the row got into that state;
               "A promise to pay was made" is the thing somebody needs to know. */
            <> &middot; <span className="text-slate-500">{run.leftReason}</span></>
          )}
          {run.state === 'finished' && <> &middot; finished</>}
        </p>
      </div>

      {waiting.length > 0 && (
        <p className="mt-1 text-[11px] font-medium text-[var(--c-gold-deep)]">
          {waiting.length === 1 ? '1 step is waiting on you' : `${waiting.length} steps are waiting on you`}
        </p>
      )}

      <div className="mt-2">
        <WorkflowTrack steps={run.steps} selectedId={focusId} onSelect={setPicked}
          today={run.state === 'running' ? today : null} />
      </div>

      {/*
        WHERE THE SEQUENCE IS TODAY, IN WORDS. The firm: "it's important to show where in the
        workflow is it currently and on which day... also to know when it has gone out."

        THE MARK ON THE TRACK SAYS WHERE AND THIS SAYS WHICH DAY, because a day number is the
        one thing a dot cannot carry -- nothing in the database moves as the day turns, so
        today's number is arithmetic off the day the run started, in the unit the run counts in.
        dayNumberOn is landsOn read backwards, which is why it lives beside it: worked out any
        other way the caret and the caption would eventually disagree about which side of a step
        today is on.

        AND THE NEXT DATE BESIDE IT, which is the other half of the firm's sentence. A dot says
        a step has not gone; this says when it will.
      */}
      {run.state === 'running' && (
        <p className="mt-1.5 text-[11px] text-slate-500 tabular-nums">
          <span className="font-medium text-[var(--c-gold-deep)]">
            Today &middot; {dayLabel(dayNumberOn(run.startedOn, today, run.dayUnit), run.dayUnit).toLowerCase()}
          </span>
          {next
            ? <> &middot; next: {next.label}, {shortDate(next.dueOn)}</>
            : <> &middot; nothing left to send</>}
        </p>
      )}

      {inFocus && (
        <StepDetail step={inFocus} run={run} live={run.state === 'running'} onSent={onSent} />
      )}

      {/*
        EVERY STEP, WHEN SOMEBODY ASKS FOR IT. Shut by default and not removed: "what have we
        actually sent this person, and when" is a question an attorney asks eighteen months later,
        and the answer is a list with dates on it.
      */}
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-700">
        <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        {open ? 'Hide the steps' : `Every step (${run.steps.length})`}
      </button>
      {open && (
        <ul className="mt-1 divide-y divide-slate-100">
          {run.steps.map((s) => (
            <StepRow key={s.id} step={s} run={run}
              selected={s.id === focusId} onSelect={() => setPicked(s.id)} />
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * THE ONE STEP IN FOCUS, AND — WHERE IT IS STOPPED — THE BUTTON THAT SENDS IT.
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
 *
 * IT DRAWS FOR EVERY STEP NOW, NOT ONLY A HELD ONE, because the track put the sentences behind a
 * dot: a step nobody is waiting on still has to be able to say what it is, when it goes and
 * whether it has gone. Only the button is conditional.
 */
function StepDetail({ step, run, live, onSent }: {
  step: RunStep
  run: AccountRun
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
  const stopped = shapeOf(step) === 'stopped'

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
    <div className={`mt-2 rounded-lg border px-3 py-2 ${stopped
      ? 'border-[var(--c-gold-deep)]/30 bg-gold-50'
      : 'border-slate-200 bg-slate-50/60'}`}>
      <p className="text-[12px] font-medium text-navy-950">
        {step.label} &middot; {RUN_STEP_WORDS[step.state].label}
      </p>
      {/*
        THE DAY NUMBER WITH ITS UNIT, AND THE DATE IT LANDS ON. The same rule as the builder: a
        number read as calendar days on a business-day chart is a fortnight out, and this is the
        screen where somebody checks what actually happened against what was meant to.
      */}
      <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
        {dayLabel(step.day, run.dayUnit)}
        {' · '}
        {step.sentAt ? `sent ${shortDate(step.sentAt.slice(0, 10))}` : `due ${shortDate(step.dueOn)}`}
      </p>
      {step.note && <p className="text-[11px] text-slate-600 mt-1 leading-snug">{step.note}</p>}
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
      {stopped && live && (
        <button type="button" onClick={() => { void release() }} disabled={busy}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[#c9a052]
            bg-white px-2.5 py-1 text-[11px] font-medium text-navy-950
            hover:bg-gold-100 disabled:opacity-40">
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
          {step.needsRelease ? 'Send it now' : 'Try again'}
        </button>
      )}
    </div>
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

/**
 * ONE ROW OF THE DROP-DOWN — the whole sequence, in order, with its dates.
 *
 * IT SELECTS THE STEP RATHER THAN EXPANDING ITSELF. The detail lives in one place above, so a
 * row here is a way of reaching a dot whose label is too small to be sure of — not a second
 * place the same sentences are drawn, which is how the panel came to print a held reason twice.
 */
function StepRow({ step, run, selected, onSelect }: {
  step: RunStep
  run: AccountRun
  selected: boolean
  onSelect: () => void
}) {
  const word = RUN_STEP_WORDS[step.state]
  const Icon = ICONS[word.tone]
  return (
    <li>
      <button type="button" onClick={onSelect}
        className="flex w-full items-start gap-2 py-1.5 text-left">
        <Icon size={12} className={`mt-[3px] shrink-0 ${TONES[word.tone]}`} />
        <span className="min-w-0 flex-1">
          <span className={`block text-[12px] leading-snug ${
            step.state === 'cancelled' ? 'text-slate-400 line-through'
              : selected ? 'font-medium text-navy-950' : 'text-slate-700'
          }`}>
            {step.label}
          </span>
          {/*
            THE DAY NUMBER WITH ITS UNIT, AND THE DATE IT LANDS ON, ON THEIR OWN LINE. The same
            rule as the builder: a number read as calendar days on a business-day chart is a
            fortnight out, and this is the screen where somebody checks what actually happened
            against what was meant to.

            UNDER THE NAME RATHER THAN BESIDE IT, because of where this list lives. Three columns
            in the account's rail left about thirty pixels for the name, and "Section 129 / letter
            of demand" came out as five lines of one word each with the dates alongside it. Two
            short lines read; one cramped row does not.
          */}
          <span className="block text-[10px] leading-tight text-slate-400 tabular-nums">
            {dayLabel(step.day, run.dayUnit)} &middot; {shortDate(step.sentAt ? step.sentAt.slice(0, 10) : step.dueOn)}
          </span>
        </span>
      </button>
    </li>
  )
}
