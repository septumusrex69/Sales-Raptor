import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FileSpreadsheet, GitBranch, Pause, Play, Plus, Trash2 } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { campaignBodyEmpty } from '../../lib/campaignHtml'
import { XLSX_MIME, buildXlsx, downloadBytes, type Cell } from '../../lib/xlsxWrite'
import { Card, CardHeader } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { WORKFLOW_AUDIENCE_LABELS, followUpDueOn, resultRates, workflowSheet, type CampaignResults, type SheetRow, type WorkflowAudience } from '../../lib/marketing.ts'
import {
  sendsOf, addWorkflowStep, createWorkflow, listCampaigns, listWorkflows, removeWorkflowStep, updateWorkflow, updateWorkflowStep,
  type CampaignRow, type WorkflowRow, type WorkflowStepRow,
} from '../../lib/marketingApi'
import { Field, INPUT, StatusPill, errorText } from './shared'

/**
 * FOLLOW-UPS (S13, on the tables built for Ryno 28 Oct). Ryno: "emails are out, wait until day 20 ... and
 * then you're going to send out this email ... to those addresses." A workflow is a News campaign and the
 * follow-ups after it. Each follow-up is its own campaign, written in the ordinary editor, and says how many
 * days after the email before it to go and to whom -- everybody it reached, those who did not open it, and
 * so on, read off that email's own results on the morning it goes (07:13, the daily timer).
 *
 * FOR CLIENTS, AND NEWS ONLY. A follow-up to a lead who never said yes would be a second unasked email,
 * which POPIA s69 does not allow, so introductions and prospect campaigns cannot start a workflow, and the
 * drain refuses an unconsented lead on every follow-up anyway (sendBlockReason).
 */

const WF_STATUS: Record<WorkflowRow['status'], { label: string; tone: string }> = {
  draft: { label: 'Not started', tone: 'bg-slate-100 text-slate-600' },
  active: { label: 'Running', tone: 'bg-emerald-50 text-emerald-700' },
  paused: { label: 'Paused', tone: 'bg-gold-100 text-gold-800' },
  finished: { label: 'Finished', tone: 'bg-slate-100 text-slate-400' },
}

const dayWords = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })

export function WorkflowsPanel() {
  const [workflows, setWorkflows] = useState<WorkflowRow[] | null>(null)
  const [steps, setSteps] = useState<WorkflowStepRow[]>([])
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [counts, setCounts] = useState<Map<string, CampaignResults>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [first, setFirst] = useState('')

  const load = useCallback(async () => {
    const [w, c] = await Promise.all([listWorkflows(), listCampaigns()])
    setWorkflows(w.workflows); setSteps(w.steps); setCampaigns(c.campaigns); setCounts(c.counts)
  }, [])
  useEffect(() => { load().catch((e: unknown) => setError(errorText(e))) }, [load])

  const byId = useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns])
  const usedAsStep = useMemo(() => new Set(steps.map((s) => s.campaign_id)), [steps])
  /* A workflow starts with a News campaign that is not itself somebody's follow-up. */
  const starters = campaigns.filter((c) => c.kind === 'news' && c.status !== 'cancelled' && !usedAsStep.has(c.id))

  async function act(fn: () => Promise<void>) {
    setError(null)
    try { await fn(); await load() } catch (e) { setError(errorText(e)) }
  }

  return (
    <div className="space-y-4" data-testid="news-workflows">
      <Card className="bg-brand-50/50 border-brand-100">
        <p className="text-sm text-slate-700">
          A workflow sends follow-ups on its own. Start with a News campaign, then add follow-ups: each waits a number of days after the email before it has gone,
          and goes to the people that email reached — all of them, or only those who did not open it, and so on. Raptor checks every morning at 07:13 and sends
          what is due. Anybody who unsubscribes or whose email did not arrive is never followed up.
        </p>
      </Card>
      {error && <p className="text-sm text-red-600" data-testid="news-workflow-error">{error}</p>}

      {creating ? (
        <Card>
          <CardHeader title="New workflow" />
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Name">
              <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. November newsletter and reminder" data-testid="news-workflow-name" />
            </Field>
            <Field label="Starts with" hint="A News campaign. It can be sent already, or still a draft you send by hand; the first follow-up counts its days from when it has gone.">
              <select className={INPUT} value={first} onChange={(e) => setFirst(e.target.value)} data-testid="news-workflow-first">
                <option value="">Choose a campaign…</option>
                {starters.map((c) => <option key={c.id} value={c.id}>{c.name}{c.status === 'draft' ? ' (draft)' : ''}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" disabled={!name.trim() || !first} data-testid="news-workflow-create"
              onClick={() => void act(async () => { await createWorkflow(name, first); setCreating(false); setName(''); setFirst('') })}>Create</Button>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </Card>
      ) : (
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)} data-testid="news-workflow-new">New workflow</Button>
      )}

      {workflows === null ? <p className="text-sm text-slate-400">Loading…</p>
        : workflows.length === 0 ? (
          <Card><div className="p-4 text-center text-sm text-slate-500" data-testid="news-workflows-empty">
            <GitBranch className="mx-auto mb-2 text-slate-300" size={28} />No workflows yet.
          </div></Card>
        ) : workflows.map((w) => (
          <WorkflowCard key={w.id} workflow={w} steps={steps.filter((s) => s.workflow_id === w.id).sort((a, b) => a.position - b.position)}
            campaigns={byId} counts={counts} act={act} />
        ))}
    </div>
  )
}

