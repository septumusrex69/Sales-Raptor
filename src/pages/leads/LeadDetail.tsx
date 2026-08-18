import { useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { ArrowLeft, Pencil, ArrowRightLeft, StickyNote, CheckSquare, Calendar, XCircle, Phone, Mail, Trash2 } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { Card, CardHeader } from '../../components/ui/Card'
import { StatusBadge, ServiceBadge, StageBadge } from '../../components/ui/Badge'
import { Avatar, UserAvatar } from '../../components/ui/Avatar'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { ConfirmDeleteModal } from '../../components/ui/ConfirmDeleteModal'
import { formatCurrency, formatDate, formatDateTime, formatLeadNumber, industries, leadSources } from '../../data/mockData'
import type { ActivityType, LeadStatus, TaskType } from '../../types'
import { LeadOpportunityFields, leadOpportunityValueFromLead, leadOpportunityPatch, serviceValueLabel, leadServiceValueList } from '../../components/leads/LeadOpportunityFields'

const ALL_STATUSES: LeadStatus[] = ['New', 'Attempting Contact', 'Contacted', 'Qualified', 'Unqualified', 'Proposal Required', 'Converted', 'Lost']

export function LeadDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { leads, deals, activities, users, userById, updateLead, convertLeadToDeal, markLeadLost, deleteLead, addActivity, addTask } = useAppStore()
  const reps = useMemo(() => users.filter((u) => u.role.includes('Sales') || u.role === 'Administrator'), [users])
  const lead = leads.find((l) => l.id === id)
  const resultingDeals = useMemo(() => deals.filter((d) => d.leadId === id), [deals, id])

  const [editOpen, setEditOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [taskOpen, setTaskOpen] = useState<'task' | 'meeting' | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const timeline = useMemo(
    () => activities.filter((a) => a.leadId === id).sort((a, b) => new Date(b.activityDate).getTime() - new Date(a.activityDate).getTime()),
    [activities, id],
  )

  if (!lead) {
    return (
      <div className="text-center py-16 text-slate-400">
        Lead not found. <Link to="/leads" className="text-brand-600 hover:underline">Back to leads</Link>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Link to="/leads" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={15} /> Back to Leads
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <Avatar name={`${lead.firstName} ${lead.lastName}`} color="#6086a9" size={48} />
            <div>
              <p className="text-xs font-medium text-slate-400 tracking-wide">{formatLeadNumber(lead.leadNumber)}</p>
              <h2 className="text-lg font-semibold text-slate-800">{lead.firstName} {lead.lastName}</h2>
              <p className="text-sm text-slate-500">{lead.jobTitle ? `${lead.jobTitle} at ` : ''}{lead.companyName}</p>
              <div className="flex items-center gap-2 mt-2">
                <StatusBadge status={lead.status} />
                <span className="text-xs text-slate-400">Source: {lead.source}</span>
              </div>
              {lead.services && lead.services.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {lead.services.map((s) => (
                    <ServiceBadge key={s} service={s} />
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Estimated Value</p>
            <p className="text-xl font-bold text-slate-800">{formatCurrency(lead.estimatedValue)}</p>
            <div className="flex items-center gap-1.5 justify-end mt-1.5">
              <UserAvatar userId={lead.ownerId} size={20} />
              <span className="text-xs text-slate-500">{userById(lead.ownerId)?.name}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-slate-100">
          <ActionButton icon={Pencil} label="Edit" onClick={() => setEditOpen(true)} />
          <ActionButton
            icon={ArrowRightLeft}
            label="Convert"
            onClick={() => {
              const deal = convertLeadToDeal(lead.id)
              if (deal) navigate(`/deals/${deal.id}`)
            }}
            disabled={lead.status === 'Converted' || lead.status === 'Lost'}
          />
          <ActionButton icon={StickyNote} label="Add Activity" onClick={() => setActivityOpen(true)} />
          <ActionButton icon={CheckSquare} label="Create Task" onClick={() => setTaskOpen('task')} />
          <ActionButton icon={Calendar} label="Schedule Meeting" onClick={() => setTaskOpen('meeting')} />
          <ActionButton icon={XCircle} label="Mark Lost" tone="danger" onClick={() => markLeadLost(lead.id)} disabled={lead.status === 'Lost'} />
          <ActionButton icon={Trash2} label="Delete" tone="danger" onClick={() => setDeleteOpen(true)} />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <CardHeader title="Contact Information" />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3.5 text-sm">
              <Field label="First Name" value={lead.firstName} />
              <Field label="Last Name" value={lead.lastName} />
              <Field label="Company" value={lead.companyName} />
              <Field label="Job Title" value={lead.jobTitle} />
              <Field label="Email" value={lead.email} icon={Mail} href={lead.email ? `mailto:${lead.email}` : undefined} />
              <Field label="Mobile Number" value={lead.mobile} icon={Phone} href={lead.mobile ? `tel:${lead.mobile}` : undefined} />
              <Field label="Office Number" value={lead.phone} icon={Phone} href={lead.phone ? `tel:${lead.phone}` : undefined} />
              <Field label="Industry" value={lead.industry} />
              <Field label="Country" value={lead.country} />
              <Field label="Province" value={lead.province} />
              <Field label="City / Town" value={lead.city} />
              <Field label="Address" value={lead.address} />
            </dl>
          </Card>

          <Card>
            <CardHeader title="Lead Information" />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3.5 text-sm">
              <Field label="Lead Source" value={lead.source} />
              <Field label="Campaign" value={lead.campaign} />
              <Field label="Assigned Owner" value={userById(lead.ownerId)?.name} />
              <Field label="Lead Status" value={lead.status} />
              <Field label="Lead Score" value={`${lead.score} / 100`} />
              <Field label="Estimated Value" value={formatCurrency(lead.estimatedValue)} />
              <Field label="Classification" value={lead.classification ? `Class ${lead.classification}` : undefined} />
              <Field label="Date Created" value={formatDate(lead.createdAt)} />
              <Field label="Last Contact" value={formatDate(lead.lastContactAt)} />
              <Field label="Next Follow-up" value={formatDate(lead.nextFollowUpAt)} />
            </dl>
            {lead.notes && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs font-medium text-slate-400 mb-1">Notes</p>
                <p className="text-sm text-slate-600">{lead.notes}</p>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Opportunity Information" />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3.5 text-sm">
              {leadServiceValueList(lead).map((sv) =>
                sv.service === 'Debt Collection' ? (
                  <div key={sv.service} className="col-span-2 grid grid-cols-2 gap-x-6 gap-y-3.5">
                    <Field label="Estimated Handover Amount" value={sv.handoverAmount != null ? formatCurrency(sv.handoverAmount) : undefined} />
                    <Field label="Estimated Number of Accounts / Matters" value={sv.accountsCount != null ? String(sv.accountsCount) : undefined} />
                  </div>
                ) : (
                  <Field
                    key={sv.service}
                    label={lead.services && lead.services.length > 1 ? `${sv.service} — ${serviceValueLabel(sv.service)}` : serviceValueLabel(sv.service)}
                    value={sv.value != null ? formatCurrency(sv.value) : undefined}
                  />
                ),
              )}
              {lead.services?.includes('Other') && <Field label="Other Service — Please Specify" value={lead.otherServiceDetail} />}
            </dl>
            {(!lead.services || lead.services.length === 0) && !lead.estimatedProjectValue && (
              <p className="text-xs text-slate-400">No products or services captured yet. Use Edit to add opportunity details.</p>
            )}
          </Card>

          {resultingDeals.length > 0 && (
            <Card>
              <CardHeader title="Resulting Deal(s)" />
              <div className="space-y-2">
                {resultingDeals.map((d) => (
                  <Link
                    key={d.id}
                    to={`/deals/${d.id}`}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-700">{d.name}</p>
                      {d.service && <p className="text-xs text-slate-400">{d.service}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-slate-700">{formatCurrency(d.value)}</span>
                      <StageBadge stage={d.stage} />
                    </div>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>

        <Card padded={false} className="h-fit">
          <div className="p-5 pb-3">
            <CardHeader title="Activity Timeline" />
          </div>
          <div className="px-5 pb-5 space-y-4 max-h-[600px] overflow-y-auto">
            {timeline.length === 0 && <p className="text-sm text-slate-400">No activity recorded yet.</p>}
            {timeline.map((a, i) => (
              <div key={a.id} className="relative pl-5">
                {i !== timeline.length - 1 && <span className="absolute left-[3px] top-3 bottom-[-16px] w-px bg-slate-100" />}
                <span className="absolute left-0 top-1.5 w-2 h-2 rounded-full bg-brand-500" />
                <p className="text-xs text-slate-400">{formatDateTime(a.activityDate)}</p>
                <p className="text-sm font-medium text-slate-700 mt-0.5">{a.subject}</p>
                {a.notes && <p className="text-xs text-slate-500 mt-0.5">{a.notes}</p>}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {editOpen && <EditLeadModal lead={lead} reps={reps} onClose={() => setEditOpen(false)} onSave={(patch) => updateLead(lead.id, patch)} />}
      {activityOpen && (
        <AddActivityModal
          onClose={() => setActivityOpen(false)}
          onSave={(type, notes) => addActivity({ type, subject: `${type}: ${lead.firstName} ${lead.lastName}`, notes, leadId: lead.id, companyId: lead.companyId })}
        />
      )}
      {taskOpen && (
        <QuickTaskModal
          isMeeting={taskOpen === 'meeting'}
          onClose={() => setTaskOpen(null)}
          onSave={(title, dueDate, type) => addTask({ title, dueDate, type, leadId: lead.id, companyId: lead.companyId, relatedToLabel: `${lead.firstName} ${lead.lastName}` })}
        />
      )}
      {deleteOpen && (
        <ConfirmDeleteModal
          title="Delete Lead"
          itemLabel={`${lead.firstName} ${lead.lastName}`}
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => {
            deleteLead(lead.id)
            navigate('/leads')
          }}
        />
      )}
    </div>
  )
}

function ActionButton({ icon: Icon, label, onClick, tone, disabled }: { icon: typeof Pencil; label: string; onClick: () => void; tone?: 'danger'; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        tone === 'danger' ? 'border-red-100 text-red-600 hover:bg-red-50' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
      }`}
    >
      <Icon size={14} /> {label}
    </button>
  )
}

function Field({ label, value, icon: Icon, href }: { label: string; value?: string; icon?: typeof Mail; href?: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-400 mb-0.5">{label}</dt>
      <dd className="text-slate-700 font-medium flex items-center gap-1.5">
        {Icon && <Icon size={13} className="text-slate-400" />}
        {href ? (
          <a href={href} className="hover:text-brand-600 hover:underline">
            {value ?? '—'}
          </a>
        ) : (
          value || '—'
        )}
      </dd>
    </div>
  )
}

function EditLeadModal({
  lead,
  reps,
  onClose,
  onSave,
}: {
  lead: ReturnType<typeof useAppStore>['leads'][number]
  reps: ReturnType<typeof useAppStore>['users']
  onClose: () => void
  onSave: (patch: Partial<typeof lead>) => void
}) {
  const [form, setForm] = useState({ ...lead })
  const [opportunity, setOpportunity] = useState(() => leadOpportunityValueFromLead(lead))
  return (
    <Modal title="Edit Lead" onClose={onClose} width={560}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave({ ...form, ...leadOpportunityPatch(opportunity) })
          onClose()
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <FormField label="First Name" required>
            <input className={inputClass} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
          </FormField>
          <FormField label="Last Name">
            <input className={inputClass} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </FormField>
          <FormField label="Job Title">
            <input className={inputClass} value={form.jobTitle ?? ''} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
          </FormField>
          <FormField label="Company">
            <input className={inputClass} value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          </FormField>
          <FormField label="Email">
            <input type="email" className={inputClass} value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </FormField>
          <FormField label="Mobile">
            <input className={inputClass} value={form.mobile ?? ''} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          </FormField>
          <FormField label="Lead Status">
            <select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as LeadStatus })}>
              {ALL_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Lead Source">
            <select className={inputClass} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as typeof form.source })}>
              {leadSources.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Estimated Value (R)">
            <input type="number" className={inputClass} value={form.estimatedValue} onChange={(e) => setForm({ ...form, estimatedValue: Number(e.target.value) })} />
          </FormField>
          <FormField label="Lead Score">
            <input type="number" min={0} max={100} className={inputClass} value={form.score} onChange={(e) => setForm({ ...form, score: Number(e.target.value) })} />
          </FormField>
          <FormField label="Owner">
            <select className={inputClass} value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Industry">
            <select className={inputClass} value={form.industry ?? ''} onChange={(e) => setForm({ ...form, industry: e.target.value })}>
              <option value="">—</option>
              {industries.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          </FormField>
        </div>
        <LeadOpportunityFields value={opportunity} onChange={setOpportunity} />
        <FormField label="Notes">
          <textarea className={inputClass} rows={3} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Save Changes
          </button>
        </div>
      </form>
    </Modal>
  )
}

const ACTIVITY_TYPES: ActivityType[] = ['Call', 'Email', 'WhatsApp', 'Meeting', 'Note', 'Proposal']

function AddActivityModal({ onClose, onSave }: { onClose: () => void; onSave: (type: ActivityType, notes: string) => void }) {
  const [type, setType] = useState<ActivityType>('Call')
  const [notes, setNotes] = useState('')
  return (
    <Modal title="Add Activity" onClose={onClose} width={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave(type, notes)
          onClose()
        }}
      >
        <FormField label="Activity Type">
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as ActivityType)}>
            {ACTIVITY_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Notes">
          <textarea className={inputClass} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened?" />
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Log Activity
          </button>
        </div>
      </form>
    </Modal>
  )
}

function QuickTaskModal({ isMeeting, onClose, onSave }: { isMeeting: boolean; onClose: () => void; onSave: (title: string, dueDate: string, type: TaskType) => void }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('09:00')
  return (
    <Modal title={isMeeting ? 'Schedule Meeting' : 'Create Task'} onClose={onClose} width={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!title || !date) return
          onSave(title, new Date(`${date}T${time}`).toISOString(), isMeeting ? 'Meeting' : 'Follow-up')
          onClose()
        }}
      >
        <FormField label={isMeeting ? 'Meeting Title' : 'Task Title'} required>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date" required>
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} required />
          </FormField>
          <FormField label="Time">
            <input type="time" className={inputClass} value={time} onChange={(e) => setTime(e.target.value)} />
          </FormField>
        </div>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            {isMeeting ? 'Schedule' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
