import { useState } from 'react'
import { Modal, FormField, inputClass } from './ui/Modal'

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
