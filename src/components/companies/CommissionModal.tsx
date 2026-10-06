import { useState } from 'react'
import clsx from 'clsx'
import { Modal, inputClass } from '../ui/Modal'
import { CommissionScaleEditor } from './CommissionScaleEditor'
import { bandsToTiers, scaleTerms, tiersToBands, type Tier } from '../../lib/commissionTiers'
import { scheduleProblems, type CommissionBand } from '../../lib/commission'
import { saveCommission, type CommissionChange, type SavedCommission } from '../../lib/commissionChange'
import { tierWords } from '../../lib/commissionRule'

export interface CommissionModalClient {
  id: string
  name: string
  rate: number | null
  bands: CommissionBand[] | null
  bandsSource: string | null
  bandsDated: string | null
  tiers: { prefix: string; rate: number }[] | null
  /** How many accounts a change re-splits, where the caller knows. */
  accounts?: number
}

/**
 * A CLIENT'S COMMISSION: ONE RATE, OR A SLIDING SCALE -- from Trust settings and the client page.
 *
 * THE FIRM, on Trust settings when it took one number: "Here I can't choose a sliding scale." And
 * prompt 9: no screen could set bands on an existing client at all -- Trust settings sent people to
 * the client record, whose card only showed a scale. One dialog now, opened from both, saved by one
 * function (saveCommission), so the two cannot drift.
 *
 * IT OPENS ON WHAT THE CLIENT HAS. A scale opens as a scale with its bands. A client the register
 * shows on TIERS but with no bands yet opens as a scale with the tiers' rates filled in and the rand
 * boundaries blank -- the boundaries are the one thing the mandate has that the register does not,
 * so they are the one thing left to type.
 *
 * A FLAT RATE OVER A SCALE IS CONFIRMED, not merely saved: "This replaces a 4-tier scale with a flat
 * rate." Every new handover inherits it, whatever the debt size -- which is exactly how the scale was
 * being lost for new business.
 *
 * AND THE TERMS ARE READ BACK IN WORDS before anything is written, as Add client does: 3 typed for
 * 30 is invisible in a box and obvious in a sentence.
 */
