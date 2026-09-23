import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Trash2, X } from 'lucide-react'
import { inputClass } from '../ui/Modal'
import {
  CHANNELS, DAY_UNITS, NODE_KINDS, dayLabel, orderedNodes, triggerMeta, type Channel,
  type DeadlineUnit, type NodeKind, type Workflow, type WorkflowNode, type WorkflowProblem,
} from '../../lib/workflowBuilder.ts'
import { TEMPLATE_KINDS, kindForChannel } from '../../lib/messageTemplates.ts'
import type { LibraryTemplate } from '../../lib/templateLibrary.ts'

/**
 * Editing one step.
 *
 * THE FIRM'S MOCKUP PUT THREE "WHENS" ON THIS PANEL and this one has two, on purpose, because
 * they are two different facts rather than two spellings of one. The WORKFLOW DAY says when the
 * step happens. NEXT STEP says what follows it. Those are independent — a workflow can perfectly
 * well run day 35 then day 40 — and they contradict each other in exactly one way, an edge
 * pointing at an earlier day, which is refused rather than reconciled.
 *
 * WHAT IS NOT HERE is the mockup's third one, "wait period after completion". That was the
 * DEBTOR'S period wearing a scheduling label: "final notice, seven days to settle" means the
 * notice goes out on day 35 and the debtor has until day 42, and merging the two leaves nobody
 * able to say whose seven days they are. It is its own field, named for what it is, and it says
 * which kind of day it counts in — because twenty calendar days and twenty business days are a
 * month apart and on a statutory notice that is one to be served again.
 */