function WorkflowCard({ workflow: w, steps, campaigns, counts, act }: {
  workflow: WorkflowRow; steps: WorkflowStepRow[]; campaigns: Map<string, CampaignRow>; counts: Map<string, CampaignResults>
  act: (fn: () => Promise<void>) => Promise<void>
}) {
  const firstCampaign = campaigns.get(w.first_campaign_id) ?? null
  const [sheetOpen, setSheetOpen] = useState(false)
  const unwritten = steps.filter((s) => { const c = campaigns.get(s.campaign_id); return !c || !c.subject.trim() || campaignBodyEmpty(c.body) })
  const canStart = steps.length > 0 && unwritten.length === 0
  const status = WF_STATUS[w.status]
  /* Each email's due day reads off the one before it -- the database's own rule (marketing_workflow_steps_due). */
  const chain = [firstCampaign, ...steps.map((s) => campaigns.get(s.campaign_id) ?? null)]
  return (
    <Card>
      <div data-testid="news-workflow">
      <div className="flex flex-wrap items-start gap-3 mb-4">
        <div className="flex-1 min-w-[12rem]">
          <h3 className="font-semibold text-[15px] text-slate-800">{w.name}</h3>
          <span className={`inline-block mt-1 rounded-full px-2 py-0.5 text-xs font-medium ${status.tone}`} data-testid="news-workflow-status">{status.label}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<FileSpreadsheet size={13} />} onClick={() => setSheetOpen(true)} data-testid="news-workflow-sheet">The sheet</Button>
          {(w.status === 'draft' || w.status === 'paused') && (
            <Button size="sm" variant="primary" icon={<Play size={13} />} disabled={!canStart} data-testid="news-workflow-start"
              title={canStart ? undefined : steps.length ? 'Every follow-up needs a subject and a body first' : 'Add a follow-up first'}
              onClick={() => void act(() => updateWorkflow(w.id, { status: 'active' }))}>{w.status === 'paused' ? 'Carry on' : 'Start'}</Button>
          )}
          {w.status === 'active' && (
            <Button size="sm" icon={<Pause size={13} />} data-testid="news-workflow-pause" onClick={() => void act(() => updateWorkflow(w.id, { status: 'paused' }))}>Pause</Button>
          )}
        </div>
      </div>

      <ol className="relative border-l-2 border-slate-100 ml-2 space-y-4">
        <Stage index={0} title="First email" campaign={firstCampaign} counts={counts}
          when={firstCampaign?.finished_at ? `Went ${new Date(firstCampaign.finished_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}`
            : firstCampaign?.status === 'sending' ? 'Going out now' : 'Sent by hand, from the campaign'} />
        {steps.map((s, i) => {
          const prev = chain[i]
          const c = campaigns.get(s.campaign_id) ?? null
          const due = followUpDueOn(prev?.finished_at, s.wait_days)
          const editable = !s.run_at && w.status !== 'finished'
          const when = s.run_at ? `Sent ${new Date(s.run_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}`
            : due ? `${w.status === 'active' ? 'Goes' : 'Would go'} ${dayWords(due)}` : 'Counts its days from when the email before it has gone'
          return (
            <Stage key={s.id} index={i + 1} title={`Follow-up ${s.position}`} campaign={c} counts={counts} when={when}>
              {editable ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700 mt-2">
                  Wait
                  <input type="number" min={1} max={90} value={s.wait_days} data-testid="news-step-wait"
                    onChange={(e) => void act(() => updateWorkflowStep(s.id, { wait_days: Math.max(1, Math.min(90, Math.round(Number(e.target.value) || 1))) }))}
                    className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-sm" />
                  days, then send to
                  <select value={s.audience} data-testid="news-step-audience" className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
                    onChange={(e) => void act(() => updateWorkflowStep(s.id, { audience: e.target.value as WorkflowAudience }))}>
                    {(Object.keys(WORKFLOW_AUDIENCE_LABELS) as WorkflowAudience[]).map((k) => <option key={k} value={k}>{WORKFLOW_AUDIENCE_LABELS[k].toLowerCase()}</option>)}
                  </select>
                  <button type="button" aria-label="Remove this follow-up" title="Remove this follow-up" className="ml-auto p-1 text-slate-400 hover:text-red-600"
                    onClick={() => void act(() => removeWorkflowStep(s.id))}><Trash2 size={14} /></button>
                </div>
              ) : (
                <p className="text-xs text-slate-500 mt-1">{s.wait_days} days after the email before, to {WORKFLOW_AUDIENCE_LABELS[s.audience].toLowerCase()}.</p>
              )}
              {(s.audience === 'clicked' || s.audience === 'not_clicked') && prev && prev.send_from !== 'news' && (
                <p className="text-xs text-gold-800 mt-1">Clicks are not counted on mail from bredellferreira.co.za, so “clicked” cannot be told apart there. Choose by opening instead.</p>
              )}
            </Stage>
          )
        })}
      </ol>

      {w.status !== 'finished' && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" icon={<Plus size={13} />} data-testid="news-workflow-add-step"
            onClick={() => void act(async () => { await addWorkflowStep(w, (steps.at(-1)?.position ?? 0) + 1, firstCampaign?.send_from ?? 'news') })}>
            Add a follow-up
          </Button>
          {unwritten.length > 0 && <span className="text-xs text-slate-500">{unwritten.length === 1 ? 'One follow-up has' : `${unwritten.length} follow-ups have`} no subject or body yet: write {unwritten.length === 1 ? 'it' : 'them'} before starting.</span>}
        </div>
      )}
      </div>
      {sheetOpen && <SheetModal name={w.name} campaignIds={[w.first_campaign_id, ...steps.map((s) => s.campaign_id)]} onClose={() => setSheetOpen(false)} />}
    </Card>
  )
}

