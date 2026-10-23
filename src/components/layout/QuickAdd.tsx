import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Target, Users, Building2, Handshake, CheckSquare, Calendar, FileText, ChevronDown } from 'lucide-react'
import { Modal, FormField, inputClass } from '../ui/Modal'
import { isHandoverService } from '../../lib/dealKind'
import { SearchableSelect } from '../ui/SearchableSelect'
import { useAppStore } from '../../store/AppStore'
import { ClientPicker } from '../ui/ClientPicker'
import { useAuth } from '../../store/AuthContext'
import { leadSources, services } from '../../data/mockData'
import type { Lead, LeadSource, ProductService } from '../../types'
import { LeadOpportunityFields, emptyLeadOpportunityValue, leadOpportunityPatch } from '../leads/LeadOpportunityFields'
import { isAssignableOwner } from '../../lib/permissions'
import { clockNow } from '../../lib/clock.ts'
import { clientNameFor, emptyContactPerson, furtherContacts, type ContactPersonDraft } from '../../lib/leadParty.ts'

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

/**
 * THE ONE LEAD FORM.
 *
 * Used by Add Lead in the top bar and by Create lead in the mailbox, at the firm's instruction:
 * "leads should use the same lead form as adding an actual lead -- this lead form you made here is
 * a small version, it should actually make a lead."
 *
 * A second, shorter form would have drifted within a month: the fields a lead needs are decided by
 * what the sales side does with one, not by which screen somebody happened to be on, and the
 * opportunity fields in particular turn into deals the moment the lead is saved.
 *
 * `initial` prefills it. `onCreated` replaces what happens afterwards -- by default, close and go
 * to the new lead, which is what the top bar has always done; from the mailbox the email has to be
 * filed on the lead first and the person asked where they would rather be.
 */
