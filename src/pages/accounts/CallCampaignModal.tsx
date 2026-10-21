import { useState } from 'react'
import { AlertTriangle, Loader2, Phone } from 'lucide-react'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import {
  DEFAULT_SPREAD_RANK, NOW_RANK, SPREAD_RANKS, callConfirmation, type CallMode,
} from '../../lib/callCampaign.ts'
import { createCallCampaign, previewCallCampaign, type CallPreview } from '../../lib/campaignApi'
import { formatDate } from '../../data/mockData'
import type { Selection } from '../../lib/accountAllocation'

/**
 * A CALL CAMPAIGN: the selected accounts onto their collectors' diaries (S10, 21 Oct).
 *
 * THE TWO WAYS, side by side, because choosing between them is the decision: NOW puts every call
 * on today above everything else on the diary; SPREAD runs to an end date at a place on the day the
 * person chooses, filling each collector's free room. callCampaign.ts says why.
 *
 * NOTHING HERE DECIDES, as with the SMS and email box: the preview -- who gets how many, who goes
 * over their day, what does not fit -- is the server's, and the server asks again on create.
 */
export function CallCampaignModal({ selection, selectedCount, ids, onClose, onBack, onStarted }: {
  selection: Selection
  selectedCount: number
  /** The accounts, already resolved by the campaign box. */
  ids: string[] | null
  onClose: () => void
  onBack: () => void
  onStarted: (campaignId: string, name: string) => void
}) {
  const [step, setStep] = useState<'compose' | 'preview'>('compose')
  const [mode, setMode] = useState<CallMode>('spread')
  const [rank, setRank] = useState(DEFAULT_SPREAD_RANK)
  const [endsOn, setEndsOn] = useState('')
  const [script, setScript] = useState('')
  const [name, setName] = useState('')
  const [preview, setPreview] = useState<CallPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const draft = () => ({ mode, rank: mode === 'now' ? NOW_RANK : rank, endsOn: mode === 'now' ? null : endsOn || null, script })
  const subtitle = `${selectedCount.toLocaleString('en-ZA')} ${selectedCount === 1 ? 'account' : 'accounts'} selected`
  const ready = !!ids && !!script.trim() && !!name.trim() && (mode === 'now' || !!endsOn)

  async function runPreview() {
    if (!ids) return
    setBusy(true); setError(null)
    try { setPreview(await previewCallCampaign(draft(), ids)); setStep('preview') }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  async function start() {
    if (!ids) return
    setBusy(true); setError(null)
    try {
      const made = await createCallCampaign(draft(), ids, name, selection)
      onStarted(made.campaignId, name.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  if (step === 'preview' && preview) {
    const blocker = preview.dateProblem
      ?? (preview.outOfScope > 0
        ? `${preview.outOfScope.toLocaleString('en-ZA')} of these accounts ${preview.outOfScope === 1 ? 'is' : 'are'} outside what you may campaign on — your team’s desks, or your own clients. Narrow the selection.`
        : null)
      ?? (preview.placing === 0 ? 'No call can be placed: every account is skipped, or no diary has room before the end date.' : null)
    const skipped = preview.skipped + (preview.selected - preview.found)
    return (
      <Modal title="Call campaign: what would happen" subtitle={subtitle} onClose={onClose} width={620}>
        <div className="space-y-4" data-testid="call-campaign-preview">
          <div className="grid grid-cols-3 gap-3">
            <Figure label="Calls placed" value={preview.placing} testid="call-placing" />
            <Figure label="Skipped" value={skipped} />
            <Figure label="No room before the end" value={preview.unplaced} testid="call-unplaced" />
          </div>
          {preview.skips.length > 0 && (
            <ul className="text-[13px] text-slate-600 space-y-0.5">
              {preview.skips.map((s) => (
                <li key={s.words}><span className="tabular-nums font-medium">{s.count.toLocaleString('en-ZA')}</span> · {s.words}</li>
              ))}
            </ul>
          )}
          {preview.collectors.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">On whose diary</p>
              <ul className="text-[13px] text-slate-700 divide-y divide-slate-100 rounded-lg border border-slate-200" data-testid="call-collectors">
                {preview.collectors.map((c) => (
                  <li key={c.name} className="flex items-center justify-between px-3 py-1.5">
                    <span>{c.name}</span>
                    <span className="tabular-nums text-slate-600">
                      {c.calls.toLocaleString('en-ZA')} {c.calls === 1 ? 'call' : 'calls'}
                      {c.over > 0 && <span className="text-negative-700"> · {c.over} over their day</span>}
                      {c.unplaced > 0 && <span className="text-negative-700"> · {c.unplaced} do not fit</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="rounded-lg border border-gold-500 bg-gold-50 p-3.5 text-sm text-navy-950" data-testid="call-confirm-words">
            {callConfirmation({
              name: name.trim(), mode, rank, endsOn: preview.endsOn, placing: preview.placing,
              collectors: preview.collectors.filter((c) => c.calls > 0).length, skipped,
              unplaced: preview.unplaced, overCollectors: preview.overCollectors, endWords: formatDate(preview.endsOn),
            })}
          </div>
          <p className="text-xs text-slate-500">
            No fee is raised for being on a campaign. A consultation the call leads to is charged as on any other call.
          </p>
          {blocker && (
            <p className="flex items-start gap-2 text-sm text-negative-700" data-testid="call-blocker">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {blocker}
            </p>
          )}
          {error && <p className="text-sm text-negative-700">{error}</p>}
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={start} disabled={busy || !!blocker} data-testid="call-start"
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-gold-400 text-navy-950 border border-gold-500 disabled:opacity-40">
              {busy ? 'Starting…' : `Put ${preview.placing.toLocaleString('en-ZA')} on the diaries`}
            </button>
            <button type="button" onClick={() => setStep('compose')} disabled={busy}
              className="text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600">
              Go back
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Run a call campaign" subtitle={subtitle} onClose={onClose} width={600}>
      <div data-testid="call-campaign-compose">
        <p className="text-[13px] text-slate-600 mb-3">
          Each account goes on the diary of the collector who holds it. Nobody is reassigned.
        </p>
        <FormField label="How should it be worked?" required>
          <div className="grid grid-cols-2 gap-2">
            {([
              ['now', 'Now', 'Today, above everything on the diary — broken PTPs included.'],
              ['spread', 'Spread until an end date', 'Over the coming days, in the room each collector keeps free.'],
            ] as const).map(([m, title, words]) => (
              <button key={m} type="button" onClick={() => setMode(m)} data-testid={`call-mode-${m}`}
                className={`text-left rounded-lg border p-3 ${mode === m ? 'border-navy-950 bg-navy-950 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
                <span className="block text-sm font-medium">{title}</span>
                <span className={`block text-xs mt-0.5 ${mode === m ? 'text-white/80' : 'text-slate-500'}`}>{words}</span>
              </button>
            ))}
          </div>
        </FormField>

        {mode === 'spread' && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Last day" required>
              <input type="date" className={inputClass} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} data-testid="call-ends-on" />
            </FormField>
            <FormField label="Where on the day" required>
              <select className={inputClass} value={rank} onChange={(e) => setRank(Number(e.target.value))} data-testid="call-rank">
                {SPREAD_RANKS.map((r) => <option key={r.rank} value={r.rank}>{r.label}</option>)}
              </select>
            </FormField>
          </div>
        )}

        <FormField label="What the collector says or asks for" required>
          <textarea className={`${inputClass} min-h-[110px]`} value={script} onChange={(e) => setScript(e.target.value)} maxLength={2000}
            data-testid="call-script" placeholder="Offer a settlement of 70% if paid before month end. Confirm the email address." />
        </FormField>

        <FormField label="Campaign name" required>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
            placeholder="So it can be found and stopped" data-testid="call-name" />
        </FormField>

        {error && <p className="text-sm text-negative-700 mb-2">{error}</p>}
        <div className="flex items-center gap-2">
          <button type="button" onClick={runPreview} disabled={busy || !ready} data-testid="call-preview-go"
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-navy-950 text-white disabled:opacity-40">
            {busy || !ids ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />}
            {!ids ? 'Finding the accounts…' : 'See what would happen'}
          </button>
          <button type="button" onClick={onBack} className="text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600">
            SMS or email instead
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Figure({ label, value, testid }: { label: string; value: number; testid?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-xl font-semibold text-navy-950 tabular-nums" data-testid={testid}>{value.toLocaleString('en-ZA')}</p>
    </div>
  )
}
