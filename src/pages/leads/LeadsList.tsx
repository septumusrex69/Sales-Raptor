import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Phone,
  Mail,
  MessageCircle,
  StickyNote,
  CheckSquare,
  Calendar,
  ArrowRightLeft,
  UserCog,
  XCircle,
  Search,
  SlidersHorizontal,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { canEditOwned, canReassign as canReassignRole, useDefaultOwnerFilter, isAssignableOwner} from '../../lib/permissions'
import { Card } from '../../components/ui/Card'
import { StatusBadge, ServiceBadge, ClassificationBadge } from '../../components/ui/Badge'
import { UserAvatar } from '../../components/ui/Avatar'
import { RowMenu } from '../../components/ui/RowMenu'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { ConfirmDeleteModal } from '../../components/ui/ConfirmDeleteModal'
import { LeadForm } from '../../components/layout/QuickAdd'
import { LeadsPeriodBar } from '../../components/leads/LeadsPeriodBar'
import { LeadsKpiRow, type LeadsKpiValues } from '../../components/leads/LeadsKpiRow'
import { formatCurrency, formatDate, formatLeadNumber, daysAgoLabel, industries, leadClassifications, leadSources, provinces, services, TODAY } from '../../data/mockData'
import { readParam } from '../../lib/drilldown'
import { decodeSalesMonthParam, isWithinPeriod, type SalesMonthPeriod } from '../../lib/salesMonth'
import { getPreviousEquivalentRange, getThisCalendarMonth } from '../../lib/dateRange'
import { isMeaningfulActivity } from '../../lib/meaningfulActivity'
import { ALL_COLUMNS, defaultVisibleColumns, SORTABLE_COLUMN_KEYS, type ColumnKey, type SortKey } from '../../lib/leadColumns'
import type { Lead, LeadClassification, LeadStatus, ProductService } from '../../types'

const ALL_STATUSES: LeadStatus[] = ['New', 'Attempting Contact', 'Contacted', 'Qualified', 'Unqualified', 'Proposal Required', 'Converted', 'Lost']
const SCORE_THRESHOLDS = ['All', '80', '60', '40', '20'] as const
const PAGE_SIZES = [10, 25, 50, 100]

function leadAgeLabel(iso: string) {
  const days = Math.max(0, Math.floor((TODAY.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)))
  if (days === 0) return 'Today'
  if (days === 1) return '1 day'
  return `${days} days`
}

function followUpTone(iso?: string) {
  if (!iso) return 'text-slate-400'
  const due = new Date(iso)
  if (due < TODAY && due.toDateString() !== TODAY.toDateString()) return 'text-[#794234] font-medium'
  if (due.toDateString() === TODAY.toDateString()) return 'text-[#b28e34] font-medium'
  return 'text-slate-600'
}

function isStaleClassAContact(lead: Lead) {
  if (lead.classification !== 'A') return false
  if (!lead.lastContactAt) return true
  const days = (TODAY.getTime() - new Date(lead.lastContactAt).getTime()) / (1000 * 60 * 60 * 24)
  return days > 7
}

