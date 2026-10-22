import { CheckCircle2, Loader2 } from 'lucide-react'
import { FormField, inputClass } from '../ui/Modal'

/**
 * FINISHING A CAMPAIGN ITEM ON A CLOSED ACCOUNT -- a recovery call, or a trace on the written-off
 * book -- that was not won back (S10, 22 Oct). Shared by the diary's own Done and the diary run's
 * "Done & next", so the two say the same thing.
 *
 * ONLY WHAT CAME OF IT. No outcome picker that would write a promise onto a closed account, no
 * next date that would diarise one: "otherwise, the account just stays where it was". The way to a
 * promise is the account page's "Debtor agreed to pay — re-open and keep it", which is the
 * collector's own press and the only thing that re-opens it.
 */
export function ClosedFinish({ name, script, outcome, setOutcome, error, busy, onClose, onSave, saveLabel }: {
  name: string
  script: string | null
  outcome: string
  setOutcome: (v: string) => void
  error: string | null
  busy: boolean
  onClose: () => void
  onSave: () => void
  saveLabel?: string
}) {
  return (
    <div className="space-y-4" data-testid="finish-closed">
      <p className="text-sm text-slate-600">{name}</p>
      {script && (
        <p className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-[13px] text-slate-700 whitespace-pre-wrap">{script}</p>
      )}
      <FormField label="What came of it">
        <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={2} autoFocus
          placeholder="No answer on the new number." className={`${inputClass} resize-none`} />
      </FormField>
      <p className="text-[13px] text-slate-600">
        The account stays closed and where it is. If the debtor agreed to pay, press “Debtor agreed to pay — re-open
        and keep it” on the account first; then take the promise there.
      </p>
      {error && <p className="text-sm text-negative-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-2">Cancel</button>
        <button type="button" onClick={onSave} disabled={busy} data-testid="finish-closed-save"
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900 disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          {saveLabel ?? 'Worked, leave it closed'}
        </button>
      </div>
    </div>
  )
}
