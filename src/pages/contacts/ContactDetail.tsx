import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Mail, Phone, StickyNote, Building2 } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { Card, CardHeader } from '../../components/ui/Card'
import { Avatar } from '../../components/ui/Avatar'
import { StageBadge } from '../../components/ui/Badge'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { ComposeEmailModal } from '../../components/ComposeEmailModal'
import { companyById, formatCurrency, formatDate, formatDateTime, userById } from '../../data/mockData'

export function ContactDetail() {
  const { id } = useParams()
  const { contacts, deals, activities, tasks, addActivity } = useAppStore()
  const contact = contacts.find((c) => c.id === id)
  const [noteOpen, setNoteOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)

  const contactDeals = useMemo(() => deals.filter((d) => d.contactId === id), [deals, id])
  const contactActivities = useMemo(
    () => activities.filter((a) => a.contactId === id || (a.companyId === contact?.companyId && contactDeals.some((d) => d.id === a.dealId))).sort((a, b) => new Date(b.activityDate).getTime() - new Date(a.activityDate).getTime()),
    [activities, id, contact, contactDeals],
  )
  const contactTasks = useMemo(() => tasks.filter((t) => t.contactId === id || contactDeals.some((d) => d.id === t.dealId)), [tasks, id, contactDeals])
  const notes = contactActivities.filter((a) => a.type === 'Note')

  if (!contact) {
    return (
      <div className="text-center py-16 text-slate-400">
        Contact not found. <Link to="/contacts" className="text-brand-600 hover:underline">Back to contacts</Link>
      </div>
    )
  }

  const company = companyById(contact.companyId)

  return (
    <div className="space-y-5">
      <Link to="/contacts" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={15} /> Back to Contacts
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <Avatar name={`${contact.firstName} ${contact.lastName}`} color="#416281" size={48} />
            <div>
              <h2 className="text-lg font-semibold text-slate-800">{contact.firstName} {contact.lastName}</h2>
              <p className="text-sm text-slate-500">{contact.jobTitle}{company ? ` at ${company.name}` : ''}</p>
              <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                {contact.email && (
                  <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1 hover:text-brand-600">
                    <Mail size={12} /> {contact.email}
                  </a>
                )}
                {(contact.phone || contact.mobile) && (
                  <a href={`tel:${contact.phone ?? contact.mobile}`} className="inline-flex items-center gap-1 hover:text-brand-600">
                    <Phone size={12} /> {contact.phone ?? contact.mobile}
                  </a>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {contact.email && (
              <button onClick={() => setEmailOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                <Mail size={14} /> Send Email
              </button>
            )}
            <button onClick={() => setNoteOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
              <StickyNote size={14} /> Add Note
            </button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <CardHeader title="Deals" />
            {contactDeals.length === 0 ? (
              <p className="text-sm text-slate-400">No deals linked to this contact yet.</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {contactDeals.map((d) => (
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
            <CardHeader title="Activities" />
            {contactActivities.length === 0 ? (
              <p className="text-sm text-slate-400">No activity recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {contactActivities.slice(0, 8).map((a) => (
                  <div key={a.id} className="flex justify-between text-sm border-b border-slate-50 pb-2.5 last:border-0">
                    <span className="text-slate-700">{a.subject}</span>
                    <span className="text-xs text-slate-400">{formatDateTime(a.activityDate)}</span>
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

        <div className="space-y-5">
          <Card>
            <CardHeader title="Personal Details" />
            <dl className="space-y-3 text-sm">
              <Field label="First Name" value={contact.firstName} />
              <Field label="Last Name" value={contact.lastName} />
              <Field label="Job Title" value={contact.jobTitle} />
              <Field label="Email" value={contact.email} />
              <Field label="Phone" value={contact.phone} />
              <Field label="Mobile" value={contact.mobile} />
              <Field label="Owner" value={userById(contact.ownerId)?.name} />
              <Field label="Created" value={formatDate(contact.createdAt)} />
              <Field label="Last Contact" value={formatDate(contact.lastContactAt)} />
            </dl>
          </Card>

          {company && (
            <Card>
              <CardHeader title="Company" />
              <Link to={`/companies/${company.id}`} className="flex items-center gap-2.5 hover:bg-slate-50 -mx-1 px-1 py-1 rounded-lg">
                <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
                  <Building2 size={16} />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">{company.name}</p>
                  <p className="text-xs text-slate-400">{company.industry}</p>
                </div>
              </Link>
            </Card>
          )}

          <Card>
            <CardHeader title="Tasks" />
            {contactTasks.length === 0 ? (
              <p className="text-sm text-slate-400">No tasks yet.</p>
            ) : (
              <div className="space-y-2">
                {contactTasks.map((t) => (
                  <div key={t.id} className="text-sm">
                    <p className="text-slate-700">{t.title}</p>
                    <p className="text-xs text-slate-400">Due {formatDate(t.dueDate)}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {noteOpen && (
        <NoteModal
          onClose={() => setNoteOpen(false)}
          onSave={(text) => addActivity({ type: 'Note', subject: 'Note added', notes: text, contactId: contact.id, companyId: contact.companyId })}
        />
      )}
      {emailOpen && contact.email && (
        <ComposeEmailModal
          to={contact.email}
          onClose={() => setEmailOpen(false)}
          onSent={(subject, bodyText) => addActivity({ type: 'Email', subject, notes: bodyText, contactId: contact.id, companyId: contact.companyId })}
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