export function LeadsList() {
  const store = useAppStore()
  const { leads, activities, users, userById, updateLead, markLeadLost, deleteLead, convertLeadToDeal, addActivity } = store
  const { currentUser } = useAuth()
  const canReassign = canReassignRole(currentUser)
  const reps = useMemo(() => users.filter((u) => isAssignableOwner(u.role)), [users])
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'All' | LeadStatus>(() => (readParam(searchParams, 'status') as LeadStatus) ?? 'All')
  const [classification, setClassification] = useState<'All' | LeadClassification>(() => (readParam(searchParams, 'classification') as LeadClassification) ?? 'All')
  const [scoreThreshold, setScoreThreshold] = useState<(typeof SCORE_THRESHOLDS)[number]>('All')
  const [owner, setOwner] = useDefaultOwnerFilter(readParam(searchParams, 'owner'), currentUser)
  const [service, setService] = useState<'All' | ProductService>(() => (readParam(searchParams, 'service') as ProductService) ?? 'All')
  const [province, setProvince] = useState(() => readParam(searchParams, 'province') ?? 'All')
  const [source, setSource] = useState<'All' | string>(() => readParam(searchParams, 'source') ?? 'All')

  const [showMoreFilters, setShowMoreFilters] = useState(false)
  const [industry, setIndustry] = useState('All')
  const [country, setCountry] = useState('All')
  const [city, setCity] = useState(() => readParam(searchParams, 'city') ?? 'All')

  const [period, setPeriod] = useState<SalesMonthPeriod>(() => decodeSalesMonthParam(searchParams.get('salesMonth')) ?? getThisCalendarMonth(TODAY))
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>(() => defaultVisibleColumns())
  const [sortKey, setSortKey] = useState<SortKey>('dateAdded')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const [addOpen, setAddOpen] = useState(false)
  const [reassignLead, setReassignLead] = useState<Lead | null>(null)
  const [deleteLeadTarget, setDeleteLeadTarget] = useState<Lead | null>(null)
  const [openServicesFor, setOpenServicesFor] = useState<string | null>(null)

  // One-time drill-down filters carried in from Dashboard/Reports links — not exposed as UI controls.
  const [noNextActionFilter] = useState(() => readParam(searchParams, 'noNextAction') === '1')
  const [touchedFilter] = useState(() => readParam(searchParams, 'touched'))

  const cityOptions = useMemo(() => Array.from(new Set(leads.map((l) => l.city).filter((c): c is string => Boolean(c)))).sort(), [leads])

  function matchesLeadFilters(l: Lead) {
    // Once converted, a lead is no longer an active thing to chase — it's
    // tracked as a Deal from here on. The default (no explicit status
    // chosen) view excludes them so the working list stays about leads
    // still worth pursuing; picking "Converted" explicitly still shows them.
    if (status === 'All' && l.status === 'Converted') return false
    if (status !== 'All' && l.status !== status) return false
    if (source !== 'All' && l.source !== source) return false
    if (owner !== 'All' && l.ownerId !== owner) return false
    if (industry !== 'All' && l.industry !== industry) return false
    if (province !== 'All' && l.province !== province) return false
    if (country !== 'All' && l.country !== country) return false
    if (city !== 'All' && l.city !== city) return false
    if (service !== 'All' && !l.services?.includes(service)) return false
    if (classification !== 'All' && l.classification !== classification) return false
    if (scoreThreshold !== 'All' && l.score < Number(scoreThreshold)) return false
    return true
  }

  function matchesSearch(l: Lead) {
    if (!search) return true
    const q = search.toLowerCase()
    const hay = `${formatLeadNumber(l.leadNumber)} ${l.firstName} ${l.lastName} ${l.companyName} ${l.email ?? ''} ${l.phone ?? ''} ${l.mobile ?? ''} ${(l.services ?? []).join(' ')}`.toLowerCase()
    return hay.includes(q)
  }

  const filtered = useMemo(() => {
    const touchedLeadIds = touchedFilter
      ? new Set(activities.filter((a) => a.leadId && isMeaningfulActivity(a) && isWithinPeriod(a.activityDate, period)).map((a) => a.leadId as string))
      : undefined
    return leads.filter((l) => {
      if (!isWithinPeriod(l.createdAt, period)) return false
      if (!matchesLeadFilters(l)) return false
      if (!matchesSearch(l)) return false
      if (noNextActionFilter && l.nextFollowUpAt) return false
      if (touchedFilter && touchedLeadIds) {
        const isTouched = touchedLeadIds.has(l.id) || (l.lastContactAt && isWithinPeriod(l.lastContactAt, period))
        if (touchedFilter === '1' && !isTouched) return false
        if (touchedFilter === '0' && isTouched) return false
      }
      return true
    })
  }, [leads, activities, period, status, source, owner, industry, province, country, city, service, classification, scoreThreshold, search, noNextActionFilter, touchedFilter])

  const previousPeriod = useMemo(() => getPreviousEquivalentRange(period), [period])
  const filteredPrevious = useMemo(
    () => leads.filter((l) => isWithinPeriod(l.createdAt, previousPeriod) && matchesLeadFilters(l) && matchesSearch(l)),
    [leads, previousPeriod, status, source, owner, industry, province, country, city, service, classification, scoreThreshold, search],
  )

  function computeKpis(rows: Lead[]): LeadsKpiValues {
    return {
      totalLeads: rows.length,
      newLeads: rows.filter((l) => l.status === 'New').length,
      qualified: rows.filter((l) => l.status === 'Qualified').length,
      converted: rows.filter((l) => l.status === 'Converted').length,
      estValueTotal: rows.reduce((s, l) => s + (l.estimatedValue ?? 0), 0),
      handoverTotal: rows.reduce((s, l) => s + (l.estimatedHandoverAmount ?? 0), 0),
    }
  }
  const kpiCurrent = useMemo(() => computeKpis(filtered), [filtered])
  const kpiPrevious = useMemo(() => computeKpis(filteredPrevious), [filteredPrevious])

  function getSortValue(l: Lead, key: SortKey): string | number | undefined {
    switch (key) {
      case 'leadNumber':
        return l.leadNumber
      case 'companyLead':
        return l.companyName?.toLowerCase()
      case 'status':
        return l.status
      case 'classification':
        return l.classification
      case 'score':
        return l.score
      case 'estValue':
        return l.estimatedValue
      case 'handoverAmount':
        return l.estimatedHandoverAmount
      case 'nextFollowUp':
        return l.nextFollowUpAt
      case 'dateAdded':
        return l.createdAt
      case 'lastContact':
        return l.lastContactAt
    }
  }

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      const va = getSortValue(a, sortKey)
      const vb = getSortValue(b, sortKey)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [filtered, sortKey, sortDir])

  useEffect(() => {
    setPage(1)
  }, [period, status, source, owner, industry, province, country, city, service, classification, scoreThreshold, search, pageSize])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [totalPages, page])
  const pageItems = sorted.slice((page - 1) * pageSize, page * pageSize)

  function handleSort(colKey: ColumnKey) {
    const key = SORTABLE_COLUMN_KEYS[colKey]
    if (!key) return
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  function sortableHeader(colKey: ColumnKey, label: string, align: 'left' | 'right' | 'center' = 'left') {
    const sortKeyForCol = SORTABLE_COLUMN_KEYS[colKey]
    const active = sortKeyForCol && sortKey === sortKeyForCol
    return (
      <button
        type="button"
        onClick={sortKeyForCol ? () => handleSort(colKey) : undefined}
        className={`inline-flex items-center gap-1 ${sortKeyForCol ? 'cursor-pointer hover:text-slate-600' : 'cursor-default'} ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {label}
        {active && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </button>
    )
  }

  function logQuickAction(lead: Lead, type: 'Call' | 'Email' | 'WhatsApp') {
    addActivity({ type, subject: `${type} with ${lead.firstName} ${lead.lastName}`, leadId: lead.id, companyId: lead.companyId })
    updateLead(lead.id, { lastContactAt: new Date().toISOString() })
    if (type === 'Call' && lead.phone) window.open(`tel:${lead.phone}`)
    if (type === 'Email' && lead.email) window.open(`mailto:${lead.email}`)
    if (type === 'WhatsApp' && lead.mobile) window.open(`https://wa.me/${lead.mobile.replace(/\D/g, '')}`)
  }

  const col = visibleColumns

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
          Leads
        </h2>
        <p className="text-sm text-slate-400 mt-0.5">Manage, track and convert your leads</p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 w-64">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leads..." className="text-sm outline-none flex-1 min-w-0" />
        </div>
        <SimpleSelect value={status} onChange={(v) => setStatus(v as typeof status)} options={['All', ...ALL_STATUSES]} labels={{ All: 'All Statuses' }} />
        <SimpleSelect value={classification} onChange={(v) => setClassification(v as typeof classification)} options={['All', ...leadClassifications]} labels={{ All: 'All Classes' }} />
        <SimpleSelect value={scoreThreshold} onChange={(v) => setScoreThreshold(v as typeof scoreThreshold)} options={[...SCORE_THRESHOLDS]} labels={{ All: 'All Scores', '80': '80+', '60': '60+', '40': '40+', '20': '20+' }} />
        <SimpleSelect value={owner} onChange={setOwner} options={['All', ...reps.map((r) => r.id)]} labels={{ All: 'All Owners', ...Object.fromEntries(reps.map((r) => [r.id, r.name])) }} />
        <SimpleSelect value={service} onChange={(v) => setService(v as typeof service)} options={['All', ...services]} labels={{ All: 'All Services' }} />
        <SimpleSelect value={province} onChange={setProvince} options={['All', ...provinces]} labels={{ All: 'All Provinces' }} />
        <SimpleSelect value={source} onChange={setSource} options={['All', ...leadSources]} labels={{ All: 'All Sources' }} />
        <button
          onClick={() => setShowMoreFilters((s) => !s)}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
        >
          <SlidersHorizontal size={14} /> More Filters
        </button>
        <button
          onClick={() => setAddOpen(true)}
          className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700"
        >
          <Plus size={15} /> Add Lead
        </button>
      </div>

      {showMoreFilters && (
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
            <FormField label="Country">
              <select className={inputClass} value={country} onChange={(e) => setCountry(e.target.value)}>
                <option>All</option>
                <option>South Africa</option>
              </select>
            </FormField>
            <FormField label="City / Town">
              <select className={inputClass} value={city} onChange={(e) => setCity(e.target.value)}>
                <option value="All">All</option>
                {cityOptions.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </FormField>
            <div className="flex items-end">
              <button
                onClick={() => {
                  setIndustry('All')
                  setCountry('All')
                  setCity('All')
                }}
                className="text-sm font-medium text-slate-500 hover:text-slate-700"
              >
                Reset filters
              </button>
            </div>
          </div>
        </Card>
      )}

      <LeadsPeriodBar period={period} onChange={setPeriod} referenceDate={TODAY} visibleColumns={visibleColumns} onChangeColumns={setVisibleColumns} />

      <LeadsKpiRow current={kpiCurrent} previous={period.key === 'all-time' ? undefined : kpiPrevious} compareLabel="vs previous period" />

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                {col.leadNumber && <th className="font-medium px-5 py-3 sticky left-0 z-10 bg-white min-w-[100px]">{sortableHeader('leadNumber', 'Lead #')}</th>}
                {col.companyLead && <th className="font-medium px-3 py-3 sticky left-[100px] z-10 bg-white min-w-[180px]">{sortableHeader('companyLead', 'Company / Lead')}</th>}
                {col.contactPerson && <th className="font-medium px-3 py-3">Contact Person</th>}
                {col.status && <th className="font-medium px-3 py-3">{sortableHeader('status', 'Status')}</th>}
                {col.classification && <th className="font-medium px-3 py-3">{sortableHeader('classification', 'Class')}</th>}
                {col.score && <th className="font-medium px-3 py-3">{sortableHeader('score', 'Score')}</th>}
                {col.services && <th className="font-medium px-3 py-3">Service(s)</th>}
                {col.estValue && <th className="font-medium px-3 py-3 text-right">{sortableHeader('estValue', 'Est. Value', 'right')}</th>}
                {col.handoverAmount && <th className="font-medium px-3 py-3 text-right">{sortableHeader('handoverAmount', 'Handover Amount', 'right')}</th>}
                {col.owner && <th className="font-medium px-3 py-3">Owner</th>}
                {col.nextFollowUp && <th className="font-medium px-3 py-3">{sortableHeader('nextFollowUp', 'Next Follow-up')}</th>}
                {col.dateAdded && <th className="font-medium px-3 py-3">{sortableHeader('dateAdded', 'Date Added')}</th>}
                {col.lastContact && <th className="font-medium px-3 py-3">{sortableHeader('lastContact', 'Last Contact')}</th>}
                {col.source && <th className="font-medium px-3 py-3">Source</th>}
                {col.city && <th className="font-medium px-3 py-3">City</th>}
                {col.province && <th className="font-medium px-3 py-3">Province</th>}
                {col.leadAge && <th className="font-medium px-3 py-3">Lead Age</th>}
                {col.jobTitle && <th className="font-medium px-3 py-3">Job Title</th>}
                {col.phone && <th className="font-medium px-3 py-3">Phone</th>}
                {col.email && <th className="font-medium px-3 py-3">Email</th>}
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((lead) => {
                const leadServices = lead.services ?? []
                const staleContact = isStaleClassAContact(lead)
                return (
                  <tr key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)} className="border-t border-slate-50 hover:bg-slate-50/60 cursor-pointer">
                    {col.leadNumber && (
                      <td className="px-5 py-3 sticky left-0 z-10 bg-white">
                        <Link to={`/leads/${lead.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-slate-700 hover:text-brand-600">
                          {formatLeadNumber(lead.leadNumber)}
                        </Link>
                      </td>
                    )}
                    {col.companyLead && (
                      <td className="px-3 py-3 sticky left-[100px] z-10 bg-white">
                        <Link to={`/leads/${lead.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-slate-700 hover:text-brand-600">
                          {lead.companyName || `${lead.firstName} ${lead.lastName}`}
                        </Link>
                      </td>
                    )}
                    {col.contactPerson && (
                      <td className="px-3 py-3">
                        <p className="text-slate-700">
                          {lead.firstName} {lead.lastName}
                        </p>
                        {lead.jobTitle && <p className="text-xs text-slate-400">{lead.jobTitle}</p>}
                      </td>
                    )}
                    {col.status && (
                      <td className="px-3 py-3">
                        <StatusBadge status={lead.status} />
                      </td>
                    )}
                    {col.classification && (
                      <td className="px-3 py-3">{lead.classification ? <ClassificationBadge classification={lead.classification} /> : <span className="text-slate-300">—</span>}</td>
                    )}
                    {col.score && (
                      <td className="px-3 py-3">
                        <ScorePill score={lead.score} />
                      </td>
                    )}
                    {col.services && (
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        {leadServices.length === 0 ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <div className="relative inline-flex items-center gap-1.5">
                            <ServiceBadge service={leadServices[0]} />
                            {leadServices.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setOpenServicesFor((v) => (v === lead.id ? null : lead.id))}
                                className="badge bg-slate-100 text-slate-500 hover:bg-slate-200"
                                title={leadServices.slice(1).join(', ')}
                              >
                                +{leadServices.length - 1}
                              </button>
                            )}
                            {openServicesFor === lead.id && (
                              <div className="absolute top-full left-0 mt-1.5 bg-white rounded-xl shadow-lg border border-slate-100 p-2.5 z-40 w-52 flex flex-wrap gap-1.5">
                                {leadServices.map((s) => (
                                  <ServiceBadge key={s} service={s} />
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                    {col.estValue && <td className="px-3 py-3 text-right font-medium text-slate-700">{formatCurrency(lead.estimatedValue)}</td>}
                    {col.handoverAmount && (
                      <td className="px-3 py-3 text-right text-slate-600">{lead.estimatedHandoverAmount != null ? formatCurrency(lead.estimatedHandoverAmount) : '—'}</td>
                    )}
                    {col.owner && (
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          <UserAvatar userId={lead.ownerId} size={22} />
                          <span className="text-slate-500 text-xs">{userById(lead.ownerId)?.name.split(' ')[0]}</span>
                        </div>
                      </td>
                    )}
                    {col.nextFollowUp && (
                      <td className="px-3 py-3">
                        <Link to={`/leads/${lead.id}`} onClick={(e) => e.stopPropagation()} className={`hover:underline ${followUpTone(lead.nextFollowUpAt)}`}>
                          {formatDate(lead.nextFollowUpAt)}
                        </Link>
                      </td>
                    )}
                    {col.dateAdded && <td className="px-3 py-3 text-slate-500">{formatDate(lead.createdAt)}</td>}
                    {col.lastContact && (
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          <div>
                            <p className="text-slate-600">{formatDate(lead.lastContactAt)}</p>
                            {lead.lastContactAt && <p className="text-xs text-slate-400">{daysAgoLabel(lead.lastContactAt)}</p>}
                          </div>
                          {staleContact && (
                            <span title="Class A lead — no recent contact">
                              <AlertTriangle size={13} className="text-[#794234] shrink-0" />
                            </span>
                          )}
                        </div>
                      </td>
                    )}
                    {col.source && <td className="px-3 py-3 text-slate-500">{lead.source}</td>}
                    {col.city && <td className="px-3 py-3 text-slate-500">{lead.city ?? '—'}</td>}
                    {col.province && <td className="px-3 py-3 text-slate-500">{lead.province ?? '—'}</td>}
                    {col.leadAge && <td className="px-3 py-3 text-slate-500">{leadAgeLabel(lead.createdAt)}</td>}
                    {col.jobTitle && <td className="px-3 py-3 text-slate-500">{lead.jobTitle ?? '—'}</td>}
                    {col.phone && <td className="px-3 py-3 text-slate-500">{lead.phone ?? '—'}</td>}
                    {col.email && <td className="px-3 py-3 text-slate-500">{lead.email ?? '—'}</td>}
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <RowMenu
                        items={[
                          { label: 'Call', icon: <Phone size={14} />, onClick: () => logQuickAction(lead, 'Call') },
                          { label: 'Email', icon: <Mail size={14} />, onClick: () => logQuickAction(lead, 'Email') },
                          { label: 'WhatsApp', icon: <MessageCircle size={14} />, onClick: () => logQuickAction(lead, 'WhatsApp') },
                          { label: 'Add note', icon: <StickyNote size={14} />, onClick: () => addActivity({ type: 'Note', subject: 'Note added', leadId: lead.id, companyId: lead.companyId }) },
                          { label: 'Add task', icon: <CheckSquare size={14} />, onClick: () => navigate(`/leads/${lead.id}`) },
                          { label: 'Schedule meeting', icon: <Calendar size={14} />, onClick: () => navigate(`/leads/${lead.id}`) },
                          ...(canEditOwned(currentUser, lead.ownerId)
                            ? [
                                {
                                  label: 'Convert to deal',
                                  icon: <ArrowRightLeft size={14} />,
                                  onClick: () => {
                                    const deal = convertLeadToDeal(lead.id)
                                    if (deal) navigate(`/deals/${deal.id}`)
                                  },
                                },
                              ]
                            : []),
                          ...(canReassign ? [{ label: 'Reassign', icon: <UserCog size={14} />, onClick: () => setReassignLead(lead) }] : []),
                          ...(canEditOwned(currentUser, lead.ownerId)
                            ? [
                                { label: 'Mark lost', icon: <XCircle size={14} />, danger: true, onClick: () => markLeadLost(lead.id) },
                                { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => setDeleteLeadTarget(lead) },
                              ]
                            : []),
                        ]}
                      />
                    </td>
                  </tr>
                )
              })}
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={ALL_COLUMNS.length + 1} className="text-center text-slate-400 text-sm py-10">
                    No leads match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-t border-slate-100">
          <span className="text-xs text-slate-400">
            Showing {sorted.length === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, sorted.length)} of {sorted.length} leads
          </span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:pointer-events-none"
              >
                <ChevronLeft size={14} />
              </button>
              {paginationWindow(page, totalPages).map((p, i) =>
                p === '…' ? (
                  <span key={`e${i}`} className="px-1.5 text-slate-400 text-xs">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-7 h-7 rounded-lg text-xs font-medium ${p === page ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:pointer-events-none"
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-600 outline-none"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} per page
                </option>
              ))}
            </select>
          </div>
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
          itemLabel={`${formatLeadNumber(deleteLeadTarget.leadNumber)} — ${deleteLeadTarget.firstName} ${deleteLeadTarget.lastName}`}
          onClose={() => setDeleteLeadTarget(null)}
          onConfirm={() => deleteLead(deleteLeadTarget.id)}
        />
      )}
    </div>
  )
}

/** Windowed page-number list with ellipsis for large page counts, e.g. [1,'…',4,5,6,'…',12]. */
function paginationWindow(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = new Set([1, 2, total - 1, total, current - 1, current, current + 1])
  const clamped = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
  const out: (number | '…')[] = []
  let prev = 0
  for (const p of clamped) {
    if (prev && p - prev > 1) out.push('…')
    out.push(p)
    prev = p
  }
  return out
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
