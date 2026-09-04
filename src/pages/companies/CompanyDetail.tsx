import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Mail, Phone, Globe, StickyNote, Pencil, Handshake, CalendarClock, Users2 } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { Card, CardHeader } from '../../components/ui/Card'
import { StatusBadge, StageBadge } from '../../components/ui/Badge'
import { UserAvatar } from '../../components/ui/Avatar'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { formatCurrency, formatDate, formatDateTime, services } from '../../data/mockData'
import type { ProductService } from '../../types'

export function CompanyDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { companies, contacts, leads, deals, activities, tasks, users, addActivity, updateCompany, addDeal, addTask } = useAppStore()
  const company = companies.find((c) => c.id === id)
  const reps = useMemo(() => users.filter((u) => u.role.includes('Sales') || u.role === 'Administrator'), [users])
  const [noteOpen, setNoteOpen] = useState(false)
  const [ownerOpen, setOwnerOpen] = useState(false)
  const [dealOpen, setDealOpen] = useState(false)
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [meetingOpen, setMeetingOpen] = useState(false)

  const companyContacts = useMemo(() => contacts.filter((c) => c.companyId === id), [contacts, id])
  const companyLeads = useMemo(() => leads.filter((l) => l.companyId === id), [leads, id])
  const companyDeals = useMemo(() => deals.filter((d) => d.companyId === id), [deals, id])
  const openDeals = companyDeals.filter((d) => d.stage !== 'Won' && d.stage !== 'Lost')
  const wonDeals = companyDeals.filter((d) => d.stage === 'Won')
  const subAccounts = useMemo(() => companies.filter((c) => c.parentCompanyId === id), [companies, id])
  const isClient = wonDeals.length > 0 || !!company?.code
  const companyActivities = useMemo(
    () => activities.filter((a) => a.companyId === id).sort((a, b) => new Date(b.activityDate).getTime() - new Date(a.activityDate).getTime()),
    [activities, id],
  )
  const companyTasks = useMemo(() => tasks.filter((t) => t.companyId === id), [tasks, id])
  const notes = companyActivities.filter((a) => a.type === 'Note')
  const lifetimeValue = wonDeals.reduce((s, d) => s + d.value, 0)

  if (!company) {
    return (
      <div className="text-center py-16 text-slate-400">
        Client not found. <Link to="/companies" className="text-brand-600 hover:underline">Back to clients</Link>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Link to="/companies" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={15} /> Back to Clients
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-800">{company.name}</h2>
              {company.code && <span className="font-mono text-[11px] text-white bg-gold-500 px-2 py-0.5 rounded-md">{company.code}</span>}
            </div>
            {company.parentCompanyId && (
              <p className="text-xs text-slate-400 mt-0.5">
                Sub-account of{' '}
                <Link to={`/companies/${company.parentCompanyId}`} className="text-brand-600 hover:underline">
                  {companies.find((c) => c.id === company.parentCompanyId)?.name}
                </Link>
              </p>
            )}
            <p className="text-sm text-slate-500 mt-0.5">{company.industry} · {company.city}, {company.province}</p>
            {(company.accountCount !== undefined || company.handoverAmount !== undefined) && (
              <p className="text-xs text-slate-500 mt-1">
                {company.accountCount ?? 0} accounts · Handover {formatCurrency(company.handoverAmount ?? 0)}
                {company.paymentsToDate !== undefined && ` · Paid to date ${formatCurrency(company.paymentsToDate)}`}
              </p>
            )}
            <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
              {company.email && (
                <a href={`mailto:${company.email}`} className="inline-flex items-center gap-1 hover:text-brand-600">
                  <Mail size={12} /> {company.email}
                </a>
              )}
              {company.phone && (
                <a href={`tel:${company.phone}`} className="inline-flex items-center gap-1 hover:text-brand-600">
                  <Phone size={12} /> {company.phone}
                </a>
              )}
              {company.website && (
                <span className="inline-flex items-center gap-1">
                  <Globe size={12} /> {company.website}
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Lifetime Value</p>
            <p className="text-xl font-bold text-slate-800">{formatCurrency(lifetimeValue)}</p>
            <div className="flex items-center gap-2 mt-2">
              {isClient && (
                <button onClick={() => setDealOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                  <Handshake size={13} /> Add Deal
                </button>
              )}
              {isClient && (
                <button onClick={() => setFollowUpOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                  <CalendarClock size={13} /> Schedule Follow-up
                </button>
              )}
              {isClient && (
                <button onClick={() => setMeetingOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                  <Users2 size={13} /> Schedule Meeting
                </button>
              )}
              <button onClick={() => setNoteOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                <StickyNote size={13} /> Add Note
              </button>
            </div>
          </div>
        </div>
      </Card>

      {subAccounts.length > 0 && (
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Sub-accounts" subtitle={`${subAccounts.length} under this client`} />
          </div>
          <div className="overflow-x-auto px-5 pb-5">
            <table className="w-full text-sm border border-slate-100 rounded-xl overflow-hidden">
              <thead>
                <tr className="text-left text-xs text-slate-400 bg-slate-50/70">
                  <th className="font-medium px-4 py-2.5">Sub-account</th>
                  <th className="font-medium px-3 py-2.5">Code</th>
                  <th className="font-medium px-3 py-2.5 text-right">Accounts</th>
                  <th className="font-medium px-3 py-2.5 text-right">Handover Amount</th>
                  <th className="font-medium px-3 py-2.5 text-right">Payments to Date</th>
                </tr>
              </thead>
              <tbody>
                {subAccounts.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer" onClick={() => navigate(`/companies/${s.id}`)}>
                    <td className="px-4 py-2.5">
                      <Link to={`/companies/${s.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-slate-700 hover:text-brand-600">
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      {s.code ? <span className="font-mono text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">{s.code}</span> : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">{s.accountCount ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">{s.handoverAmount !== undefined ? formatCurrency(s.handoverAmount) : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">{s.paymentsToDate !== undefined ? formatCurrency(s.paymentsToDate) : '—'}</td>
                  </tr>
                ))}
                <tr className="border-t border-slate-200" style={{ background: 'rgba(236,220,184,0.25)' }}>
                  <td className="px-4 py-2.5 font-bold text-slate-800">Total</td>
                  <td className="px-3 py-2.5"></td>
                  <td className="px-3 py-2.5 text-right font-bold text-slate-800 tabular-nums">{subAccounts.reduce((s, a) => s + (a.accountCount ?? 0), 0)}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-slate-800 tabular-nums">{formatCurrency(subAccounts.reduce((s, a) => s + (a.handoverAmount ?? 0), 0))}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-slate-800 tabular-nums">{formatCurrency(subAccounts.reduce((s, a) => s + (a.paymentsToDate ?? 0), 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <CardHeader title="Open Deals" subtitle={`${openDeals.length} active`} />
            {openDeals.length === 0 ? (
              <p className="text-sm text-slate-400">No open deals.</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {openDeals.map((d) => (
                  <Link key={d.id} to={`/deals/${d.id}`} className="flex items-center justify-between py-2.5 hover:bg-slate-50/60 -mx-1 px-1 rounded-lg">
                    <span className="text-sm font-medium text-slate-700">{d.name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-slate-500">{formatCurrency(d.value)}</span>
                      <StageBadge stage={d.stage} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Won Deals" subtitle={`${wonDeals.length} closed`} />
            {wonDeals.length === 0 ? (
              <p className="text-sm text-slate-400">No won deals yet.</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {wonDeals.map((d) => (
                  <Link key={d.id} to={`/deals/${d.id}`} className="flex items-center justify-between py-2.5 hover:bg-slate-50/60 -mx-1 px-1 rounded-lg">
                    <span className="text-sm font-medium text-slate-700">{d.name}</span>
                    <span className="text-sm font-semibold text-[#957323]">{formatCurrency(d.value)}</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Leads" />
            {companyLeads.length === 0 ? (
              <p className="text-sm text-slate-400">No leads for this company.</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {companyLeads.map((l) => (
                  <Link key={l.id} to={`/leads/${l.id}`} className="flex items-center justify-between py-2.5 hover:bg-slate-50/60 -mx-1 px-1 rounded-lg">
                    <span className="text-sm font-medium text-slate-700">{l.firstName} {l.lastName}</span>
                    <StatusBadge status={l.status} />
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Activities" />
            {companyActivities.length === 0 ? (
              <p className="text-sm text-slate-400">No activity recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {companyActivities.slice(0, 8).map((a) => (
                  <div key={a.id} className="flex justify-between text-sm border-b border-slate-50 pb-2.5 last:border-0">
                    <span className="text-slate-700">{a.subject}</span>
                    <span className="text-xs text-slate-400">{formatDateTime(a.activityDate)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Company Information" />
            <dl className="space-y-3 text-sm">
              <Field label="Industry" value={company.industry} />
              <Field label="Province" value={company.province} />
              <Field label="City" value={company.city} />
              <Field label="Address" value={company.address} />
              <Field label="Signed by (Marketing Agent)" value={company.marketingAgent} />
              <div className="flex justify-between gap-3 items-center">
                <dt className="text-slate-400">Account Owner</dt>
                <dd className="flex items-center gap-1.5">
                  <span className="text-slate-700 font-medium">{users.find((u) => u.id === company.accountOwnerId)?.name ?? '—'}</span>
                  <button onClick={() => setOwnerOpen(true)} className="p-1 rounded-lg text-slate-300 hover:text-slate-600 hover:bg-slate-100">
                    <Pencil size={12} />
                  </button>
                </dd>
              </div>
              <Field label="Created" value={formatDate(company.createdAt)} />
            </dl>
          </Card>

          <Card>
            <CardHeader title="Contacts" />
            {companyContacts.length === 0 ? (
              <p className="text-sm text-slate-400">No contacts yet.</p>
            ) : (
              <div className="space-y-2.5">
                {companyContacts.map((c) => (
                  <Link key={c.id} to={`/contacts/${c.id}`} className="flex items-center gap-2.5 hover:bg-slate-50 -mx-1 px-1 py-1 rounded-lg">
                    <UserAvatar userId={c.ownerId} size={26} />
                    <div>
                      <p className="text-sm font-medium text-slate-700">{c.firstName} {c.lastName}</p>
                      <p className="text-xs text-slate-400">{c.jobTitle}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Tasks" />
            {companyTasks.length === 0 ? (
              <p className="text-sm text-slate-400">No tasks yet.</p>
            ) : (
              <div className="space-y-2">
                {companyTasks.map((t) => (
                  <div key={t.id} className="text-sm">
                    <p className="text-slate-700">{t.title}</p>
                    <p className="text-xs text-slate-400">Due {formatDate(t.dueDate)}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Notes" />
            {notes.length === 0 ? (
              <p className="text-sm text-slate-400">No notes yet.</p>
            ) : (
              <div className="space-y-2.5">
                {notes.map((n) => (
                  <div key={n.id} className="bg-[#f7f4eb] border border-[#e7dbb2] rounded-lg p-3">
                    <p className="text-sm text-slate-700">{n.notes || n.subject}</p>
                    <p className="text-[11px] text-slate-400 mt-1">{formatDateTime(n.activityDate)}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {noteOpen && (
        <NoteModal onClose={() => setNoteOpen(false)} onSave={(text) => addActivity({ type: 'Note', subject: 'Note added', notes: text, companyId: company.id })} />
      )}
      {ownerOpen && (
        <EditOwnerModal
          currentOwnerId={company.accountOwnerId}
          reps={reps}
          onClose={() => setOwnerOpen(false)}
          onSave={(accountOwnerId) => updateCompany(company.id, { accountOwnerId })}
        />
      )}
      {dealOpen && <AddClientDealModal onClose={() => setDealOpen(false)} onSave={(input) => addDeal({ ...input, companyId: company.id })} />}
      {followUpOpen && (
        <ScheduleFollowUpModal
          onClose={() => setFollowUpOpen(false)}
          onSave={(input) => addTask({ ...input, companyId: company.id, relatedToLabel: company.name })}
        />
      )}
      {meetingOpen && (
        <ScheduleMeetingModal
          onClose={() => setMeetingOpen(false)}
          onSave={(input) => addTask({ ...input, type: 'Meeting', companyId: company.id, relatedToLabel: company.name })}
        />
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-slate-700 font-medium text-right">{value || '—'}</dd>
    </div>
  )
}

function NoteModal({ onClose, onSave }: { onClose: () => void; onSave: (text: string) => void }) {
  const [text, setText] = useState('')
  return (
    <Modal title="Add Note" onClose={onClose} width={400}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          onSave(text)
          onClose()
        }}
      >
        <FormField label="Note" required>
          <textarea className={inputClass} rows={4} value={text} onChange={(e) => setText(e.target.value)} required autoFocus />
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Add Note
          </button>
        </div>
      </form>
    </Modal>
  )
}

function EditOwnerModal({
  currentOwnerId,
  reps,
  onClose,
  onSave,
}: {
  currentOwnerId: string
  reps: ReturnType<typeof useAppStore>['users']
  onClose: () => void
  onSave: (ownerId: string) => void
}) {
  const [ownerId, setOwnerId] = useState(currentOwnerId)
  return (
    <Modal title="Reassign Account Owner" onClose={onClose} width={380}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave(ownerId)
          onClose()
        }}
      >
        <FormField label="Account Owner" required>
          <select className={inputClass} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}

function AddClientDealModal({ onClose, onSave }: { onClose: () => void; onSave: (input: { name: string; value: number; service: ProductService; expectedCloseDate: string }) => void }) {
  const [form, setForm] = useState({ name: '', value: '', service: services[0], expectedCloseDate: '' })
  return (
    <Modal title="Add Deal" onClose={onClose} width={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.name) return
          onSave({
            name: form.name,
            value: Number(form.value) || 0,
            service: form.service,
            expectedCloseDate: form.expectedCloseDate ? new Date(form.expectedCloseDate).toISOString() : new Date().toISOString(),
          })
          onClose()
        }}
      >
        <FormField label="Deal Name" required>
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus placeholder="e.g. Annual renewal" />
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

function ScheduleFollowUpModal({ onClose, onSave }: { onClose: () => void; onSave: (input: { title: string; dueDate: string }) => void }) {
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
          <input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required autoFocus placeholder="e.g. Quarterly check-in call" />
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

function ScheduleMeetingModal({ onClose, onSave }: { onClose: () => void; onSave: (input: { title: string; dueDate: string }) => void }) {
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
          <input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required autoFocus placeholder="e.g. Quarterly review" />
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
