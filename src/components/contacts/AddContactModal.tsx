import { useState, type FormEvent } from 'react'
import { Modal, FormField, inputClass } from '../ui/Modal'

export interface NewContactInput {
  firstName: string
  lastName: string
  jobTitle?: string
  email?: string
  phone?: string
  mobile?: string
}

export function AddContactModal({ onClose, onSave }: { onClose: () => void; onSave: (input: NewContactInput) => void }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', jobTitle: '', email: '', phone: '', mobile: '' })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.firstName.trim() || !form.lastName.trim()) return
    onSave({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      jobTitle: form.jobTitle.trim() || undefined,
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      mobile: form.mobile.trim() || undefined,
    })
    onClose()
  }

  return (
    <Modal title="Add Contact Person" onClose={onClose} width={440}>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-x-3">
          <FormField label="First Name" required>
            <input className={inputClass} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required autoFocus />
          </FormField>
          <FormField label="Last Name" required>
            <input className={inputClass} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
          </FormField>
        </div>
        <FormField label="Job Title">
          <input className={inputClass} value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
        </FormField>
        <FormField label="Email">
          <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </FormField>
        <div className="grid grid-cols-2 gap-x-3">
          <FormField label="Phone">
            <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </FormField>
          <FormField label="Mobile">
            <input className={inputClass} value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          </FormField>
        </div>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Add Contact
          </button>
        </div>
      </form>
    </Modal>
  )
}
