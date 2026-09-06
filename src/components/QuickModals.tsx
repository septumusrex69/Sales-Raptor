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
  subjectName,
  onClose,
  onSave,
  defaultService,
}: {
  /** The client or lead the deal is for — the deal takes its name from this and the service. */
  subjectName: string
  onClose: () => void
  onSave: (input: {
    name: string
    value: number
    service: ProductService
    expectedCloseDate: string
    handoverAmount?: number
    accountsCount?: number
    notes?: string
  }) => void
  defaultService?: ProductService
}) {
  const [form, setForm] = useState({
    service: defaultService ?? services[0],
    value: '',
    handoverAmount: '',
    accountsCount: '',
    expectedCloseDate: '',
    notes: '',
  })
  const isHandover = isHandoverService(form.service)

  return (
    <Modal title="Add Deal" onClose={onClose} width={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave({
            // Named from the subject and the service rather than asked for — that's what
            // anyone typed anyway, and a blank required field is a toll on the way to the
            // information that actually matters.
            name: `${subjectName} — ${form.service}`,
            service: form.service,
            value: isHandover ? 0 : Number(form.value) || 0,
            handoverAmount: isHandover && form.handoverAmount !== '' ? Number(form.handoverAmount) : undefined,
            accountsCount: isHandover && form.accountsCount !== '' ? Number(form.accountsCount) : undefined,
            notes: form.notes.trim() || undefined,
            expectedCloseDate: form.expectedCloseDate ? new Date(form.expectedCloseDate).toISOString() : new Date().toISOString(),
          })
          onClose()
        }}
      >
        <FormField label="Service" required>
          <select className={inputClass} value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value as ProductService })} autoFocus>
            {services.map((s: ProductService) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </FormField>
        {/* What "how much" means depends entirely on the service: a book to collect against,
            or a fee to invoice. */}
        <div className="grid grid-cols-2 gap-3">
          {isHandover ? (
            <>
              <FormField label="Handover Value (R)">
                <input type="number" className={inputClass} value={form.handoverAmount} onChange={(e) => setForm({ ...form, handoverAmount: e.target.value })} placeholder="e.g. 750000" />
              </FormField>
              <FormField label="Number of Accounts">
                <input type="number" className={inputClass} value={form.accountsCount} onChange={(e) => setForm({ ...form, accountsCount: e.target.value })} placeholder="e.g. 40" />
              </FormField>
            </>
          ) : (
            <FormField label="Value (R)">
              <input type="number" className={inputClass} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
            </FormField>
          )}
          <FormField label="Expected Close Date">
            <input type="date" className={inputClass} value={form.expectedCloseDate} onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Description">
          <textarea
            className={inputClass}
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Optional — e.g. lease agreement for the Sandton premises"
          />
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
