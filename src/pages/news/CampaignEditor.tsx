import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, GitBranch, LayoutTemplate, Send } from 'lucide-react'
import { useAuth } from '../../store/AuthContext'
import { useAppStore } from '../../store/AppStore'
import { Card, CardHeader } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { fetchFirmSettings, type FirmSettings } from '../../lib/firmSettings'
import {
  CAMPAIGN_KIND_LABELS, FIRM_REPORTS_ADDRESS, FIRM_SENDER_ENV, FIRM_SENDER_NAME, LEAD_AUDIENCES, MERGE_FIELDS, SEND_FROM_LABELS,
  WORKFLOW_AUDIENCE_LABELS, describeAudience, describeSplit, domainReady, fromHeader, isFirmMainDomain, isProspectKind, prospectAddressSender, prospectSender,
  renderCampaignEmail, splitFrom,
  unknownMergeFields, type CampaignKind, type SendFrom,
} from '../../lib/marketing.ts'
import { EMAIL_HTML_MARKER, campaignBodyEmpty, isHtmlBody, storeHtmlBody, textToEmailHtml } from '../../lib/campaignHtml'
import {
  cancelCampaign, drainCampaign, getCampaign, listSenders, previewAudience, queueCampaign, saveAsTemplate, saveCampaign, sendTest, stepOfCampaign,
  uploadEmailPicture,
  type Allowance, type AudiencePreview, type CampaignDraft, type CampaignRow, type ExtraSender, type WorkflowRow, type WorkflowStepRow,
} from '../../lib/marketingApi'
import { AudiencePicker } from './AudiencePicker'
import { InboxPreview } from './InboxPreview'
import { ResultsPanel } from './ResultsPanel'
import { RichEditor } from './RichEditor'
import { SendModal, type SendPlan } from './SendModal'
import { Choices, Field, INPUT, SenderSetup, StatusPill, errorText, kindReady, useSenderConfig } from './shared'

/**
 * ONE CAMPAIGN, AS FIVE STEPS (S13): Who -> Write -> Check -> Send -> Results.
 *
 * The firm: "make this nice and make it work, look better." It was one long column doing everything at
 * once -- the kind, the list, the words, the preview and the Send button all on one screen, so the
 * button sat beside a form half filled in. Each step now asks one question, and Send is reached only
 * through Check, where the real email, the count and who it goes from are on screen together.
 *
 * Nothing about WHAT goes changed: the count is the server's (resolveOnServer), and the split by sender
 * is counted in the same pass, so the number somebody approves is the number that goes.
 */

type Step = 'who' | 'write' | 'check' | 'send' | 'results'
const STEPS: { key: Step; label: string }[] = [
  { key: 'who', label: 'Who' }, { key: 'write', label: 'Write' }, { key: 'check', label: 'Check' }, { key: 'send', label: 'Send' }, { key: 'results', label: 'Results' },
]

const EXCLUSION_ORDER = ['unsubscribed', 'client unsubscribed', 'undeliverable', 'no consent recorded', 'already approached once',
  'already said yes', 'already a client', 'no address', 'address does not look right', 'on the list twice'] as const

const KIND_EXPLAINED: Record<CampaignKind, string> = {
  news: 'News goes to clients (unless they unsubscribed) and to leads who have said yes.',
  introduction: 'One email to leads who have never been asked, with a “Yes, keep me informed” button. Each lead gets an introduction once, ever. Anybody who does not press it is never sent marketing again. It goes from the marketer below, on the separate marketing domain.',
  prospect: 'Marketing to leads who pressed “Yes, keep me informed” (or whose yes is recorded on their lead). From the marketer below, on the separate marketing domain.',
}

const SEND_FROM_EXPLAINED: Record<SendFrom, string> = {
  news: 'From news@bfnews.co.za, as every newsletter has gone so far.',
  liaison: 'Each client hears from the person who looks after them: Nicole’s clients from Nicole, and so on. A client without a liaison gets it from reports@. Replies go to whoever it came from.',
  reports: 'From reports@bredellferreira.co.za, signed Bredell Ferreira. Replies go to reports@.',
  address: 'From one of the extra addresses (added under Senders & results). Replies go to that address.',
}

