import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowRight, ChevronRight, Loader2, Play, Plus, Upload } from 'lucide-react'
import { Card, CardHeader } from '../../components/ui/Card'
import { inputClass } from '../../components/ui/Modal'
import { PhaseStrip, WorkflowSchedule } from '../../components/workflows/WorkflowSchedule'
import { StepDrawer } from '../../components/workflows/StepDrawer'
import { useAuth } from '../../store/AuthContext'
import { canEditLibrary, canViewLibrary } from '../../lib/permissions'
import { LibraryHeader } from './LibraryHeader'
import {
  canSave, dayZeroLabel, triggerMeta, workflowFacts, workflowProblems, DAY_UNITS, NODE_KINDS,
  TRIGGERS, TRIGGER_ORDER, type DayUnit, type NodeKind, type TriggerKind, type Workflow,
  type WorkflowNode,
} from '../../lib/workflowBuilder.ts'
import {
  addNode, createWorkflow, deleteNode, fetchWorkflow, fetchWorkflows, publish, saveNode,
  setDayUnit, setNextNode, setTrigger, takeDraft, type WorkflowSummary,
} from '../../lib/workflowStore.ts'
import { fetchLibrary, type LibraryTemplate } from '../../lib/templateLibrary.ts'
import { clerksReached } from '../../lib/workflowSchedule.ts'
import { dayKey } from '../../lib/collectionPace.ts'

/**
 * Library &rarr; Workflows.
 *
 * MOVED HERE FROM SETTINGS, at the firm's instruction. A workflow is not a setting: a setting is
 * configured once and forgotten, and a workflow is content somebody writes, argues about and
 * publishes a version of. It belongs beside the wording it sends, and it now has a URL of its own
 * so a draft can be linked to rather than described.
 *
 * ONE WORKFLOW FOR NOW, and that is the design rather than a shortcut. The branch-heavy version
 * that hung payment arrangements, disputes, sequestration and liquidation underneath the main line
 * made the main line look like the exception; each of those becomes a workflow of its own, entered
 * from this one through a connection that already has somewhere to point.
 */
export function LibraryWorkflows() {
  const { currentUser } = useAuth()
  const mayEdit = canEditLibrary(currentUser?.role)
  const mayView = canViewLibrary(currentUser?.role)
  /* The open workflow is in the ADDRESS, not in state. That is the whole reason this is a page
     and no longer a settings tab: a workflow being argued about can be sent to somebody. */
  const { key: openKey } = useParams<{ key: string }>()
  const navigate = useNavigate()
  const [list, setList] = useState<WorkflowSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (!mayView || openKey) return
    let cancelled = false
    fetchWorkflows()
      .then((rows) => { if (!cancelled) setList(rows) })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
    return () => { cancelled = true }
  }, [mayView, openKey])

  if (!mayView) {
    return (
      <Card>
        <p className="text-sm text-slate-600">The library is not open to you.</p>
      </Card>
    )
  }

  if (openKey) {
    return (
      <div className="space-y-4">
        <LibraryHeader mayEdit={mayEdit} />
        <WorkflowBuilder workflowKey={openKey} mayEdit={mayEdit}
          onBack={() => navigate('/library/workflows')} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <LibraryHeader mayEdit={mayEdit} />
      <Card>
      <CardHeader title="Workflows"
        subtitle="What happens to an account, and when. A published workflow is superseded rather than edited."
        action={mayEdit && !starting ? (
          <button type="button" onClick={() => setStarting(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-navy-800">
            <Plus size={13} /> New workflow
          </button>
        ) : undefined} />
      {error && <p className="text-sm text-rose-700">{error}</p>}
      {starting && (
        <NewWorkflow
          onCancel={() => setStarting(false)}
          onCreated={(key) => navigate(`/library/workflows/${key}`)} />
      )}
      {list === null ? (
        <div className="py-8 grid place-items-center text-slate-400"><Loader2 size={18} className="animate-spin" /></div>
      ) : list.length === 0 ? (
        /* Says what to do, not just that there is nothing. An empty library with no next step is
           a screen somebody leaves. */
        <p className="text-sm text-slate-500">
          {mayEdit ? 'No workflows yet. Start one and say what sets it off.' : 'No workflows yet.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {list.map((w, i) => (
            <WorkflowRow key={w.id} index={i + 1} workflow={w}
              onOpen={() => navigate(`/library/workflows/${w.key}`)} />
          ))}
        </ul>
      )}
      {list !== null && list.length > 1 && <HowTheyConnect list={list} />}
      </Card>
    </div>
  )
}

