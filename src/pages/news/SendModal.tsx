import { useEffect, useState } from 'react'
import { Plus, Send, Trash2 } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { WORKFLOW_AUDIENCE_LABELS, describeSplit, type WorkflowAudience } from '../../lib/marketing.ts'
import {
  addWorkflowStep, createWorkflow, fillCampaignFromTemplate, listTemplates, updateWorkflow, updateWorkflowStep,
  type AudiencePreview, type CampaignDraft, type CampaignRow, type TemplateRow,
} from '../../lib/marketingApi'

/**
 * THE POP-UP BEFORE ANYTHING GOES (Ryno, 29 Oct): "an additional pop-up ... how many emails at a time, the
 * frequency, which emails you send when ... that's basically the workflow."
 *
 *  - HOW IT GOES OUT: all at once, or in batches -- N every so often. Batches are also how a new sending address
 *    earns a reputation: a domain that sends 2 800 emails in its first minute is what a spammer looks like.
 *  - WHAT FOLLOWS: follow-ups, each N days after the email before, to everybody it reached or only those who did
 *    not open it, and so on. They become a workflow (the Workflows tab), sent by the 07:13 morning run.
 *
 * The one Send here is the press that cannot be called back, so it says once more who and from whom.
 */
export interface SendPlan {
  batchSize: number | null
  everyMinutes: number | null
  /** Run once the list is queued: sets up the follow-ups. */
  afterSend?: () => Promise<void>
}