export function CampaignEditor({ id }: { id: string }) {
  const { currentUser } = useAuth()
  const { users } = useAppStore()
  const { config, error: configError } = useSenderConfig()
  const [row, setRow] = useState<CampaignRow | null>(null)
  const [draft, setDraft] = useState<CampaignDraft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [firm, setFirm] = useState<FirmSettings | null>(null)
  const [preview, setPreview] = useState<AudiencePreview | null>(null)
  const [senders, setSenders] = useState<ExtraSender[]>([])
  const [wfStep, setWfStep] = useState<(WorkflowStepRow & { workflow: WorkflowRow | null }) | null>(null)
  const [step, setStep] = useState<Step>('who')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<{
    sent: number; remaining: number; stoppedFor: string | null; waitingForTomorrow?: number; allowance?: Allowance | null; nextBatchAt?: string | null
  } | null>(null)
  const [sendOpen, setSendOpen] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const sending = useRef(false)
  const opened = useRef(false)

  const load = useCallback(async () => {
    const c = await getCampaign(id)
    setRow(c)
    if (c) {
      setDraft({
        name: c.name, subject: c.subject, preheader: c.preheader, body: c.body, image_url: c.image_url, audience: c.audience,
        first_approach: c.kind === 'introduction', kind: c.kind ?? 'news', sender_id: c.sender_id ?? c.created_by,
        send_from: c.send_from ?? 'news', sender_address_id: c.sender_address_id,
        batch_size: c.batch_size, batch_every_minutes: c.batch_every_minutes,
      })
      /* A campaign that has gone opens on what happened to it; a draft on its first step. */
      if (!opened.current) { opened.current = true; setStep(c.status === 'draft' ? 'who' : 'results') }
    }
  }, [id])

  useEffect(() => {
    load().catch((e: unknown) => setError(errorText(e)))
    fetchFirmSettings().then(setFirm).catch(() => setFirm(null))
    listSenders().then(setSenders).catch(() => setSenders([]))
    stepOfCampaign(id).then(setWfStep).catch(() => setWfStep(null))
  }, [load, id])

  const locked = !!row && row.status !== 'draft'
  const edit = (patch: Partial<CampaignDraft>) => {
    /* The stored first-approach flag follows the kind: the introduction is the only first approach. */
    setDraft((d) => (d ? { ...d, ...patch, first_approach: (patch.kind ?? d.kind) === 'introduction' } : d))
    setDirty(true)
    if ('audience' in patch || 'kind' in patch || 'send_from' in patch || 'sender_address_id' in patch) setPreview(null)
  }

  async function save(): Promise<boolean> {
    if (!draft || locked) return true
    try {
      await saveCampaign(id, draft)
      setDirty(false)
      return true
    } catch (e) {
      setError(errorText(e))
      return false
    }
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError(null); setMessage(null)
    try { await fn() } catch (e) { setError(errorText(e)) } finally { setBusy(null) }
  }

  const checkList = () => run('preview', async () => {
    if (!draft) return
    setPreview(await previewAudience(draft.audience, draft.kind, draft.send_from, draft.sender_address_id ?? null))
  })

  const test = () => run('test', async () => {
    if (!(await save())) return
    const r = await sendTest(id)
    setMessage(`A test went to ${r.sentTo}${r.from ? `, from ${r.from}` : ''}, marked [Test]. Check it in your inbox before sending to anybody else.`)
  })

  /* THE SCREEN DRIVES THE SEND while it is open: queue, then drain until nothing is left. Closed
     halfway, the five-minute mail sweep carries on with it on the server. */
  const drainLoop = useCallback(async () => {
    if (sending.current) return
    sending.current = true
    try {
      for (let i = 0; i < 500; i += 1) {
        const r = await drainCampaign(id)
        setProgress((p) => ({
          sent: (p?.sent ?? 0) + r.sent, remaining: r.remaining, stoppedFor: r.stoppedFor,
          waitingForTomorrow: r.waitingForTomorrow, allowance: r.allowance, nextBatchAt: r.nextBatchAt,
        }))
        if (r.remaining === 0) break
        /* Between batches: the five-minute sweep sends the next one on its own. Nothing to wait for here. */
        if (r.nextBatchAt && r.sent === 0) break
        /* A sender at today's allowance: the rest go tomorrow from the sweep. Nothing to wait for here. */
        if ((r.waitingForTomorrow ?? 0) > 0 && r.sent === 0) break
        if (r.stoppedFor) await new Promise((res) => setTimeout(res, 20_000))
      }
      await load()
    } finally {
      sending.current = false
    }
  }, [id, load])

  /*
   * SEND OPENS THE POP-UP (Ryno, 29 Oct: "an additional pop-up ... how many emails at a time, the frequency,
   * which emails you send when"). It says once more who and from whom, and takes the batches and the follow-ups;
   * pressing Send there is the one press that cannot be called back.
   */
  const send = (plan: SendPlan) => run('send', async () => {
    if (!draft || !preview) return
    const withBatches = { ...draft, ...(row?.batch_size !== undefined ? { batch_size: plan.batchSize, batch_every_minutes: plan.everyMinutes } : {}) }
    setDraft(withBatches)
    try { await saveCampaign(id, withBatches) } catch (e) { setError(errorText(e)); return }
    setDirty(false)
    const r = await queueCampaign(id)
    setSendOpen(false)
    setProgress({ sent: r.sent, remaining: r.remaining, stoppedFor: r.stoppedFor, waitingForTomorrow: r.waitingForTomorrow, allowance: r.allowance, nextBatchAt: r.nextBatchAt })
    if (plan.afterSend) { try { await plan.afterSend() } catch (e) { setError(`It has gone. The follow-ups could not be set up: ${errorText(e)}`) } }
    await load()
    setStep('results')
    void drainLoop()
  })

  const saveTemplate = () => run('template', async () => {
    if (!draft) return
    const name = window.prompt('Name the template (for example “Nicole’s client newsletter”)', draft.name)
    if (!name?.trim()) return
    await saveAsTemplate(name, draft)
    setMessage(`Saved as the template “${name.trim()}”. Start a campaign from it with “From a template”.`)
  })

  /* A campaign already sending when the page opens: carry on driving it. */
  /*
   * A COLD CAMPAIGN FROM A CHOSEN ADDRESS (29 Oct) needs no prospect domain -- only the first key and its own
   * domain set up; the domain is judged with the From below.
   */
  const ready = !!draft && (isProspectKind(draft.kind) && draft.sender_address_id
    ? !!config && !config.missing.includes('RESEND_API_KEY')
    : kindReady(config, draft.kind))
  useEffect(() => {
    if (row?.status === 'sending' && ready) void drainLoop()
  }, [row?.status, ready, drainLoop])

  const marketer = users.find((u) => u.id === draft?.sender_id) ?? null
  const chosenAddress = senders.find((s) => s.id === draft?.sender_address_id) ?? null
  /* The From a prospect campaign will carry, worked out by the very functions the server sends with. */
  const prospectFrom = draft && isProspectKind(draft.kind)
    ? draft.sender_address_id
      ? (chosenAddress ? prospectAddressSender(chosenAddress.display_name, chosenAddress.address) : { error: 'Choose which address it goes from.' })
      : config?.prospect?.domain
        ? prospectSender(config.prospect.domain, marketer ? { name: marketer.name, email: marketer.email ?? null } : null)
        : null
    : null

  /* The bare address whose signature {{signature}} stands for, in the preview. */
  const signatureAddress = !draft ? '' : isProspectKind(draft.kind) ? (chosenAddress?.address ?? '')
    : draft.send_from === 'reports' ? FIRM_REPORTS_ADDRESS
      : draft.send_from === 'address' ? (chosenAddress?.address ?? '')
        : draft.send_from === 'news' ? splitFrom(config?.from).address : ''

  const myFirstName = currentUser?.name?.split(' ')[0] ?? null
  const sampleRecipient = useMemo(
    () => preview?.sample[0] ?? { firstName: myFirstName, companyName: null },
    [preview, myFirstName],
  )
  const rendered = useMemo(() => {
    if (!draft) return null
    return renderCampaignEmail(
      { subject: draft.subject, preheader: draft.preheader, body: draft.body, imageUrl: draft.image_url },
      sampleRecipient,
      {
        unsubscribeUrl: `${window.location.origin}/unsubscribe/preview`, firmName: firm?.firmName ?? 'Bredell Ferreira',
        face: { emailFont: firm?.emailFont ?? 'Georgia, serif', emailSizePt: firm?.emailSizePt ?? 11 },
        firmAddress: firm?.postalAddress ?? firm?.physicalAddress ?? null,
        basis: draft.kind === 'introduction' ? 'introduction' : LEAD_AUDIENCES.includes(draft.audience.kind) && draft.audience.kind !== 'manual' ? 'lead' : 'client',
        optInUrl: draft.kind === 'introduction' ? `${window.location.origin}/opt-in/preview` : null,
        /*
         * {{signature}} in the preview is the signature of the address shown as the From. A liaison's is on her
         * profile and differs per client, so the preview says whose it will be instead of guessing one.
         */
        signatureHtml: draft.kind === 'news' && draft.send_from === 'liaison'
          ? '<p><i>[the liaison’s own signature, from her profile]</i></p>'
          : senders.find((s) => s.address === signatureAddress)?.signature_html ?? '',
      },
    )
  }, [draft, firm, sampleRecipient, senders, signatureAddress])

  if (error && !row) return <Card><p className="text-sm text-red-600">{error}</p></Card>
  if (!row || !draft) return <p className="text-sm text-slate-400">Loading…</p>

  const isNews = draft.kind === 'news'
  const isFollowUp = !!wfStep
  const firmReady = !!config?.firm?.ready
  /* Undefined, not null: the database has not had migration campaign_compose yet. */
  const canPickAddress = row.sender_address_id !== undefined
  const activeSenders = senders.filter((s) => s.active || s.id === draft.sender_address_id)
  const extra = senders.find((s) => s.id === draft.sender_address_id) ?? null
  const needsFirmKey = isNews && (draft.send_from === 'liaison' || draft.send_from === 'reports'
    || (draft.send_from === 'address' && !!extra && isFirmMainDomain(extra.address)))
  const sendFromProblem = !isNews ? null
    : needsFirmKey && !firmReady ? `Sending from ${draft.send_from === 'liaison' ? 'the liaisons' : draft.send_from === 'reports' ? 'reports@' : extra?.address} is not set up yet: ${FIRM_SENDER_ENV} must be set in Vercel.`
      : draft.send_from === 'address' && !extra ? 'Choose which address it goes from.'
        : draft.send_from === 'address' && extra && !domainReady(extra.address, config?.readyDomains ?? [])
          ? `${extra.address.split('@')[1]} is not set up for sending yet. Follow the steps under Email addresses on the campaigns page.`
          : null

  /* What the inbox shows as the From. In liaison mode it differs per client, so the first one counted. */
  const shownFrom = isProspectKind(draft.kind)
    ? (prospectFrom && 'from' in prospectFrom ? prospectFrom.from : null)
    : draft.send_from === 'reports' ? fromHeader(FIRM_SENDER_NAME, FIRM_REPORTS_ADDRESS)
      : draft.send_from === 'address' && extra ? fromHeader(extra.display_name, extra.address)
        : draft.send_from === 'liaison'
          ? (preview?.senders?.[0] ? fromHeader(preview.senders[0].label, preview.senders[0].address) : null)
          : config?.from ?? null
  const fromNote = isNews && draft.send_from === 'liaison' ? 'From each client’s own liaison; reports@ for clients without one.' : null

  const unknown = unknownMergeFields(`${draft.subject} ${draft.preheader} ${draft.body}`)
  /* A new email is written in the full editor; one written as plain text before 29 Oct stays text until switched. */
  const htmlMode = isHtmlBody(draft.body) || (!locked && !draft.body.trim())
  const insertField = (f: string) => {
    const el = bodyRef.current
    const token = `{{${f}}}`
    if (!el) { edit({ body: draft.body + token }); return }
    const at = el.selectionStart ?? draft.body.length
    edit({ body: draft.body.slice(0, at) + token + draft.body.slice(el.selectionEnd ?? at) })
  }
  const senderProblem = prospectFrom && 'error' in prospectFrom ? prospectFrom.error : null
  const blockers = [
    !draft.subject.trim() && 'It has no subject yet (Write).',
    campaignBodyEmpty(draft.body) && 'It has no body yet (Write).',
    unknown.length > 0 && `Raptor does not know ${unknown.map((u) => `{{${u}}}`).join(', ')} (Write).`,
    !ready && 'Sending is not set up yet.',
    senderProblem, sendFromProblem,
    !preview && 'Count who gets it first (Check).',
    preview && preview.count === 0 && 'Nobody on this list can be sent to.',
  ].filter((x): x is string => !!x)
  const canSend = !locked && !isFollowUp && blockers.length === 0
  const done: Record<Step, boolean> = {
    who: locked, write: locked || (!!draft.subject.trim() && !campaignBodyEmpty(draft.body) && unknown.length === 0), check: locked || !!preview, send: locked, results: false,
  }
  const at = STEPS.findIndex((s) => s.key === step)
  const go = (s: Step) => { void save(); setStep(s) }

  return (
    <div className="space-y-4" data-testid="news-editor">
      <Link to="/news" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> All campaigns</Link>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold text-slate-800">{draft.name || 'Untitled campaign'}</h1>
        <StatusPill status={row.status} />
        <span className="text-xs text-slate-400">{CAMPAIGN_KIND_LABELS[draft.kind]}</span>
      </div>

      <SenderSetup config={config} error={configError} kind={draft.kind} />

      {isFollowUp && wfStep && (
        <Card className="bg-brand-50/60 border-brand-100">
          <p className="text-sm text-slate-700 flex items-start gap-2" data-testid="news-followup">
            <GitBranch size={16} className="mt-0.5 shrink-0 text-brand-500" />
            <span>
              This email is follow-up {wfStep.position} of the workflow <b>{wfStep.workflow?.name ?? '—'}</b>. It goes on its own,{' '}
              {wfStep.wait_days} {wfStep.wait_days === 1 ? 'day' : 'days'} after the email before it has gone, to{' '}
              {WORKFLOW_AUDIENCE_LABELS[wfStep.audience].toLowerCase()}. Write it here; when and to whom is set on the workflow.{' '}
              <Link to="/news?tab=workflows" className="text-brand-700 underline">Open the workflow</Link>
            </span>
          </p>
        </Card>
      )}

      {/* The steps. Each can be opened at any time: the order is a guide, not a gate -- except Send. */}
      <nav className="card p-1.5 flex gap-1 overflow-x-auto" aria-label="Steps">
        {STEPS.map((s, i) => {
          const disabled = s.key === 'results' && !locked
          return (
            <button key={s.key} type="button" disabled={disabled} onClick={() => go(s.key)} data-testid={`news-step-${s.key}`}
              aria-current={step === s.key ? 'step' : undefined}
              className={`flex-1 min-w-[6.5rem] flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${step === s.key
                ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              <span className={`grid place-items-center h-5 w-5 rounded-full text-[11px] ${step === s.key ? 'bg-white/20' : done[s.key] ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {done[s.key] && step !== s.key ? <Check size={12} /> : i + 1}
              </span>
              {s.label}
            </button>
          )
        })}
      </nav>

      {locked && step !== 'results' && (
        <p className="text-sm text-slate-500" data-testid="news-locked">
          {row.status === 'sending' ? 'Sending now.' : row.status === 'sent' ? 'Sent.' : 'Cancelled.'} A campaign that has gone out is a record of what was sent and cannot be edited.
        </p>
      )}

      {/* ------------------------------------------- WHO ------------------------------------------- */}
      {step === 'who' && (
        <Card>
          <fieldset disabled={locked} className="space-y-5">
            {!isFollowUp && (
              <Field label="Kind">
                <Choices<CampaignKind> label="Kind" testid="news-kind" value={draft.kind}
                  options={(Object.keys(CAMPAIGN_KIND_LABELS) as CampaignKind[]).map((k) => ({ value: k, label: CAMPAIGN_KIND_LABELS[k] }))}
                  onChange={(k) => edit({
                    kind: k,
                    /* A prospect kind goes to leads only: a client list is swapped for an imported one. */
                    ...(isProspectKind(k) && !LEAD_AUDIENCES.includes(draft.audience.kind) ? { audience: { kind: 'imported_list', listIds: [] } } : {}),
                  })} />
                <p className="text-xs text-slate-500 mt-1.5" data-testid="news-kind-explained">{KIND_EXPLAINED[draft.kind]}</p>
              </Field>
            )}

            {isNews && (
              <div data-testid="news-send-from">
                <span className="block text-xs font-medium text-slate-500 mb-1">Send from</span>
                <Choices<SendFrom> label="Send from" testid="news-send-from" value={draft.send_from}
                  options={(['news', 'liaison', 'reports', 'address'] as SendFrom[])
                    .filter((k) => k !== 'address' || canPickAddress)
                    .map((k) => ({
                      value: k, label: SEND_FROM_LABELS[k],
                      /* Offered only once the firm's key is there -- the screen never promises a sender Resend will refuse. */
                      disabled: (k === 'liaison' || k === 'reports') && !firmReady && draft.send_from !== k,
                      title: (k === 'liaison' || k === 'reports') && !firmReady ? `${FIRM_SENDER_ENV} is not set yet` : undefined,
                    }))}
                  onChange={(k) => edit({ send_from: k })} />
                <p className="text-xs text-slate-500 mt-1.5" data-testid="news-send-from-explained">{SEND_FROM_EXPLAINED[draft.send_from]}</p>
                {draft.send_from === 'address' && (
                  <div className="mt-2 max-w-md">
                    <select className={INPUT} value={draft.sender_address_id ?? ''} data-testid="news-sender-address"
                      onChange={(e) => edit({ sender_address_id: e.target.value || null })}>
                      <option value="">Choose an address…</option>
                      {activeSenders.map((s) => <option key={s.id} value={s.id}>{s.display_name} · {s.address}</option>)}
                    </select>
                    <p className="text-xs text-slate-500 mt-1"><Link to="/news?tab=senders" className="text-brand-700 underline">Add another address</Link></p>
                  </div>
                )}
                {!firmReady && config && (
                  <p className="text-xs text-gold-800 bg-gold-50 border border-gold-200 rounded-lg px-2.5 py-1.5 mt-2" data-testid="firm-setup">
                    Sending from the liaisons is not set up yet: {FIRM_SENDER_ENV} must be set in Vercel. Until then only BF News{canPickAddress ? ' and extra addresses on bfnews.co.za' : ''} can be chosen.
                  </p>
                )}
                {!canPickAddress && (
                  <p className="text-xs text-slate-400 mt-1" data-testid="news-address-waiting">
                    Choosing one of the extra addresses for a campaign needs one database change first (campaign_sender_address).
                  </p>
                )}
                {sendFromProblem && firmReady && <p className="text-xs text-red-600 mt-1">{sendFromProblem}</p>}
              </div>
            )}

            {isProspectKind(draft.kind) && canPickAddress && (
              <Field label="Send from">
                {/* 29 Oct: a cold campaign may go from one of the added addresses -- any but the firm's own domain. */}
                <select className={INPUT} value={draft.sender_address_id ?? ''} data-testid="news-prospect-address"
                  onChange={(e) => edit({ sender_address_id: e.target.value || null })}>
                  <option value="">The marketer, on the prospect domain</option>
                  {activeSenders.filter((x) => !isFirmMainDomain(x.address)).map((x) => <option key={x.id} value={x.id}>{x.display_name} · {x.address}</option>)}
                </select>
                {chosenAddress && !domainReady(chosenAddress.address, config?.readyDomains ?? []) && (
                  <p className="text-xs text-gold-800 mt-1">{chosenAddress.address.split('@')[1]} is not set up for sending yet: see Email addresses on the campaigns page.</p>
                )}
              </Field>
            )}

            {isProspectKind(draft.kind) && !draft.sender_address_id && (
              <Field label="From (the marketer who runs it — replies go to their own inbox)">
                <select className={INPUT} value={draft.sender_id ?? ''} onChange={(e) => edit({ sender_id: e.target.value || null })} data-testid="news-sender">
                  {users.filter((u) => u.status === 'Active' || u.id === draft.sender_id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <p className="text-xs mt-1" data-testid="news-from">
                  {!prospectFrom
                    ? <span className="text-slate-500">The address appears here once MARKETING_PROSPECT_DOMAIN is set.</span>
                    : 'error' in prospectFrom
                      ? <span className="text-red-600">{prospectFrom.error}</span>
                      : <span className="text-slate-600">{prospectFrom.from} · replies to {prospectFrom.replyTo}</span>}
                </p>
              </Field>
            )}

            {isFollowUp ? (
              <div>
                <span className="block text-xs font-medium text-slate-500 mb-1">Goes to</span>
                <p className="text-sm text-slate-700">{wfStep ? WORKFLOW_AUDIENCE_LABELS[wfStep.audience] : ''} of the email before it — worked out on the morning it goes. Anybody who has unsubscribed since is left out.</p>
              </div>
            ) : (
              <div>
                <span className="block text-xs font-medium text-slate-500 mb-1">Goes to</span>
                <p className="text-xs text-slate-500 mb-2">Drawn from Raptor’s own clients, contacts and leads when it is sent. Anybody who has unsubscribed is left out, always.</p>
                <AudiencePicker audience={draft.audience} onChange={(audience) => edit({ audience })} leadsOnly={isProspectKind(draft.kind)} />
              </div>
            )}
          </fieldset>
        </Card>
      )}

      {/* ------------------------------------------ WRITE ------------------------------------------ */}
      {step === 'write' && (htmlMode ? (
        /*
         * OUTLOOK'S LAYOUT, AS RYNO ASKED (29 Oct): the ribbon across the top, then From, To and Subject, then the
         * message. From and To are chosen on Who; here they are shown, as Outlook shows them above the words.
         */
        <RichEditor value={draft.body.replace(EMAIL_HTML_MARKER, '')} disabled={locked} testid="news-rich"
          onChange={(html) => edit({ body: storeHtmlBody(html) })}
          onPicture={currentUser ? (f) => uploadEmailPicture(currentUser.id, f) : undefined}
          fields={[{ token: 'first_name', label: 'First name' }, { token: 'company', label: 'Company' }, { token: 'signature', label: 'Signature' }]}
          ribbonRight={!locked && config?.schemaReady ? (
            <Button size="sm" icon={<LayoutTemplate size={13} />} onClick={() => void saveTemplate()} data-testid="news-save-template">Save as template</Button>
          ) : undefined}
          header={(
            <div className="divide-y divide-slate-100 border-b border-slate-200 text-sm" data-testid="news-compose-header">
              <ComposeRow label="From">
                <span className="text-slate-800" data-testid="news-compose-from">{shownFrom ?? (isNews ? SEND_FROM_LABELS[draft.send_from] : '—')}</span>
                {fromNote && <span className="text-xs text-slate-400 ml-2">{fromNote}</span>}
                {!locked && <button type="button" className="ml-auto text-xs text-brand-700 hover:underline" onClick={() => go('who')}>Change</button>}
              </ComposeRow>
              <ComposeRow label="To">
                <span className="text-slate-800">{isFollowUp && wfStep ? WORKFLOW_AUDIENCE_LABELS[wfStep.audience] : describeAudience(draft.audience)}</span>
                {preview && <span className="text-xs text-slate-400 ml-2">{preview.count} addresses</span>}
                {!locked && !isFollowUp && <button type="button" className="ml-auto text-xs text-brand-700 hover:underline" onClick={() => go('who')}>Change</button>}
              </ComposeRow>
              <ComposeRow label="Subject">
                <input className="flex-1 bg-transparent outline-none text-slate-900" value={draft.subject} disabled={locked}
                  onChange={(e) => edit({ subject: e.target.value })} data-testid="news-subject" placeholder="What it is about" />
              </ComposeRow>
              <ComposeRow label="Preview line">
                <input className="flex-1 bg-transparent outline-none text-slate-700" value={draft.preheader} disabled={locked}
                  onChange={(e) => edit({ preheader: e.target.value })} data-testid="news-preheader" placeholder="The line an inbox shows after the subject" />
              </ComposeRow>
              <ComposeRow label="Name">
                <input className="flex-1 bg-transparent outline-none text-slate-500 text-xs" value={draft.name} disabled={locked}
                  onChange={(e) => edit({ name: e.target.value })} data-testid="news-name" />
                <span className="text-[11px] text-slate-400">for us, never shown</span>
              </ComposeRow>
              {unknown.length > 0 && (
                <p className="px-4 py-1.5 text-xs text-red-600">Raptor does not know {unknown.map((u) => `{{${u}}}`).join(', ')}. Only {MERGE_FIELDS.map((f) => `{{${f}}}`).join(', ')} are filled in.</p>
              )}
            </div>
          )} />
      ) : (
        <Card>
          <CardHeader title="Write it" subtitle="This email was written as plain text. A blank line starts a new paragraph; **two asterisks** make bold." />
          {!locked && (
            <div className="mb-3 rounded-lg bg-brand-50/60 border border-brand-100 px-3 py-2 text-sm text-slate-700 flex flex-wrap items-center gap-2">
              <span className="flex-1 min-w-[12rem]">Use the full editor, with fonts, colours, pictures and signatures, as in Outlook.</span>
              <Button size="sm" variant="primary" data-testid="news-to-rich" onClick={() => edit({ body: storeHtmlBody(textToEmailHtml(draft.body)) })}>Switch to the full editor</Button>
            </div>
          )}
          <fieldset disabled={locked} className="space-y-3">
            <Field label="Campaign name (for us, never shown)">
              <input className={INPUT} value={draft.name} onChange={(e) => edit({ name: e.target.value })} data-testid="news-name" />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Subject">
                <input className={INPUT} value={draft.subject} onChange={(e) => edit({ subject: e.target.value })} data-testid="news-subject" />
              </Field>
              <Field label="Preheader (the line an inbox shows after the subject)">
                <input className={INPUT} value={draft.preheader} onChange={(e) => edit({ preheader: e.target.value })} data-testid="news-preheader" />
              </Field>
            </div>
            <Field label="Picture (optional, an https:// link to an image)">
              <input className={INPUT} value={draft.image_url ?? ''} placeholder="https://…" onChange={(e) => edit({ image_url: e.target.value })} />
            </Field>
            <Field label="Body">
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {MERGE_FIELDS.map((f) => (
                  <button key={f} type="button" onClick={() => insertField(f)}
                    className="text-xs px-2 py-1 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
                    {`{{${f}}}`}
                  </button>
                ))}
              </div>
              <textarea ref={bodyRef} className={`${INPUT} min-h-[18rem] font-[Georgia,serif] text-[15px] leading-relaxed`} value={draft.body}
                onChange={(e) => edit({ body: e.target.value })} data-testid="news-body"
                placeholder={'Dear {{first_name}},\n\nWhat we want to tell you…\n\nKind regards'} />
            </Field>
            {unknown.length > 0 && (
              <p className="text-xs text-red-600">Raptor does not know {unknown.map((u) => `{{${u}}}`).join(', ')}. Only {MERGE_FIELDS.map((f) => `{{${f}}}`).join(', ')} are filled in.</p>
            )}
          </fieldset>
          {!locked && config?.schemaReady && (
            <Button className="mt-3" icon={<LayoutTemplate size={14} />} onClick={() => void saveTemplate()} data-testid="news-save-template">Save as template</Button>
          )}
        </Card>
      ))}

      {/* ------------------------------------------ CHECK ------------------------------------------ */}
      {step === 'check' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader title="How it reads" subtitle="The real email, as the inbox lists it and as it opens, in the firm’s own face." />
            {rendered && <InboxPreview from={shownFrom} subject={rendered.subject} preheader={draft.preheader} html={rendered.html}
              recipientName={sampleRecipient.firstName} fromNote={fromNote} />}
          </Card>
          <div className="space-y-4">
            {!isFollowUp && (
              <Card>
                <CardHeader title="Who gets it" subtitle="Counted by the server with the very rule it sends with." />
                <Button onClick={() => void checkList()} disabled={!!busy} data-testid="news-check">{busy === 'preview' ? 'Counting…' : preview ? 'Count again' : 'Count who gets it'}</Button>
                {preview && <PreviewList preview={preview} kind={draft.kind} />}
              </Card>
            )}
            {!locked && (
              <Card>
                <CardHeader title="Send me a test" subtitle="To your own inbox, marked [Test], from what you chose. Nobody else gets it." />
                <Button onClick={() => void test()} disabled={!ready || !!senderProblem || !!sendFromProblem || !!busy} data-testid="news-test">
                  {busy === 'test' ? 'Sending…' : 'Send a test to me'}
                </Button>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------- SEND ------------------------------------------ */}
      {step === 'send' && (
        <Card>
          {isFollowUp ? (
            <p className="text-sm text-slate-600">A follow-up is not sent from here: the workflow sends it on its day, every morning at 07:13.</p>
          ) : locked ? (
            <p className="text-sm text-slate-600">{row.status === 'sending' ? 'It is going out now — see Results.' : 'It has gone — see Results.'}</p>
          ) : (
            <div className="space-y-4">
              <CardHeader title="Ready to send?" subtitle="Once it has gone it cannot be called back." />
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[8rem_minmax(0,1fr)] text-sm">
                <dt className="text-slate-500">Subject</dt><dd className="text-slate-800">{draft.subject || '—'}</dd>
                <dt className="text-slate-500">From</dt>
                <dd className="text-slate-800" data-testid="news-send-split">
                  {preview?.senders?.length ? describeSplit(preview.senders) : isNews ? SEND_FROM_LABELS[draft.send_from] : shownFrom ?? '—'}
                </dd>
                <dt className="text-slate-500">To</dt><dd className="text-slate-800">{preview ? `${preview.count} ${preview.count === 1 ? 'address' : 'addresses'}, each once` : 'Not counted yet'}</dd>
              </dl>
              {blockers.length > 0 && (
                <ul className="text-sm text-slate-600 list-disc pl-5" data-testid="news-blockers">
                  {blockers.map((b) => <li key={b}>{b}</li>)}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                {!preview && <Button onClick={() => void checkList()} disabled={!!busy} data-testid="news-check">{busy === 'preview' ? 'Counting…' : 'Count who gets it'}</Button>}
                <Button variant="primary" icon={<Send size={14} />} disabled={!canSend || !!busy} onClick={() => setSendOpen(true)} data-testid="news-send">
                  {preview ? `Send to ${preview.count} ${preview.count === 1 ? 'person' : 'people'}` : 'Count first, then send'}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ----------------------------------------- RESULTS ----------------------------------------- */}
      {step === 'results' && locked && (
        <>
          {(row.status === 'sending' || progress) && (
            <Card className="bg-slate-50">
              <p className="text-sm text-slate-600" data-testid="news-locked">
                {row.status === 'sending' ? 'Sending now.' : row.status === 'sent' ? 'Sent.' : 'Cancelled.'}{' '}
                {row.recipient_count ? `${row.recipient_count} on the list. ` : ''}
                {progress && `${progress.sent} sent so far${progress.remaining ? `, ${progress.remaining} still to go` : ''}.`}
                {progress?.stoppedFor && !progress.waitingForTomorrow && ` Paused: ${progress.stoppedFor}`}
              </p>
              {(progress?.nextBatchAt || row.next_batch_at) && row.status === 'sending' && (
                <p className="text-sm text-slate-600 mt-1" data-testid="news-next-batch">
                  Sending in batches of {row.batch_size}{row.batch_every_minutes ? `, every ${everyWords(row.batch_every_minutes)}` : ''}. The next batch goes at{' '}
                  {new Date((progress?.nextBatchAt ?? row.next_batch_at) as string).toLocaleString('en-ZA', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}, whether or not this page is open.
                </p>
              )}
              {progress?.allowance && (
                <p className="text-sm text-slate-600 mt-1" data-testid="news-allowance">
                  {progress.allowance.sender} is in week {progress.allowance.week} of its warm-up: {progress.allowance.used} of {progress.allowance.cap} sent today.
                  {(progress.waitingForTomorrow ?? 0) > 0 && <> <b>{progress.waitingForTomorrow} waiting for tomorrow’s allowance.</b> They go on their own.</>}
                </p>
              )}
              {row.status === 'sending' && (
                <Button size="sm" variant="danger" className="mt-2" onClick={() => void run('cancel', async () => { await cancelCampaign(id); await load() })}>
                  Stop what has not gone yet
                </Button>
              )}
            </Card>
          )}
          <ResultsPanel campaignId={id} kind={draft.kind} live={row.status === 'sending'} />
        </>
      )}

      {sendOpen && preview && (
        <SendModal campaign={row} draft={draft} preview={preview} shownFrom={shownFrom} schemaReady={!!config?.schemaReady && row.batch_size !== undefined}
          busy={busy === 'send'} error={busy === null ? error : null} onClose={() => setSendOpen(false)} onSend={(plan) => void send(plan)} />
      )}

      {/* Back, Save, Next -- on every step but the record of a campaign that has gone. */}
      {!locked && (
        <div className="flex flex-wrap items-center gap-2">
          {at > 0 && <Button icon={<ArrowLeft size={14} />} onClick={() => go(STEPS[at - 1].key)} data-testid="news-back">Back</Button>}
          <Button onClick={() => void run('save', async () => { if (await save()) setMessage('Saved.') })} disabled={!dirty || !!busy} data-testid="news-save">Save draft</Button>
          {at < 3 && (
            <Button variant="primary" onClick={() => go(STEPS[at + 1].key)} data-testid="news-next">
              Next: {STEPS[at + 1].label} <ArrowRight size={14} className="inline ml-1" />
            </Button>
          )}
          {dirty && <span className="text-xs text-slate-400">Not saved yet</span>}
        </div>
      )}

      {message && <p className="text-sm text-emerald-700" data-testid="news-message">{message}</p>}
      {error && <p className="text-sm text-red-600" data-testid="news-error">{error}</p>}
    </div>
  )
}

function PreviewList({ preview, kind }: { preview: AudiencePreview; kind: CampaignKind }) {
  const left = EXCLUSION_ORDER.filter((k) => preview.excluded[k])
  const split = preview.senders ?? []
  return (
    <div className="mt-4 space-y-3" data-testid="news-preview-list">
      <p className="text-sm text-slate-700">
        <b className="text-2xl font-semibold text-slate-900 tabular-nums mr-1" data-testid="news-count">{preview.count}</b> {preview.count === 1 ? 'address' : 'addresses'}, each once
        {kind !== 'introduction' && preview.firstApproaches > 0 && <>, of which {preview.firstApproaches} {preview.firstApproaches === 1 ? 'is a lead' : 'are leads'} being approached for the first and only time</>}.
      </p>
      {split.length > 1 && (
        <div data-testid="news-split">
          <p className="text-xs font-medium text-slate-500 mb-1">Who it comes from</p>
          <ul className="flex flex-wrap gap-1.5">
            {split.map((s) => (
              <li key={s.address} className="text-xs rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-700" title={s.address}>
                {s.label} <b className="tabular-nums">{s.count}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      {kind === 'introduction' && preview.count > 0 && (
        <p className="text-sm text-slate-700 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2" data-testid="news-never-again">
          This is the one email each of these {preview.count} will ever get from us unasked. Anybody who does not press
          “Yes, keep me informed” will <b>never be sent another marketing email</b> — Raptor refuses them on every later list, and again at the moment of sending.
        </p>
      )}
      {kind === 'prospect' && (
        <p className="text-xs text-slate-500">Only leads who said yes. Everybody who had an introduction and did not press the button is left out, always.</p>
      )}
      {left.length > 0 && (
        <p className="text-xs text-slate-500" data-testid="news-excluded">
          Left out: {left.map((k) => `${preview.excluded[k]} ${k}`).join(' · ')}
        </p>
      )}
      {preview.sample.length > 0 && (
        <ul className="text-sm divide-y divide-slate-100 border border-slate-100 rounded-lg">
          {preview.sample.map((s) => (
            <li key={s.email} className="px-3 py-1.5 flex flex-wrap gap-x-3">
              <span className="text-slate-800">{s.email}</span>
              <span className="text-slate-400">{[s.firstName, s.companyName].filter(Boolean).join(' · ')}</span>
              <span className="text-xs text-slate-400 ml-auto">{s.via === 'lead' ? (s.firstApproach ? 'lead · first approach' : 'lead · consented') : s.via}</span>
            </li>
          ))}
          {preview.count > preview.sample.length && <li className="px-3 py-1.5 text-xs text-slate-400">and {preview.count - preview.sample.length} more</li>}
        </ul>
      )}
    </div>
  )
}

/** "an hour", "4 hours", "a day" -- how often a batch goes. */
export function everyWords(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? 'day' : `${minutes / 1440} days`
  if (minutes % 60 === 0) return minutes === 60 ? 'hour' : `${minutes / 60} hours`
  return `${minutes} minutes`
}

/** One line of Outlook's header: a grey label, then the field. */
function ComposeRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <span className="w-24 shrink-0 text-xs text-slate-500">{label}</span>
      <div className="flex-1 min-w-0 flex items-center gap-1">{children}</div>
    </div>
  )
}
