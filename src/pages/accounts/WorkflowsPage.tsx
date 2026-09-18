import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, CheckSquare, CircleHelp, Flag, Mail, OctagonMinus, ShieldAlert, X,
} from 'lucide-react'
import { Card, CardHeader } from '../../components/ui/Card'
import { inputClass } from '../../components/ui/Modal'
import { PRE_LEGAL_160 } from '../../lib/preLegalWorkflow.ts'
import {
  noticesWanted, resolveSteps, type Action, type Branch, type ResolvedStep, type Step,
} from '../../lib/workflowDefinition.ts'
import { dayKey } from '../../lib/collectionPace.ts'
import { rotationSchedule, type WhenSpec } from '../../lib/workflowSchedule.ts'

/**
 * Reading a workflow back.
 *
 * READ-ONLY, AND THAT IS THE POINT OF IT FOR NOW. The firm's 160-day workflow exists on paper and
 * has just been transcribed into a definition; before anything runs it, somebody who knows the
 * work has to look at the dates and say whether they are right. An editor is the next thing and a
 * runner is the thing after that — building either before this one would mean correcting the
 * workflow through a form nobody had checked.
 *
 * DATED FROM A HANDOVER THE READER CHOOSES. A workflow written in day numbers is unreadable
 * against a calendar — "day 110" tells nobody whether the viability review lands in the December
 * shutdown. Putting a real date beside every step is what makes an error visible, and the date
 * picker is here so the firm can try the dates that worry them rather than the one that happens
 * to be today.
 */
