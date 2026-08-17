import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Target, Users, Building2, Handshake, CheckSquare, Calendar, FileText, ChevronDown } from 'lucide-react'
import { Modal, FormField, inputClass } from '../ui/Modal'
import { useAppStore } from '../../store/AppStore'
import { companies, leadSources, services } from '../../data/mockData'
import type { LeadSource, ProductService } from '../../types'
import { LeadOpportunityFields, emptyLeadOpportunityValue, leadOpportunityPatch } from '../leads/LeadOpportunityFields'

type QuickAddType = 'lead' | 'contact' | 'company' | 'deal' | 'task' | 'meeting' | 'note'

const OPTIONS: { type: QuickAddType; label: string; icon: typeof Target }[] = [
  { type: 'lead', label: 'Add Lead', icon: Target },
  { type: 'contact', label: 'Add Contact', icon: Users },
  { type: 'company', label: 'Add Company', icon: Building2 },
  { type: 'deal', label: 'Add Deal', icon: Handshake },
  { type: 'task', label: 'Add Task', icon: CheckSquare },
  { type: 'meeting', label: 'Add Meeting', icon: Calendar },
  { type: 'note', label: 'Add Note', icon: FileText },
]

export function QuickAdd() {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<QuickAddType | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 bg-brand-600 text-white text-sm font-medium px-3.5 py-2 rounded-lg hover:bg-brand-700 shadow-sm"
      >
        <Plus size={16} /> Add <ChevronDown size={14} className="opacity-70" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-xl shadow-lg border border-slate-100 py-1.5 z-50">
          {OPTIONS.map(({ type, label, icon: Icon }) => (
            <button
              key={type}
              onClick={() => {
                setActive(type)
                setOpen(false)
              }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      )}
      {active && <QuickAddModal type={active} onClose={() => setActive(null)} />}
    </div>
  )
}

function QuickAddModal({ type, onClose }: { type: QuickAddType; onClose: () => void }) {
  const store = useAppStore()
  const navigate = useNavigate()

  if (type === 'lead') {
    return <LeadForm onClose={onClose} store={store} navigate={navigate} />
  }
  if (type === 'contact') {
    return <ContactForm onClose={onClose} store={store} />
  }
  if (type === 'company') {
    return <CompanyForm onClose={onClose} store={store} />
  }
  if (type === 'deal') {
    return <DealForm onClose={onClose} store={store} navigate={navigate} />
  }
  if (type === 'task' || type === 'meeting') {
    return <TaskForm onClose={onClose} store={store} isMeeting={type === 'meeting'} />
  }
  return <NoteForm onClose={onClose} store={store} />
}

export type Store = ReturnType<typeof useAppStore>

export function LeadForm({ onClose, store, navigate }: { onClose: () => void; store: Store; navigate: ReturnType<typeof useNavigate> }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', companyName: '', phone: '', email: '', source: 'Website' as LeadSource, estimatedValue: '' })
  const [opportunity, setOpportunity] = useState(emptyLeadOpportunityValue())
  return (
    <Modal title="Add Lead" onClose={onClose} width={560}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.firstName || !form.companyName || (!form.phone && !form.email)) return
          const lead = store.addLead({
            firstName: form.firstName,
            lastName: form.lastName,
            companyName: form.companyName,
            phone: form.phone || undefined,
            email: form.email || undefined,
            source: form.source,
            estimatedValue: Number(form.estimatedValue) || 0,
            ...leadOpportunityPatch(opportunity),
          })
          onClose()
          navigate(`/leads/${lead.id}`)
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <FormField label="First Name" required>
            <input className={inputClass} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
          </FormField>
          <FormField label="Last Name">
            <input className={inputClass} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Company" required>
          <input className={inputClass} value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} required />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Phone">
            <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </FormField>
          <FormField label="Email">
            <input type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Lead Source" required>
            <select className={inputClass} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as LeadSource })}>
              {leadSources.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Estimated Value (R)">
            <input type="number" className={inputClass} value={form.estimatedValue} onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })} />
          </FormField>
        </div>
        <LeadOpportunityFields value={opportunity} onChange={setOpportunity} />
        <SubmitRow onClose={onClose} label="Add Lead" />
      </form>
    </Modal>
  )
}