export function StepDrawer({
  workflow, node, problems, readOnly, templates, onSave, onDelete, onClose, onNext,
}: {
  workflow: Workflow
  node: WorkflowNode
  problems: WorkflowProblem[]
  readOnly: boolean
  /**
   * The collections library, so a step can be told what to send.
   *
   * Null while it is still loading, which is not the same as an empty library: "nothing written
   * yet" and "not read yet" would otherwise look identical, and the second one resolves itself.
   */
  templates: LibraryTemplate[] | null
  onSave: (next: WorkflowNode) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
  onNext: (toNodeId: string | null) => Promise<void>
}) {
  const [draft, setDraft] = useState<WorkflowNode>(node)
  const [tab, setTab] = useState<'settings' | 'conditions' | 'actions'>('settings')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* Re-seeded when the selection moves, or the drawer shows the last step's values under the new
     step's heading — which looks like the save went to the wrong place. */
  useEffect(() => { setDraft(node); setError(null) }, [node])

  const set = <K extends keyof WorkflowNode>(k: K, v: WorkflowNode[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  const nextEdge = workflow.connections.find((c) => c.fromNodeId === node.id)
  const dirty = JSON.stringify(draft) !== JSON.stringify(node)
  const refusals = problems.filter((p) => p.level === 'refuse')

  async function save() {
    setSaving(true)
    setError(null)
    try { await onSave(draft) } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }

  return (
    <aside className="w-full xl:w-[360px] shrink-0 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Step details</p>
          <h3 className="font-semibold text-[15px] text-slate-800 mt-0.5">{node.label}</h3>
          <p className="text-xs text-slate-400">
            {dayLabel(node.day, workflow.version.dayUnit)} &middot; {NODE_KINDS[node.kind].label}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close step details"
          className="text-slate-400 hover:text-slate-600"><X size={15} /></button>
      </div>

      <div className="mt-3 flex gap-4 border-b border-slate-100 px-4">
        {(['settings', 'conditions', 'actions'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`pb-2 text-sm capitalize border-b-2 -mb-px ${
              tab === t ? 'border-gold-400 font-medium text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}>{t}</button>
        ))}
      </div>

      {tab !== 'settings' ? (
        /*
          EMPTY, AND SAYING SO. The brief asks for the tabs now and for placeholders where the
          thing does not exist — and explicitly for no invented data. A tab showing a plausible
          condition nobody can edit is worse than one saying there is nothing here yet.
        */
        <p className="px-4 py-8 text-sm text-slate-400">
          {tab === 'conditions'
            ? 'Conditions are not built yet. Every step in this workflow runs in order.'
            : 'Extra actions are not built yet. What this step does is set under Settings.'}
        </p>
      ) : (
        <div className="px-4 py-4 space-y-4">
          {readOnly && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              This version is published, so nothing here can be changed. Take a draft to edit it.
            </p>
          )}

          <Field label="Step name">
            <input className={inputClass} value={draft.label} disabled={readOnly}
              onChange={(e) => set('label', e.target.value)} />
          </Field>

          <Field label="Description">
            <textarea className={inputClass} rows={3} value={draft.description ?? ''} disabled={readOnly}
              onChange={(e) => set('description', e.target.value || null)} />
          </Field>

          <Field label="Step type">
            <select className={inputClass} value={draft.kind} disabled={readOnly}
              onChange={(e) => {
                const kind = e.target.value as NodeKind
                /* A channel belongs to a communication and to nothing else, so it is cleared and
                   defaulted with the kind rather than left behind to fail validation later. */
                set('kind', kind)
                setDraft((d) => ({ ...d, kind, channel: kind === 'communication' ? (d.channel ?? 'email') : null }))
              }}>
              {(Object.keys(NODE_KINDS) as NodeKind[]).map((k) => (
                <option key={k} value={k}>{NODE_KINDS[k].label} &mdash; {NODE_KINDS[k].hint}</option>
              ))}
            </select>
          </Field>

          {draft.kind === 'communication' && (
            <Field label="How it goes out">
              <select className={inputClass} value={draft.channel ?? 'email'} disabled={readOnly}
                onChange={(e) => set('channel', e.target.value as Channel)}>
                {(Object.keys(CHANNELS) as Channel[]).map((c) => (
                  <option key={c} value={c}>{CHANNELS[c]}</option>
                ))}
              </select>
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={draft.statutory} disabled={readOnly}
                  onChange={(e) => set('statutory', e.target.checked)} />
                {/* Not a label on a box: it changes what may be done with the notice later. */}
                Required by the Act or the mandate &mdash; never re-issued, proof of dispatch kept
              </label>
            </Field>
          )}

          {/*
            WHAT IT ACTUALLY SENDS, and the reason the workflows moved into the library at all.

            workflow_nodes.template_id has existed since this table was written and nothing could
            set it: a step could be created saying "send an email" with nothing to send, and the
            builder counted those under "Notices to write" without being able to fix one. Nobody
            would have found out until the day it ran.

            The list is narrowed to the wording the CHANNEL can carry -- an email step cannot post
            a letter -- because a picker offering forty rows of which four are usable is a picker
            people stop reading.
          */}
          {draft.kind === 'communication' && (
            <Field label="What it sends">
              {templates === null ? (
                <p className="text-xs text-slate-400">Reading the library&hellip;</p>
              ) : (
                <>
                  <select className={inputClass} value={draft.templateId ?? ''} disabled={readOnly}
                    onChange={(e) => set('templateId', e.target.value || null)}>
                    <option value="">Not written yet</option>
                    {forChannel(templates, draft.channel).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.active ? t.name : `${t.name} (retired)`}
                      </option>
                    ))}
                  </select>
                  {/*
                    A WARNING THAT ONLY FIRES WHEN SOMETHING IS WRONG. An unwritten notice is
                    ordinary early in a draft; an unwritten STATUTORY notice on a workflow about
                    to be published is the firm failing to make a demand the Act requires.
                  */}
                  {draft.templateId === null && (
                    <p className={`mt-1.5 text-[11px] ${
                      draft.statutory ? 'text-rose-700' : 'text-slate-400'}`}>
                      {draft.statutory
                        ? 'This notice is required by the Act and there is nothing written for it.'
                        : 'This step sends nothing until wording is chosen.'}
                    </p>
                  )}
                  {templates !== null && forChannel(templates, draft.channel).length === 0 && (
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      Nothing in the library is written as{' '}
                      {kindForChannel(draft.channel)
                        ? TEMPLATE_KINDS[kindForChannel(draft.channel)!].plural.toLowerCase()
                        : 'anything this channel can carry'}.{' '}
                      <Link to="/library" className="underline hover:text-slate-600">
                        Write one
                      </Link>.
                    </p>
                  )}
                </>
              )}
            </Field>
          )}

          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-[11px] uppercase tracking-wide text-slate-400">When</legend>
            {/*
              THE UNIT AND THE ZERO, BOTH READ OFF THE VERSION, because this box is where the
              number is typed and it was telling everybody the wrong thing twice.

              "days after the handover" was hard-coded. A workflow triggered by a broken
              arrangement counts from the day the arrangement broke, and `triggerMeta().dayZero`
              has said so since triggers were built -- the header prints it and this field, the
              one somebody is actually typing into, did not.

              AND THE FLOOR FOLLOWS THE UNIT. Business days are 1-based and inclusive, so day 0
              does not exist on a business chart -- `landsOn` clamps it to day 1, which means a
              step typed as 0 silently becomes a step on day 1 and the chart reads as though
              something happens before the workflow starts. Calendar days are 0-based and
              unchanged.
            */}
            <Field label={`Workflow day (${DAY_UNITS[workflow.version.dayUnit].label})`}>
              <div className="flex items-center gap-2">
                <input type="number" min={workflow.version.dayUnit === 'business' ? 1 : 0}
                  className={`${inputClass} w-24`} value={draft.day} disabled={readOnly}
                  onChange={(e) => set('day', Number(e.target.value))} />
                <span className="text-xs text-slate-500">
                  {DAY_UNITS[workflow.version.dayUnit].label} from{' '}
                  {triggerMeta(workflow.version.trigger).dayZero}
                </span>
              </div>
            </Field>
          </fieldset>

          {/*
            THE DEBTOR'S PERIOD, ON ITS OWN, because it is not a wait before the next step. It also
            behaves differently: it stays where it falls on a Saturday, since their clock does not
            stop when the office shuts.
          */}
          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-[11px] uppercase tracking-wide text-slate-400">
              Period given to the debtor
            </legend>
            <div className="flex items-center gap-2">
              <input type="number" min={1} placeholder="None" className={`${inputClass} w-20`}
                disabled={readOnly} value={draft.deadlineDays ?? ''}
                onChange={(e) => {
                  const days = e.target.value === '' ? null : Number(e.target.value)
                  /* The two move together or the workflow refuses to save: "20" on its own is not
                     a period, it is twenty of something nobody has said. */
                  setDraft((d) => ({ ...d, deadlineDays: days, deadlineUnit: days === null ? null : (d.deadlineUnit ?? 'calendar') }))
                }} />
              <select className={`${inputClass} w-40`} disabled={readOnly || draft.deadlineDays === null}
                value={draft.deadlineUnit ?? 'calendar'}
                onChange={(e) => set('deadlineUnit', e.target.value as DeadlineUnit)}>
                <option value="calendar">calendar days</option>
                <option value="business">business days</option>
              </select>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              Business days skip weekends and South African public holidays. On a statutory notice
              the two are about a month apart.
            </p>
          </fieldset>

          <Field label="Assigned to">
            <input className={inputClass} value={draft.assignTo ?? ''} disabled={readOnly}
              placeholder="Current clerk" onChange={(e) => set('assignTo', e.target.value || null)} />
          </Field>

          {/*
            NEXT STEP IS AN EDGE, NOT A SECOND WAY OF SAYING WHEN. It is saved on its own, because
            it is a different row in a different table — and changing it is the one edit that can
            contradict the days, so it is refused rather than reconciled.
          */}
          <Field label="Next step">
            <select className={inputClass} disabled={readOnly}
              value={nextEdge?.toNodeId ?? ''}
              onChange={(e) => { void onNext(e.target.value || null) }}>
              <option value="">Nothing &mdash; the line ends here</option>
              {orderedNodes(workflow).filter((n) => n.id !== node.id).map((n) => (
                <option key={n.id} value={n.id}>
                  {dayLabel(n.day, workflow.version.dayUnit)} &ndash; {n.label}
                </option>
              ))}
            </select>
          </Field>

          {refusals.length > 0 && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
              {refusals.map((p) => (
                <p key={p.message} className="flex items-start gap-2 text-xs text-rose-700">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />{p.message}
                </p>
              ))}
            </div>
          )}
          {error && <p className="text-xs text-rose-700">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={() => { void onDelete() }} disabled={readOnly}
              className="inline-flex items-center gap-1.5 text-xs text-rose-600 hover:text-rose-800 disabled:opacity-40">
              <Trash2 size={13} /> Delete step
            </button>
            <button type="button" onClick={onClose}
              className="ml-auto rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button type="button" onClick={() => { void save() }}
              disabled={readOnly || !dirty || saving || refusals.length > 0}
              className="rounded-lg bg-gold-400 px-3 py-1.5 text-xs font-medium text-navy-950 hover:bg-gold-500 disabled:opacity-40">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}

/**
 * The wording this channel can carry, retired ones included.
 *
 * RETIRED ONES STAY ON THE LIST for the same reason they stay in the library: a step already
 * pointing at one has to keep showing what it points at, and dropping it here would silently
 * reset the picker to "Not written yet" the next time somebody saved the step.
 */
function forChannel(templates: LibraryTemplate[], channel: Channel | null): LibraryTemplate[] {
  const kind = kindForChannel(channel)
  if (kind === null) return []
  return templates.filter((t) => t.kind === kind)
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">{label}</p>
      {children}
    </div>
  )
}