export function WorkflowsPage() {
  const [from, setFrom] = useState<string>(() => dayKey(new Date()))
  const [selected, setSelected] = useState<string | null>(null)
  const def = PRE_LEGAL_160

  const spine = useMemo(() => resolveSteps(def.spine, from), [def, from])
  const rotations = useMemo(() => rotationSchedule(from, 3), [from])
  const notices = useMemo(() => noticesWanted(def), [def])
  const outstanding = notices.filter((n) => n.template === null)
  const closesOn = spine.length > 0 ? spine[spine.length - 1].on : null

  /*
   * THE FINDING THAT IS WORTH A BANNER RATHER THAN A FOOTNOTE. Rotation is a calendar rule now, so
   * whether the fourth clerk is ever reached depends on the month the file was handed over — it is
   * not a property of the workflow, it is a property of the date. Computed for the date on screen
   * rather than stated once, because on some handover dates all four clerks do get it.
   */
  const clerksReached = closesOn === null ? 0 : 1 + rotations.filter((r) => r < closesOn).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/accounts" className="text-xs text-slate-400 hover:text-slate-600 inline-flex items-center gap-1.5">
            <ArrowLeft size={13} /> Accounts
          </Link>
          <h2 className="text-lg font-semibold text-slate-800 mt-1">{def.name}</h2>
          <p className="text-sm text-slate-500">{def.summary}</p>
        </div>
        <label className="text-xs text-slate-500 flex items-center gap-2">
          Dated from a handover on
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value || from)}
            className={inputClass + ' w-auto'} />
        </label>
      </div>

      {/* ---------- what the dates on screen imply ---------- */}
      {clerksReached < 4 && (
        <Card className="border-amber-200 bg-amber-50">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900">
              <p className="font-semibold">Clerk {clerksReached + 1} never receives this file.</p>
              <p className="text-amber-800 mt-1">
                The sequence reaches its recommendation on {closesOn}, and the next rotation is{' '}
                {rotations[clerksReached - 1] ?? '—'}. The file closes on clerk {clerksReached}&rsquo;s desk.
                The chart staffs this workflow with four. Either the sequence runs longer than it
                does, or this is a {clerksReached}-clerk workflow.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* ---------- the spine, and the step being read ---------- */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4 items-start">
        <Card padded={false}>
          <div className="p-5 pb-0">
            <CardHeader title="The sequence"
              subtitle="Anchored to the file. Every date here is what it is whoever happens to be holding the account." />
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-y border-slate-100">
                <th className="text-left font-medium px-5 py-2">Day</th>
                <th className="text-left font-medium py-2">Date</th>
                <th className="text-left font-medium py-2 pr-5">Step</th>
                <th className="text-left font-medium py-2 pr-5">What happens</th>
                <th className="text-left font-medium px-5 py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {spine.map((r) => (
                <StepRow key={r.step.id} resolved={r}
                  selected={r.step.id === selected}
                  onSelect={() => setSelected(r.step.id === selected ? null : r.step.id)} />
              ))}
            </tbody>
          </table>
        </Card>

        {/*
          THE STEP PANEL, and it is deliberately not the one the firm mocked up.

          That one carried three ways of saying when — "workflow day N days after start", "wait
          period after completion N days", and a "next step" — on one form. Those can disagree,
          and when they do the workflow silently does something nobody chose. There is ONE when
          here, and the seven days a final notice gives the debtor is a different field, because a
          deadline and a delay behave differently: a deadline stays where it falls on a Saturday
          and a job for a person does not.
        */}
        <StepPanel resolved={spine.find((r) => r.step.id === selected) ?? null}
          all={def.spine} onClose={() => setSelected(null)} />
      </div>

      {/* ---------- rotation, on its own track ---------- */}
      <Card>
        <CardHeader title="Clerk rotation"
          subtitle="A separate track, on the 5th. A statutory date must not move because somebody was reallocated." />
        <ol className="text-sm text-slate-600 space-y-1.5">
          <li className="flex items-center gap-3">
            <span className="w-16 shrink-0 tabular-nums text-slate-400">{from}</span>
            Clerk 1 takes the handover
          </li>
          {rotations.map((on, i) => (
            <li key={on} className="flex items-center gap-3">
              <span className="w-16 shrink-0 tabular-nums text-slate-400">{on}</span>
              Clerk {i + 2} takes it
              {closesOn !== null && on >= closesOn && (
                <span className="text-[11px] uppercase tracking-wide text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                  after the file has closed
                </span>
              )}
            </li>
          ))}
        </ol>
      </Card>

      {/* ---------- the exits ---------- */}
      <Card>
        <CardHeader title="Ways off the sequence"
          subtitle="Each one rejoins at the day it left, closes the file, or opens a new one." />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {def.branches.map((b) => <BranchCard key={b.id} branch={b} from={from} />)}
        </div>
      </Card>

      {/* ---------- what is still to be written ---------- */}
      <Card>
        <CardHeader title="Still to be written"
          subtitle="Every notice this workflow sends, and whether anybody has written the wording." />
        {outstanding.length === 0 ? (
          <p className="text-sm text-slate-500">Every notice has wording behind it.</p>
        ) : (
          <ul className="text-sm space-y-1.5">
            {outstanding.map((n) => (
              <li key={`${n.where}-${n.step.id}`} className="flex items-center gap-2.5">
                {/* Statutory ones are marked because they are not the same job: a follow-up offer
                    is the firm's own words, a section 129 is the Act's and the attorney's. */}
                {n.statutory
                  ? <span className="text-[10px] uppercase tracking-wide font-semibold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded">Statutory</span>
                  : <span className="text-[10px] uppercase tracking-wide text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">Firm&rsquo;s own</span>}
                <span className="text-slate-700">{n.step.label}</span>
                <span className="text-slate-400 text-xs">{n.where}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------- the firm's own rules ---------- */}
      <Card>
        <CardHeader title="Rules that govern every branch" subtitle="The firm's own, from the foot of their chart." />
        <ul className="text-sm text-slate-600 space-y-1.5 list-disc pl-5">
          {def.rules.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </Card>
    </div>
  )
}

function StepRow({ resolved, selected, onSelect }: {
  resolved: ResolvedStep
  selected: boolean
  onSelect: () => void
}) {
  const { step, on, nominal, day } = resolved
  const moved = on !== nominal
  return (
    /* A row, not a button: the whole row is the target, and a nested button inside a table row
       is a smaller thing to hit for no benefit. Keyboard reach is the Enter key on the row. */
    <tr onClick={onSelect} tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      className={`border-b border-slate-50 last:border-0 align-top cursor-pointer outline-none
        focus-visible:ring-2 focus-visible:ring-brand-400 ${
        selected ? 'bg-brand-50/60' : 'hover:bg-slate-50'
      }`}>
      <td className="px-5 py-2.5 tabular-nums text-slate-400">{day}</td>
      <td className="py-2.5 tabular-nums text-slate-600 whitespace-nowrap">
        {on}
        {/* A step moved off a weekend says so, because a date that disagrees with its own day
            number looks like a bug to anybody reading the two side by side. */}
        {moved && <span className="block text-[11px] text-slate-400">moved off {nominal}</span>}
      </td>
      <td className="py-2.5 pr-5 text-slate-800 whitespace-nowrap">{step.label}</td>
      <td className="py-2.5 pr-5"><ActionCell action={step.action} /></td>
      <td className="px-5 py-2.5 text-xs text-slate-400 max-w-sm">{step.note}</td>
    </tr>
  )
}

/**
 * What one step is, read on its own.
 *
 * THE FIRM'S MOCKUP PUT THREE "WHENS" ON THIS PANEL and that is the fault worth spending a
 * component on. It offered "Workflow day — 35 days after start", "Wait period after completion —
 * 7 days" and "Next step — Day 40", all editable, all at once. Any two of those can disagree, and
 * the one that wins is whichever the runner happens to read first. Worse, the seven days on that
 * card was the DEBTOR'S period to settle, wearing a label about scheduling.
 *
 * So: one "when", said as an offset from a named step, with the kind of day it is counted in
 * shown rather than assumed. The debtor's period is its own line. What comes next is read off the
 * order, not set here, because a "next step" field and an "after" field are the same edge stored
 * twice and they drift.
 *
 * READ-ONLY FOR NOW. Editing needs somewhere to store a workflow, a version, and an answer to
 * what happens to accounts already running the old one — and that answer is worth more thought
 * than a form. This is the panel design, made real enough to argue with.
 */
function StepPanel({ resolved, all, onClose }: {
  resolved: ResolvedStep | null
  all: Step[]
  onClose: () => void
}) {
  if (resolved === null) {
    return (
      <Card className="hidden xl:block">
        <p className="text-sm text-slate-500">Pick a step to see what it does and when.</p>
        <p className="text-xs text-slate-400 mt-1.5">
          Nothing here can be edited yet. Changing a live workflow needs a version and an answer to
          what happens to the files already running the old one.
        </p>
      </Card>
    )
  }

  const { step, on, nominal, day, deadline } = resolved
  const after = step.after === 'start'
    ? 'the handover'
    : all.find((s) => s.id === step.after)?.label ?? step.after

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Day {day}</p>
          <h3 className="font-semibold text-[15px] text-slate-800 mt-0.5">{step.label}</h3>
        </div>
        <button type="button" onClick={onClose} aria-label="Close"
          className="text-slate-400 hover:text-slate-600"><X size={15} /></button>
      </div>

      <Field label="What happens"><ActionCell action={step.action} /></Field>

      {/*
        ONE WHEN, AND THE KIND OF DAY IT IS COUNTED IN. "20" means two different dates depending
        on whether they are calendar days or business days, and the difference on a statutory
        period is the difference between a valid notice and one to be re-served.
      */}
      <Field label="When">
        <span className="text-slate-700">
          {whenText(step.when)} after <span className="font-medium">{after}</span>
        </span>
        <span className="block text-slate-500 mt-0.5">
          {step.when.kind === 'business_days'
            ? 'Business days — weekends and public holidays do not count'
            : step.when.kind === 'calendar_days' ? 'Calendar days' : 'A fixed day of the month'}
        </span>
      </Field>

      <Field label="Falls on">
        <span className="tabular-nums text-slate-700">{on}</span>
        {on !== nominal && (
          /* Said, not hidden: a date that disagrees with its own day number reads as a bug. */
          <span className="block text-slate-500 mt-0.5">
            Moved off {nominal}, which is not a working day. Its day number does not move, so
            nothing after it shifts.
          </span>
        )}
      </Field>

      {/*
        THE DEBTOR'S PERIOD, ON ITS OWN LINE. This is the field the mockup merged with the wait,
        and they are not the same thing: one is what the debtor is given, the other is when Raptor
        does the next thing. A deadline also stays where it falls on a Saturday — the debtor's
        clock does not stop because the office is shut.
      */}
      {deadline !== null && step.deadline && (
        <Field label="The debtor is given">
          <span className="text-slate-700">{whenText(step.deadline)}</span>
          <span className="block text-slate-500 mt-0.5">
            Runs to <span className="tabular-nums">{deadline}</span>. A deadline stays where it
            falls, including on a weekend.
          </span>
        </Field>
      )}

      {step.action.kind === 'notice' && (
        <Field label="Wording">
          {step.action.template === null ? (
            <span className="text-amber-700">
              Not written yet.{' '}
              {step.action.statutory
                ? 'Statutory — the attorney settles this one.'
                : 'The firm\u2019s own words.'}
            </span>
          ) : (
            <span className="text-slate-700">{step.action.template}</span>
          )}
        </Field>
      )}

      {step.note && <Field label="Note"><span className="text-slate-600">{step.note}</span></Field>}

      <p className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-400">
        What comes next is read off the order of the sequence, not set here. A &ldquo;next
        step&rdquo; field and an &ldquo;after&rdquo; field are the same edge stored twice.
      </p>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <div className="text-sm mt-1">{children}</div>
    </div>
  )
}

/** "10 calendar days", "20 business days", "the 5th of the second month". */
function whenText(when: WhenSpec): string {
  if (when.kind === 'month_day') {
    return `the ${when.day}${ordinal(when.day)} of the month ${when.monthsAhead} months on`
  }
  const unit = when.kind === 'business_days' ? 'business day' : 'calendar day'
  if (when.days === 0) return 'The same day'
  return `${when.days} ${unit}${when.days === 1 ? '' : 's'}`
}

const ordinal = (n: number): string =>
  n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd'
    : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'

function ActionCell({ action }: { action: Action }) {
  switch (action.kind) {
    case 'notice':
      return (
        <span className="inline-flex items-center gap-2 text-slate-600">
          <Mail size={14} className="text-slate-400 shrink-0" />
          <span>{CHANNELS[action.channel]}</span>
          {action.statutory && (
            <span className="text-[10px] uppercase tracking-wide font-semibold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded">
              Statutory
            </span>
          )}
          {action.template === null && (
            <span className="text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
              Not written
            </span>
          )}
        </span>
      )
    case 'task':
      return <span className="inline-flex items-center gap-2 text-slate-600"><CheckSquare size={14} className="text-slate-400 shrink-0" />{action.title}</span>
    case 'flag':
      return <span className="inline-flex items-center gap-2 text-slate-600"><Flag size={14} className="text-slate-400 shrink-0" />{action.flag}</span>
    case 'decision':
      return <span className="inline-flex items-center gap-2 text-slate-600"><CircleHelp size={14} className="text-slate-400 shrink-0" />{action.question}</span>
    case 'stop_collection':
      return <span className="inline-flex items-center gap-2 text-slate-600"><OctagonMinus size={14} className="text-rose-400 shrink-0" />{action.reason}</span>
  }
}

const CHANNELS: Record<string, string> = {
  email: 'Email', sms: 'SMS', post: 'Post', registered_post: 'Registered post', hand: 'By hand',
}

function BranchCard({ branch, from }: { branch: Branch; from: string }) {
  const steps = resolveSteps(branch.steps, from)
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <p className="font-semibold text-sm text-slate-800 flex items-center gap-2">
        <ShieldAlert size={14} className="text-slate-400" />{branch.name}
      </p>
      <p className="text-xs text-slate-400 mt-0.5">{branch.entry}</p>
      <ol className="mt-3 space-y-1 text-xs text-slate-600">
        {steps.map((r) => (
          <li key={r.step.id} className="flex gap-2.5">
            {/* Counted from the day the file LEFT the sequence, which is what a branch day means. */}
            <span className="w-12 shrink-0 tabular-nums text-slate-400">day {r.day}</span>
            <span>{r.step.label}</span>
          </li>
        ))}
      </ol>
      <ul className="mt-3 space-y-1.5">
        {branch.outcomes.map((o) => (
          <li key={o.id} className="text-xs">
            <span className={`font-semibold tracking-wide ${EFFECT_TONE[o.effect.kind]}`}>{o.label}</span>
            <span className="text-slate-500"> &middot; {o.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/*
 * An outcome is coloured by what it does to the FILE, not by whether it is good news. A dispute
 * upheld in full closes the file and is a loss; a kept arrangement closes it and is a win. Both
 * are the same thing to whoever is looking for the accounts that have stopped moving.
 */
const EFFECT_TONE: Record<string, string> = {
  rejoin: 'text-sky-700',
  continue: 'text-emerald-700',
  goto_branch: 'text-amber-700',
  hold: 'text-slate-500',
  close: 'text-slate-700',
  write_off: 'text-rose-700',
  new_file: 'text-violet-700',
}