export function CommissionModal({ client, onClose, onSaved }: {
  client: CommissionModalClient
  onClose: () => void
  onSaved: (saved: SavedCommission) => void | Promise<void>
}) {
  const hasBands = !!client.bands && client.bands.length > 0
  const tiers0 = client.tiers && client.tiers.length > 1 ? client.tiers : null
  const onScale = hasBands || !!tiers0
  const [kind, setKind] = useState<'rate' | 'scale'>(onScale ? 'scale' : 'rate')
  const [percent, setPercent] = useState(client.rate === null ? '' : String(Math.round(client.rate * 10000) / 100))
  /*
   * TIERS INTO THE EDITOR, WHERE THERE ARE NO BANDS: the register's rates, highest first (the
   * smallest debt), each with an empty boundary -- except the last, which is "and above" anyway.
   */
  const [tiers, setTiers] = useState<Tier[]>(() => hasBands
    ? bandsToTiers(client.bands)
    : tiers0
      ? tiers0.map((t) => ({ upTo: '', rate: String(Math.round(t.rate * 10000) / 100) }))
      : bandsToTiers(null))
  const [source, setSource] = useState(client.bandsSource ?? '')
  const [dated, setDated] = useState(client.bandsDated ?? '')
  const [reason, setReason] = useState('')
  const [replaceScale, setReplaceScale] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scaleSize = hasBands ? client.bands!.length : (tiers0?.length ?? 0)
  const fraction = Number(percent) / 100
  const bands = tiersToBands(tiers)
  const problems: string[] = []
  if (kind === 'rate') {
    if (!(Number.isFinite(fraction) && percent.trim() !== '' && fraction > 0)) problems.push('Type the rate as a percentage, like 30.')
    else if (fraction >= 1) problems.push('A commission rate of 100% or more would bill more than the debt.')
    if (onScale && !replaceScale) problems.push(`Tick to confirm this replaces the ${scaleSize}-tier scale.`)
  } else {
    problems.push(...scheduleProblems(bands))
  }
  if (!reason.trim()) problems.push('Say why — a new mandate, a gazette, a correction.')
  const terms = kind === 'rate' ? [`${percent}% of everything collected, on every account.`] : scaleTerms(tiers)

  function save() {
    setBusy(true); setError(null)
    const next: CommissionChange = kind === 'rate'
      ? { kind: 'rate', rate: fraction }
      : { kind: 'scale', bands, source: source.trim() || 'Signed mandate', dated: dated || null }
    void saveCommission({ id: client.id, name: client.name, rate: client.rate, bands: client.bands }, next, reason.trim())
      .then((saved) => onSaved(saved))
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : 'That did not save.'); setConfirming(false) })
      .finally(() => setBusy(false))
  }

  if (confirming) {
    return (
      <Modal title={`Commission for ${client.name}`} onClose={onClose} width={520}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {client.name} will be on {kind === 'rate' ? 'this rate' : 'this sliding scale'}:
          </p>
          <ul className="rounded-lg bg-gold-50 px-4 py-3 text-sm text-slate-800 space-y-1">
            {terms.map((t) => <li key={t}>{t}</li>)}
          </ul>
          {kind === 'scale' && (
            <p className="text-xs text-slate-500">
              Each account gets one rate, from the band its capital handed over falls in, decided at
              handover. An imported account keeps the rate Swordfish billed it.
            </p>
          )}
          <p className="text-xs text-slate-500">
            {client.accounts !== undefined
              ? `${client.accounts.toLocaleString('en-ZA')} ${client.accounts === 1 ? 'account is' : 'accounts are'} re-split on it`
              : 'Its accounts are re-split on it'}, and any payover still being worked is rebuilt. Anything
            already inside an approved invoice is left exactly as it was.
          </p>
          {error && <p className="rounded-lg bg-negative-50 px-3 py-2 text-[13px] text-negative-700">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button type="button" onClick={() => setConfirming(false)} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Back</button>
            <button type="button" disabled={busy} onClick={save} className="btn-primary">
              {busy ? 'Saving…' : 'Confirm and save'}
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={`Commission for ${client.name}`} onClose={onClose} width={580}>
      <div className="space-y-3">
        {tiers0 && (
          /* WHAT SWORDFISH FILED, always shown: it is the evidence the boundaries are being typed against. */
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            The register files this client on {tiers0.length} tiers: <span className="font-medium">{tierWords(tiers0)}</span>.
            {!hasBands && ' Their rand boundaries are in the signed mandate and are not captured yet.'}
          </p>
        )}
        <div className="flex gap-2">
          {(['rate', 'scale'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
              className={clsx('text-xs px-3 py-1.5 rounded-lg border', kind === k
                ? 'border-gold-500 bg-gold-100 text-navy-950 font-medium'
                : 'border-slate-200 text-slate-500')}>
              {k === 'rate' ? 'One rate' : 'A sliding scale'}
            </button>
          ))}
        </div>

        {kind === 'rate' ? (
          <div className="space-y-2">
            <label className="mb-1 block text-xs font-medium text-slate-600">Rate</label>
            <div className="flex items-center gap-2">
              <input value={percent} onChange={(e) => setPercent(e.target.value)} inputMode="decimal"
                placeholder="30" className={clsx(inputClass, 'w-24')} />
              <span className="text-sm text-slate-500">% of what is collected</span>
            </div>
            {onScale && (
              <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
                <input type="checkbox" className="mt-0.5" checked={replaceScale} onChange={(e) => setReplaceScale(e.target.checked)} />
                <span>This replaces a {scaleSize}-tier scale with a flat rate. Every new handover gets this one rate, whatever the debt size.</span>
              </label>
            )}
          </div>
        ) : (
          <>
            <CommissionScaleEditor tiers={tiers} onTiers={setTiers} source={source} onSource={setSource} />
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Mandate dated</label>
              <input type="date" value={dated} onChange={(e) => setDated(e.target.value)} className={clsx(inputClass, 'max-w-[11rem]')} />
            </div>
          </>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Why</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass}
            placeholder="A new mandate, a gazette, a correction…" />
          <p className="mt-1 text-xs text-slate-400">Required. Only you know why, and in a month nobody will.</p>
        </div>
        {error && <p className="rounded-lg bg-negative-50 px-3 py-2 text-[13px] text-negative-700">{error}</p>}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
          {/* WHAT STOPS IT, said -- rather than a grey button nobody is told the reason for. */}
          {problems.length > 0 && <span className="mr-auto text-xs text-slate-500">{problems[0]}</span>}
          <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button type="button" disabled={problems.length > 0} onClick={() => setConfirming(true)} className="btn-primary">
            Continue
          </button>
        </div>
      </div>
    </Modal>
  )
}