export function LeadForm({ onClose, store, navigate, initial, title = 'Add Lead', intro, onCreated }: {
  onClose: () => void
  store: Store
  navigate: ReturnType<typeof useNavigate>
  /** Prefilled values. Guesses, every one of them, which is why they land in editable boxes. */
  initial?: Partial<{ firstName: string; lastName: string; companyName: string; phone: string; email: string; source: LeadSource }>
  title?: string
  /** Said above the fields where the caller has something to explain -- a fee, or where this came from. */
  intro?: ReactNode
  /** What to do with the new lead. Omitted: close, and open it. */
  onCreated?: (lead: Lead) => void
}) {
  const { currentUser } = useAuth()
  const reps = useMemo(() => store.users.filter((u) => isAssignableOwner(u.role)), [store.users])
  const [form, setForm] = useState({
    firstName: initial?.firstName ?? '',
    lastName: initial?.lastName ?? '',
    jobTitle: '',
    companyName: initial?.companyName ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    source: initial?.source ?? ('Website' as LeadSource),
    ownerId: currentUser?.id ?? '',
  })
  /*
   * ASKED FIRST, AND NOT GUESSED (the firm, 23 Oct: "the first thing it should ask is it a company or
   * an individual?"). Nothing else is drawn until it is answered, because it decides what the next
   * two questions mean. The one exception is a prefill that already names a company -- the mailbox
   * reads one off the sender's domain or the website form -- where "a company" is what the message
   * said, and the choice stays at the top to be changed.
   */
  const [party, setParty] = useState<'company' | 'individual' | null>(initial?.companyName ? 'company' : null)
  const [others, setOthers] = useState<ContactPersonDraft[]>([])
  const [opportunity, setOpportunity] = useState(emptyLeadOpportunityValue())
  const clientName = party ? clientNameFor(party, form) : ''
  const further = party === 'company' ? furtherContacts(others) : { save: [], problem: null }
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch })
  const setOther = (i: number, patch: Partial<ContactPersonDraft>) =>
    setOthers((prev) => prev.map((o, j) => (j === i ? { ...o, ...patch } : o)))
  return (
    <Modal title={title} onClose={onClose} width={560}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!party || !form.firstName || !clientName || (!form.phone && !form.email) || further.problem) return
          const lead = store.addLead({
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            jobTitle: party === 'company' ? form.jobTitle.trim() || undefined : undefined,
            companyName: clientName,
            party,
            phone: form.phone || undefined,
            email: form.email || undefined,
            source: form.source,
            ownerId: form.ownerId || undefined,
            ...leadOpportunityPatch(opportunity),
          }, further.save)
          if (onCreated) { onCreated(lead); return }
          onClose()
          navigate(`/leads/${lead.id}`)
        }}
      >
        {intro}
        {/* 1. COMPANY OR INDIVIDUAL. Said here (18 Oct: "when we add the lead, we should already say if
            it's a company or an individual"), and since 23 Oct said FIRST. The mandate opens on it. */}
        <div className="mb-4" data-testid="lead-party">
          <p className="mb-1.5 text-xs font-medium text-slate-500">Is the client a company or an individual?<span className="text-red-500 ml-0.5">*</span></p>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm" role="radiogroup" aria-label="The client is">
            {([['company', 'A company'], ['individual', 'An individual']] as const).map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={party === v} data-testid={`lead-party-${v}`}
                onClick={() => setParty(v)}
                className={`rounded-md px-3 py-1 ${party === v ? 'bg-navy-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{label}</button>
            ))}
          </div>
        </div>

        {party === null && (
          <p className="mb-4 text-sm text-slate-400" data-testid="lead-party-first">Choose one to start: it decides what the client&rsquo;s name is and who you speak to there.</p>
        )}

        {party === 'company' && (
          <>
            {/* 2. THE CLIENT'S NAME: the company's. */}
            <FormField label="Client name" required>
              <input className={inputClass} value={form.companyName} onChange={(e) => set({ companyName: e.target.value })} required
                placeholder="The company, as it will appear on the mandate" data-testid="lead-client-name" />
            </FormField>
            {/* 3. WHO WE SPEAK TO THERE. The first is the lead's own name, phone and email -- the
                stored shape is unchanged; further people become contacts on the lead. */}
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400" data-testid="lead-contact-heading">
              {others.length > 0 ? 'Contact persons' : 'Contact person'}
            </p>
            <div className="mb-3 rounded-lg border border-slate-200 p-3 pb-0" data-testid="lead-contact-0">
              <div className="grid grid-cols-2 gap-3">
                <FormField label="First Name" required>
                  <input className={inputClass} value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} required />
                </FormField>
                <FormField label="Last Name">
                  <input className={inputClass} value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} />
                </FormField>
                <FormField label="Phone">
                  <input className={inputClass} value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
                </FormField>
                <FormField label="Email">
                  <input type="email" className={inputClass} value={form.email} onChange={(e) => set({ email: e.target.value })} />
                </FormField>
              </div>
              <FormField label="Role">
                <input className={inputClass} value={form.jobTitle} onChange={(e) => set({ jobTitle: e.target.value })} placeholder="e.g. Financial manager" />
              </FormField>
            </div>
            {others.map((o, i) => (
              <div key={i} className="mb-3 rounded-lg border border-slate-200 p-3 pb-0" data-testid={`lead-contact-${i + 1}`}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-slate-400">Contact person {i + 2}</span>
                  <button type="button" className="text-xs text-slate-500 hover:text-red-600"
                    onClick={() => setOthers((prev) => prev.filter((_, j) => j !== i))}>Remove</button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="First Name" required>
                    <input className={inputClass} value={o.firstName} onChange={(e) => setOther(i, { firstName: e.target.value })} />
                  </FormField>
                  <FormField label="Last Name">
                    <input className={inputClass} value={o.lastName} onChange={(e) => setOther(i, { lastName: e.target.value })} />
                  </FormField>
                  <FormField label="Phone">
                    <input className={inputClass} value={o.phone} onChange={(e) => setOther(i, { phone: e.target.value })} />
                  </FormField>
                  <FormField label="Email">
                    <input type="email" className={inputClass} value={o.email} onChange={(e) => setOther(i, { email: e.target.value })} />
                  </FormField>
                </div>
                <FormField label="Role">
                  <input className={inputClass} value={o.jobTitle} onChange={(e) => setOther(i, { jobTitle: e.target.value })} />
                </FormField>
              </div>
            ))}
            <button type="button" onClick={() => setOthers((prev) => [...prev, emptyContactPerson()])}
              className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700" data-testid="lead-add-contact">
              <Plus size={14} /> Add another contact person
            </button>
            {further.problem && <p className="-mt-2 mb-3 text-[12px] text-[var(--c-rust-deep)]">{further.problem}</p>}
          </>
        )}

        {party === 'individual' && (
          <>
            {/* 2. THE CLIENT'S NAME IS THE PERSON'S. 3. Their own phone and email are the contact
                details -- there is nobody else to ask for, so the form does not ask twice. */}
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400" data-testid="lead-individual-name">Client name</p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="First Name" required>
                <input className={inputClass} value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} required />
              </FormField>
              <FormField label="Last Name">
                <input className={inputClass} value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} />
              </FormField>
            </div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Their contact details</p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Phone">
                <input className={inputClass} value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
              </FormField>
              <FormField label="Email">
                <input type="email" className={inputClass} value={form.email} onChange={(e) => set({ email: e.target.value })} />
              </FormField>
            </div>
          </>
        )}

        {party !== null && (
          <>
            {!form.phone && !form.email && (
              <p className="-mt-1 mb-3 text-[12px] text-slate-400">A phone number or an email address is needed to save the lead.</p>
            )}
            <FormField label="Lead Source" required>
              <select className={inputClass} value={form.source} onChange={(e) => set({ source: e.target.value as LeadSource })}>
                {leadSources.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Owner">
              <select className={inputClass} value={form.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </FormField>
            <LeadOpportunityFields value={opportunity} onChange={setOpportunity} />
          </>
        )}
        <SubmitRow onClose={onClose} label={title} />
      </form>
    </Modal>
  )
}

export function ContactForm({ onClose, store }: { onClose: () => void; store: Store }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', jobTitle: '', companyId: store.companies[0]?.id ?? '', email: '', phone: '' })
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
          <ClientPicker
            clients={store.companies}
            value={form.companyId}
            onChange={(companyId) => setForm({ ...form, companyId })} />
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
  const [form, setForm] = useState({
    companyId: store.companies[0]?.id ?? '',
    service: services[0],
    value: '',
    handoverAmount: '',
    accountsCount: '',
    expectedCloseDate: '',
    notes: '',
  })
  const isHandover = isHandoverService(form.service)
  const company = store.companies.find((c) => c.id === form.companyId)
  // Sub-accounts share a parent's name closely enough that the code is what tells them apart.
  const clientOptions = useMemo(
    () =>
      [...store.companies]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ id: c.id, label: c.name, hint: c.code ?? undefined })),
    [store.companies],
  )

  return (
    <Modal title="Add Deal" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.companyId || !company) return
          const deal = store.addDeal({
            // Named from the client and the service rather than asked for. Every deal name
            // anyone typed was one of these two things anyway, and a blank required field is
            // a toll on the way to the information that matters.
            name: `${company.name} — ${form.service}`,
            companyId: form.companyId,
            service: form.service,
            value: isHandover ? 0 : Number(form.value) || 0,
            handoverAmount: isHandover && form.handoverAmount !== '' ? Number(form.handoverAmount) : undefined,
            accountsCount: isHandover && form.accountsCount !== '' ? Number(form.accountsCount) : undefined,
            notes: form.notes.trim() || undefined,
            expectedCloseDate: form.expectedCloseDate ? new Date(form.expectedCloseDate).toISOString() : clockNow().toISOString(),
          })
          onClose()
          navigate(`/deals/${deal.id}`)
        }}
      >
        <FormField label="Client" required>
          <SearchableSelect
            ariaLabel="Client"
            value={form.companyId}
            onChange={(companyId) => setForm({ ...form, companyId })}
            placeholder="Search clients…"
            emptyLabel="No client matches that name"
            options={clientOptions}
          />
        </FormField>
        <FormField label="Service" required>
          <select className={inputClass} value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value as ProductService })}>
            {services.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </FormField>
        {/* What "how much" means depends entirely on the service: a book to collect against,
            or a fee to invoice. Asking for the wrong one is how a book ends up counted as
            revenue. */}
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
