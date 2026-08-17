import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Phone, Mail, MessageCircle, StickyNote, CheckSquare, Calendar, ArrowRightLeft, UserCog, XCircle, Search, SlidersHorizontal, Plus, Trash2 } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { Card } from '../../components/ui/Card'
import { StatusBadge } from '../../components/ui/Badge'
import { UserAvatar } from '../../components/ui/Avatar'
import { RowMenu } from '../../components/ui/RowMenu'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { ConfirmDeleteModal } from '../../components/ui/ConfirmDeleteModal'
import { LeadForm } from '../../components/layout/QuickAdd'
import { formatCurrency, formatDate, industries, leadSources, provinces, userById, users } from '../../data/mockData'
import { readParam } from '../../lib/drilldown'
import { decodeSalesMonthParam, isWithinPeriod } from '../../lib/salesMonth'
import { isMeaningfulActivity } from '../../lib/meaningfulActivity'
import type { Lead, LeadStatus } from '../../types'

const ALL_STATUSES: LeadStatus[] = ['New', 'Attempting Contact', 'Contacted', 'Qualified', 'Unqualified', 'Proposal Required', 'Converted', 'Lost']
const reps = users.filter((u) => u.role.includes('Sales') || u.role === 'Administrator')

export function LeadsList() {
  const store = useAppStore()
  const { leads, activities, updateLead, markLeadLost, deleteLead, convertLeadToDeal, addActivity } = store
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'All' | LeadStatus>(() => (readParam(searchParams, 'status') as LeadStatus) ?? 'All')
  const [source, setSource] = useState<'All' | string>(() => readParam(searchParams, 'source') ?? 'All')
  const [owner, setOwner] = useState<'All' | string>(() => readParam(searchParams, 'owner') ?? 'All')
  const [showFilters, setShowFilters] = useState(false)
  const [industry, setIndustry] = useState('All')
  const [province, setProvince] = useState('All')
  const [minScore, setMinScore] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [reassignLead, setReassignLead] = useState<Lead | null>(null)
  const [deleteLeadTarget, setDeleteLeadTarget] = useState<Lead | null>(null)

  // One-time drill-down filters carried in from Dashboard links — not exposed as UI controls.
  const [salesMonthFilter] = useState(() => decodeSalesMonthParam(searchParams.get('salesMonth')))
  const [noNextActionFilter] = useState(() => readParam(searchParams, 'noNextAction') === '1')
  const [touchedFilter] = useState(() => readParam(searchParams, 'touched'))

  const filtered = useMemo(() => {
    const touchedLeadIds = touchedFilter
      ? new Set(
          activities
            .filter((a) => a.leadId && isMeaningfulActivity(a) && (!salesMonthFilter || isWithinPeriod(a.activityDate, salesMonthFilter)))
            .map((a) => a.leadId as string),
        )
      : undefined
    return leads.filter((l) => {
      if (status !== 'All' && l.status !== status) return false
      if (source !== 'All' && l.source !== source) return false
      if (owner !== 'All' && l.ownerId !== owner) return false
      if (industry !== 'All' && l.industry !== industry) return false
      if (province !== 'All' && l.province !== province) return false
      if (minScore && l.score < Number(minScore)) return false
      if (salesMonthFilter && !isWithinPeriod(l.createdAt, salesMonthFilter)) return false
      if (noNextActionFilter && l.nextFollowUpAt) return false
      if (touchedFilter && touchedLeadIds) {
        const isTouched = touchedLeadIds.has(l.id) || (l.lastContactAt && salesMonthFilter && isWithinPeriod(l.lastContactAt, salesMonthFilter))
        if (touchedFilter === '1' && !isTouched) return false
        if (touchedFilter === '0' && isTouched) return false
      }
      if (search) {
        const q = search.toLowerCase()
        const hay = `${l.firstName} ${l.lastName} ${l.companyName} ${l.email ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [leads, activities, status, source, owner, industry, province, minScore, search, salesMonthFilter, noNextActionFilter, touchedFilter])

  function logQuickAction(lead: Lead, type: 'Call' | 'Email' | 'WhatsApp') {
    addActivity({ type, subject: `${type} with ${lead.firstName} ${lead.lastName}`, leadId: lead.id, companyId: lead.companyId })
    updateLead(lead.id, { lastContactAt: new Date().toISOString() })
    if (type === 'Call' && lead.phone) window.open(`tel:${lead.phone}`)
    if (type === 'Email' && lead.email) window.open(`mailto:${lead.email}`)
    if (type === 'WhatsApp' && lead.mobile) window.open(`https://wa.me/${lead.mobile.replace(/\D/g, '')}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 w-64">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leads..." className="text-sm outline-none flex-1 min-w-0" />
        </div>
        <SimpleSelect value={status} onChange={(v) => setStatus(v as typeof status)} options={['All', ...ALL_STATUSES]} />
        <SimpleSelect value={source} onChange={setSource} options={['All', ...leadSources]} />
        <SimpleSelect value={owner} onChange={setOwner} options={['All', ...reps.map((r) => r.id)]} labels={{ All: 'All Owners', ...Object.fromEntries(reps.map((r) => [r.id, r.name])) }} />
        <button
          onClick={() => setShowFilters((s) => !s)}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
        >
          <SlidersHorizontal size={14} /> Filters
        </button>
        <span className="text-xs text-slate-400 ml-1">{filtered.length} leads</span>
        <button
          onClick={() => setAddOpen(true)}
          className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700"
        >
          <Plus size={15} /> Add Lead
        </button>
      </div>

      {showFilters && (
        <Card className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <FormField label="Industry">
              <select className={inputClass} value={industry} onChange={(e) => setIndustry(e.target.value)}>
                <option>All</option>
                {industries.map((i) => (
                  <option key={i}>{i}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Province">
              <select className={inputClass} value={province} onChange={(e) => setProvince(e.target.value)}>
                <option>All</option>
                {provinces.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Min Lead Score">
              <input type="number" className={inputClass} value={minScore} onChange={(e) => setMinScore(e.target.value)} placeholder="0" />
            </FormField>
            <div className="flex items-end">
              <button
                onClick={() => {
                  setIndustry('All')
                  setProvince('All')
                  setMinScore('')
                }}
                className="text-sm font-medium text-slate-500 hover:text-slate-700"
              >
                Reset filters
              </button>
            </div>
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="font-medium px-5 py-3">Lead Name</th>
                <th className="font-medium px-3 py-3">Company</th>
                <th className="font-medium px-3 py-3">Source</th>
                <th className="font-medium px-3 py-3">Status</th>
                <th className="font-medium px-3 py-3">Score</th>
                <th className="font-medium px-3 py-3 text-right">Est. Value</th>
                <th className="font-medium px-3 py-3">Owner</th>
                <th className="font-medium px-3 py-3">Next Follow-up</th>
                <th className="font-medium px-3 py-3 w-40">Quick Actions</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => (
                <tr key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)} className="border-t border-slate-50 hover:bg-slate-50/60 cursor-pointer">
                  <td className="px-5 py-3">
                    <Link to={`/leads/${lead.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-slate-700 hover:text-brand-600">
                      {lead.firstName} {lead.lastName}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-slate-500">{lead.companyName}</td>
                  <td className="px-3 py-3 text-slate-500">{lead.source}</td>
                  <td className="px-3 py-3">
                    <StatusBadge status={lead.status} />
                  </td>
                  <td className="px-3 py-3">
                    <ScorePill score={lead.score} />
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-slate-700">{formatCurrency(lead.estimatedValue)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <UserAvatar userId={lead.ownerId} size={22} />
                      <span className="text-slate-500 text-xs">{userById(lead.ownerId)?.name.split(' ')[0]}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-500">{formatDate(lead.nextFollowUpAt)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <QuickIcon icon={Phone} title="Call" onClick={() => logQuickAction(lead, 'Call')} />
                      <QuickIcon icon={Mail} title="Email" onClick={() => logQuickAction(lead, 'Email')} />
                      <QuickIcon icon={MessageCircle} title="WhatsApp" onClick={() => logQuickAction(lead, 'WhatsApp')} />
                    </div>
                  </td>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <RowMenu
                      items={[
                        { label: 'Add note', icon: <StickyNote size={14} />, onClick: () => addActivity({ type: 'Note', subject: 'Note added', leadId: lead.id, companyId: lead.companyId }) },
                        { label: 'Add task', icon: <CheckSquare size={14} />, onClick: () => navigate(`/leads/${lead.id}`) },
                        { label: 'Schedule meeting', icon: <Calendar size={14} />, onClick: () => navigate(`/leads/${lead.id}`) },
                        { label: 'Convert to deal', icon: <ArrowRightLeft size={14} />, onClick: () => {
                          const deal = convertLeadToDeal(lead.id)
                          if (deal) navigate(`/deals/${deal.id}`)
                        } },
                        { label: 'Reassign', icon: <UserCog size={14} />, onClick: () => setReassignLead(lead) },
                        { label: 'Mark lost', icon: <XCircle size={14} />, danger: true, onClick: () => markLeadLost(lead.id) },
                        { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => setDeleteLeadTarget(lead) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center text-slate-400 text-sm py-10">
                    No leads match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {addOpen && <LeadForm onClose={() => setAddOpen(false)} store={store} navigate={navigate} />}
      {reassignLead && (
        <Modal title="Reassign Lead" onClose={() => setReassignLead(null)} width={360}>
          <p className="text-sm text-slate-500 mb-3">
            Reassign <span className="font-medium text-slate-700">{reassignLead.firstName} {reassignLead.lastName}</span> to:
          </p>
          <div className="space-y-1">
            {reps.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  updateLead(reassignLead.id, { ownerId: r.id })
                  addActivity({ type: 'Status change', subject: `Lead reassigned to ${r.name}`, leadId: reassignLead.id, companyId: reassignLead.companyId })
                  setReassignLead(null)
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 text-left"
              >
                <UserAvatar userId={r.id} size={26} />
                <span className="text-sm font-medium text-slate-700">{r.name}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {deleteLeadTarget && (
        <ConfirmDeleteModal
          title="Delete Lead"
          itemLabel={`${deleteLeadTarget.firstName} ${deleteLeadTarget.lastName}`}
          onClose={() => setDeleteLeadTarget(null)}
          onConfirm={() => deleteLead(deleteLeadTarget.id)}
        />
      )}
    </div>
  )
}

function QuickIcon({ icon: Icon, title, onClick }: { icon: typeof Phone; title: string; onClick: () => void }) {
  return (
    <button title={title} onClick={onClick} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-600">
      <Icon size={14} />
    </button>
  )
}

function ScorePill({ score }: { score: number }) {
  const tone = score >= 81 ? 'bg-[#f6eeec] text-[#794234]' : score >= 61 ? 'bg-[#f7f4eb] text-[#b28e34]' : score >= 31 ? 'bg-[#edf1f5] text-[#6086a9]' : 'bg-slate-100 text-slate-500'
  return <span className={`inline-flex items-center justify-center w-9 h-6 rounded-md text-xs font-semibold ${tone}`}>{score}</span>
}

function SimpleSelect({ value, onChange, options, labels }: { value: string; onChange: (v: string) => void; options: string[]; labels?: Record<string, string> }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-600 outline-none"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? o}
        </option>
      ))}
    </select>
  )
}
