import { useState } from 'react'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { services } from '../../data/mockData'
import { dealKind } from '../../lib/dealKind'
import type { Deal } from '../../types'
import { REJECTION_REASONS } from '../../lib/rejection'
import type { RejectionReason } from '../../types'
import type { WonDealDetails } from '../../store/AppStore'

export function MarkWonModal({
  deal,
  onClose,
  onSave,
}: {
  deal: Pick<Deal, 'service' | 'value' | 'handoverAmount' | 'accountsCount' | 'kind'>
  onClose: () => void
  onSave: (details: WonDealDetails) => void
}) {
  const isHandover = dealKind(deal) === 'Handover'
  // Everything already on the deal is carried in rather than asked for again. Closing should
  // only ask what closing actually establishes — the date, and whether the numbers moved.
  const [form, setForm] = useState({
    finalValue: deal.value ? String(deal.value) : '',
    startDate: '',
    contractDuration: '12 months',
    handoverAmount: deal.handoverAmount != null ? String(deal.handoverAmount) : '',
    accountsCount: deal.accountsCount != null ? String(deal.accountsCount) : '',
  })
  return (
    <Modal title={isHandover ? 'Mandate Signed' : 'Mark Deal Won 🎉'} onClose={onClose} width={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.startDate) return
          onSave({
            // A handover earns nothing at signature, so there is no value to record. The book
            // goes in handoverAmount, where nothing will add it to revenue.
            finalValue: isHandover ? 0 : Number(form.finalValue) || 0,
            startDate: form.startDate,
            service: deal.service ?? services[0],
            contractDuration: form.contractDuration,
            handoverAmount: isHandover && form.handoverAmount !== '' ? Number(form.handoverAmount) : undefined,
            accountsCount: isHandover && form.accountsCount !== '' ? Number(form.accountsCount) : undefined,
          })
          onClose()
        }}
      >
        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 mb-3">
          {deal.service ?? 'Service'}
          {isHandover
            ? " — billed on what's recovered, so nothing is earned at signature."
            : ' — confirm the final figure if it moved.'}
        </p>

        <FormField label={isHandover ? 'Mandate Signed On' : 'Starting Date'} required>
          <input type="date" className={inputClass} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
        </FormField>

        {isHandover ? (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Agreed Book (R)">
              <input type="number" className={inputClass} value={form.handoverAmount} onChange={(e) => setForm({ ...form, handoverAmount: e.target.value })} />
            </FormField>
            <FormField label="Number of Accounts">
              <input type="number" className={inputClass} value={form.accountsCount} onChange={(e) => setForm({ ...form, accountsCount: e.target.value })} />
            </FormField>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Final Value (R)" required>
              <input type="number" className={inputClass} value={form.finalValue} onChange={(e) => setForm({ ...form, finalValue: e.target.value })} required />
            </FormField>
            <FormField label="Contract Duration">
              <input className={inputClass} value={form.contractDuration} onChange={(e) => setForm({ ...form, contractDuration: e.target.value })} />
            </FormField>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-[var(--c-gold-deep)] text-white hover:bg-[var(--c-gold-deep-hover)]">
            {isHandover ? 'Confirm Mandate' : 'Confirm Won'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function MarkRejectedModal({ onClose, onSave }: { onClose: () => void; onSave: (reason: RejectionReason, note: string) => void }) {
  const [reason, setReason] = useState<RejectionReason>('Not interested anymore')
  const [note, setNote] = useState('')
  return (
    <Modal title="Reject Deal" onClose={onClose} width={400}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave(reason, note.trim())
          onClose()
        }}
      >
        <FormField label="Rejection Reason" required>
          <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value as RejectionReason)} autoFocus>
            {REJECTION_REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Note (optional)">
          <textarea className={inputClass} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything worth remembering if it comes back." />
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-[var(--c-rust-deep)] text-white hover:bg-[var(--c-rust-deep-hover)]">
            Reject Deal
          </button>
        </div>
      </form>
    </Modal>
  )
}
