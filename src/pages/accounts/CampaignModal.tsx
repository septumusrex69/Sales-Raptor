import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Mail, MessageSquare } from 'lucide-react'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { fetchLibrary, type LibraryTemplate } from '../../lib/templateLibrary'
import { groupedFields } from '../../lib/messageTemplates.ts'
import {
  campaignConfirmation, campaignWordingProblem, type CampaignChannel,
} from '../../lib/campaigns.ts'
import {
  campaignAccountIds, createCampaign, previewCampaign, type CampaignPreview,
} from '../../lib/campaignApi'
import { emailBodyCss } from '../../lib/emailStyle.ts'
import { fetchFirmSettings } from '../../lib/firmSettings'
import { rand } from '../../lib/money'
import type { Selection } from '../../lib/accountAllocation'

/**
 * THE CAMPAIGN BOX: one SMS or one email to the accounts ticked on the list, or to everything the
 * filters match (S10, 21 Oct).
 *
 * THREE STEPS, AND THE MIDDLE ONE IS THE POINT. Write it (or take it from the library); then see
 * what would actually happen -- one real account's message merged exactly as it will go, how many
 * will be sent, how many skipped and WHY, and what it is estimated to cost the debtors; then a
 * sentence reading the numbers back, like Add client's, before anything leaves.
 *
 * NOTHING ON THIS SCREEN DECIDES. The preview and the counts are the server's (api/_lib/campaign),
 * which asks the same campaigns.ts the sender asks -- so the count on the confirm step is the count
 * the sender works from, and a team leader's selection reaching another team's desk is refused by
 * the server whatever this box drew.
 */
