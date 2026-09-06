import { useState } from 'react'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { services } from '../../data/mockData'
import { isHandoverService } from '../../lib/dealKind'
import { REJECTION_REASONS } from '../../lib/rejection'
import type { RejectionReason } from '../../types'
import type { WonDealDetails } from '../../store/AppStore'

export function MarkWonModal({ defaultService, onClose, onSave }: { defaultService?: string; onClose: () => void; onSave: (details: WonDealDetails) => void }) {
  const [form, setForm] = useState({
    finalValue: '',
    startDate: '',
    service: defaultService ?? services[0],
    contractDuration: '12 months',
    handoverAmount: '',
    accountsCount: '',
  })
  const isHandover = isHandoverService(form.service)
  return (
    <Modal title={isHandover ? 'Confirm Mandate Signed' : 'Mark Deal Won 🎉'} onClose={onClose} width={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.startDate) return
          onSave({
            // A handover earns nothing at signature, so it has no value to record. The book
            // goes in handoverAmount, where nothing will add it to revenue.
            finalValue: isHandover ? 0 : Number(form.finalValue) || 0,
            startDate: form.startDate,
            service: form.service,
            contractDuration: form.contractDuration,
            handoverAmount: isHandover && form.handoverAmount !== '' ? Number(form.handoverAmount) : undefined,
            accountsCount: isHandover && form.accountsCount !== '' ? Number(form.accountsCount) : undefined,
          })
          onClose()
        }}
      >
        {!isHandover && (
          <FormField label="Final Contract Value (R)" required>
            <input
              type="number"
              className={inputClass}
              value={form.finalValue}
              onChange={(e) => setForm({ ...form, finalValue: e.target.value })}
              placeholder="Enter final contract value"
              required
            />
          </FormField>
        )}
        {isHandover && (
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 mb-3">
            Nothing is earned at signature — this client is billed on what's recovered. Record the book they've agreed to
            hand over; the real figures arrive with the accounts themselves.
          </p>
        )}
        <FormField label={isHandover ? 'Mandate Signed On' : 'Starting Date'} required>
          <input type="date" className={inputClass} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
        </FormField>
        <FormField label="Service Sold">
          <select className={inputClass} value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })}>
            {services.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </FormField>
        {isHandover && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Agreed Book (R)" required>
              <input
                type="number"
                className={inputClass}
                value={form.handoverAmount}
                onChange={(e) => setForm({ ...form, handoverAmount: e.target.value })}
                placeholder="e.g. 750000"
                required
              />
            </FormField>
            <FormField label="Number of Accounts / Matters">
              <input
                type="number"
                className={inputClass}
                value={form.accountsCount}
                onChange={(e) => setForm({ ...form, accountsCount: e.target.value })}
                placeholder="e.g. 40"
              />
            </FormField>
          </div>
        )}
        <FormField label="Contract Duration">
          <input className={inputClass} value={form.contractDuration} onChange={(e) => setForm({ ...form, contractDuration: e.target.value })} />
        </FormField>
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

/**
 * The same reason list a lead is rejected with, so a deal that fell over and a lead that
 * never signed can be counted together rather than in two vocabularies.
 */
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