export function ContactForm({ onClose, store }: { onClose: () => void; store: Store }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', jobTitle: '', companyId: companies[0]?.id ?? '', email: '', phone: '' })
  return (
    <Modal title="Add Contact" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.firstName || !form.lastName) return
          store.addContact({ ...form, companyId: form.companyId || undefined })
          onClose()
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <FormField label="First Name" required>
            <input className={inputClass} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
          </FormField>
          <FormField label="Last Name" required>
            <input className={inputClass} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
          </FormField>
        </div>
        <FormField label="Job Title">
          <input className={inputClass} value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
        </FormField>
        <FormField label="Company">
          <select className={inputClass} value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Email">
            <input type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </FormField>
          <FormField label="Phone">
            <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </FormField>
        </div>
        <SubmitRow onClose={onClose} label="Add Contact" />
      </form>
    </Modal>
  )
}

export function CompanyForm({ onClose, store }: { onClose: () => void; store: Store }) {
  const [form, setForm] = useState({ name: '', industry: '', phone: '', email: '', website: '' })
  return (
    <Modal title="Add Company" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.name) return
          store.addCompany(form)
          onClose()
        }}
      >
        <FormField label="Company Name" required>
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </FormField>
        <FormField label="Industry">
          <input className={inputClass} value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Phone">
            <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </FormField>
          <FormField label="Email">
            <input type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Website">
          <input className={inputClass} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
        </FormField>
        <SubmitRow onClose={onClose} label="Add Company" />
      </form>
    </Modal>
  )
}

export function DealForm({ onClose, store, navigate }: { onClose: () => void; store: Store; navigate: ReturnType<typeof useNavigate> }) {
  const [form, setForm] = useState({ name: '', companyId: companies[0]?.id ?? '', value: '', service: services[0], expectedCloseDate: '' })
  return (
    <Modal title="Add Deal" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.name || !form.companyId) return
          const deal = store.addDeal({
            name: form.name,
            companyId: form.companyId,
            value: Number(form.value) || 0,
            service: form.service,
            expectedCloseDate: form.expectedCloseDate ? new Date(form.expectedCloseDate).toISOString() : new Date().toISOString(),
          })
          onClose()
          navigate(`/deals/${deal.id}`)
        }}
      >
        <FormField label="Deal Name" required>
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </FormField>
        <FormField label="Company" required>
          <select className={inputClass} value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Value (R)">
            <input type="number" className={inputClass} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
          </FormField>
          <FormField label="Expected Close Date">
            <input type="date" className={inputClass} value={form.expectedCloseDate} onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Service">
          <select className={inputClass} value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value as ProductService })}>
            {services.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </FormField>
        <SubmitRow onClose={onClose} label="Add Deal" />
      </form>
    </Modal>
  )
}

export function TaskForm({ onClose, store, isMeeting }: { onClose: () => void; store: Store; isMeeting: boolean }) {
  const [form, setForm] = useState({ title: '', dueDate: '', dueTime: '09:00', priority: 'Medium' as const })
  return (
    <Modal title={isMeeting ? 'Add Meeting' : 'Add Task'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.title || !form.dueDate) return
          const due = new Date(`${form.dueDate}T${form.dueTime}`)
          store.addTask({ title: form.title, dueDate: due.toISOString(), priority: form.priority, type: isMeeting ? 'Meeting' : 'Follow-up' })
          onClose()
        }}
      >
        <FormField label={isMeeting ? 'Meeting Title' : 'Task Title'} required>
          <input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date" required>
            <input type="date" className={inputClass} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} required />
          </FormField>
          <FormField label="Time">
            <input type="time" className={inputClass} value={form.dueTime} onChange={(e) => setForm({ ...form, dueTime: e.target.value })} />
          </FormField>
        </div>
        {!isMeeting && (
          <FormField label="Priority">
            <select className={inputClass} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as typeof form.priority })}>
              {['Low', 'Medium', 'High', 'Urgent'].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </FormField>
        )}
        <SubmitRow onClose={onClose} label={isMeeting ? 'Add Meeting' : 'Add Task'} />
      </form>
    </Modal>
  )
}

export function NoteForm({ onClose, store }: { onClose: () => void; store: Store }) {
  const [note, setNote] = useState('')
  return (
    <Modal title="Add Note" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!note.trim()) return
          store.addActivity({ type: 'Note', subject: 'Note added', notes: note })
          onClose()
        }}
      >
        <FormField label="Note" required>
          <textarea className={inputClass} rows={4} value={note} onChange={(e) => setNote(e.target.value)} required />
        </FormField>
        <SubmitRow onClose={onClose} label="Add Note" />
      </form>
    </Modal>
  )
}

function SubmitRow({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
      <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
        Cancel
      </button>
      <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
        {label}
      </button>
    </div>
  )
}
