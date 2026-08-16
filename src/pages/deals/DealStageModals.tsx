import { useState } from 'react'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { lossReasons, services } from '../../data/mockData'
import type { LossReason } from '../../types'
import type { WonDealDetails } from '../../store/AppStore'

export function MarkWonModal({ defaultValue, defaultService, onClose, onSave }: { defaultValue: number; defaultService?: string; onClose: () => void; onSave: (details: WonDealDetails) => void }) {
  const [form, setForm] = useState({
    finalValue: String(defaultValue),
    startDate: '',
    service: defaultService ?? services[0],
    contractDuration: '12 months',
  })
  return (
    <Modal title="Mark Deal Won 🎉" onClose={onClose} width={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.startDate) return
          onSave({ finalValue: Number(form.finalValue) || 0, startDate: form.startDate, service: form.service, contractDuration: form.contractDuration })
          onClose()
        }}
      >
        <FormField label="Final Contract Value (R)" required>
          <input type="number" className={inputClass} value={form.finalValue} onChange={(e) => setForm({ ...form, finalValue: e.target.value })} required />
        </FormField>
        <FormField label="Start Date" required>
          <input type="date" className={inputClass} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
        </FormField>
        <FormField label="Service Sold">
          <select className={inputClass} value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })}>
            {services.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Contract Duration">
          <input className={inputClass} value={form.contractDuration} onChange={(e) => setForm({ ...form, contractDuration: e.target.value })} />
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
            Confirm Won
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function MarkLostModal({ onClose, onSave }: { onClose: () => void; onSave: (reason: LossReason) => void }) {
  const [reason, setReason] = useState<LossReason>('Price')
  return (
    <Modal title="Mark Deal Lost" onClose={onClose} width={380}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave(reason)
          onClose()
        }}
      >
        <FormField label="Loss Reason" required>
          <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value as LossReason)}>
            {lossReasons.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700">
            Confirm Lost
          </button>
        </div>
      </form>
    </Modal>
  )
}