const EVERY = [[15, '15 minutes'], [30, '30 minutes'], [60, 'hour'], [120, '2 hours'], [240, '4 hours'], [1440, 'day']] as const
interface FollowUp { wait: number; audience: WorkflowAudience; templateId: string }

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`
  if (minutes < 1440) { const h = Math.round(minutes / 60); return `${h} ${h === 1 ? 'hour' : 'hours'}` }
  const d = Math.round(minutes / 1440); return `${d} ${d === 1 ? 'day' : 'days'}`
}

export function SendModal({ campaign, draft, preview, shownFrom, schemaReady, busy, error, onClose, onSend }: {
  campaign: CampaignRow; draft: CampaignDraft; preview: AudiencePreview; shownFrom: string | null; schemaReady: boolean
  busy: boolean; error: string | null; onClose: () => void; onSend: (plan: SendPlan) => void
}) {
  const [mode, setMode] = useState<'all' | 'batches'>(draft.batch_size ? 'batches' : 'all')
  const [size, setSize] = useState(draft.batch_size ?? 200)
  const [every, setEvery] = useState(draft.batch_every_minutes ?? 60)
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  useEffect(() => { if (schemaReady) listTemplates().then(setTemplates).catch(() => setTemplates([])) }, [schemaReady])

  const count = preview.count
  const batches = mode === 'batches' && size > 0 ? Math.ceil(count / size) : 1
  const takes = mode === 'batches' && batches > 1 ? (batches - 1) * every : 0
  const news = draft.kind === 'news'
  const from = preview.senders && preview.senders.length > 1 ? describeSplit(preview.senders) : shownFrom ?? '—'
  const setUp = (i: number, patch: Partial<FollowUp>) => setFollowUps((f) => f.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const validBatch = mode === 'all' || (size >= 10 && size <= 5000)

  function plan(): SendPlan {
    const ups = followUps
    return {
      batchSize: mode === 'batches' ? size : null,
      everyMinutes: mode === 'batches' ? every : null,
      afterSend: ups.length ? async () => {
        /* The workflow: this campaign first, then each follow-up as its own draft, filled from a template if chosen. */
        const wf = await createWorkflow(draft.name || campaign.name, campaign.id)
        for (const [i, u] of ups.entries()) {
          const step = await addWorkflowStep(wf, i + 1, draft.send_from)
          await updateWorkflowStep(step.id, { wait_days: u.wait, audience: u.audience })
          const t = templates.find((x) => x.id === u.templateId)
          if (t) await fillCampaignFromTemplate(step.campaign_id, t)
        }
        /* Started at once only if every follow-up already has its words; otherwise it waits on the Workflows tab. */
        if (ups.every((u) => !!templates.find((x) => x.id === u.templateId))) await updateWorkflow(wf.id, { status: 'active' })
      } : undefined,
    }
  }

  return (
    <Modal title="Ready to send?" subtitle="Once it has gone it cannot be called back." onClose={onClose} width={720}
      footer={(
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {error && <span className="text-sm text-red-600 mr-auto">{error}</span>}
          <Button onClick={onClose}>Not yet</Button>
          <Button variant="primary" icon={<Send size={14} />} disabled={busy || !validBatch} onClick={() => onSend(plan())} data-testid="news-send-confirm">
            {busy ? 'Sending…' : `Send to ${count} ${count === 1 ? 'person' : 'people'}`}
          </Button>
        </div>
      )}>
      <div className="space-y-5" data-testid="news-send-modal">
        <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-[7rem_minmax(0,1fr)] text-sm">
          <dt className="text-slate-500">Subject</dt><dd className="text-slate-800">{draft.subject}</dd>
          <dt className="text-slate-500">From</dt><dd className="text-slate-800" data-testid="news-send-modal-from">{from}</dd>
          <dt className="text-slate-500">To</dt>
          <dd className="text-slate-800">
            {count} {count === 1 ? 'address' : 'addresses'}, each once
            {draft.kind === 'introduction' && ', each for the first and only time'}
            {draft.kind !== 'introduction' && preview.firstApproaches > 0 && `, ${preview.firstApproaches} of them leads being approached for the first and only time`}
          </dd>
        </dl>

        <section>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">How it goes out</h4>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} data-testid="news-send-all" /> All at once
            </label>
            <label className={`flex flex-wrap items-center gap-2 text-sm ${schemaReady ? 'text-slate-700' : 'text-slate-400'}`}>
              <input type="radio" checked={mode === 'batches'} disabled={!schemaReady} onChange={() => setMode('batches')} data-testid="news-send-batches" /> In batches of
              <input type="number" min={10} max={5000} value={size} disabled={mode !== 'batches'} data-testid="news-batch-size"
                onChange={(e) => setSize(Math.round(Number(e.target.value) || 0))} className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-sm" />
              emails, every
              <select value={every} disabled={mode !== 'batches'} onChange={(e) => setEvery(Number(e.target.value))} data-testid="news-batch-every"
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm">
                {EVERY.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
              </select>
            </label>
            {mode === 'batches' && (
              <p className="text-xs text-slate-500 pl-6" data-testid="news-batch-estimate">
                {!validBatch ? 'A batch is between 10 and 5 000 emails.'
                  : batches === 1 ? 'That is one batch: everybody at once.'
                    : `${batches} batches. The last goes about ${duration(takes)} after the first, whether or not this page is open.`}
              </p>
            )}
            {!schemaReady && <p className="text-xs text-slate-400 pl-6">Batches need one database change first (campaign_compose).</p>}
          </div>
        </section>

        {news && (
          <section>
            <h4 className="text-sm font-semibold text-slate-800 mb-1">Then, follow-ups</h4>
            <p className="text-xs text-slate-500 mb-2">Each goes on its own, the set number of days after the email before it, at 07:13. Anybody who unsubscribes or whose email did not arrive is never followed up.</p>
            <ul className="space-y-2" data-testid="news-followups">
              {followUps.map((u, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 text-sm text-slate-700 rounded-lg border border-slate-200 px-3 py-2">
                  <span className="font-medium">Email {i + 2}</span> after
                  <input type="number" min={1} max={90} value={u.wait} onChange={(e) => setUp(i, { wait: Math.max(1, Math.min(90, Math.round(Number(e.target.value) || 1))) })}
                    className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-sm" data-testid="news-followup-wait" />
                  days, to
                  <select value={u.audience} onChange={(e) => setUp(i, { audience: e.target.value as WorkflowAudience })} className="rounded-lg border border-slate-200 px-2 py-1 text-sm" data-testid="news-followup-audience">
                    {(Object.keys(WORKFLOW_AUDIENCE_LABELS) as WorkflowAudience[]).map((k) => <option key={k} value={k}>{WORKFLOW_AUDIENCE_LABELS[k].toLowerCase()}</option>)}
                  </select>
                  <select value={u.templateId} onChange={(e) => setUp(i, { templateId: e.target.value })} className="rounded-lg border border-slate-200 px-2 py-1 text-sm max-w-[14rem]" data-testid="news-followup-template">
                    <option value="">I will write it on the Workflows tab</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>From the template “{t.name}”</option>)}
                  </select>
                  <button type="button" aria-label="Remove" className="ml-auto text-slate-400 hover:text-red-600" onClick={() => setFollowUps((f) => f.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                </li>
              ))}
            </ul>
            <Button size="sm" className="mt-2" icon={<Plus size={13} />} data-testid="news-followup-add"
              onClick={() => setFollowUps((f) => [...f, { wait: f.length ? 7 : 20, audience: 'not_opened', templateId: '' }])}>Add a follow-up</Button>
            {followUps.some((u) => !u.templateId) && (
              <p className="text-xs text-slate-500 mt-1.5">The follow-ups wait on the Workflows tab until each has its words; start the workflow there.</p>
            )}
          </section>
        )}
      </div>
    </Modal>
  )
}
