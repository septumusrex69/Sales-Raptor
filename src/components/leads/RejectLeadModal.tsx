import { useState } from 'react'
import { Modal, FormField, inputClass } from '../ui/Modal'
import { REJECTION_REASONS } from '../../lib/leadStatus'
import type { RejectionReason } from '../../types'

/**
 * Closing a lead off always asks why. Without a reason a rejected lead is just a lead that
 * went quiet, and a month of 'we declined them' reads identically to a month of losing on
 * price — which is exactly the difference worth knowing.
 */
export function RejectLeadModal({
  leadName,
  onClose,
  onConfirm,
}: {
  leadName: string
  onClose: () => void
  onConfirm: (reason: RejectionReason, note: string) => void
}) {
  const [reason, setReason] = useState<RejectionReason>('Not interested anymore')
  const [note, setNote] = useState('')
  return (
    <Modal title="Reject Lead" onClose={onClose} width={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onConfirm(reason, note.trim())
          onClose()
        }}
      >
        <p className="text-sm text-slate-500 mb-3">
          {leadName} stays on file as rejected — nothing is deleted, and it can be reopened by changing the status back.
        </p>
        <FormField label="Rejection Reason" required>
          <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value as RejectionReason)} autoFocus>
            {REJECTION_REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Note (optional)">
          <textarea className={inputClass} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything worth remembering if they come back." />
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700">
            Reject Lead
          </button>
        </div>
      </form>
    </Modal>
  )
}
