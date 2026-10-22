import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Megaphone, Plus, Send } from 'lucide-react'
import { useAuth } from '../../store/AuthContext'
import { useAppStore } from '../../store/AppStore'
import { canSendMarketing } from '../../lib/permissions'
import { Card, CardHeader } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { MultiSelectChips } from '../../components/ui/MultiSelectChips'
import { leadSources, services as SERVICES } from '../../data/mockData'
import { fetchFirmSettings, type FirmSettings } from '../../lib/firmSettings'
import {
  ACTIVE_LEAD_STATUSES, AUDIENCE_LABELS, CAMPAIGN_KIND_LABELS, DEFAULT_DORMANT_DAYS, LEAD_AUDIENCES, MERGE_FIELDS,
  OPENS_ARE_APPROXIMATE, PROSPECT_SETUP_STEPS, SENDER_SETUP_STEPS, describeAudience, isProspectKind, prospectSender,
  renderCampaignEmail, resultRates, unknownMergeFields, type Audience, type CampaignKind, type CampaignResults,
} from '../../lib/marketing.ts'
import {
  RECIPIENT_PAGE, campaignRecipients, campaignResults, cancelCampaign, createCampaign, drainCampaign, getCampaign,
  listCampaigns, listLists, previewAudience, queueCampaign, saveCampaign, sendTest, senderConfig,
  type Allowance, type AudiencePreview, type CampaignDraft, type CampaignRow, type MarketingList, type RecipientRow,
  type SenderConfig,
} from '../../lib/marketingApi'
import { ImportListCard } from './ImportListCard'
import { UndeliveredCard } from './UndeliveredCard'
import type { LeadStatus } from '../../types'
import { clockNow } from '../../lib/clock'

/**
 * NEWS & CAMPAIGNS -- a client newsletter and lead re-engagement, sent through Resend (S10, 21 Oct).
 *
 * The firm: "if we send out a blog or a new blog or a newsletter, we should be able to send it out
 * from the system to all of their email addresses", and for leads, "to try to reactivate them,
 * leads that are dormant". Lists are rules over Raptor's own records, never typed; the count and a
 * sample are shown before anything goes; and an address that has said stop is never sent to.
 *
 * NOTHING HERE IS A DEBTOR. This page reads companies, contacts and leads; it never touches an
 * account and raises no Annexure B fee.
 */
export function NewsPage() {
  const { id } = useParams()
  const { currentUser } = useAuth()
  if (!canSendMarketing(currentUser)) {
    return (
      <Card>
        <p className="text-sm text-slate-600">Sending news and campaigns is not one of your permissions. An administrator can give it to you in Settings → Users.</p>
      </Card>
    )
  }
  return id ? <CampaignEditor id={id} /> : <CampaignList />
}

/* ------------------------------------------------------------------------------------------------
 * The sender, and what the firm must do when it is not set up
 * ---------------------------------------------------------------------------------------------- */

function useSenderConfig() {
  const [config, setConfig] = useState<SenderConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    senderConfig().then((c) => { if (live) setConfig(c) }).catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [])
  return { config, error }
}

/** Whether a campaign of this kind can be sent with the sender as it is set up. */
function kindReady(config: SenderConfig | null, kind: CampaignKind): boolean {
  if (!config) return false
  return isProspectKind(kind) ? !!config.prospect?.ready && !config.missing.includes('RESEND_API_KEY') : config.ready
}

/**
 * WHAT THE FIRM MUST DO BEFORE THIS KIND CAN GO -- news and the prospect kinds have different
 * senders (marketing.ts: three domains), so each names its own missing setting.
 */
