import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Clock, History, Loader2, Minus, Pause, Play, Send, XCircle } from 'lucide-react'
import { Card } from '../ui/Card'
import { WorkflowTrack } from './WorkflowTrack'
import { useAuth } from '../../store/AuthContext'
import {
  releaseStep, startWorkflow, type AccountRun, type StartableWorkflow,
} from '../../lib/accountRun.ts'
import { RUN_STEP_WORDS, needsAttention, shapeOf, stepInFocus, type RunStep } from '../../lib/runSteps.ts'
import { dayLabel, dayNumberOn } from '../../lib/workflowBuilder.ts'
import { shortDate } from '../../lib/dateLabels.ts'
import {
  workflowHeadline, workflowStory, type StoryEvent, type StoryKind, type WorkflowHeadline,
} from '../../lib/workflowStory.ts'
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
  const head = workflowHeadline(runs)
  const story = workflowStory(runs)
  const byId = new Map(runs.map((r) => [r.id, r]))

  return (
    <Card>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-slate-800">Workflows</h3>
        {/* The firm's own words off their mockup, and they are the right ones: the pane is read
            to find out what is happening, not to audit a sequence. */}
        <p className="mt-0.5 text-[13px] text-slate-500">Follow what is active, paused, and next.</p>
      </div>
      {error && <p className="mb-3 text-xs text-negative-700">{error}</p>}

      {runs.length > 0 && <Headline head={head} />}

      {/*
        THE DATED RAIL. One row per thing that HAPPENED, which is not one row per run: a paused
        section 129 and the promise that paused it are one row each on the day it happened, and
        the same section 129 is a third row on the day it was let go. workflowStory makes that
        stream; this draws it.
      */}
      {story.length > 0 && (
        <ol className="mt-5 space-y-4">
          {story.map((e) => (
            <StoryRow key={e.id} event={e} run={byId.get(e.runId) ?? null} onSent={onChanged} />
          ))}
        </ol>
      )}

      {/*
        WHAT CAN BE STARTED, under the story rather than over it. Starting one is a thing somebody
        does today, and what is already happening to the debtor is the more important fact.
      */}
      {offers.length > 0 && (
        <section className="mt-5 border-t border-slate-100 pt-4">
          <Heading>{runs.length === 0 ? 'Nothing has started yet' : 'Start another'}</Heading>
          <div className="mt-3 space-y-2">
            {offers.map((w) => (
              <StartWorkflow key={w.versionId} accountId={accountId} offer={w} onStarted={onChanged} />
            ))}
          </div>
        </section>
      )}

      {/*
        AND THE EMPTY CASE SAID PLAINLY. In the account's rail this card drew nothing at all where
        there was no run -- an empty card on every account pushed the figures down in order to say
        nothing. A TAB somebody opened cannot do that: a blank pane reads as a screen that failed.
      */}
      {runs.length === 0 && offers.length === 0 && !error && (
        <p className="text-sm text-slate-500">
          No workflow has been started on this account, and there is none published for a person
          to start. Sequences are written in the Library.
        </p>
      )}

      {story.length > 1 && <PastHistory story={story} />}
    </Card>
  )
}

/**
 * THE THREE FACTS ACROSS THE TOP: what is running, what is paused, and what happens next.
 *
 * THE FIRM'S MOCKUP LEADS WITH THIS, and it is the right thing to lead with on the case they
 * drew: an account carrying a paused section 129 AND a live promise at the same time. Reading
 * down the rail you would find those two facts four inches apart.
 *
 * A CELL IS ABSENT RATHER THAN EMPTY. "Paused — none" on the thousands of accounts where nothing
 * is paused is a column of dashes that teaches people to stop reading the strip.
 */
