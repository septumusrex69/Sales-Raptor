import { useState, type FormEvent } from 'react'
import { Modal, FormField, inputClass } from '../ui/Modal'
import type { Handover } from '../../types'

/**
 * Records one batch a client actually sent.
 *
 * Handovers used to be logged as a line of free text, which meant the app knew a handover had
 * happened but never how much — so a client who signed for a million and sent fifty thousand
 * looked identical to one who sent the lot. These are the numbers everything real about a
 * handover client is derived from, so they're captured as numbers.
 */
export function LogHandoverModal({
  companyName,
  onClose,
  onSave,
}: {
  companyName: string
  onClose: () => void
  onSave: (input: Pick<Handover, 'capitalAmount' | 'accountsCount' | 'receivedAt' | 'reference' | 'notes'>) => void
}) {
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [capitalAmount, setCapitalAmount] = useState('')
  const [accountsCount, setAccountsCount] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    const amount = Number(capitalAmount)
    if (!Number.isFinite(amount) || amount <= 0) return
    onSave({
      capitalAmount: amount,
      accountsCount: accountsCount === '' ? undefined : Number(accountsCount),
      receivedAt: new Date(receivedAt).toISOString(),
      reference: reference.trim() || undefined,
      notes: notes.trim() || undefined,
    })
    onClose()
  }

  return (
    <Modal title="Log Handover Received" onClose={onClose} width={480}>
      <form onSubmit={submit}>
        <p className="text-sm text-slate-500 mb-4">
          One batch from {companyName}. Capital only — Annex B fees and interest are added as the accounts are worked,
          not here.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date Received" required>
            <input type="date" className={inputClass} value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} required />
          </FormField>
          <FormField label="Capital (R)" required>
            <input
              type="number"
              min="0"
              step="0.01"
              className={inputClass}
              value={capitalAmount}
              onChange={(e) => setCapitalAmount(e.target.value)}
              required
              autoFocus
            />
          </FormField>
          <FormField label="Number of Accounts">
            <input type="number" min="0" className={inputClass} value={accountsCount} onChange={(e) => setAccountsCount(e.target.value)} />
          </FormField>
          <FormField label="Reference">
            <input
              className={inputClass}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="File or batch name"
            />
          </FormField>
        </div>

        <FormField label="Notes">
          <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>

        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Log Handover
          </button>
        </div>
      </form>
    </Modal>
  )
}