const MARK_TONE: Record<string, string> = {
  Clicked: 'text-emerald-700', Opened: 'text-emerald-700', Delivered: 'text-slate-700', Sent: 'text-slate-500',
  'Didn’t arrive': 'text-red-700', 'Marked as spam': 'text-red-700', Unsubscribed: 'text-gold-800', 'Not sent': 'text-slate-400', Waiting: 'text-slate-400',
}

/**
 * RYNO'S SHEET (29 Oct): email in column one, then "Sent 1", "Sent 2", ... -- filled in as each email of the
 * workflow goes, from the sends Raptor keeps (workflowSheet), and downloadable as Excel. Nobody types it, so it
 * cannot drift from what happened.
 */
function SheetModal({ name, campaignIds, onClose }: { name: string; campaignIds: string[]; onClose: () => void }) {
  const [rows, setRows] = useState<SheetRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /* Keyed on the ids' text, not the array: a new array each render would read every send again and again. */
  const key = campaignIds.join(',')
  useEffect(() => {
    const ids = key.split(',')
    sendsOf(ids).then((s) => setRows(workflowSheet(ids, s))).catch((e: unknown) => setError(errorText(e)))
  }, [key])
  const heads = campaignIds.map((_, i) => `Sent ${i + 1}`)
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '')
  const download = () => {
    if (!rows) return
    const sheet: Cell[][] = [
      [{ v: 'Email', style: 'head' }, { v: 'Name', style: 'head' }, { v: 'Company', style: 'head' }, ...heads.map((h) => ({ v: h, style: 'head' as const }))],
      ...rows.map((r) => [r.email, r.name, r.company, ...r.cells.map((c) => (c.mark ? `${c.mark}${c.at ? ` ${day(c.at)}` : ''}` : ''))]),
    ]
    downloadBytes(`${name.replace(/[^\w -]+/g, '').trim() || 'workflow'}.xlsx`, buildXlsx('Sent', sheet), XLSX_MIME)
  }
  return (
    <Modal title={`The sheet · ${name}`} subtitle="One row per address, a column per email. Filled in as each one goes." onClose={onClose} width={980}
      headerRight={<Button size="sm" icon={<FileSpreadsheet size={13} />} disabled={!rows?.length} onClick={download} data-testid="news-sheet-download">Download Excel</Button>}>
      {error ? <p className="text-sm text-red-600">{error}</p> : rows === null ? <p className="text-sm text-slate-400">Loading…</p> : (
        <div className="overflow-auto max-h-[65vh]" data-testid="news-sheet">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="px-2 py-1.5 font-medium">Email</th>
                {heads.map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.email} className="border-b border-slate-50">
                  <td className="px-2 py-1.5"><div className="text-slate-800">{r.email}</div><div className="text-xs text-slate-400">{[r.name, r.company].filter(Boolean).join(' · ')}</div></td>
                  {r.cells.map((c, i) => (
                    <td key={i} className={`px-2 py-1.5 text-xs ${MARK_TONE[c.mark] ?? ''}`}>{c.mark}{c.at && <span className="text-slate-400"> {day(c.at)}</span>}</td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={heads.length + 1} className="px-2 py-4 text-center text-slate-500">Nothing has gone yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

function Stage({ index, title, campaign, counts, when, children }: {
  index: number; title: string; campaign: CampaignRow | null; counts: Map<string, CampaignResults>; when: string; children?: ReactNode
}) {
  const n = campaign ? counts.get(campaign.id) : undefined
  const r = n ? resultRates(n) : null
  return (
    <li className="ml-5" data-testid="news-workflow-stage">
      <span className="absolute -left-[9px] mt-1 grid place-items-center h-4 w-4 rounded-full bg-white border-2 border-brand-400 text-[9px] font-semibold text-brand-600">{index + 1}</span>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{title}</span>
        <span className="text-xs text-slate-500">· {when}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-0.5">
        {campaign ? <Link to={`/news/${campaign.id}`} className="text-sm font-medium text-slate-800 hover:text-brand-700">{campaign.subject || campaign.name}</Link>
          : <span className="text-sm text-slate-400">Missing</span>}
        {campaign && <StatusPill status={campaign.status} />}
        {campaign && !campaign.subject.trim() && <Link to={`/news/${campaign.id}`} className="text-xs text-brand-700 underline">Write it</Link>}
        {n && n.accepted > 0 && (
          <span className="text-xs text-slate-500">{n.accepted} sent · {n.delivered} delivered · {r?.opened ?? '—'}% opened</span>
        )}
      </div>
      {children}
    </li>
  )
}