function Headline({ head }: { head: WorkflowHeadline }) {
  const cells: { icon: typeof Play; tone: string; label: string; title: string; detail: string }[] = []
  for (const run of head.active) {
    cells.push({
      icon: Play, tone: 'text-positive-700 bg-positive-50',
      label: 'Active', title: run.workflowName, detail: `Started ${shortDate(run.startedOn)}`,
    })
  }
  for (const run of head.paused) {
    const hold = run.holds.find((h) => !h.endedOn)
    cells.push({
      icon: Pause, tone: 'text-[var(--c-gold-deep)] bg-gold-50',
      label: 'Paused', title: run.workflowName,
      detail: hold ? `Paused on ${shortDate(hold.startedOn)}` : 'Paused',
    })
  }
  /*
   * WHAT IS WAITING ON A PERSON BEATS WHAT IS MERELY NEXT. A step the runner will send on the
   * 5th is not work; a held section 129 is, and it is the reason somebody opened this tab.
   */
  if (head.waiting.length > 0) {
    cells.push({
      icon: AlertTriangle, tone: 'text-[var(--c-gold-deep)] bg-gold-50',
      label: 'Waiting on you',
      title: head.waiting.length === 1 ? head.waiting[0].step.label : `${head.waiting.length} steps`,
      detail: head.waiting.length === 1
        ? head.waiting[0].run.workflowName
        : 'Across this account’s sequences',
    })
  } else if (head.next) {
    cells.push({
      icon: Clock, tone: 'text-slate-500 bg-slate-100',
      label: 'Next', title: head.next.step.label,
      detail: `${shortDate(head.next.step.dueOn)} · ${head.next.run.workflowName}`,
    })
  }
  if (cells.length === 0) return null

  return (
    <div className="grid gap-3 rounded-xl border border-gold-200 bg-gold-50/40 p-4 @lg/details:grid-cols-3 sm:grid-cols-3">
      {cells.map((c) => (
        <div key={`${c.label}:${c.title}`} className="flex items-start gap-2.5 min-w-0">
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${c.tone}`}>
            <c.icon size={14} />
          </span>
          <span className="min-w-0">
            <span className="block text-[11px] uppercase tracking-wide text-slate-400">{c.label}</span>
            <span className="block truncate text-[13px] font-medium text-slate-800">{c.title}</span>
            <span className="block truncate text-[11px] text-slate-500">{c.detail}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

const STORY_MARK: Record<StoryKind, { icon: typeof Play; tone: string }> = {
  started: { icon: Play, tone: 'bg-positive-50 text-positive-700 border-positive-100' },
  paused: { icon: Pause, tone: 'bg-gold-50 text-[var(--c-gold-deep)] border-gold-200' },
  resumed: { icon: Play, tone: 'bg-gold-50 text-[var(--c-gold-deep)] border-gold-200' },
  left: { icon: XCircle, tone: 'bg-negative-50 text-negative-700 border-negative-100' },
  finished: { icon: Check, tone: 'bg-slate-100 text-slate-500 border-slate-200' },
}

/**
 * ONE THING THAT HAPPENED: the date on the left, a mark on the line, the card on the right.
 *
 * THE TRACK IS ONLY ON THE CARD THAT IS STILL THE RUN'S LATEST STATE. A section 129 that was
 * started, paused and resumed is three rows, and drawing all eleven dots three times would be
 * the wall of steps this pane was redesigned to stop being. The event that IS where the run
 * stands today carries the track; the others are a line each.
 */
function StoryRow({ event, run, onSent }: {
  event: StoryEvent
  run: AccountRun | null
  onSent: () => Promise<void>
}) {
  const mark = STORY_MARK[event.kind]
  const latest = run !== null && isCurrentState(run, event)
  return (
    <li className="flex gap-3">
      <div className="w-[72px] shrink-0 pt-1 text-right sm:w-[86px]">
        <p className="text-[11px] font-medium text-slate-600 tabular-nums">{shortDate(event.on)}</p>
        <p className="text-[10px] text-slate-400">{weekdayOf(event.on)}</p>
      </div>
      <div className={`mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full border ${mark.tone}`}>
        <mark.icon size={13} />
      </div>
      <div className={`min-w-0 flex-1 rounded-xl border px-4 py-3 ${
        latest ? 'border-gold-200 bg-gold-50/40' : 'border-slate-200 bg-white'}`}>
        {/*
          THE CARD THAT IS THE RUN'S STATE TODAY IS TITLED WITH THE RUN, and the chip says the
          state; every other card is titled with the EVENT. That is what the firm drew: the live
          card reads "Section 129 / letter of demand" + Paused, and the card above it reads
          "Section 129 resumed" with no chip at all.

          Titled by the event, the live card said it twice -- "Section 129 paused" beside a chip
          reading "Paused".
        */}
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[14px] font-semibold text-slate-800">
            {latest && run ? run.workflowName : event.title}
          </p>
          {latest && run && <StateChip state={run.state} />}
        </div>
        {event.detail && (
          <p className="mt-1 text-[12px] leading-snug text-slate-600">{event.detail}</p>
        )}
        {/*
        A RUN WITH NO STEPS DRAWS NOTHING BUT ITS CARD. The handover on an imported account is a
        row with no steps on it -- the sequence was written after the account arrived -- and the
        block under it read "Every step (0)" over an empty track, which is a control that opens
        nothing. Said by the card's own title and state instead.
      */}
      {latest && run && run.steps.length > 0 && <RunBlock run={run} onSent={onSent} />}
      </div>
    </li>
  )
}

/**
 * Is this event where the run stands today?
 *
 * ASKED OF THE EVENT AND THE RUN TOGETHER, because the same run appears several times on the
 * rail and exactly one of those appearances is the current one. A held run's latest event is the
 * hold that has not ended; a running one's is its most recent resume, or its start if it has
 * never been held.
 */
export function isCurrentState(run: AccountRun, event: StoryEvent): boolean {
  if (run.state === 'held') return event.kind === 'paused' && isLatestHoldEvent(run, event)
  if (run.state === 'left') return event.kind === 'left'
  if (run.state === 'finished') return event.kind === 'finished'
  /* running: the last resume, or the start where nothing ever held it. */
  const ended = run.holds.filter((h) => h.endedOn)
  if (ended.length === 0) return event.kind === 'started'
  return event.id === `release:${ended[ended.length - 1].id}`
}

function isLatestHoldEvent(run: AccountRun, event: StoryEvent): boolean {
  const open = run.holds.find((h) => !h.endedOn)
  return open ? event.id === `hold:${open.id}` : false
}

function StateChip({ state }: { state: string }) {
  const word = state === 'running' ? 'Active'
    : state === 'held' ? 'Paused'
      : state === 'left' ? 'Ended' : 'Finished'
  const tone = state === 'running' ? 'bg-positive-50 text-positive-700'
    : state === 'held' ? 'bg-gold-100 text-[var(--c-gold-deep)]'
      : state === 'left' ? 'bg-negative-50 text-negative-700' : 'bg-slate-100 text-slate-500'
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{word}</span>
}

/**
 * THE SAME EVENTS AGAIN, ONE LINE EACH, OLDEST FIRST.
 *
 * THE FIRM'S MOCKUP HAS BOTH and they are not a duplication: the rail above is where you read
 * what is happening now, and this is where you read the STORY -- promise captured, sequence
 * paused, payment missed, sequence resumed -- in the order it happened, which is the order an
 * attorney would want it in eighteen months from now.
 *
 * IT REVERSES THE SAME STREAM rather than building its own, so the two can never disagree about
 * what happened. Shut by default past a handful, because on a long-running account it is the
 * longest thing on the page.
 */
function PastHistory({ story }: { story: StoryEvent[] }) {
  const [open, setOpen] = useState(false)
  const oldest = [...story].reverse()
  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center gap-2 text-left">
        <History size={15} className="shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-slate-700">Past workflow history</span>
          <span className="block text-[11px] text-slate-400">
            {oldest.length} {oldest.length === 1 ? 'event' : 'events'}
          </span>
        </span>
        <ChevronDown size={14}
          className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="mt-3 space-y-2">
          {oldest.map((e) => {
            const mark = STORY_MARK[e.kind]
            return (
              <li key={`h:${e.id}`} className="flex items-start gap-2.5">
                <span className="w-[74px] shrink-0 text-[11px] text-slate-500 tabular-nums">
                  {shortDate(e.on)}
                </span>
                <mark.icon size={12} className="mt-0.5 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] text-slate-700">{e.title}</span>
                  {e.detail && <span className="block text-[11px] leading-snug text-slate-400">{e.detail}</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** The one heading style these sections share, so they weigh alike. */
function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{children}</h4>
  )
}

/** "Thu", off a yyyy-mm-dd, without dragging a date library in for three letters. */
function weekdayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] ?? ''
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
    <section className="mt-2">
      {/*
        NO NAME AND NO STATE HERE ANY MORE. The card this sits inside carries both -- "Section 129
        resumed", "Paused" -- and printing them again two lines down was the shape the firm sent
        back: "this email is taking a lot of space". One fact, one place.

        WHAT IT DOES STILL SAY is the day it started, because every day number under the dots
        counts from it and a track with no anchor is a row of numbers.
      */}
      <p className="text-[11px] text-slate-400">
        Started {shortDate(run.startedOn)}
        {run.state === 'held' && run.holds.some((h) => !h.endedOn) && (
          <> &middot; paused since {shortDate(run.holds.find((h) => !h.endedOn)!.startedOn)}</>
        )}
      </p>

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
      {/*
        NOT ON A PAUSED RUN. A held sequence's dates are the dates it had when it stopped, and
        every one of them moves when it is let go -- so "next: Reminder, 5 Oct" would be quoting a
        date already known to be wrong, and a "today" caret would be counting a clock that is not
        running. What happens next on a paused run is the pause ending.
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
