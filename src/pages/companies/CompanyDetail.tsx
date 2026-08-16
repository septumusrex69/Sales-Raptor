import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Mail, Phone, Globe, StickyNote } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { Card, CardHeader } from '../../components/ui/Card'
import { StatusBadge, StageBadge } from '../../components/ui/Badge'
import { UserAvatar } from '../../components/ui/Avatar'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { formatCurrency, formatDate, formatDateTime, userById } from '../../data/mockData'

export function CompanyDetail() {
  const { id } = useParams()
  const { companies, contacts, leads, deals, activities, tasks, addActivity } = useAppStore()
  const company = companies.find((c) => c.id === id)
  const [noteOpen, setNoteOpen] = useState(false)

  const companyContacts = useMemo(() => contacts.filter((c) => c.companyId === id), [contacts, id])
  const companyLeads = useMemo(() => leads.filter((l) => l.companyId === id), [leads, id])
  const companyDeals = useMemo(() => deals.filter((d) => d.companyId === id), [deals, id])
  const openDeals = companyDeals.filter((d) => d.stage !== 'Won' && d.stage !== 'Lost')
  const wonDeals = companyDeals.filter((d) => d.stage === 'Won')
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
        Company not found. <Link to="/companies" className="text-brand-600 hover:underline">Back to companies</Link>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Link to="/companies" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={15} /> Back to Companies
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{company.name}</h2>
            <p className="text-sm text-slate-500 mt-0.5">{company.industry} · {company.city}, {company.province}</p>
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
            <button onClick={() => setNoteOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 mt-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
              <StickyNote size={13} /> Add Note
            </button>
          </div>
        </div>
      </Card>

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
                    <span className="text-sm font-semibold text-emerald-600">{formatCurrency(d.value)}</span>
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
              <Field label="Account Owner" value={userById(company.accountOwnerId)?.name} />
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
                  <div key={n.id} className="bg-amber-50/60 border border-amber-100 rounded-lg p-3">
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