function SenderSetup({ config, error, kind = 'news' }: { config: SenderConfig | null; error: string | null; kind?: CampaignKind }) {
  if (error) return <Card className="border-red-200 bg-red-50"><p className="text-sm text-red-700">The sender could not be checked: {error}</p></Card>
  if (!config || kindReady(config, kind)) return null
  const prospect = isProspectKind(kind)
  const missing = prospect
    ? [...(config.missing.includes('RESEND_API_KEY') ? ['RESEND_API_KEY'] : []), ...(config.prospect?.missing ?? []).filter((m) => m !== 'RESEND_API_KEY')]
    : config.missing
  const problem = prospect ? config.prospect?.problem : config.problem
  return (
    <Card className="border-gold-300 bg-gold-50/60">
      <div data-testid={prospect ? 'prospect-setup' : 'sender-setup'}>
        <CardHeader title={prospect ? 'Prospect sending is not set up yet' : 'Sending is not set up yet'}
          subtitle={missing.length
            ? `Nothing will be sent until ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} set. You can write and save campaigns in the meantime.`
            : problem ?? ''} />
        {missing.length > 0 && problem && <p className="text-sm text-red-700 mb-2">{problem}</p>}
        <ol className="list-decimal pl-5 space-y-1.5 text-sm text-slate-700">
          {(prospect ? PROSPECT_SETUP_STEPS : SENDER_SETUP_STEPS).map((s) => <li key={s}>{s}</li>)}
        </ol>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------------------------------------
 * The list of campaigns
 * ---------------------------------------------------------------------------------------------- */

const STATUS_WORDS: Record<CampaignRow['status'], string> = {
  draft: 'Draft', sending: 'Sending', sent: 'Sent', cancelled: 'Cancelled',
}

function CampaignList() {
  const navigate = useNavigate()
  const { config, error: configError } = useSenderConfig()
  const [rows, setRows] = useState<CampaignRow[] | null>(null)
  const [counts, setCounts] = useState<Map<string, CampaignResults>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listCampaigns().then(({ campaigns, counts: c }) => { setRows(campaigns); setCounts(c) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  async function newCampaign(kind: CampaignKind) {
    setBusy(true)
    try {
      const month = clockNow().toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
      const name = kind === 'news' ? `Newsletter ${month}` : kind === 'introduction' ? `Introduction ${month}` : `Prospects ${month}`
      const c = await createCampaign(name, kind)
      navigate(`/news/${c.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <SenderSetup config={config} error={configError} />
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-500 flex-1 min-w-[16rem]">
          News for clients and leads, sent from the firm’s own records. Statements, reports and remittance advices are never sent from here, and an unsubscribe here does not stop them.
        </p>
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => void newCampaign('news')} disabled={busy} data-testid="news-new">
          New news campaign
        </Button>
        <Button icon={<Plus size={15} />} onClick={() => void newCampaign('introduction')} disabled={busy} data-testid="news-new-introduction">
          New introduction
        </Button>
        <Button icon={<Plus size={15} />} onClick={() => void newCampaign('prospect')} disabled={busy} data-testid="news-new-prospect">
          New prospect campaign
        </Button>
      </div>
      <ImportListCard />
      <UndeliveredCard />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Card padded={false}>
        {rows === null ? (
          <p className="p-5 text-sm text-slate-400">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500" data-testid="news-empty">
            <Megaphone className="mx-auto mb-2 text-slate-300" size={28} />
            No campaigns yet. Start one, choose who it goes to, and send yourself a test first.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="news-list">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-2.5 font-medium">Campaign</th>
                  <th className="px-4 py-2.5 font-medium">Goes to</th>
                  <th className="px-4 py-2.5 font-medium">Where it stands</th>
                  <th className="px-4 py-2.5 font-medium text-right">Sent</th>
                  <th className="px-4 py-2.5 font-medium text-right">Delivered</th>
                  <th className="px-4 py-2.5 font-medium text-right">Opened</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const n = counts.get(c.id)
                  return (
                    <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-4 py-2.5">
                        <Link to={`/news/${c.id}`} className="font-medium text-slate-800 hover:text-brand-700">{c.name}</Link>
                        <div className="text-xs text-slate-400 truncate max-w-[22rem]">
                          {CAMPAIGN_KIND_LABELS[c.kind ?? 'news']}{c.subject ? ` · ${c.subject}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{describeAudience(c.audience)}</td>
                      <td className="px-4 py-2.5 text-slate-600">{STATUS_WORDS[c.status]}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                        {n ? `${n.accepted} of ${n.total}` : '—'}
                        {n && (n.bounced + n.complained + n.failed) > 0 && (
                          <div className="text-xs text-slate-400">{[n.failed && `${n.failed} failed`, n.bounced && `${n.bounced} didn’t arrive`, n.complained && `${n.complained} spam reports`].filter(Boolean).join(' · ')}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{n && n.accepted ? withRate(n.delivered, resultRates(n).delivered) : '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{n && n.delivered ? withRate(n.opened, resultRates(n).opened) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------
 * One campaign
 * ---------------------------------------------------------------------------------------------- */

const EXCLUSION_ORDER = ['unsubscribed', 'undeliverable', 'no consent recorded', 'already approached once',
  'already said yes', 'already a client', 'no address', 'address does not look right', 'on the list twice'] as const

/** "12 (40%)": a count with its rate, or the count alone while there is nothing to divide by. */
function withRate(n: number, rate: number | null): string {
  return rate === null ? String(n) : `${n} (${rate}%)`
}

const KIND_EXPLAINED: Record<CampaignKind, string> = {
  news: 'News goes to clients (unless they unsubscribed) and to leads who have said yes, from the news address.',
  introduction: 'One email to leads who have never been asked, with a “Yes, keep me informed” button. Each lead gets an introduction once, ever. Anybody who does not press it is never sent marketing again. It goes from the marketer below, on the separate marketing domain.',
  prospect: 'Marketing to leads who pressed “Yes, keep me informed” (or whose yes is recorded on their lead). From the marketer below, on the separate marketing domain.',
}

function CampaignEditor({ id }: { id: string }) {
  const { currentUser } = useAuth()
  const { config, error: configError } = useSenderConfig()
  const [row, setRow] = useState<CampaignRow | null>(null)
  const [draft, setDraft] = useState<CampaignDraft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [firm, setFirm] = useState<FirmSettings | null>(null)
  const [preview, setPreview] = useState<AudiencePreview | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<{
    sent: number; remaining: number; stoppedFor: string | null; waitingForTomorrow?: number; allowance?: Allowance | null
  } | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const sending = useRef(false)

  const load = useCallback(async () => {
    const c = await getCampaign(id)
    setRow(c)
    if (c) {
      setDraft({
        name: c.name, subject: c.subject, preheader: c.preheader, body: c.body, image_url: c.image_url, audience: c.audience,
        first_approach: c.kind === 'introduction', kind: c.kind ?? 'news', sender_id: c.sender_id ?? c.created_by,
      })
    }
  }, [id])

  useEffect(() => {
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    fetchFirmSettings().then(setFirm).catch(() => setFirm(null))
  }, [load])

  const locked = !!row && row.status !== 'draft'
  const edit = (patch: Partial<CampaignDraft>) => {
    /* The stored first-approach flag follows the kind: the introduction is the only first approach. */
    setDraft((d) => (d ? { ...d, ...patch, first_approach: (patch.kind ?? d.kind) === 'introduction' } : d))
    setDirty(true)
    if ('audience' in patch || 'kind' in patch) setPreview(null)
  }

  async function save(): Promise<boolean> {
    if (!draft || locked) return true
    try {
      await saveCampaign(id, draft)
      setDirty(false)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    }
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError(null); setMessage(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  const checkList = () => run('preview', async () => {
    if (!draft) return
    setPreview(await previewAudience(draft.audience, draft.kind))
  })

  const test = () => run('test', async () => {
    if (!(await save())) return
    const r = await sendTest(id)
    setMessage(`A test went to ${r.sentTo}, marked [Test]. Check it in your inbox before sending to anybody else.`)
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
          waitingForTomorrow: r.waitingForTomorrow, allowance: r.allowance,
        }))
        if (r.remaining === 0) break
        /* A sender at today's allowance: the rest go tomorrow from the sweep. Nothing to wait for here. */
        if ((r.waitingForTomorrow ?? 0) > 0 && r.sent === 0) break
        if (r.stoppedFor) await new Promise((res) => setTimeout(res, 20_000))
      }
      await load()
    } finally {
      sending.current = false
    }
  }, [id, load])

  const send = () => run('send', async () => {
    if (!draft || !preview) return
    if (!(await save())) return
    const what = draft.kind === 'introduction'
      ? `${preview.count} people, each for the first and only time`
      : preview.firstApproaches
        ? `${preview.count} people, ${preview.firstApproaches} of them leads being approached for the first and only time`
        : `${preview.count} people`
    if (!window.confirm(`Send “${draft.subject}” to ${what}? This cannot be called back once it has gone.`)) return
    const r = await queueCampaign(id)
    setProgress({ sent: r.sent, remaining: r.remaining, stoppedFor: r.stoppedFor, waitingForTomorrow: r.waitingForTomorrow, allowance: r.allowance })
    await load()
    void drainLoop()
  })

  /* A campaign already sending when the page opens: carry on driving it. */
  const ready = !!draft && kindReady(config, draft.kind)
  useEffect(() => {
    if (row?.status === 'sending' && ready) void drainLoop()
  }, [row?.status, ready, drainLoop])

  const { users } = useAppStore()
  const marketer = users.find((u) => u.id === draft?.sender_id) ?? null
  /* The From a prospect campaign will carry, worked out by the very function the server sends with. */
  const prospectFrom = draft && isProspectKind(draft.kind) && config?.prospect?.domain
    ? prospectSender(config.prospect.domain, marketer ? { name: marketer.name, email: marketer.email ?? null } : null)
    : null

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
      },
    )
  }, [draft, firm, sampleRecipient])

  if (error && !row) return <Card><p className="text-sm text-red-600">{error}</p></Card>
  if (!row || !draft) return <p className="text-sm text-slate-400">Loading…</p>

  const unknown = unknownMergeFields(`${draft.subject} ${draft.preheader} ${draft.body}`)
  const insertField = (f: string) => {
    const el = bodyRef.current
    const token = `{{${f}}}`
    if (!el) { edit({ body: draft.body + token }); return }
    const at = el.selectionStart ?? draft.body.length
    edit({ body: draft.body.slice(0, at) + token + draft.body.slice(el.selectionEnd ?? at) })
  }
  const senderProblem = prospectFrom && 'error' in prospectFrom ? prospectFrom.error : null
  const canSend = !locked && ready && !senderProblem && !!preview && preview.count > 0 && !!draft.subject.trim() && !!draft.body.trim() && unknown.length === 0

  return (
    <div className="space-y-4" data-testid="news-editor">
      <Link to="/news" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> All campaigns</Link>
      <SenderSetup config={config} error={configError} kind={draft.kind} />
      {locked && (
        <Card className="bg-slate-50">
          <p className="text-sm text-slate-600" data-testid="news-locked">
            {row.status === 'sending' ? 'Sending now.' : row.status === 'sent' ? 'Sent.' : 'Cancelled.'}{' '}
            {row.recipient_count ? `${row.recipient_count} on the list. ` : ''}A campaign that has gone out is a record of what was sent and cannot be edited.
            {progress && ` ${progress.sent} sent so far${progress.remaining ? `, ${progress.remaining} still to go` : ''}.`}
            {progress?.stoppedFor && !progress.waitingForTomorrow && ` Paused: ${progress.stoppedFor}`}
          </p>
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

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="The message" subtitle="A blank line starts a new paragraph. **Two asterisks** make bold. [Words](https://…) or a bare https:// address make a link." />
          <fieldset disabled={locked} className="space-y-3">
            <Field label="Kind">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind">
                {(Object.keys(CAMPAIGN_KIND_LABELS) as CampaignKind[]).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={draft.kind === k} data-testid={`news-kind-${k}`}
                    onClick={() => edit({
                      kind: k,
                      /* A prospect kind goes to leads only: a client list is swapped for an imported one. */
                      ...(isProspectKind(k) && !LEAD_AUDIENCES.includes(draft.audience.kind) ? { audience: { kind: 'imported_list', listIds: [] } } : {}),
                    })}
                    className={`text-xs font-medium px-3 py-1.5 rounded-lg border ${draft.kind === k ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    {CAMPAIGN_KIND_LABELS[k]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-1.5" data-testid="news-kind-explained">{KIND_EXPLAINED[draft.kind]}</p>
            </Field>
            {isProspectKind(draft.kind) && (
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
            <Field label="Campaign name (for us, never shown)">
              <input className={INPUT} value={draft.name} onChange={(e) => edit({ name: e.target.value })} />
            </Field>
            <Field label="Subject">
              <input className={INPUT} value={draft.subject} onChange={(e) => edit({ subject: e.target.value })} data-testid="news-subject" />
            </Field>
            <Field label="Preheader (the line an inbox shows after the subject)">
              <input className={INPUT} value={draft.preheader} onChange={(e) => edit({ preheader: e.target.value })} />
            </Field>
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
              <textarea ref={bodyRef} className={`${INPUT} min-h-[16rem] font-[Georgia,serif]`} value={draft.body}
                onChange={(e) => edit({ body: e.target.value })} data-testid="news-body"
                placeholder={'Dear {{first_name}},\n\nWhat we want to tell you…\n\nKind regards'} />
            </Field>
            {unknown.length > 0 && (
              <p className="text-xs text-red-600">Raptor does not know {unknown.map((u) => `{{${u}}}`).join(', ')}. Only {MERGE_FIELDS.map((f) => `{{${f}}}`).join(' and ')} are filled in.</p>
            )}
          </fieldset>
          {!locked && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => void run('save', async () => { if (await save()) setMessage('Saved.') })} disabled={!dirty || !!busy}>Save draft</Button>
              <Button onClick={() => void test()} disabled={!ready || !!senderProblem || !!busy} data-testid="news-test">Send a test to me</Button>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="How it reads" subtitle={`As ${sampleRecipient.firstName ?? 'somebody with no first name on file'} will see it, in the firm’s own face.`} />
          {rendered && (
            <>
              <p className="text-sm font-medium text-slate-800 mb-2" data-testid="news-preview-subject">{rendered.subject || <span className="text-slate-400">No subject yet</span>}</p>
              <iframe title="Preview" sandbox="" srcDoc={rendered.html} className="w-full h-[28rem] rounded-lg border border-slate-200 bg-white" data-testid="news-preview" />
            </>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Who it goes to" subtitle="Drawn from Raptor’s own clients, contacts and leads when it is sent. Anybody who has unsubscribed is left out, always." />
        <fieldset disabled={locked}>
          <AudiencePicker audience={draft.audience} onChange={(audience) => edit({ audience })} leadsOnly={isProspectKind(draft.kind)} />
        </fieldset>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => void checkList()} disabled={!!busy} data-testid="news-check">{busy === 'preview' ? 'Counting…' : 'Count who gets it'}</Button>
          {!locked && (
            <Button variant="primary" icon={<Send size={14} />} disabled={!canSend || !!busy} onClick={() => void send()} data-testid="news-send">
              {preview ? `Send to ${preview.count} ${preview.count === 1 ? 'person' : 'people'}` : 'Count first, then send'}
            </Button>
          )}
        </div>
        {preview && <PreviewList preview={preview} kind={draft.kind} />}
      </Card>

      {locked && <ResultsPanel campaignId={id} kind={draft.kind} live={row.status === 'sending'} />}

      {message && <p className="text-sm text-emerald-700" data-testid="news-message">{message}</p>}
      {error && <p className="text-sm text-red-600" data-testid="news-error">{error}</p>}
    </div>
  )
}

const INPUT = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 disabled:bg-slate-50'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  )
}

function PreviewList({ preview, kind }: { preview: AudiencePreview; kind: CampaignKind }) {
  const left = EXCLUSION_ORDER.filter((k) => preview.excluded[k])
  return (
    <div className="mt-4 space-y-3" data-testid="news-preview-list">
      <p className="text-sm text-slate-700">
        <b data-testid="news-count">{preview.count}</b> {preview.count === 1 ? 'address' : 'addresses'}, each once
        {kind !== 'introduction' && preview.firstApproaches > 0 && <>, of which {preview.firstApproaches} {preview.firstApproaches === 1 ? 'is a lead' : 'are leads'} being approached for the first and only time</>}.
      </p>
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

/* ------------------------------------------------------------------------------------------------
 * The audience
 * ---------------------------------------------------------------------------------------------- */

const STATUSES: LeadStatus[] = ['No Contact Yet', 'Interested', 'Hot Lead', 'Rejected']

function AudiencePicker({ audience, onChange, leadsOnly = false }: { audience: Audience; onChange: (a: Audience) => void; leadsOnly?: boolean }) {
  const pick = (kind: Audience['kind']) => {
    switch (kind) {
      case 'all_clients': onChange({ kind }); break
      case 'active_leads': onChange({ kind }); break
      case 'clients_by_service': onChange({ kind, services: [] }); break
      case 'dormant_leads': onChange({ kind, days: DEFAULT_DORMANT_DAYS, includeLost: true }); break
      case 'leads_by': onChange({ kind, statuses: [...ACTIVE_LEAD_STATUSES], sources: [] }); break
      case 'manual': onChange({ kind, picks: [] }); break
      case 'imported_list': onChange({ kind, listIds: [] }); break
    }
  }
  const kinds = (Object.keys(AUDIENCE_LABELS) as Audience['kind'][]).filter((k) => !leadsOnly || LEAD_AUDIENCES.includes(k))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="List">
        {kinds.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={audience.kind === k} onClick={() => pick(k)}
            data-testid={`news-audience-${k}`}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg border ${audience.kind === k ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            {AUDIENCE_LABELS[k]}
          </button>
        ))}
      </div>
      {audience.kind === 'all_clients' && <p className="text-xs text-slate-500">Every client’s own address and every contact on it or its sub-accounts. Clients are sent our news unless they have unsubscribed.</p>}
      {audience.kind === 'clients_by_service' && (
        <MultiSelectChips options={SERVICES} value={audience.services} onChange={(services) => onChange({ ...audience, services })} />
      )}
      {audience.kind === 'active_leads' && <p className="text-xs text-slate-500">Leads still open: {ACTIVE_LEAD_STATUSES.join(', ')}.</p>}
      {audience.kind === 'dormant_leads' && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
          <label className="flex items-center gap-2">
            Nothing done and no change of status for
            <input type="number" min={1} max={3650} value={audience.days} data-testid="news-dormant-days"
              onChange={(e) => onChange({ ...audience, days: Math.max(1, Math.round(Number(e.target.value) || DEFAULT_DORMANT_DAYS)) })}
              className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm" />
            days
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={audience.includeLost} onChange={(e) => onChange({ ...audience, includeLost: e.target.checked })} />
            Include lost leads (never the ones we declined)
          </label>
        </div>
      )}
      {audience.kind === 'leads_by' && (
        <div className="space-y-2">
          <div><span className="block text-xs text-slate-500 mb-1">Status</span><MultiSelectChips options={STATUSES} value={audience.statuses} onChange={(statuses) => onChange({ ...audience, statuses })} /></div>
          <div><span className="block text-xs text-slate-500 mb-1">Source (none chosen means any)</span><MultiSelectChips options={leadSources} value={audience.sources} onChange={(sources) => onChange({ ...audience, sources })} /></div>
        </div>
      )}
      {audience.kind === 'manual' && <ManualPicker audience={audience} onChange={onChange} />}
      {audience.kind === 'imported_list' && <ListPicker audience={audience} onChange={onChange} />}
    </div>
  )
}

function ManualPicker({ audience, onChange }: { audience: Extract<Audience, { kind: 'manual' }>; onChange: (a: Audience) => void }) {
  const { companies, contacts, leads } = useAppStore()
  const [q, setQ] = useState('')
  const options = useMemo(() => [
    ...companies.filter((c) => c.email).map((c) => ({ type: 'company' as const, id: c.id, label: c.name, email: c.email ?? '' })),
    ...contacts.filter((c) => c.email).map((c) => ({ type: 'contact' as const, id: c.id, label: `${c.firstName} ${c.lastName}`, email: c.email ?? '' })),
    ...leads.filter((l) => l.email && l.status !== 'Converted').map((l) => ({ type: 'lead' as const, id: l.id, label: `${l.firstName} ${l.lastName} · ${l.companyName}`, email: l.email ?? '' })),
  ], [companies, contacts, leads])
  const picked = new Set(audience.picks.map((p) => `${p.type}:${p.id}`))
  const needle = q.trim().toLowerCase()
  const found = needle ? options.filter((o) => `${o.label} ${o.email}`.toLowerCase().includes(needle) && !picked.has(`${o.type}:${o.id}`)).slice(0, 8) : []
  const labelOf = (p: { type: string; id: string }) => options.find((o) => o.type === p.type && o.id === p.id)
  return (
    <div className="space-y-2">
      <input className={INPUT} placeholder="Find a client, contact or lead…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="news-manual-search" />
      {found.length > 0 && (
        <ul className="border border-slate-100 rounded-lg divide-y divide-slate-100 text-sm">
          {found.map((o) => (
            <li key={`${o.type}:${o.id}`}>
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-slate-50"
                onClick={() => { onChange({ ...audience, picks: [...audience.picks, { type: o.type, id: o.id }] }); setQ('') }}>
                {o.label} <span className="text-slate-400">{o.email} · {o.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5">
        {audience.picks.map((p) => (
          <span key={`${p.type}:${p.id}`} className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-700 rounded-md px-2 py-1">
            {labelOf(p)?.label ?? 'Removed record'}
            <button type="button" aria-label="Remove" className="text-slate-400 hover:text-slate-700"
              onClick={() => onChange({ ...audience, picks: audience.picks.filter((x) => !(x.type === p.type && x.id === p.id)) })}>×</button>
          </span>
        ))}
      </div>
      <p className="text-xs text-slate-500">A lead picked by hand still needs consent, or the first-approach box below.</p>
    </div>
  )
}

function ListPicker({ audience, onChange }: { audience: Extract<Audience, { kind: 'imported_list' }>; onChange: (a: Audience) => void }) {
  const [lists, setLists] = useState<MarketingList[] | null>(null)
  useEffect(() => { listLists().then(setLists).catch(() => setLists([])) }, [])
  if (lists === null) return <p className="text-xs text-slate-400">Loading lists…</p>
  if (!lists.length) return <p className="text-xs text-slate-500">No list has been imported yet. Import one on the campaigns page.</p>
  const picked = new Set(audience.listIds)
  return (
    <div className="space-y-1" data-testid="news-list-picker">
      {lists.map((l) => (
        <label key={l.id} className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={picked.has(l.id)}
            onChange={(e) => onChange({ ...audience, listIds: e.target.checked ? [...audience.listIds, l.id] : audience.listIds.filter((x) => x !== l.id) })} />
          {l.name} <span className="text-xs text-slate-400">{l.lead_count} leads · {new Date(l.uploaded_at).toLocaleDateString('en-ZA')}</span>
        </label>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Results -- "the success of what's been delivered, what was undelivered, what was opened"
 * ---------------------------------------------------------------------------------------------- */

const STATE_WORDS: Record<RecipientRow['state'], string> = {
  queued: 'Waiting', sending: 'Sending', sent: 'Sent', failed: 'Failed', skipped: 'Not sent', bounced: 'Didn’t arrive', complained: 'Marked as spam',
}

type RecipientFilter = 'all' | 'undelivered' | 'opened' | 'unopened' | 'clicked'

function ResultsPanel({ campaignId, kind, live }: { campaignId: string; kind: CampaignKind; live: boolean }) {
  const [results, setResults] = useState<CampaignResults | null>(null)
  const [rows, setRows] = useState<RecipientRow[] | null>(null)
  const [filter, setFilter] = useState<RecipientFilter>('all')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => Promise.all([campaignResults(campaignId), campaignRecipients(campaignId)])
      .then(([r, list]) => { if (alive) { setResults(r); setRows(list) } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    void load()
    /* While it is sending, and for a while after, the webhook keeps filling these in. */
    const t = live ? window.setInterval(() => void load(), 15_000) : undefined
    return () => { alive = false; if (t) window.clearInterval(t) }
  }, [campaignId, live])
  if (error) return <Card><p className="text-sm text-red-600">{error}</p></Card>
  if (!results || !rows) return <Card><p className="text-sm text-slate-400">Loading results…</p></Card>
  const rates = resultRates(results)
  const tiles: { label: string; value: number; rate: number | null; testid: string; of?: string }[] = [
    { label: 'Sent', value: results.accepted, rate: null, testid: 'sent' },
    { label: 'Delivered', value: results.delivered, rate: rates.delivered, testid: 'delivered', of: 'of sent' },
    { label: 'Didn’t arrive', value: results.bounced, rate: rates.bounced, testid: 'bounced', of: 'of sent' },
    { label: 'Opened', value: results.opened, rate: rates.opened, testid: 'opened', of: 'of delivered' },
    { label: 'Clicked', value: results.clicked, rate: rates.clicked, testid: 'clicked', of: 'of delivered' },
    { label: 'Unsubscribed', value: results.unsubscribed, rate: rates.unsubscribed, testid: 'unsubscribed', of: 'of delivered' },
    { label: 'Marked as spam', value: results.complained, rate: rates.complained, testid: 'complained', of: 'of delivered' },
    ...(kind === 'introduction' ? [{ label: 'Opted in', value: results.opted_in, rate: rates.optedIn, testid: 'opted-in', of: 'of delivered' }] : []),
  ]
  const shown = rows.filter((r) => filter === 'all'
    || (filter === 'undelivered' && ['bounced', 'failed', 'skipped'].includes(r.state))
    || (filter === 'opened' && !!r.first_opened_at)
    || (filter === 'unopened' && !r.first_opened_at && r.state === 'sent')
    || (filter === 'clicked' && !!r.first_clicked_at))
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
  return (
    <Card>
      <div data-testid="news-results">
        <CardHeader title="What happened to it" subtitle={`Of ${results.total} on the list${results.queued ? `, ${results.queued} not sent yet` : ''}${results.skipped ? `, ${results.skipped} not sent (unsubscribed or no longer allowed)` : ''}${results.failed ? `, ${results.failed} failed` : ''}.`} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {tiles.map((t) => (
            <div key={t.testid} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2" data-testid={`news-result-${t.testid}`}>
              <div className="text-xs text-slate-500">{t.label}</div>
              <div className="text-lg font-semibold tabular-nums text-slate-800">{t.value}</div>
              <div className="text-xs text-slate-400">{t.rate === null ? (t.of ? '—' : '\u00a0') : `${t.rate}% ${t.of}`}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500" data-testid="news-opens-note">{OPENS_ARE_APPROXIMATE}</p>
        {results.delayed > 0 && <p className="mt-1 text-xs text-slate-500">{results.delayed} delayed: the receiving server has not taken them yet, and Resend is still trying.</p>}
        <div className="mt-4 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Show">
          {([['all', 'Everybody'], ['undelivered', 'Not delivered'], ['opened', 'Opened'], ['unopened', 'Not opened'], ['clicked', 'Clicked']] as [RecipientFilter, string][]).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={filter === k} onClick={() => setFilter(k)} data-testid={`news-recipients-${k}`}
              className={`text-xs px-2.5 py-1 rounded-md border ${filter === k ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-600'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm" data-testid="news-recipients">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="px-2 py-1.5 font-medium">Who</th>
                <th className="px-2 py-1.5 font-medium">Where it stands</th>
                <th className="px-2 py-1.5 font-medium">Delivered</th>
                <th className="px-2 py-1.5 font-medium">Opened</th>
                <th className="px-2 py-1.5 font-medium">Clicked</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="px-2 py-1.5"><div className="text-slate-800">{r.email}</div><div className="text-xs text-slate-400">{[r.first_name, r.company_name].filter(Boolean).join(' · ')}</div></td>
                  <td className="px-2 py-1.5 text-slate-600">
                    {STATE_WORDS[r.state]}
                    {r.opted_in_at && <span className="ml-1 text-xs text-emerald-700">· said yes</span>}
                    {r.unsubscribed_at && <span className="ml-1 text-xs text-slate-500">· unsubscribed</span>}
                    {r.error && r.state !== 'sent' && <div className="text-xs text-slate-400">{r.error}</div>}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-slate-500">{day(r.delivered_at)}</td>
                  <td className="px-2 py-1.5 text-xs text-slate-500">{r.first_opened_at ? `${day(r.first_opened_at)}${r.open_count > 1 ? ` · ${r.open_count}×` : ''}` : ''}</td>
                  <td className="px-2 py-1.5 text-xs text-slate-500">{r.first_clicked_at ? `${day(r.first_clicked_at)}${r.click_count > 1 ? ` · ${r.click_count}×` : ''}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length >= RECIPIENT_PAGE && <p className="text-xs text-slate-400 mt-1">The first {RECIPIENT_PAGE} by address. The counts above are the whole campaign.</p>}
        </div>
      </div>
    </Card>
  )
}
