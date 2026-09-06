import { useState } from 'react'
import { Modal, FormField, inputClass } from './ui/Modal'
import { services } from '../data/mockData'
import { isHandoverService } from '../lib/dealKind'
import type { ProductService } from '../types'

/**
 * The small "write a line about what happened" capture used by every quick-log action —
 * notes, courtesy calls, handovers, logged calls. Kept in one place so a client and a lead
 * log the same way rather than drifting apart as each page grows its own version.
 */
export function QuickLogModal({
  title,
  fieldLabel,
  submitLabel,
  required = true,
  onClose,
  onSave,
}: {
  title: string
  fieldLabel: string
  submitLabel: string
  required?: boolean
  onClose: () => void
  onSave: (text: string) => void
}) {
  const [text, setText] = useState('')
  return (
    <Modal title={title} onClose={onClose} width={400}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (required && !text.trim()) return
          onSave(text)
          onClose()
        }}
      >
        <FormField label={fieldLabel} required={required}>
          <textarea className={inputClass} rows={4} value={text} onChange={(e) => setText(e.target.value)} required={required} autoFocus />
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function ScheduleFollowUpModal({
  onClose,
  onSave,
  placeholder = 'e.g. Quarterly check-in call',
}: {
  onClose: () => void
  onSave: (input: { title: string; dueDate: string }) => void
  placeholder?: string
}) {
  const [form, setForm] = useState({ title: '', dueDate: '', dueTime: '09:00' })
  return (
    <Modal title="Schedule Follow-up" onClose={onClose} width={380}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.title || !form.dueDate) return
          const due = new Date(`${form.dueDate}T${form.dueTime}`)
          onSave({ title: form.title, dueDate: due.toISOString() })
          onClose()
        }}
      >
        <FormField label="Title" required>
          <input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required autoFocus placeholder={placeholder} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date" required>
            <input type="date" className={inputClass} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} required />
          </FormField>
          <FormField label="Time">
            <input type="time" className={inputClass} value={form.dueTime} onChange={(e) => setForm({ ...form, dueTime: e.target.value })} />
          </FormField>
        </div>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Schedule
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function ScheduleMeetingModal({
  onClose,
  onSave,
  placeholder = 'e.g. Quarterly review',
}: {
  onClose: () => void
  onSave: (input: { title: string; dueDate: string }) => void
  placeholder?: string
}) {
  const [form, setForm] = useState({ title: '', dueDate: '', dueTime: '09:00', format: 'Virtual' as 'Virtual' | 'In-Person' })
  return (
    <Modal title="Schedule Meeting" onClose={onClose} width={380}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.title || !form.dueDate) return
          const due = new Date(`${form.dueDate}T${form.dueTime}`)
          onSave({ title: `${form.title} (${form.format})`, dueDate: due.toISOString() })
          onClose()
        }}
      >
        <FormField label="Title" required>
          <input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required autoFocus placeholder={placeholder} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date" required>
            <input type="date" className={inputClass} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} required />
          </FormField>
          <FormField label="Time">
            <input type="time" className={inputClass} value={form.dueTime} onChange={(e) => setForm({ ...form, dueTime: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Format">
          <select className={inputClass} value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value as 'Virtual' | 'In-Person' })}>
            <option>Virtual</option>
            <option>In-Person</option>
          </select>
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Schedule
          </button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Opening a deal, from either side of the conversion — an existing client signing for another
 * service, or a lead who's said they're interested in one. Same form either way, so a deal
 * means the same thing wherever it was raised.
 */
export function AddDealModal({
  onClose,
  onSave,
  defaultName = '',
  defaultService,
  namePlaceholder = 'e.g. Annual renewal',
}: {
  onClose: () => void
  onSave: (input: { name: string; value: number; service: ProductService; expectedCloseDate: string }) => void
  defaultName?: string
  defaultService?: ProductService
  namePlaceholder?: string
}) {
  const [form, setForm] = useState({ name: defaultName, value: '', service: defaultService ?? services[0], expectedCloseDate: '' })
  // A handover is billed on what's recovered, so there's no figure to enter here — the book
  // is agreed when the mandate is signed, and even that is what the client says.
  const isHandover = isHandoverService(form.service)
  return (
    <Modal title="Add Deal" onClose={onClose} width={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.name) return
          onSave({
            name: form.name,
            value: isHandover ? 0 : Number(form.value) || 0,
            service: form.service,
            expectedCloseDate: form.expectedCloseDate ? new Date(form.expectedCloseDate).toISOString() : new Date().toISOString(),
          })
          onClose()
        }}
      >
        <FormField label="Deal Name" required>
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus placeholder={namePlaceholder} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          {isHandover ? (
            <FormField label="Value">
              <p className="text-sm text-slate-400 py-2">Billed on recovery — no value yet</p>
            </FormField>
          ) : (
            <FormField label="Value (R)">
              <input type="number" className={inputClass} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
            </FormField>
          )}
          <FormField label="Expected Close Date">
            <input type="date" className={inputClass} value={form.expectedCloseDate} onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Service">
          <select className={inputClass} value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value as ProductService })}>
            {services.map((s: ProductService) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Add Deal
          </button>
        </div>
      </form>
    </Modal>
  )
}
