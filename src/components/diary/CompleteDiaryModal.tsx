import { useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Modal, FormField, inputClass } from '../ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { completeEntry, debtorName, type DiaryRow } from '../../lib/diary.ts'
import { DIARY_KINDS } from '../../lib/diaryPriority.ts'

/**
 * Mark one diary entry worked.
 *
 * The outcome line is kept on the entry itself rather than only in the account's timeline,
 * because "how much did we get through yesterday, and what came of it" is a question about
 * diary rows. Answering it out of a timeline means reading every note on every account.
 *
 * It is optional here and required in the work loop. Closing an entry from a list is usually
 * tidying — the call happened last week and was never written down — while closing one you have
 * just worked is the moment the outcome is known.
 */
export function CompleteDiaryModal({ entry, onClose, onDone }: {
  entry: DiaryRow
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const { currentUser } = useAuth()
  const [outcome, setOutcome] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true); setError(null)
    try {
      await completeEntry({
        id: entry.id,
        outcome,
        actor: { id: currentUser?.id ?? null, name: currentUser?.name ?? null },
      })
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Mark this worked" onClose={onClose} width={460}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          {debtorName(entry)} — {DIARY_KINDS[entry.kind].label.toLowerCase()}
          {entry.reason && <span className="text-slate-400"> · {entry.reason}</span>}
        </p>

        <FormField label="What came of it">
          <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={2} autoFocus
            placeholder="No answer on either number. Left an SMS."
            className={`${inputClass} resize-none`} />
        </FormField>

        {/*
          Said plainly, because the next thing an agent will wonder is whether this made the
          account disappear. It does not: closing an entry only closes the appointment.
        */}
        <p className="text-xs text-slate-400">
          This closes the diary entry, not the account. If it needs to come back, diarise it
          again from the account page.
        </p>

        {error && <p className="text-sm text-negative-700">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-2">
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={busy}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Worked
          </button>
        </div>
      </div>
    </Modal>
  )
}
