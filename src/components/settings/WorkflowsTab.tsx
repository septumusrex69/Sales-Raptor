import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronRight, Loader2, Play, Plus, Upload } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { inputClass } from '../ui/Modal'
import { WorkflowCanvas } from '../workflows/WorkflowCanvas'
import { StepDrawer } from '../workflows/StepDrawer'
import {
  canSave, workflowFacts, workflowProblems, NODE_KINDS,
  type NodeKind, type Workflow, type WorkflowNode,
} from '../../lib/workflowBuilder.ts'
import {
  addNode, deleteNode, fetchWorkflow, fetchWorkflows, publish, saveNode, setNextNode, takeDraft,
  type WorkflowSummary,
} from '../../lib/workflowStore.ts'

/**
 * Settings &rarr; Workflows.
 *
 * ONE WORKFLOW FOR NOW, and that is the design rather than a shortcut. The branch-heavy version
 * that hung payment arrangements, disputes, sequestration and liquidation underneath the main line
 * made the main line look like the exception; each of those becomes a workflow of its own, entered
 * from this one through a connection that already has somewhere to point.
 */
export function WorkflowsTab() {
  const [list, setList] = useState<WorkflowSummary[] | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchWorkflows()
      .then((rows) => { if (!cancelled) setList(rows) })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
    return () => { cancelled = true }
  }, [])

  if (openKey) return <WorkflowBuilder workflowKey={openKey} onBack={() => setOpenKey(null)} />

  return (
    <Card>
      <CardHeader title="Workflows"
        subtitle="What happens to an account, and when. A published workflow is superseded rather than edited." />
      {error && <p className="text-sm text-rose-700">{error}</p>}
      {list === null ? (
        <div className="py-8 grid place-items-center text-slate-400"><Loader2 size={18} className="animate-spin" /></div>
      ) : list.length === 0 ? (
        <p className="text-sm text-slate-500">No workflows yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.map((w) => {
            const live = w.versions.find((v) => v.state === 'active') ?? w.versions[0]
            return (
              <li key={w.id}>
                <button type="button" onClick={() => setOpenKey(w.key)}
                  className="w-full flex items-center gap-3 py-3 text-left hover:bg-slate-50 -mx-2 px-2 rounded-lg">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{w.name}</p>
                    {w.description && <p className="text-xs text-slate-400 mt-0.5">{w.description}</p>}
                  </div>
                  <span className="ml-auto flex items-center gap-2 shrink-0">
                    {live && <StateBadge state={live.state} />}
                    {live && <span className="text-xs text-slate-400">Version {live.version}</span>}
                    <ChevronRight size={15} className="text-slate-300" />
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
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

function WorkflowBuilder({ workflowKey, onBack }: { workflowKey: string; onBack: () => void }) {
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [tab, setTab] = useState<(typeof TABS)[number]>('Builder')
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (versionId?: string) => {
    try { setWorkflow(await fetchWorkflow(workflowKey, versionId)) }
    catch (e) { setError((e as Error).message) }
  }, [workflowKey])

  useEffect(() => { void load() }, [load])

  const problems = useMemo(() => (workflow ? workflowProblems(workflow) : []), [workflow])
  const facts = useMemo(() => (workflow ? workflowFacts(workflow) : null), [workflow])
  const node = workflow?.nodes.find((n) => n.id === selected) ?? null
  const readOnly = workflow?.version.state !== 'draft'

  if (workflow === null) {
    return (
      <Card>
        {error ? <p className="text-sm text-rose-700">{error}</p>
          : <div className="py-8 grid place-items-center text-slate-400"><Loader2 size={18} className="animate-spin" /></div>}
      </Card>
    )
  }

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try { await fn(); await load(workflow!.version.id) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      {/* ---------- the header ---------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-slate-400">
            <button type="button" onClick={onBack} className="hover:text-slate-600">Workflows</button>
            {' '}&rsaquo; {workflow.name}
          </p>
          <h2 className="text-lg font-semibold text-slate-800 mt-1 flex items-center gap-2.5">
            {workflow.name}
            <StateBadge state={workflow.version.state} />
            <span className="text-xs font-normal text-slate-400">Version {workflow.version.version}</span>
          </h2>
          {workflow.description && <p className="text-sm text-slate-500">{workflow.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {/*
            TEST IS DISABLED AND SAYS WHY. The brief is explicit that nothing may fake working
            functionality, and a Test button that runs nothing is the most expensive kind of lie on
            a screen that sends statutory notices.
          */}
          <button type="button" disabled title="Dry runs are not built yet"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-400 cursor-not-allowed">
            <Play size={13} /> Test
          </button>
          {readOnly ? (
            <button type="button" disabled={busy}
              onClick={() => { void act(async () => { const id = await takeDraft(workflow.version.id); await load(id) }) }}
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
          {problems.some((p) => p.level === 'refuse') && (
            <Card className="border-rose-200 bg-rose-50/60">
              <p className="flex items-start gap-2 text-sm text-rose-800">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>This workflow contradicts itself and cannot be published until it is fixed.</span>
              </p>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <AddStep disabled={readOnly || busy} workflow={workflow}
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
              })} />
            {readOnly && (
              <p className="text-xs text-slate-400">
                Published versions are frozen. Press Edit to take a draft.
              </p>
            )}
          </div>

          <div className="flex flex-col xl:flex-row gap-4 items-start">
            <div className="flex-1 min-w-0">
              <WorkflowCanvas workflow={workflow} selected={selected}
                onSelect={setSelected} problems={problems} />
            </div>
            {node && (
              <StepDrawer workflow={workflow} node={node} readOnly={readOnly}
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
