import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, CheckCircle2, XCircle, StickyNote, CheckSquare, FileText, Send, Plus, Upload, Trash2 } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { Card, CardHeader } from '../../components/ui/Card'
import { StageBadge } from '../../components/ui/Badge'
import { UserAvatar } from '../../components/ui/Avatar'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { MarkLostModal, MarkWonModal } from './DealStageModals'
import { formatCurrency, formatDate, formatDateTime, services } from '../../data/mockData'
import { DEAL_STAGES } from '../../types'
import type { ActivityType, DealStage, LossReason, ProposalStatus, TaskType } from '../../types'
import type { WonDealDetails } from '../../store/AppStore'

const TABS = ['Overview', 'Activities', 'Tasks', 'Documents', 'Proposals', 'Notes', 'History'] as const
type Tab = (typeof TABS)[number]

interface MockDocument {
  id: string
  name: string
  uploadedAt: string
  size: string
}

export function DealDetail() {
  const { id } = useParams()
  const store = useAppStore()
  const {
    deals,
    activities,
    tasks,
    proposals,
    users,
    companyById,
    contactById,
    userById,
    updateDeal,
    moveDealStage,
    markDealWon,
    markDealLost,
    addActivity,
    addTask,
    updateTask,
    addProposal,
    updateProposal,
  } = store
  const reps = useMemo(() => users.filter((u) => u.role.includes('Sales') || u.role === 'Administrator'), [users])
  const deal = deals.find((d) => d.id === id)

  const [tab, setTab] = useState<Tab>('Overview')
  const [editOpen, setEditOpen] = useState(false)
  const [wonOpen, setWonOpen] = useState(false)
  const [lostOpen, setLostOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [taskOpen, setTaskOpen] = useState(false)
  const [proposalOpen, setProposalOpen] = useState(false)
  const [docs, setDocs] = useState<MockDocument[]>([
    { id: 'doc1', name: 'Signed_MSA.pdf', uploadedAt: new Date().toISOString(), size: '212 KB' },
  ])

  const dealActivities = useMemo(() => activities.filter((a) => a.dealId === id).sort((a, b) => new Date(b.activityDate).getTime() - new Date(a.activityDate).getTime()), [activities, id])
  const dealTasks = useMemo(() => tasks.filter((t) => t.dealId === id), [tasks, id])
  const dealProposals = useMemo(() => proposals.filter((p) => p.dealId === id), [proposals, id])
  const dealNotes = useMemo(() => dealActivities.filter((a) => a.type === 'Note'), [dealActivities])

  if (!deal) {
    return (
      <div className="text-center py-16 text-slate-400">
        Deal not found. <Link to="/deals" className="text-brand-600 hover:underline">Back to deals</Link>
      </div>
    )
  }

  const company = companyById(deal.companyId)
  const contact = contactById(deal.contactId)
  const isClosed = deal.stage === 'Won' || deal.stage === 'Lost'

  return (
    <div className="space-y-5">
      <Link to="/deals" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={15} /> Back to Deals
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-semibold text-slate-800">{deal.name}</h2>
              <StageBadge stage={deal.stage} />
            </div>
            <p className="text-sm text-slate-500 mt-1">
              {company?.name}
              {contact ? ` · ${contact.firstName} ${contact.lastName}` : ''}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Deal Value</p>
            <p className="text-xl font-bold text-slate-800">{formatCurrency(deal.value)}</p>
            <div className="flex items-center gap-1.5 justify-end mt-1.5">
              <UserAvatar userId={deal.ownerId} size={20} />
              <span className="text-xs text-slate-500">{userById(deal.ownerId)?.name}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-5 pt-4 border-t border-slate-100">
          <label className="text-xs text-slate-400">Stage:</label>
          <select
            value={deal.stage}
            disabled={isClosed}
            onChange={(e) => {
              const next = e.target.value as DealStage
              if (next === 'Won') setWonOpen(true)
              else if (next === 'Lost') setLostOpen(true)
              else moveDealStage(deal.id, next)
            }}
            className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-600 outline-none disabled:opacity-50"
          >
            {DEAL_STAGES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2 ml-auto">
            <ActionButton icon={Pencil} label="Edit" onClick={() => setEditOpen(true)} />
            <ActionButton icon={StickyNote} label="Add Activity" onClick={() => setActivityOpen(true)} />
            <ActionButton icon={CheckSquare} label="Create Task" onClick={() => setTaskOpen(true)} />
            <ActionButton icon={CheckCircle2} label="Mark Won" tone="success" onClick={() => setWonOpen(true)} disabled={isClosed} />
            <ActionButton icon={XCircle} label="Mark Lost" tone="danger" onClick={() => setLostOpen(true)} disabled={isClosed} />
          </div>
        </div>
      </Card>

      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${
              tab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t}
            {t === 'Tasks' && dealTasks.length > 0 && <span className="ml-1.5 text-xs text-slate-400">({dealTasks.length})</span>}
            {t === 'Proposals' && dealProposals.length > 0 && <span className="ml-1.5 text-xs text-slate-400">({dealProposals.length})</span>}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <Card>
          <CardHeader title="Deal Information" />
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3.5 text-sm">
            <Field label="Deal Name" value={deal.name} />
            <Field label="Company" value={company?.name} />
            <Field label="Contact" value={contact ? `${contact.firstName} ${contact.lastName}` : undefined} />
            <Field label="Owner" value={userById(deal.ownerId)?.name} />
            <Field label="Stage" value={deal.stage} />
            <Field label="Probability" value={`${deal.probability}%`} />
            <Field label="Expected Close Date" value={formatDate(deal.expectedCloseDate)} />
            <Field label="Service" value={deal.service} />
            <Field label="Lead Source" value={deal.source} />
            <Field label="Competitor" value={deal.competitor} />
            {deal.lossReason && <Field label="Loss Reason" value={deal.lossReason} />}
            <Field label="Weighted Value" value={formatCurrency(Math.round((deal.value * deal.probability) / 100))} />
          </dl>
          {deal.notes && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs font-medium text-slate-400 mb-1">Notes</p>
              <p className="text-sm text-slate-600 whitespace-pre-line">{deal.notes}</p>
            </div>
          )}
        </Card>
      )}

      {tab === 'Activities' && (
        <Card padded={false}>
          <div className="p-5 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 text-[15px]">Activities</h3>
            <button onClick={() => setActivityOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline">
              <Plus size={13} /> Log Activity
            </button>
          </div>
          <div className="px-5 pb-5 space-y-4">
            {dealActivities.length === 0 && <p className="text-sm text-slate-400">No activities logged yet.</p>}
            {dealActivities.map((a) => (
              <div key={a.id} className="flex gap-3 pb-3 border-b border-slate-50 last:border-0">
                <UserAvatar userId={a.userId} size={26} />
                <div>
                  <p className="text-sm font-medium text-slate-700">{a.subject}</p>
                  {a.notes && <p className="text-xs text-slate-500 mt-0.5">{a.notes}</p>}
                  <p className="text-[11px] text-slate-400 mt-0.5">{formatDateTime(a.activityDate)}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'Tasks' && (
        <Card padded={false}>
          <div className="p-5 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 text-[15px]">Tasks</h3>
            <button onClick={() => setTaskOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline">
              <Plus size={13} /> Add Task
            </button>
          </div>
          <div className="px-5 pb-5 divide-y divide-slate-50">
            {dealTasks.length === 0 && <p className="text-sm text-slate-400">No tasks yet.</p>}
            {dealTasks.map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-2.5">
                <input
                  type="checkbox"
                  checked={t.status === 'Completed'}
                  onChange={(e) => updateTask(t.id, { status: e.target.checked ? 'Completed' : 'Not Started', completedAt: e.target.checked ? new Date().toISOString() : undefined })}
                  className="w-4 h-4 accent-brand-600"
                />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${t.status === 'Completed' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{t.title}</p>
                  <p className="text-xs text-slate-400">{t.type} · Due {formatDate(t.dueDate)}</p>
                </div>
                <UserAvatar userId={t.ownerId} size={22} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'Documents' && (
        <Card padded={false}>
          <div className="p-5 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 text-[15px]">Documents</h3>
            <button
              onClick={() =>
                setDocs((prev) => [{ id: `doc${prev.length + 1}`, name: `Document_${prev.length + 1}.pdf`, uploadedAt: new Date().toISOString(), size: `${(Math.random() * 500 + 50).toFixed(0)} KB` }, ...prev])
              }
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline"
            >
              <Upload size={13} /> Upload Document
            </button>
          </div>
          <div className="px-5 pb-5 divide-y divide-slate-50">
            {docs.map((d) => (
              <div key={d.id} className="flex items-center gap-3 py-2.5">
                <FileText size={18} className="text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{d.name}</p>
                  <p className="text-xs text-slate-400">{d.size} · Uploaded {formatDate(d.uploadedAt)}</p>
                </div>
                <button onClick={() => setDocs((prev) => prev.filter((x) => x.id !== d.id))} className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'Proposals' && (
        <Card padded={false}>
          <div className="p-5 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 text-[15px]">Quotes / Proposals</h3>
            <button onClick={() => setProposalOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline">
              <Plus size={13} /> Create Proposal
            </button>
          </div>
          <div className="px-5 pb-5 space-y-3">
            {dealProposals.length === 0 && <p className="text-sm text-slate-400">No proposals yet.</p>}
            {dealProposals.map((p) => (
              <div key={p.id} className="border border-slate-100 rounded-xl p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-700">{p.service}</p>
                    <p className="text-xs text-slate-400 mt-0.5">Valid until {formatDate(p.validityDate)}</p>
                  </div>
                  <ProposalStatusBadge status={p.status} />
                </div>
                <p className="text-lg font-bold text-slate-800 mt-2">{formatCurrency(p.pricing)}</p>
                {p.description && <p className="text-xs text-slate-500 mt-1">{p.description}</p>}
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {(['Draft', 'Sent', 'Viewed', 'Accepted', 'Declined', 'Expired'] as ProposalStatus[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => updateProposal(p.id, { status: s })}
                      className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                        p.status === s ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      Mark {s}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'Notes' && (
        <Card padded={false}>
          <div className="p-5 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 text-[15px]">Notes</h3>
            <button onClick={() => setActivityOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline">
              <Plus size={13} /> Add Note
            </button>
          </div>
          <div className="px-5 pb-5 space-y-3">
            {dealNotes.length === 0 && <p className="text-sm text-slate-400">No notes yet.</p>}
            {dealNotes.map((n) => (
              <div key={n.id} className="bg-[#f7f4eb] border border-[#e7dbb2] rounded-lg p-3">
                <p className="text-sm text-slate-700">{n.notes || n.subject}</p>
                <p className="text-[11px] text-slate-400 mt-1">{formatDateTime(n.activityDate)} · {userById(n.userId)?.name}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'History' && (
        <Card padded={false}>
          <div className="p-5">
            <h3 className="font-semibold text-slate-800 text-[15px]">History</h3>
          </div>
          <div className="px-5 pb-5 space-y-3">
            <HistoryRow label="Deal created" date={deal.createdAt} />
            {dealActivities
              .filter((a) => ['Deal Stage Change', 'Deal update', 'Deal Won', 'Deal Lost'].includes(a.type))
              .map((a) => (
                <HistoryRow key={a.id} label={a.subject} date={a.activityDate} />
              ))}
            {deal.wonAt && <HistoryRow label="Deal marked Won" date={deal.wonAt} />}
            {deal.lostAt && <HistoryRow label="Deal marked Lost" date={deal.lostAt} />}
          </div>
        </Card>
      )}

      {editOpen && <EditDealModal deal={deal} reps={reps} onClose={() => setEditOpen(false)} onSave={(patch) => updateDeal(deal.id, patch)} />}
      {wonOpen && <MarkWonModal defaultValue={deal.value} defaultService={deal.service} onClose={() => setWonOpen(false)} onSave={(details: WonDealDetails) => markDealWon(deal.id, details)} />}
      {lostOpen && <MarkLostModal onClose={() => setLostOpen(false)} onSave={(reason: LossReason) => markDealLost(deal.id, reason)} />}
      {activityOpen && (
        <AddActivityModal onClose={() => setActivityOpen(false)} onSave={(type, notes) => addActivity({ type, subject: `${type} logged on ${deal.name}`, notes, dealId: deal.id, companyId: deal.companyId })} />
      )}
      {taskOpen && (
        <AddTaskModal onClose={() => setTaskOpen(false)} onSave={(title, dueDate, type) => addTask({ title, dueDate, type, dealId: deal.id, companyId: deal.companyId, relatedToLabel: deal.name })} />
      )}
      {proposalOpen && (
        <CreateProposalModal
          defaultService={deal.service ?? services[0]}
          defaultValue={deal.value}
          onClose={() => setProposalOpen(false)}
          onSave={(input) => addProposal({ dealId: deal.id, companyId: deal.companyId, contactId: deal.contactId, ...input })}
        />
      )}
    </div>
  )
}

function HistoryRow({ label, date }: { label: string; date: string }) {
  return (
    <div className="flex items-center justify-between text-sm border-b border-slate-50 pb-2.5 last:border-0">
      <span className="text-slate-600">{label}</span>
      <span className="text-xs text-slate-400">{formatDateTime(date)}</span>
    </div>
  )
}

function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  const tone: Record<ProposalStatus, string> = {
    Draft: 'bg-slate-100 text-slate-600',
    Sent: 'bg-[#edf1f5] text-[#6086a9]',
    Viewed: 'bg-[#edf1f5] text-[#2b4055]',
    Accepted: 'bg-[#f7f3eb] text-[#957323]',
    Declined: 'bg-[#f6eeec] text-[#794234]',
    Expired: 'bg-[#f5eeed] text-[#ad6452]',
  }
  return <span className={`badge ${tone[status]}`}>{status}</span>
}

function ActionButton({ icon: Icon, label, onClick, tone, disabled }: { icon: typeof Pencil; label: string; onClick: () => void; tone?: 'success' | 'danger'; disabled?: boolean }) {
  const toneClass = tone === 'success' ? 'border-emerald-100 text-emerald-600 hover:bg-emerald-50' : tone === 'danger' ? 'border-red-100 text-red-600 hover:bg-red-50' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
  return (
    <button onClick={onClick} disabled={disabled} className={`inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${toneClass}`}>
      <Icon size={14} /> {label}
    </button>
  )
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-400 mb-0.5">{label}</dt>
      <dd className="text-slate-700 font-medium">{value || '—'}</dd>
    </div>
  )
}

function EditDealModal({
  deal,
  reps,
  onClose,
  onSave,
}: {
  deal: ReturnType<typeof useAppStore>['deals'][number]
  reps: ReturnType<typeof useAppStore>['users']
  onClose: () => void
  onSave: (patch: Partial<typeof deal>) => void
}) {
  const [form, setForm] = useState({ ...deal, expectedCloseDate: deal.expectedCloseDate.slice(0, 10) })
  return (
    <Modal title="Edit Deal" onClose={onClose} width={520}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave({ ...form, expectedCloseDate: new Date(form.expectedCloseDate).toISOString() })
          onClose()
        }}
      >
        <FormField label="Deal Name" required>
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Value (R)">
            <input type="number" className={inputClass} value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} />
          </FormField>
          <FormField label="Probability (%)">
            <input type="number" min={0} max={100} className={inputClass} value={form.probability} onChange={(e) => setForm({ ...form, probability: Number(e.target.value) })} />
          </FormField>
          <FormField label="Expected Close Date">
            <input type="date" className={inputClass} value={form.expectedCloseDate} onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })} />
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
          <FormField label="Service">
            <select className={inputClass} value={form.service ?? ''} onChange={(e) => setForm({ ...form, service: e.target.value })}>
              {services.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Competitor">
            <input className={inputClass} value={form.competitor ?? ''} onChange={(e) => setForm({ ...form, competitor: e.target.value })} />
          </FormField>
        </div>
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

const ACTIVITY_TYPES: ActivityType[] = ['Call', 'Email', 'WhatsApp', 'Meeting', 'Note', 'Proposal', 'Deal update']

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
          <textarea className={inputClass} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
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

function AddTaskModal({ onClose, onSave }: { onClose: () => void; onSave: (title: string, dueDate: string, type: TaskType) => void }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('09:00')
  const [type, setType] = useState<TaskType>('Follow-up')
  return (
    <Modal title="Add Task" onClose={onClose} width={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!title || !date) return
          onSave(title, new Date(`${date}T${time}`).toISOString(), type)
          onClose()
        }}
      >
        <FormField label="Task Title" required>
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
        <FormField label="Type">
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as TaskType)}>
            {(['Call', 'Follow-up', 'Email', 'Proposal', 'Meeting', 'WhatsApp', 'Internal task', 'Other'] as TaskType[]).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Add Task
          </button>
        </div>
      </form>
    </Modal>
  )
}

function CreateProposalModal({
  defaultService,
  defaultValue,
  onClose,
  onSave,
}: {
  defaultService: string
  defaultValue: number
  onClose: () => void
  onSave: (input: { service: string; pricing: number; description: string; terms: string; validityDate: string }) => void
}) {
  const [form, setForm] = useState({
    service: defaultService,
    pricing: String(defaultValue),
    description: '',
    terms: 'Net 30 days. Valid for 30 days from issue date.',
    validityDate: '',
  })
  return (
    <Modal title="Create Proposal" onClose={onClose} width={480}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.validityDate) return
          onSave({ service: form.service, pricing: Number(form.pricing) || 0, description: form.description, terms: form.terms, validityDate: new Date(form.validityDate).toISOString() })
          onClose()
        }}
      >
        <FormField label="Service" required>
          <select className={inputClass} value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })}>
            {services.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Pricing (R)" required>
            <input type="number" className={inputClass} value={form.pricing} onChange={(e) => setForm({ ...form, pricing: e.target.value })} required />
          </FormField>
          <FormField label="Validity Date" required>
            <input type="date" className={inputClass} value={form.validityDate} onChange={(e) => setForm({ ...form, validityDate: e.target.value })} required />
          </FormField>
        </div>
        <FormField label="Description">
          <textarea className={inputClass} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </FormField>
        <FormField label="Terms">
          <textarea className={inputClass} rows={2} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} />
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            <Send size={13} /> Save Proposal
          </button>
        </div>
      </form>
    </Modal>
  )
}