export function CampaignModal({ selection, selectedCount, onClose, onStarted }: {
  selection: Selection
  selectedCount: number
  onClose: () => void
  onStarted: (campaignId: string, name: string) => void
}) {
  const [step, setStep] = useState<'compose' | 'preview' | 'confirm'>('compose')
  const [channel, setChannel] = useState<CampaignChannel>('sms')
  const [library, setLibrary] = useState<LibraryTemplate[]>([])
  const [templateId, setTemplateId] = useState<string>('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [name, setName] = useState('')
  const [ids, setIds] = useState<string[] | null>(null)
  const [preview, setPreview] = useState<CampaignPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailCss, setEmailCss] = useState<Record<string, string> | undefined>(undefined)

  /* THE ACCOUNTS, ONCE, as the list's own clauses resolve them. A failure here is the hand-out's
     own refusal ("N match but the database returned M") and is shown rather than worked round. */
  useEffect(() => {
    let live = true
    campaignAccountIds(selection)
      .then((r) => { if (live) setIds(r) })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [selection])

  useEffect(() => {
    let live = true
    fetchLibrary('collections').then((rows) => { if (live) setLibrary(rows) }).catch(() => {})
    fetchFirmSettings().then((s) => { if (live) setEmailCss(emailBodyCss(s)) }).catch(() => {})
    return () => { live = false }
  }, [])

  /* Only what can be a campaign: this channel, live, and no notice attached -- a statutory notice is
     a workflow step, and campaignWordingProblem refuses it if somebody gets one here anyway. */
  const offered = useMemo(
    () => library.filter((t) => t.kind === channel && t.active && !t.attachmentId),
    [library, channel],
  )
  const template = library.find((t) => t.id === templateId) ?? null
  const wordingProblem = campaignWordingProblem({
    channel, subject: channel === 'email' ? subject : null, body,
    template: template ? { kind: template.kind, scope: template.scope, active: template.active, attachmentId: template.attachmentId } : null,
  })
  const fields = useMemo(() => groupedFields('collections').flatMap((g) => g.fields), [])

  const draft = () => ({
    channel, templateId: templateId || null, subject: channel === 'email' ? subject : null, body,
  })

  const pickTemplate = (id: string) => {
    setTemplateId(id)
    const t = library.find((x) => x.id === id)
    if (t) {
      setBody(t.body)
      setSubject(t.subject ?? '')
      if (!name.trim()) setName(t.name)
    }
  }

  const switchChannel = (c: CampaignChannel) => {
    if (c === channel) return
    setChannel(c); setTemplateId(''); setPreview(null)
  }

  async function runPreview() {
    if (!ids) return
    setBusy(true); setError(null)
    try {
      setPreview(await previewCampaign(draft(), ids))
      setStep('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  async function start() {
    if (!ids) return
    setBusy(true); setError(null)
    try {
      const made = await createCampaign(draft(), ids, name, selection)
      onStarted(made.campaignId, name.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const blocker = !preview ? null
    : preview.wordingProblem
      ?? (preview.outOfScope > 0
        ? `${preview.outOfScope.toLocaleString('en-ZA')} of these accounts ${preview.outOfScope === 1 ? 'is' : 'are'} not on your team’s desks. A team leader runs a campaign on their own team’s accounts — narrow the selection.`
        : null)
      ?? (channel === 'email' && !preview.mailbox
        ? 'Your mailbox is not connected. An email campaign goes from your own mailbox so the replies come back to you — connect it in Settings first.'
        : null)
      ?? (preview.sending === 0 ? 'Every selected account is skipped, so there is nothing to send.' : null)

  const what = channel === 'sms' ? 'SMS' : 'email'
  const subtitle = `${selectedCount.toLocaleString('en-ZA')} ${selectedCount === 1 ? 'account' : 'accounts'} selected`

  /* ------------------------------------------------------------------ confirm */
  if (step === 'confirm' && preview) {
    return (
      <Modal title="Start this campaign?" subtitle={subtitle} onClose={onClose} width={560}>
        <div className="space-y-4" data-testid="campaign-confirm">
          <div className="rounded-lg border border-gold-500 bg-gold-50 p-3.5 text-sm text-navy-950" data-testid="campaign-confirm-words">
            {campaignConfirmation({
              name, channel, sending: preview.sending, skipped: preview.skipped + (preview.selected - preview.found),
              estimate: preview.estimate, money: rand, from: preview.mailbox,
            })}
          </div>
          {preview.hoursProblem && (
            <p className="text-xs text-slate-500">Right now: {preview.hoursProblem} Nothing goes until then.</p>
          )}
          {error && <p className="text-sm text-negative-700">{error}</p>}
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={start} disabled={busy} data-testid="campaign-start"
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-gold-400 text-navy-950 border border-gold-500 disabled:opacity-40">
              {busy ? 'Starting…' : `Send the ${what} to ${preview.sending.toLocaleString('en-ZA')}`}
            </button>
            <button type="button" onClick={() => setStep('preview')} disabled={busy}
              className="text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600">
              Go back
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  /* ------------------------------------------------------------------ preview */
  if (step === 'preview' && preview) {
    const sample = preview.sample
    return (
      <Modal title={`Campaign: what would happen`} subtitle={subtitle} onClose={onClose} width={640}>
        <div className="space-y-4" data-testid="campaign-preview">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Will be sent</p>
              <p className="text-xl font-semibold text-navy-950 tabular-nums" data-testid="campaign-will-send">
                {preview.sending.toLocaleString('en-ZA')}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Skipped</p>
              <p className="text-xl font-semibold text-navy-950 tabular-nums" data-testid="campaign-skipped">
                {(preview.skipped + (preview.selected - preview.found)).toLocaleString('en-ZA')}
              </p>
            </div>
          </div>

          {(preview.skips.length > 0 || preview.selected > preview.found) && (
            <ul className="text-[13px] text-slate-600 space-y-0.5" data-testid="campaign-skip-reasons">
              {preview.skips.map((s) => (
                <li key={s.words}><span className="tabular-nums font-medium">{s.count.toLocaleString('en-ZA')}</span> · {s.words}</li>
              ))}
              {preview.selected > preview.found && (
                <li><span className="tabular-nums font-medium">{(preview.selected - preview.found).toLocaleString('en-ZA')}</span> · No longer in the book</li>
              )}
            </ul>
          )}

          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">
              {sample ? `What ${sample.debtor ?? 'one debtor'}${sample.caseNumber ? ` (${sample.caseNumber})` : ''} would get` : 'The message'}
            </p>
            {!sample ? (
              <p className="text-[13px] text-slate-500">There is no account to show it on.</p>
            ) : channel === 'sms' ? (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3" data-testid="campaign-sample">
                <p className="text-sm text-slate-800 whitespace-pre-wrap">{sample.text}</p>
                <p className="mt-2 text-[11px] text-slate-500">
                  {sample.segments} {sample.segments === 1 ? 'segment' : 'segments'} · {sample.encoding}
                  {sample.encoding === 'UCS-2' && ' — a character in the wording costs the debtor double; see the SMS box’s warning'}
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 p-3" data-testid="campaign-sample">
                <p className="text-[13px] text-slate-500 mb-2">Subject: <span className="text-slate-800">{sample.subject}</span></p>
                {/* emailBodyHtml's output: escaped, paragraphs as the debtor's inbox draws them. */}
                <div style={emailCss} dangerouslySetInnerHTML={{ __html: sample.html ?? '' }} />
              </div>
            )}
            {sample && sample.missing.length > 0 && (
              <p className="mt-1.5 text-xs text-negative-700">
                Nothing on this account fills {sample.missing.map((f) => `{{${f}}}`).join(', ')}. An account like
                this is skipped when its turn comes, never sent with the brackets in it.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 p-3 text-[13px] text-slate-700" data-testid="campaign-fee">
            <p>
              <span className="font-medium">About {rand(preview.estimate.total)}</span> excluding VAT, charged to the debtors’
              accounts: {preview.sending.toLocaleString('en-ZA')} × {rand(preview.estimate.perMessage)} under Annexure B
              item {preview.estimate.item === '1a' ? '1(a)' : '1(c)'}
              {channel === 'sms' && sample?.segments ? ` (${sample.segments} ${sample.segments === 1 ? 'segment' : 'segments'} each)` : ''}.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              An estimate. Each fee is raised as its message goes, on {preview.estimate.citation}: an account at the
              in duplum ceiling or written off is charged nothing
              {channel === 'sms' && (preview.estimate.monthlyLimit !== null
                ? `, and past ${preview.estimate.monthlyLimit} SMSs in a month the message still goes but earns nothing (${preview.atMonthlyLimit.toLocaleString('en-ZA')} already there)`
                : '')}
              {channel === 'sms' && ', and a longer name elsewhere can make a message a segment longer'}.
            </p>
          </div>

          <p className="text-xs text-slate-500">
            {channel === 'email' && preview.mailbox && <>From your mailbox, <span className="text-slate-700">{preview.mailbox}</span>, so replies come back to you and onto each account. </>}
            Sent only in the firm’s calling hours: weekdays 08:00–17:00 and Saturdays 09:00–13:00, never on a Sunday or a public holiday.
            {preview.hoursProblem ? ` Right now: ${preview.hoursProblem}` : ''}
          </p>

          {blocker && (
            <p className="flex items-start gap-2 text-sm text-negative-700" data-testid="campaign-blocker">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {blocker}
            </p>
          )}
          {error && <p className="text-sm text-negative-700">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button type="button" disabled={!!blocker || !name.trim()} onClick={() => setStep('confirm')}
              data-testid="campaign-continue"
              className="text-sm font-medium px-4 py-2 rounded-lg bg-navy-950 text-white disabled:opacity-40">
              Continue
            </button>
            <button type="button" onClick={() => setStep('compose')}
              className="text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600">
              Change the message
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  /* ------------------------------------------------------------------ compose */
  return (
    <Modal title="Run a campaign" subtitle={subtitle} onClose={onClose} width={600}>
      <div data-testid="campaign-compose">
        <div className="flex gap-2 mb-4">
          {(['sms', 'email'] as const).map((c) => (
            <button key={c} type="button" onClick={() => switchChannel(c)} data-testid={`campaign-channel-${c}`}
              className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg border px-3 py-1.5 ${
                channel === c ? 'border-navy-950 bg-navy-950 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              {c === 'sms' ? <MessageSquare size={14} /> : <Mail size={14} />} {c === 'sms' ? 'SMS' : 'Email'}
            </button>
          ))}
        </div>

        <FormField label="From the library">
          <select className={inputClass} value={templateId} onChange={(e) => pickTemplate(e.target.value)} data-testid="campaign-template">
            <option value="">Type my own</option>
            {offered.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.audience ? ` (${t.audience === 'company' ? 'companies' : 'individuals'})` : ''}</option>
            ))}
          </select>
        </FormField>

        {channel === 'email' && (
          <FormField label="Subject" required>
            <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="campaign-subject" />
          </FormField>
        )}

        <FormField label="Message" required>
          <textarea className={`${inputClass} min-h-[140px]`} value={body} onChange={(e) => setBody(e.target.value)}
            data-testid="campaign-body"
            placeholder={channel === 'sms' ? 'Dear {{debtor_name}}, ...' : 'A blank line starts a new paragraph.'} />
        </FormField>
        <div className="-mt-2 mb-3 flex items-center gap-2 text-xs text-slate-500">
          <span>Insert a field</span>
          <select className="text-xs border border-slate-200 rounded px-1.5 py-1 bg-white" value=""
            onChange={(e) => { if (e.target.value) setBody((b) => `${b}{{${e.target.value}}}`) }}>
            <option value="">…</option>
            {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>

        <FormField label="Campaign name" required>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
            placeholder="So it can be found and stopped" data-testid="campaign-name" />
        </FormField>

        {body.trim() && wordingProblem && <p className="text-sm text-negative-700 mb-2">{wordingProblem}</p>}
        {error && <p className="text-sm text-negative-700 mb-2">{error}</p>}

        <div className="flex items-center gap-2">
          <button type="button" onClick={runPreview} disabled={busy || !ids || !!wordingProblem || !name.trim()}
            data-testid="campaign-preview-go"
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-navy-950 text-white disabled:opacity-40">
            {(busy || !ids) && !error && <Loader2 size={14} className="animate-spin" />}
            {!ids && !error ? 'Finding the accounts…' : 'See what would happen'}
          </button>
          <span className="text-xs text-slate-500">Nothing is sent until you confirm.</span>
        </div>
      </div>
    </Modal>
  )
}