/**
 * HOW THE WORKFLOWS FIT TOGETHER, which is the question the list itself cannot answer.
 *
 * Each row says what starts one workflow. Read down the list that is a series of unrelated
 * events; read as an account's own journey it is one line -- allocated, so the handover goes;
 * worked by a collector; then somebody decides to issue a section 129. The firm's chart draws it
 * that way and it is what makes "the handover does NOT start the notice" visible rather than
 * something you have to notice is missing.
 *
 * BUILT FROM THE TRIGGERS, not written. A sentence describing two particular workflows stops
 * being true the day a third arrives, and this screen is exactly where nobody would go back and
 * fix it. What is drawn is each workflow's own trigger and name, in the order they run.
 */
function HowTheyConnect({ list }: { list: WorkflowSummary[] }) {
  const chain = list.filter((w) => w.trigger !== null)
  if (chain.length < 2) return null
  return (
    <div className="mt-4 rounded-xl bg-[var(--tint-steel-alt)] px-4 py-3.5">
      <p className="text-[13px] font-semibold text-slate-800">How they connect</p>
      <p className="text-[12px] text-slate-500 mt-0.5">
        Each one waits for its own event. Nothing here starts anything else.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2">
        {chain.map((w, i) => (
          <span key={w.id} className="flex items-center gap-2">
            {i > 0 && <ArrowRight size={13} className="text-slate-400" />}
            <span className="rounded-lg bg-white px-2.5 py-1 text-[12px] text-slate-600 shadow-sm">
              {triggerMeta(w.trigger!).label}
            </span>
            <ArrowRight size={13} className="text-slate-400" />
            <span className="rounded-lg bg-white px-2.5 py-1 text-[12px] font-medium text-navy-950 shadow-sm">
              {w.name}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * ONE WORKFLOW ON THE LIST, SAYING WHAT IT IS FOR.
 *
 * A NAME AND A STATE BADGE SAY NOTHING. A workflow's whole meaning is the event that starts it
 * and what it then does -- so both are on the row, under their own headings, rather than behind a
 * click. The firm reads these as charts; a list that made them open each one to find out which
 * was which is a list that gets the wrong one opened.
 *
 * NUMBERED, because the firm numbers them -- "Workflow 01", "Workflow 02" -- and because the
 * order they are worked in is a real fact about them: an account meets the handover before it
 * ever meets a section 129.
 */
function WorkflowRow({ index, workflow, onOpen }: {
  index: number
  workflow: WorkflowSummary
  onOpen: () => void
}) {
  const live = workflow.versions.find((v) => v.state === 'active') ?? workflow.versions[0]
  return (
    <li>
      <button type="button" onClick={onOpen}
        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left
          transition hover:border-[#c9a052] hover:shadow-sm">
        <div className="flex items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-navy-950
            text-[12px] font-semibold text-gold-400 tabular-nums">
            {String(index).padStart(2, '0')}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-slate-800">{workflow.name}</p>
            {workflow.description && (
              <p className="text-[13px] text-slate-400 mt-0.5">{workflow.description}</p>
            )}
          </div>
          <span className="flex shrink-0 items-center gap-2">
            {live && <StateBadge state={live.state} />}
            <ChevronRight size={15} className="text-slate-300" />
          </span>
        </div>

        {/* The two facts, under their own headings, on one rule. Nothing here is typed: the
            trigger is the version's own column and the sequence is derived from its steps. */}
        <div className="mt-3 border-t border-slate-100 pt-3 grid gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Trigger</p>
            <p className="text-[13px] font-medium text-slate-700 mt-0.5">
              {workflow.trigger ? triggerMeta(workflow.trigger).label : '\u2014'}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Sequence</p>
            <p className="text-[13px] text-slate-600 mt-0.5">{workflow.sequence ?? '\u2014'}</p>
          </div>
        </div>
      </button>
    </li>
  )
}

/**
 * STARTING A WORKFLOW, AND THE TRIGGER IS ASKED FOR FIRST.
 *
 * Not as a field somebody fills in later: what sets a workflow off decides what its day numbers
 * MEAN. "Day 10" is ten days after a handover in one workflow and ten days after a broken promise
 * in another, and a builder that lets you lay out fourteen steps before asking is a builder that
 * lets you lay them out against the wrong day zero.
 *
 * THE DOMAIN IS NOT ASKED FOR. Every trigger on the list is an event on a debtor account, so the
 * answer is always collections; offering three choices where two are wrong is a question that
 * only produces mistakes. It moves out here the day a sales trigger exists.
 */
function NewWorkflow({ onCancel, onCreated }: {
  onCancel: () => void
  onCreated: (key: string) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  /* Named `pickTrigger` rather than `setTrigger` on purpose: the store exports a setTrigger that
     writes one to the database, and a component that shadows it silently stops being able to. */
  const [trigger, pickTrigger] = useState<TriggerKind>('handover')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      await createWorkflow({
        name: name.trim(),
        description: description.trim() || null,
        domain: 'collections',
        trigger,
      })
      /* Straight into the builder on the new draft. The next thing anybody wants is the first
         step, and a list with one more row on it is not that. */
      const rows = await fetchWorkflows()
      const made = rows.find((r) => r.name === name.trim())
      if (made) onCreated(made.key)
      else onCancel()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 mb-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">Name</span>
          <input className={inputClass} value={name} autoFocus
            onChange={(e) => setName(e.target.value)} placeholder="Broken arrangement" />
        </label>
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">
            What it is for
          </span>
          <input className={inputClass} value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What happens when an arrangement breaks" />
        </label>
      </div>
      <div>
        <span className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">
          What sets it off
        </span>
        <div className="flex flex-wrap gap-1.5">
          {TRIGGER_ORDER.map((t) => (
            <button key={t} type="button" onClick={() => pickTrigger(t)}
              className={`rounded-full border px-3 py-1.5 text-xs ${
                trigger === t
                  ? 'border-navy-900 bg-navy-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}>{TRIGGERS[t].label}</button>
          ))}
        </div>
        {/* The consequence of the choice, said as the choice is made rather than discovered on
            the day column later. */}
        <p className="text-xs text-slate-500 mt-2">{dayZeroLabel(trigger)}</p>
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy || !name.trim()} onClick={() => { void start() }}
          className="rounded-lg bg-gold-400 px-3 py-1.5 text-xs font-medium text-navy-950 hover:bg-gold-500 disabled:opacity-40">
          {busy ? 'Starting\u2026' : 'Start it'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}
          className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100">
          Cancel
        </button>
      </div>
    </div>
  )
}

function StateBadge({ state }: { state: string }) {
  const tone = state === 'active' ? 'bg-emerald-50 text-emerald-700'
    : state === 'draft' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${
        state === 'active' ? 'bg-emerald-500' : state === 'draft' ? 'bg-amber-400' : 'bg-slate-400'
      }`} />
      {state}
    </span>
  )
}

const TABS = ['Builder', 'Overview', 'Rules', 'Notifications', 'Templates', 'History'] as const

/**
 * How many clerks the firm's chart staffs the pre-legal workflow with.
 *
 * A CONSTANT RATHER THAN A FIELD, honestly: nothing in the database records how many clerks a
 * workflow is meant to pass through, and inventing a column for one workflow's footnote would be
 * worse than naming the number here where it can be found. It exists to make the rotation
 * warning below say something specific rather than "some clerks".
 */
const STAFFED_WITH = 4

function WorkflowBuilder({ workflowKey, mayEdit, onBack }: {
  workflowKey: string
  /**
   * Whether this person may change anything here.
   *
   * SEPARATE FROM `readOnly`, which is about the VERSION rather than the person: a published
   * version is frozen for everybody, including an administrator, and that is the point of
   * publishing. This one is the library's own rule -- everyone reads, an administrator writes.
   * Both have to be true before a control appears.
   */
  mayEdit: boolean
  onBack: () => void
}) {
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  /*
   * THE LIBRARY, FETCHED ONCE FOR THE WHOLE BUILDER rather than per step drawer. Opening ten
   * steps in a row is ordinary work and would otherwise be ten round trips for a list that does
   * not change while you are looking at it.
   *
   * Collections only: a workflow runs on a debtor account, and the sales library's fields do not
   * resolve against one. The database says the same thing -- a sales template has no position and
   * the merge fields are a different set.
   */
  const [templates, setTemplates] = useState<LibraryTemplate[] | null>(null)
  /**
   * The handover this workflow is being read against.
   *
   * CARRIED IN FROM THE READ-ONLY PAGE THIS REPLACES, because it is the thing that page was for.
   * A workflow written in day numbers is unreadable against a calendar — "day 110" tells nobody
   * whether the viability review lands in the December shutdown — and the picker is here rather
   * than fixed at today so the firm can try the dates that worry them.
   */
  const [from, setFrom] = useState<string>(() => dayKey(new Date()))
  const [tab, setTab] = useState<(typeof TABS)[number]>('Builder')
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (versionId?: string) => {
    try { setWorkflow(await fetchWorkflow(workflowKey, versionId)) }
    catch (e) { setError((e as Error).message) }
  }, [workflowKey])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let cancelled = false
    /* A library that will not load is not a reason to refuse the builder: every other field on a
       step still works, and the picker says it is still reading. */
    fetchLibrary('collections')
      .then((rows) => { if (!cancelled) setTemplates(rows) })
      .catch(() => { if (!cancelled) setTemplates([]) })
    return () => { cancelled = true }
  }, [])

  const problems = useMemo(() => (workflow ? workflowProblems(workflow) : []), [workflow])
  const facts = useMemo(() => (workflow ? workflowFacts(workflow) : null), [workflow])
  /*
   * WHO ACTUALLY GETS THE FILE, for the date on screen. Computed rather than stated once, because
   * it is a property of the handover date and not of the workflow: rotation is anchored to the
   * 5th, two months on, so on some dates all four clerks are reached and on others the file
   * closes on the second desk. STAFFED_WITH is the chart's number.
   */
  const rotation = useMemo(() => {
    if (!workflow || workflow.nodes.length === 0) return null
    return clerksReached({
      handoverOn: from,
      lastDay: Math.max(...workflow.nodes.map((n) => n.day)),
      staffedWith: STAFFED_WITH,
    })
  }, [workflow, from])
  const node = workflow?.nodes.find((n) => n.id === selected) ?? null
  /* Frozen because the version is published, OR because this person does not write the library.
     Folded into one flag so no control can be reached through only one of the two. */
  const readOnly = workflow?.version.state !== 'draft' || !mayEdit

  if (workflow === null) {
    return (
      <Card>
        {error ? <p className="text-sm text-rose-700">{error}</p>
          : <div className="py-8 grid place-items-center text-slate-400"><Loader2 size={18} className="animate-spin" /></div>}
      </Card>
    )
  }

  /**
   * Run something that changes the version, then show what it left behind.
   *
   * IT USED TO RELOAD THE VERSION IT STARTED ON, which is how "Edit — takes a draft" came to look
   * like a button that did nothing. The handler took the draft and loaded it; this then reloaded
   * `workflow.version.id` — the PUBLISHED version, captured in the closure when the button was
   * pressed — and the screen snapped straight back to the frozen one. The draft was created every
   * time. The firm pressed it repeatedly and reported a dead button; staging had the draft sitting
   * there, eleven nodes and all.
   *
   * SO A HANDLER THAT MOVES YOU SOMEWHERE SAYS SO, by returning the id it moved to, and nothing is
   * reloaded on top of it. Returning nothing means "same version, just reload it".
   */
  async function act(fn: () => Promise<string | void | unknown>) {
    setBusy(true)
    setError(null)
    try {
      const went = await fn()
      await load(typeof went === 'string' ? went : workflow!.version.id)
    }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      {/* ---------- the header ---------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2.5">
            {workflow.name}
            <StateBadge state={workflow.version.state} />
          </h2>
          {/* Version, state and what kind of trigger it is, on one line under the name -- the
              three facts you need to know which chart you are looking at before you read it. */}
          <p className="text-xs text-slate-400 mt-0.5">
            <button type="button" onClick={onBack} className="hover:text-slate-600">Workflows</button>
            {' '}&rsaquo; Version {workflow.version.version}
            {' '}&rsaquo; {workflow.version.trigger === 'by_hand' ? 'Manual trigger' : 'Event trigger'}
          </p>
          {workflow.description && <p className="text-sm text-slate-500">{workflow.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Labelled from the TRIGGER, not from a handover. This box dates the whole chart, and
              on an arrangement workflow "dated from a handover on" is the wrong question -- it is
              dated from the day the arrangement broke. */}
          <label className="text-xs text-slate-500 flex items-center gap-2 mr-1">
            Dated from {triggerMeta(workflow.version.trigger).dayZero}
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value || from)}
              className={`${inputClass} w-auto py-1`} />
          </label>
          {/*
            TEST IS DISABLED AND SAYS WHY. The brief is explicit that nothing may fake working
            functionality, and a Test button that runs nothing is the most expensive kind of lie on
            a screen that sends statutory notices.
          */}
          <button type="button" disabled title="Dry runs are not built yet"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-400 cursor-not-allowed">
            <Play size={13} /> Test
          </button>
          {!mayEdit ? null : workflow.version.state !== 'draft' ? (
            <button type="button" disabled={busy}
              /* Returns the draft's id, which is what act() then opens. Loading it here as well
                 would be the second load that used to be overwritten by the first. */
              onClick={() => { void act(() => takeDraft(workflow.version.id)) }}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
              Edit &mdash; takes a draft
            </button>
          ) : (
            <button type="button" disabled={busy || !canSave(problems)}
              onClick={() => { void act(() => publish(workflow.version.id)) }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gold-400 px-3 py-1.5 text-xs font-medium text-navy-950 hover:bg-gold-500 disabled:opacity-40">
              <Upload size={13} /> Publish
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-5 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`pb-2 text-sm border-b-2 -mb-px ${
              tab === t ? 'border-gold-400 font-medium text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}>{t}</button>
        ))}
      </div>

      {error && <p className="text-sm text-rose-700">{error}</p>}

      {tab !== 'Builder' ? (
        <Card><p className="text-sm text-slate-400">
          {tab === 'Overview' ? 'A plain-language summary of this workflow is not built yet.'
            : tab === 'Rules' ? 'Rules are not built yet. Every step in this workflow runs in order.'
              : tab === 'Notifications' ? 'Notifications are not built yet.'
                : tab === 'Templates' ? 'The wording each notice sends is set in the template library.'
                  : 'Nothing has been published yet, so there is no history.'}
        </p></Card>
      ) : (
        <>
          {/*
            THE FIRM'S OPEN QUESTION, carried in from the page this replaces rather than lost with
            it. The chart staffs this workflow with four clerks; on most handover dates the notice
            spine closes before the fourth is ever reached. Either the sequence runs longer than
            it does, or it is a three-clerk workflow — and nobody has answered that yet.

            IT ONLY FIRES WHEN IT IS TRUE. On a handover date where all four are reached there is
            no banner, which is the whole reason it is computed for the date on screen instead of
            written once as a note. A warning that appears when nothing is wrong is worse than no
            warning, because people stop reading it.
          */}
          {rotation && rotation.short > 0 && (
            <Card className="border-amber-200 bg-amber-50">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-900">
                  <p className="font-semibold">
                    Clerk {rotation.reached + 1} never receives this file.
                  </p>
                  <p className="text-amber-800 mt-1">
                    Handed over on {from}, the sequence closes on {rotation.closesOn} and the next
                    rotation is {rotation.rotations[rotation.reached - 1] ?? '—'}. The file closes
                    on clerk {rotation.reached}&rsquo;s desk. The chart staffs this workflow with{' '}
                    {STAFFED_WITH}. Either the sequence runs longer than it does, or this is a{' '}
                    {rotation.reached}-clerk workflow.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {problems.some((p) => p.level === 'refuse') && (
            <Card className="border-rose-200 bg-rose-50/60">
              <p className="flex items-start gap-2 text-sm text-rose-800">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>This workflow contradicts itself and cannot be published until it is fixed.</span>
              </p>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {/*
              GONE FOR A READER, merely DISABLED for an administrator on a published version —
              and the difference is the point. "Add step" greyed out on a frozen version is
              information: it has an answer, which is Edit beside it. The same control greyed out
              for somebody who will never be allowed to press it is a dead control plus two dead
              dropdowns, and it teaches people to stop reading disabled things.
            */}
          </div>

          <div className="flex flex-col xl:flex-row gap-4 items-start">
            {/*
              THE CHART AND WHAT BELONGS UNDER IT, IN ONE COLUMN.

              "Add step" and the read-only note used to be SIBLINGS of this column inside the same
              flex row, so on a wide screen they took their content's width out of the chart: at
              1280px the schedule drew 611px of a 1040px row and every step label wrapped one word
              to a line, with a field of empty white beside it. The firm saw it on an iPad and said
              so. Neither of them is a side panel -- one is a control for the chart and the other
              is a sentence about it -- and the thing that genuinely belongs beside it is the
              drawer, which is now the row's second child.
            */}
            <div className="flex-1 min-w-0">
              {/*
                READ DOWN, NOT ACROSS. The horizontal strip of cards this replaces drew eleven
                steps in a row you scrolled sideways through -- fine for a diagram, wrong for a
                chart somebody reads. The firm's own document is a table of days, and the
                intervals between them (seven, then five, then twenty) are the thing being
                checked; sideways they were invisible.
              */}
              <WorkflowSchedule workflow={workflow} selected={selected} from={from}
                onSelect={setSelected} problems={problems}
                /* The firm's own phases, above the rail rather than grouping it. They are real
                   -- Demand, then Listing, then Legal -- and they are what the list row's
                   sequence line is built from; carved into the rail they broke the one thing the
                   rail is for, which is reading the intervals down a single column. */
                phases={<PhaseStrip workflow={workflow} unit={workflow.version.dayUnit} />}
                controls={mayEdit && workflow.version.state === 'draft' ? (
                  /*
                    THE TWO THINGS THAT CHANGE WHAT THE CHART MEANS, on one row inside the banner
                    that states them. Their labels and their explanations are the sentence above
                    -- repeated beside the controls they were three statements of one fact.
                    Drafts only: a published version is frozen and the database refuses both, so
                    offering the controls would be offering a refusal.
                  */
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <select className={`${inputClass} w-auto py-1 text-xs`} value={workflow.version.trigger}
                      disabled={busy} aria-label="What starts this workflow"
                      onChange={(e) => {
                        const next = e.target.value as TriggerKind
                        void act(() => setTrigger(workflow.version.id, next, workflow.version.triggerNote))
                      }}>
                      {TRIGGER_ORDER.map((t) => (
                        <option key={t} value={t}>{TRIGGERS[t].label.toLowerCase()}</option>
                      ))}
                    </select>
                    <span className="text-white/40">counted in</span>
                    <select className={`${inputClass} w-auto py-1 text-xs`} value={workflow.version.dayUnit}
                      disabled={busy} aria-label="What kind of day this workflow counts in"
                      onChange={(e) => {
                        void act(() => setDayUnit(workflow.version.id, e.target.value as DayUnit))
                      }}>
                      {(['business', 'calendar'] as DayUnit[]).map((u) => (
                        <option key={u} value={u}>{DAY_UNITS[u].label}</option>
                      ))}
                    </select>
                  </div>
                ) : undefined} />
            {mayEdit && <AddStep disabled={readOnly || busy} workflow={workflow}
              onAdd={(kind, phaseId) => act(async () => {
                const id = await addNode({
                  versionId: workflow.version.id,
                  phaseId,
                  kind,
                  label: `New ${NODE_KINDS[kind].label.toLowerCase()}`,
                  /* Lands after everything, which is the only day that cannot contradict an
                     existing edge. The person then types the day they actually meant. */
                  day: Math.max(0, ...workflow.nodes.map((n) => n.day)) + 1,
                  ordinal: workflow.nodes.length + 1,
                })
                setSelected(id)
              })} />}
            {readOnly && (
              <p className="text-xs text-slate-400">
                {!mayEdit
                  ? 'An administrator writes the workflows. This is what it does today.'
                  : 'Published versions are frozen. Press Edit to take a draft.'}
              </p>
            )}
            </div>
            {/*
              THE DRAWER SITS BESIDE THE CHART, which is the only place it makes sense: it is the
              step you just clicked on the chart, and reading the two together is the whole point.
              It was in a row of its own underneath with an EMPTY flex-1 spacer pushing it right,
              so opening a step scrolled the chart away to show it.
            */}
            {node && (
              <StepDrawer workflow={workflow} node={node} readOnly={readOnly} templates={templates}
                problems={problems.filter((p) => p.nodeId === node.id)}
                onClose={() => setSelected(null)}
                onSave={async (next: WorkflowNode) => { await act(() => saveNode(next)) }}
                onDelete={async () => { await act(() => deleteNode(node.id)); setSelected(null) }}
                onNext={async (to) => { await act(() => setNextNode(workflow.version.id, node.id, to)) }} />
            )}
          </div>

          {/* ---------- what the workflow adds up to ---------- */}
          {facts && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <Fact label="Duration" value={`${facts.days} days`} />
              <Fact label="Assigned team" value={workflow.teamName ?? '—'} />
              <Fact label="Steps" value={String(facts.steps)} />
              <Fact label="Phases" value={String(facts.phases)} />
              {/* Counted rather than listed: the wording is the attorney's and arrives when it
                  arrives, but four statutory notices with nothing written is a fact worth a tile. */}
              <Fact label="Notices to write" value={`${facts.unwritten} · ${facts.statutory} statutory`} />
            </div>
          )}

          <Card>
            <CardHeader title="Related workflows"
              subtitle="Payment arrangement, default, dispute and sequestration become workflows of their own. An account will hand over to one and come back to the day it left." />
            <p className="text-sm text-slate-400">None linked yet.</p>
          </Card>
        </>
      )}
    </div>
  )
}

function AddStep({ workflow, disabled, onAdd }: {
  workflow: Workflow
  disabled: boolean
  onAdd: (kind: NodeKind, phaseId: string | null) => void
}) {
  const [kind, setKind] = useState<NodeKind>('communication')
  const [phaseId, setPhaseId] = useState<string>(workflow.phases[0]?.id ?? '')
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className={`${inputClass} w-auto`} value={kind} disabled={disabled}
        onChange={(e) => setKind(e.target.value as NodeKind)}>
        {(Object.keys(NODE_KINDS) as NodeKind[]).map((k) => (
          <option key={k} value={k}>{NODE_KINDS[k].label}</option>
        ))}
      </select>
      {/* Where it belongs is asked before it is made, not after: a step with no phase draws
          nowhere, and a card that has vanished is worse than one in the wrong row. */}
      <select className={`${inputClass} w-auto`} value={phaseId} disabled={disabled}
        onChange={(e) => setPhaseId(e.target.value)}>
        {workflow.phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button type="button" disabled={disabled || !phaseId} onClick={() => onAdd(kind, phaseId)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-navy-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-navy-900 disabled:opacity-40">
        <Plus size={13} /> Add step
      </button>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-medium text-slate-800 mt-0.5">{value}</p>
    </div>
  )
}
