import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Mail, Phone, Globe, StickyNote, Pencil, Handshake, CalendarClock, Users2, Link2, Unlink, Trash2, Inbox } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { DashboardHero } from '../../components/dashboard/DashboardHero'
import { Card, CardHeader } from '../../components/ui/Card'
import { StatusBadge, StageBadge, ClassificationBadge } from '../../components/ui/Badge'
import { UserAvatar } from '../../components/ui/Avatar'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { ComposeEmailModal } from '../../components/ComposeEmailModal'
import { formatCurrency, formatDate, formatDateTime, services } from '../../data/mockData'
import { ACTIVITY_TYPE_COLORS } from '../../lib/colors'
import type { Company, ProductService } from '../../types'
import { isAssignableOwner } from '../../lib/permissions'

export function CompanyDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const { companies, contacts, leads, deals, activities, tasks, users, addActivity, updateCompany, deleteCompany, addCompany, addDeal, addTask } = useAppStore()
  const company = companies.find((c) => c.id === id)
  const isAdmin = currentUser?.role === 'Administrator'
  const reps = useMemo(() => users.filter((u) => isAssignableOwner(u.role)), [users])
  const [noteOpen, setNoteOpen] = useState(false)
  const [courtesyCallOpen, setCourtesyCallOpen] = useState(false)
  const [handoverOpen, setHandoverOpen] = useState(false)
  const [ownerOpen, setOwnerOpen] = useState(false)
  const [dealOpen, setDealOpen] = useState(false)
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [meetingOpen, setMeetingOpen] = useState(false)
  const [parentOpen, setParentOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)

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
  const lifetimeValue = wonDeals.reduce((s, d) => s + d.value, 0)
  // Paid-to-date vs. handover amount. Can exceed 100% — payments here include
  // fees on top of the handover amount, which this system deliberately never
  // discloses, so the ratio isn't meant to cap at 100.
  const collectionsCoefficient =
    company?.handoverAmount !== undefined && company.handoverAmount > 0 && company?.paymentsToDate !== undefined
      ? (company.paymentsToDate / company.handoverAmount) * 100
      : undefined

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

      <DashboardHero
        eyebrow={company.parentCompanyId ? 'Sub-account' : 'Client'}
        title={
          <span className="inline-flex items-center gap-2">
            {company.name}
            {company.code && (
              <span className="font-mono text-[11px] font-bold text-navy-950 bg-gold-400 px-2 py-0.5 rounded-md align-middle">{company.code}</span>
            )}
          </span>
        }
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            {company.parentCompanyId && (
              <>
                <span>Sub-account of</span>
                <Link to={`/companies/${company.parentCompanyId}`} className="text-gold-400 hover:underline">
                  {companies.find((c) => c.id === company.parentCompanyId)?.name}
                </Link>
                <button
                  onClick={() => updateCompany(company.id, { parentCompanyId: undefined })}
                  className="inline-flex items-center text-white/40 hover:text-white"
                  title="Remove from parent"
                >
                  <Unlink size={11} />
                </button>
                <span className="text-white/30">·</span>
              </>
            )}
            <span>
              {company.industry} · {company.city}, {company.province}
            </span>
          </span>
        }
      />

      <Card>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
          {(company.accountCount !== undefined || company.handoverAmount !== undefined) && (
            <>
              {company.classification && (
                <div>
                  <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1.5">Class</p>
                  <ClassificationBadge classification={company.classification} />
                </div>
              )}
              <div>
                <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Accounts</p>
                <p className="text-2xl font-bold text-slate-800 mt-0.5">{company.accountCount ?? 0}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Handover Amount</p>
                <p className="text-2xl font-bold text-slate-800 mt-0.5">{formatCurrency(company.handoverAmount ?? 0)}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Paid to Date</p>
                <p className="text-2xl font-bold text-[#957323] mt-0.5">{formatCurrency(company.paymentsToDate ?? 0)}</p>
              </div>
              {collectionsCoefficient !== undefined && (
                <div>
                  <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Collections Coefficient</p>
                  <p className="text-2xl font-bold text-slate-800 mt-0.5">{collectionsCoefficient.toFixed(0)}%</p>
                </div>
              )}
            </>
          )}
          <div>
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Deals Won</p>
            <p className="text-2xl font-bold text-slate-800 mt-0.5">{formatCurrency(lifetimeValue)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-slate-100">
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
          {isClient && (
            <button onClick={() => setCourtesyCallOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
              <Phone size={13} /> Log Courtesy Call
            </button>
          )}
          {isClient && (
            <button onClick={() => setHandoverOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
              <Inbox size={13} /> Log Handover Received
            </button>
          )}
          <button onClick={() => setNoteOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
            <StickyNote size={13} /> Add Note
          </button>
          {subAccounts.length === 0 && (
            <button onClick={() => setParentOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
              <Link2 size={13} /> {company.parentCompanyId ? 'Change Parent' : 'Assign to Parent'}
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setDeleteOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50">
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Contact Details" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm mb-4 pb-4 border-b border-slate-100">
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Phone</p>
            {company.phone ? (
              <a href={`tel:${company.phone}`} className="inline-flex items-center gap-1.5 text-slate-700 font-medium hover:text-brand-600">
                <Phone size={13} /> {company.phone}
              </a>
            ) : (
              <span className="text-slate-300">—</span>
            )}
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Email</p>
            {company.email ? (
              <div className="flex items-center gap-2">
                <a href={`mailto:${company.email}`} className="inline-flex items-center gap-1.5 text-slate-700 font-medium hover:text-brand-600">
                  <Mail size={13} /> {company.email}
                </a>
                <button onClick={() => setEmailOpen(true)} className="text-xs font-medium text-brand-600 hover:underline shrink-0">
                  Send Email
                </button>
              </div>
            ) : (
              <span className="text-slate-300">—</span>
            )}
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Website</p>
            {company.website ? (
              <span className="inline-flex items-center gap-1.5 text-slate-700 font-medium">
                <Globe size={13} /> {company.website}
              </span>
            ) : (
              <span className="text-slate-300">—</span>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-400 mb-2">Contact Persons</p>
        {companyContacts.length === 0 ? (
          <p className="text-sm text-slate-400">No contact persons yet.</p>
        ) : (
          <div className="space-y-1">
            {companyContacts.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 hover:bg-slate-50 -mx-1 px-2 py-2 rounded-lg">
                <Link to={`/contacts/${c.id}`} className="flex items-center gap-2.5 min-w-0">
                  <UserAvatar userId={c.ownerId} size={30} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700 hover:text-brand-600 truncate">{c.firstName} {c.lastName}</p>
                    <p className="text-xs text-slate-400 truncate">{c.jobTitle}</p>
                  </div>
                </Link>
                <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0">
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 hover:text-brand-600">
                      <Phone size={11} /> {c.phone}
                    </a>
                  )}
                  {c.mobile && (
                    <a href={`tel:${c.mobile}`} className="inline-flex items-center gap-1 hover:text-brand-600">
                      <Phone size={11} /> {c.mobile} <span className="text-slate-300">mobile</span>
                    </a>
                  )}
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-brand-600">
                      <Mail size={11} /> {c.email}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
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

      <Card>
        <CardHeader title="Notes" subtitle={`${companyActivities.length} update${companyActivities.length === 1 ? '' : 's'}`} />
        {companyActivities.length === 0 ? (
          <p className="text-sm text-slate-400">No activity recorded yet.</p>
        ) : (
          <div className="space-y-2.5">
            {companyActivities.map((a) =>
              a.type === 'Note' ? (
                <div key={a.id} className="bg-[#f7f4eb] border border-[#e7dbb2] rounded-lg p-3">
                  <p className="text-sm text-slate-700">{a.notes || a.subject}</p>
                  <p className="text-[11px] text-slate-400 mt-1">{formatDateTime(a.activityDate)}</p>
                </div>
              ) : (
                <div key={a.id} className="flex items-start justify-between gap-3 border-b border-slate-50 pb-2.5 last:border-0 last:pb-0">
                  <div className="flex items-start gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: ACTIVITY_TYPE_COLORS[a.type] }} />
                    <div className="min-w-0">
                      <p className="text-sm text-slate-700">{a.subject}</p>
                      {a.notes && <p className="text-xs text-slate-500 mt-0.5">{a.notes}</p>}
                    </div>
                  </div>
                  <span className="text-[11px] text-slate-400 shrink-0">{formatDateTime(a.activityDate)}</span>
                </div>
              ),
            )}
          </div>
        )}
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
        </div>
      </div>

      {emailOpen && company.email && (
        <ComposeEmailModal
          to={company.email}
          onClose={() => setEmailOpen(false)}
          onSent={(subject, bodyText) => addActivity({ type: 'Email', subject, notes: bodyText, companyId: company.id })}
        />
      )}
      {noteOpen && (
        <QuickLogModal
          title="Add Note"
          fieldLabel="Note"
          submitLabel="Add Note"
          onClose={() => setNoteOpen(false)}
          onSave={(text) => addActivity({ type: 'Note', subject: 'Note added', notes: text, companyId: company.id })}
        />
      )}
      {courtesyCallOpen && (
        <QuickLogModal
          title="Log Courtesy Call"
          fieldLabel="What was discussed? (optional)"
          submitLabel="Log Call"
          required={false}
          onClose={() => setCourtesyCallOpen(false)}
          onSave={(text) => addActivity({ type: 'Courtesy Call', subject: `Courtesy call — ${company.name}`, notes: text || undefined, companyId: company.id })}
        />
      )}
      {handoverOpen && (
        <QuickLogModal
          title="Log Handover Received"
          fieldLabel="Details (optional)"
          submitLabel="Log Handover"
          required={false}
          onClose={() => setHandoverOpen(false)}
          onSave={(text) => addActivity({ type: 'Handover Received', subject: `Handover received — ${company.name}`, notes: text || undefined, companyId: company.id })}
        />
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
      {parentOpen && (
        <AssignParentModal
          currentParentId={company.parentCompanyId}
          candidates={companies.filter((c) => c.id !== company.id && !c.parentCompanyId)}
          onClose={() => setParentOpen(false)}
          onAssignExisting={(parentId) => updateCompany(company.id, { parentCompanyId: parentId })}
          onCreateNew={(name, code) => {
            const parent = addCompany({ name, code: code || undefined, accountOwnerId: company.accountOwnerId })
            updateCompany(company.id, { parentCompanyId: parent.id })
          }}
        />
      )}
      {deleteOpen && (
        <DeleteClientModal
          company={company}
          subAccountsCount={subAccounts.length}
          dealsCount={companyDeals.length}
          contactsCount={companyContacts.length}
          leadsCount={companyLeads.length}
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => {
            deleteCompany(company.id)
            navigate('/companies')
          }}
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

function QuickLogModal({
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

function DeleteClientModal({
  company,
  subAccountsCount,
  dealsCount,
  contactsCount,
  leadsCount,
  onClose,
  onConfirm,
}: {
  company: Company
  subAccountsCount: number
  dealsCount: number
  contactsCount: number
  leadsCount: number
  onClose: () => void
  onConfirm: () => void
}) {
  const [confirmText, setConfirmText] = useState('')
  const canDelete = confirmText.trim() === company.name

  return (
    <Modal title="Delete Client" onClose={onClose} width={420}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          This permanently deletes <strong>{company.name}</strong> and cannot be undone.
        </p>
        {(dealsCount > 0 || subAccountsCount > 0 || contactsCount > 0 || leadsCount > 0) && (
          <ul className="list-disc pl-5 space-y-1 text-xs text-slate-500">
            {dealsCount > 0 && <li>{dealsCount} deal{dealsCount === 1 ? '' : 's'} linked to this client will also be permanently deleted.</li>}
            {subAccountsCount > 0 && <li>{subAccountsCount} sub-account{subAccountsCount === 1 ? '' : 's'} will become standalone clients.</li>}
            {contactsCount > 0 && <li>{contactsCount} contact{contactsCount === 1 ? '' : 's'} will be kept but unlinked from this client.</li>}
            {leadsCount > 0 && <li>{leadsCount} lead{leadsCount === 1 ? '' : 's'} will be kept but unlinked from this client.</li>}
          </ul>
        )}
        <FormField label={`Type "${company.name}" to confirm`}>
          <input className={inputClass} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoFocus />
        </FormField>
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="button"
            disabled={!canDelete}
            onClick={onConfirm}
            className="text-sm font-medium px-3.5 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Delete Client
          </button>
        </div>
      </div>
    </Modal>
  )
}

function AssignParentModal({
  currentParentId,
  candidates,
  onClose,
  onAssignExisting,
  onCreateNew,
}: {
  currentParentId?: string
  candidates: Company[]
  onClose: () => void
  onAssignExisting: (parentId: string) => void
  onCreateNew: (name: string, code: string) => void
}) {
  const [mode, setMode] = useState<'existing' | 'new'>(candidates.length > 0 ? 'existing' : 'new')
  const [selectedId, setSelectedId] = useState(currentParentId ?? candidates[0]?.id ?? '')
  const [newName, setNewName] = useState('')
  const [newCode, setNewCode] = useState('')

  return (
    <Modal title="Assign to Parent Client" onClose={onClose} width={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (mode === 'existing') {
            if (!selectedId) return
            onAssignExisting(selectedId)
          } else {
            if (!newName.trim()) return
            onCreateNew(newName.trim(), newCode.trim())
          }
          onClose()
        }}
      >
        <div className="flex gap-2 mb-3 text-xs font-medium">
          <button
            type="button"
            onClick={() => setMode('existing')}
            disabled={candidates.length === 0}
            className={`px-3 py-1.5 rounded-lg border ${mode === 'existing' ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Existing client
          </button>
          <button
            type="button"
            onClick={() => setMode('new')}
            className={`px-3 py-1.5 rounded-lg border ${mode === 'new' ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            New parent client
          </button>
        </div>

        {mode === 'existing' ? (
          <FormField label="Parent Client" required>
            <select className={inputClass} value={selectedId} onChange={(e) => setSelectedId(e.target.value)} required>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.code ? ` (${c.code})` : ''}
                </option>
              ))}
            </select>
          </FormField>
        ) : (
          <>
            <p className="text-xs text-slate-400 mb-3">Creates a new parent client record with no Swordfish prefix of its own, and moves this client underneath it.</p>
            <FormField label="Parent Client Name" required>
              <input className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} required autoFocus placeholder="e.g. Marara Pharmacy" />
            </FormField>
            <FormField label="Code (optional)">
              <input className={inputClass} value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} placeholder="e.g. MARARA" />
            </FormField>
          </>
        )}

        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Assign
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
