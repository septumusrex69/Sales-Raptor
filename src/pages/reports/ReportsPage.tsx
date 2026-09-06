import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { SlidersHorizontal } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { Card, CardHeader } from '../../components/ui/Card'
import { UserAvatar } from '../../components/ui/Avatar'
import { StatTile } from '../../components/ui/StatTile'
import { SalesMonthPicker } from '../../components/ui/SalesMonthPicker'
import { CompareSelector, type CompareMode } from '../../components/ui/CompareSelector'
import { FormField, inputClass } from '../../components/ui/Modal'
import { countries, formatCurrency, leadClassifications, leadSources, provinces, services, TODAY } from '../../data/mockData'
import { DEAL_STAGES } from '../../types'
import type { Deal, Lead, LeadClassification, LeadSource, LeadStatus, ProductService } from '../../types'
import { getCurrentSalesMonth, getPreviousSalesMonth, isWithinPeriod, encodeSalesMonthParam, type SalesMonthPeriod } from '../../lib/salesMonth'
import { isMeaningfulActivity } from '../../lib/meaningfulActivity'
import { parseEmailActivity } from '../../lib/emailActivity'
import { buildDrilldownUrl, SALES_MONTH_PARAM } from '../../lib/drilldown'
import { STAGE_COLORS } from '../../lib/colors'
import { isAssignableOwner } from '../../lib/permissions'
import { LEAD_STATUSES, isActiveLead, isEngagedLead } from '../../lib/leadStatus'

const TABS = ['Overview', 'Leads', 'Pipeline', 'Products & Services', 'Debt Collection', 'Sales Team', 'Lead Sources', 'Geography', 'Rejected Deals'] as const
type Tab = (typeof TABS)[number]
const ALL_STATUSES: LeadStatus[] = LEAD_STATUSES
const BAR_COLOR = STAGE_COLORS['Quotation Sent']

function pctDelta(curr: number, prev: number): number {
  if (prev === 0) return curr === 0 ? 0 : 100
  return Math.round(((curr - prev) / prev) * 100)
}

export function ReportsPage() {
  const { leads, deals, activities, users } = useAppStore()
  const reps = useMemo(() => users.filter((u) => isAssignableOwner(u.role)), [users])
  const [tab, setTab] = useState<Tab>('Overview')
  const [period, setPeriod] = useState<SalesMonthPeriod>(() => getCurrentSalesMonth(TODAY))
  const [compareMode, setCompareMode] = useState<CompareMode>('previous')
  const [showFilters, setShowFilters] = useState(false)

  const [rep, setRep] = useState('All')
  const [status, setStatus] = useState<'All' | LeadStatus>('All')
  const [classification, setClassification] = useState<'All' | LeadClassification>('All')
  const [source, setSource] = useState<'All' | LeadSource>('All')
  const [service, setService] = useState<'All' | ProductService>('All')
  const [country, setCountry] = useState('All')
  const [province, setProvince] = useState('All')
  const [city, setCity] = useState('All')

  const cityOptions = useMemo(() => Array.from(new Set(leads.map((l) => l.city).filter((c): c is string => Boolean(c)))).sort(), [leads])

  const previousPeriod = useMemo(() => getPreviousSalesMonth(period), [period])
  const periodParam = encodeSalesMonthParam(period)

  function matchesLeadFilters(l: Lead) {
    if (rep !== 'All' && l.ownerId !== rep) return false
    if (status !== 'All' && l.status !== status) return false
    if (classification !== 'All' && l.classification !== classification) return false
    if (source !== 'All' && l.source !== source) return false
    if (service !== 'All' && !l.services?.includes(service)) return false
    if (country !== 'All' && l.country !== country) return false
    if (province !== 'All' && l.province !== province) return false
    if (city !== 'All' && l.city !== city) return false
    return true
  }

  function matchesDealFilters(d: Deal) {
    if (rep !== 'All' && d.ownerId !== rep) return false
    if (source !== 'All' && d.source !== source) return false
    if (service !== 'All' && d.service !== service) return false
    return true
  }

  const leadsInPeriod = useMemo(
    () => leads.filter((l) => isWithinPeriod(l.createdAt, period) && matchesLeadFilters(l)),
    [leads, period, rep, status, classification, source, service, country, province, city],
  )
  const prevLeadsInPeriod = useMemo(
    () => (compareMode === 'previous' ? leads.filter((l) => isWithinPeriod(l.createdAt, previousPeriod) && matchesLeadFilters(l)) : []),
    [leads, previousPeriod, compareMode, rep, status, classification, source, service, country, province, city],
  )

  const wonDealsInPeriod = useMemo(
    () => deals.filter((d) => d.wonAt && isWithinPeriod(d.wonAt, period) && matchesDealFilters(d)),
    [deals, period, rep, source, service],
  )
  const lostDealsInPeriod = useMemo(
    () => deals.filter((d) => d.rejectedAt && isWithinPeriod(d.rejectedAt, period) && matchesDealFilters(d)),
    [deals, period, rep, source, service],
  )
  const prevWonDeals = useMemo(
    () => (compareMode === 'previous' ? deals.filter((d) => d.wonAt && isWithinPeriod(d.wonAt, previousPeriod) && matchesDealFilters(d)) : []),
    [deals, previousPeriod, compareMode, rep, source, service],
  )
  const prevLostDeals = useMemo(
    () => (compareMode === 'previous' ? deals.filter((d) => d.rejectedAt && isWithinPeriod(d.rejectedAt, previousPeriod) && matchesDealFilters(d)) : []),
    [deals, previousPeriod, compareMode, rep, source, service],
  )
  const openDeals = useMemo(() => deals.filter((d) => d.stage !== 'Won' && d.stage !== 'Rejected' && matchesDealFilters(d)), [deals, rep, source, service])
  const allDealsFiltered = useMemo(() => deals.filter((d) => matchesDealFilters(d)), [deals, rep, source, service])

  function computeCore(periodLeads: Lead[], won: Deal[], lost: Deal[]) {
    const total = periodLeads.length
    const noContact = periodLeads.filter((l) => l.status === 'No Contact Yet').length
    const interested = periodLeads.filter((l) => l.status === 'Interested').length
    const hot = periodLeads.filter((l) => l.status === 'Hot Lead').length
    // Everyone showing real intent, including the ones that went on to convert — the base the
    // pipeline is actually forecast from, rather than any single status.
    const engaged = periodLeads.filter(isEngagedLead).length
    const wonLeads = periodLeads.filter((l) => l.status === 'Converted').length
    const rejectedLeads = periodLeads.filter((l) => l.status === 'Rejected').length
    const conversionRate = total ? Math.round((wonLeads / total) * 100) : 0
    const revenueWon = won.reduce((s, d) => s + d.value, 0)
    const avgDealValue = won.length ? Math.round(revenueWon / won.length) : 0
    const closed = won.length + lost.length
    const winRate = closed ? Math.round((won.length / closed) * 100) : 0

    const debtLeads = periodLeads.filter((l) => l.services?.includes('Debt Collection'))
    const handoverAmounts = debtLeads.map((l) => l.estimatedHandoverAmount).filter((v): v is number => v != null)
    const totalHandoverValue = handoverAmounts.reduce((s, v) => s + v, 0)
    const avgHandoverValue = handoverAmounts.length ? Math.round(totalHandoverValue / handoverAmounts.length) : 0

    const conversionTimes: number[] = []
    for (const d of won) {
      if (!d.leadId) continue
      const lead = leads.find((l) => l.id === d.leadId)
      if (!lead) continue
      conversionTimes.push((new Date(d.wonAt!).getTime() - new Date(lead.createdAt).getTime()) / 86400000)
    }
    const avgTimeToConversionDays = conversionTimes.length ? Math.round(conversionTimes.reduce((s, v) => s + v, 0) / conversionTimes.length) : undefined

    return { total, noContact, interested, hot, engaged, wonLeads, rejectedLeads, conversionRate, revenueWon, avgDealValue, winRate, totalHandoverValue, avgHandoverValue, avgTimeToConversionDays }
  }

  const core = useMemo(() => computeCore(leadsInPeriod, wonDealsInPeriod, lostDealsInPeriod), [leadsInPeriod, wonDealsInPeriod, lostDealsInPeriod])
  const prevCore = useMemo(
    () => (compareMode === 'previous' ? computeCore(prevLeadsInPeriod, prevWonDeals, prevLostDeals) : undefined),
    [compareMode, prevLeadsInPeriod, prevWonDeals, prevLostDeals],
  )

  const pipelineValue = useMemo(() => openDeals.reduce((s, d) => s + d.value, 0), [openDeals])
  const weightedPipeline = useMemo(() => openDeals.reduce((s, d) => s + (d.value * d.probability) / 100, 0), [openDeals])

  const leadsBySource = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of leadsInPeriod) map.set(l.source, (map.get(l.source) ?? 0) + 1)
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [leadsInPeriod])

  const leadsByRep = useMemo(() => reps.map((r) => ({ name: r.name.split(' ')[0], value: leadsInPeriod.filter((l) => l.ownerId === r.id).length })), [leadsInPeriod, reps])

  const dealsByStage = useMemo(() => DEAL_STAGES.map((s) => ({ name: s, value: allDealsFiltered.filter((d) => d.stage === s).length })), [allDealsFiltered])

  const lostByReason = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of lostDealsInPeriod) {
      const reason = d.rejectionReason ?? 'Other'
      map.set(reason, (map.get(reason) ?? 0) + 1)
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [lostDealsInPeriod])

  const forecast = useMemo(() => [...openDeals].sort((a, b) => b.value - a.value).slice(0, 10).map((d) => ({ ...d, weighted: Math.round((d.value * d.probability) / 100) })), [openDeals])

  const servicesReport = useMemo(
    () =>
      services.map((svc) => {
        const svcLeads = leadsInPeriod.filter((l) => l.services?.includes(svc))
        const engaged = svcLeads.filter(isEngagedLead)
        const won = svcLeads.filter((l) => l.status === 'Converted')
        const rejected = svcLeads.filter((l) => l.status === 'Rejected')
        const open = svcLeads.filter(isActiveLead)
        const pipelineVal = open.reduce((s, l) => s + (l.estimatedProjectValue ?? l.estimatedValue ?? 0), 0)
        const values = svcLeads.map((l) => l.estimatedProjectValue ?? l.estimatedValue).filter((v): v is number => v != null)
        const avgValue = values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : 0
        return {
          service: svc,
          leads: svcLeads.length,
          engaged: engaged.length,
          won: won.length,
          rejected: rejected.length,
          conversionRate: svcLeads.length ? Math.round((won.length / svcLeads.length) * 100) : 0,
          pipelineValue: pipelineVal,
          avgValue,
        }
      }),
    [leadsInPeriod],
  )

  const debtCollectionLeads = useMemo(() => leadsInPeriod.filter((l) => l.services?.includes('Debt Collection')), [leadsInPeriod])
  const debtCollectionStats = useMemo(() => {
    const won = debtCollectionLeads.filter((l) => l.status === 'Converted')
    const rejected = debtCollectionLeads.filter((l) => l.status === 'Rejected')
    const amounts = debtCollectionLeads.map((l) => l.estimatedHandoverAmount).filter((v): v is number => v != null)
    const totalHandover = amounts.reduce((s, v) => s + v, 0)
    const accounts = debtCollectionLeads.map((l) => l.estimatedAccountsCount).filter((v): v is number => v != null)
    const totalAccounts = accounts.reduce((s, v) => s + v, 0)
    const wonHandoverValue = won.reduce((s, l) => s + (l.estimatedHandoverAmount ?? 0), 0)
    return {
      count: debtCollectionLeads.length,
      totalHandover,
      avgHandover: amounts.length ? Math.round(totalHandover / amounts.length) : 0,
      totalAccounts,
      won: won.length,
      rejected: rejected.length,
      conversionRate: debtCollectionLeads.length ? Math.round((won.length / debtCollectionLeads.length) * 100) : 0,
      wonHandoverValue,
    }
  }, [debtCollectionLeads])

  const salespeople = useMemo(
    () =>
      (rep === 'All' ? reps : reps.filter((r) => r.id === rep)).map((r) => {
        const repLeads = leadsInPeriod.filter((l) => l.ownerId === r.id)
        const won = wonDealsInPeriod.filter((d) => d.ownerId === r.id)
        const lost = lostDealsInPeriod.filter((d) => d.ownerId === r.id)
        const calls = activities.filter((a) => a.userId === r.id && a.type === 'Call' && isMeaningfulActivity(a) && isWithinPeriod(a.activityDate, period)).length
        const meetings = activities.filter((a) => a.userId === r.id && a.type === 'Meeting' && isWithinPeriod(a.activityDate, period)).length
        const proposals = activities.filter((a) => a.userId === r.id && a.type === 'Proposal' && isWithinPeriod(a.activityDate, period)).length
        const repEmails = activities.filter((a) => a.userId === r.id && a.type === 'Email' && isWithinPeriod(a.activityDate, period))
        const emailsSent = repEmails.filter((a) => parseEmailActivity(a.subject)?.direction === 'sent').length
        const emailsResponded = repEmails.filter((a) => parseEmailActivity(a.subject)?.direction === 'received').length
        const revenueWon = won.reduce((s, d) => s + d.value, 0)
        const closed = won.length + lost.length
        return {
          rep: r,
          leadsAssigned: repLeads.length,
          calls,
          meetings,
          proposals,
          emailsSent,
          emailsResponded,
          dealsWon: won.length,
          revenueWon,
          avgDealValue: won.length ? Math.round(revenueWon / won.length) : 0,
          conversionRate: closed ? Math.round((won.length / closed) * 100) : 0,
        }
      }),
    [leadsInPeriod, wonDealsInPeriod, lostDealsInPeriod, activities, period, rep, reps],
  )

  const sourcePerformance = useMemo(
    () =>
      leadSources.map((s) => {
        const sourceLeads = leadsInPeriod.filter((l) => l.source === s)
        const engagedLeads = sourceLeads.filter(isEngagedLead)
        const won = wonDealsInPeriod.filter((d) => d.source === s)
        return {
          source: s,
          leads: sourceLeads.length,
          engaged: engagedLeads.length,
          won: won.length,
          revenue: won.reduce((sum, d) => sum + d.value, 0),
          conversionRate: sourceLeads.length ? Math.round((engagedLeads.length / sourceLeads.length) * 100) : 0,
        }
      }),
    [leadsInPeriod, wonDealsInPeriod],
  )

  const provinceReport = useMemo(
    () =>
      provinces.map((p) => {
        const provinceLeads = leadsInPeriod.filter((l) => l.province === p)
        const won = provinceLeads.filter((l) => l.status === 'Converted')
        const open = provinceLeads.filter(isActiveLead)
        return {
          province: p,
          leads: provinceLeads.length,
          won: won.length,
          conversionRate: provinceLeads.length ? Math.round((won.length / provinceLeads.length) * 100) : 0,
          pipelineValue: open.reduce((s, l) => s + (l.estimatedProjectValue ?? l.estimatedValue ?? 0), 0),
        }
      }),
    [leadsInPeriod],
  )

  const emailActivitiesInPeriod = useMemo(
    () => activities.filter((a) => a.type === 'Email' && isWithinPeriod(a.activityDate, period) && (rep === 'All' || a.userId === rep)),
    [activities, period, rep],
  )
  const emailStats = useMemo(() => {
    let sent = 0
    let responded = 0
    for (const a of emailActivitiesInPeriod) {
      const parsed = parseEmailActivity(a.subject)
      if (parsed?.direction === 'sent') sent += 1
      else if (parsed?.direction === 'received') responded += 1
    }
    return { sent, responded }
  }, [emailActivitiesInPeriod])

  const cityReport = useMemo(
    () =>
      cityOptions
        .map((c) => ({ city: c, leads: leadsInPeriod.filter((l) => l.city === c).length }))
        .filter((r) => r.leads > 0)
        .sort((a, b) => b.leads - a.leads)
        .slice(0, 12),
    [cityOptions, leadsInPeriod],
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Reports</h2>
          <p className="text-sm text-slate-400 mt-0.5">Sales performance across the selected Sales Cycle</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SalesMonthPicker value={period} onChange={setPeriod} referenceDate={TODAY} />
          <CompareSelector value={compareMode} onChange={setCompareMode} />
          <button
            onClick={() => setShowFilters((s) => !s)}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          >
            <SlidersHorizontal size={14} /> Filters
          </button>
        </div>
      </div>

      {showFilters && (
        <Card className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <FormField label="Sales Rep">
              <select className={inputClass} value={rep} onChange={(e) => setRep(e.target.value)}>
                <option value="All">All Reps</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Status">
              <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="All">All</option>
                {ALL_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Classification">
              <select className={inputClass} value={classification} onChange={(e) => setClassification(e.target.value as typeof classification)}>
                <option value="All">All</option>
                {leadClassifications.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Source">
              <select className={inputClass} value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
                <option value="All">All</option>
                {leadSources.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Service">
              <select className={inputClass} value={service} onChange={(e) => setService(e.target.value as typeof service)}>
                <option value="All">All</option>
                {services.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Country">
              <select className={inputClass} value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="All">All</option>
                {countries.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Province">
              <select className={inputClass} value={province} onChange={(e) => setProvince(e.target.value)}>
                <option value="All">All</option>
                {provinces.map((p) => (
                  <option key={p}>{p}</option>
                ))}
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
          </div>
          <button
            onClick={() => {
              setRep('All')
              setStatus('All')
              setClassification('All')
              setSource('All')
              setService('All')
              setCountry('All')
              setProvince('All')
              setCity('All')
            }}
            className="text-sm font-medium text-slate-500 hover:text-slate-700 mt-3"
          >
            Reset filters
          </button>
        </Card>
      )}

      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${tab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatTile
              label="Total Leads"
              value={String(core.total)}
              pctChange={prevCore ? pctDelta(core.total, prevCore.total) : undefined}
              to={buildDrilldownUrl('/leads', { [SALES_MONTH_PARAM]: periodParam })}
            />
            <StatTile
              label="Hot Leads"
              value={String(core.hot)}
              pctChange={prevCore ? pctDelta(core.hot, prevCore.hot) : undefined}
              to={buildDrilldownUrl('/leads', { status: 'Hot Lead', [SALES_MONTH_PARAM]: periodParam })}
            />
            <StatTile label="Conversion Rate" value={`${core.conversionRate}%`} pctChange={prevCore ? pctDelta(core.conversionRate, prevCore.conversionRate) : undefined} />
            <StatTile label="Win Rate" value={`${core.winRate}%`} pctChange={prevCore ? pctDelta(core.winRate, prevCore.winRate) : undefined} />
            <StatTile
              label="Deals Won"
              value={String(wonDealsInPeriod.length)}
              pctChange={prevCore ? pctDelta(wonDealsInPeriod.length, prevWonDeals.length) : undefined}
              to={buildDrilldownUrl('/deals', { stage: 'Won', view: 'table' })}
            />
            <StatTile
              label="Revenue Won"
              value={formatCurrency(core.revenueWon)}
              pctChange={prevCore ? pctDelta(core.revenueWon, prevCore.revenueWon) : undefined}
              to={buildDrilldownUrl('/deals', { stage: 'Won', view: 'table' })}
            />
            <StatTile label="Pipeline Value" value={formatCurrency(pipelineValue)} to={buildDrilldownUrl('/deals', { view: 'table' })} />
            <StatTile
              label="Total Handover Value"
              value={formatCurrency(core.totalHandoverValue)}
              pctChange={prevCore ? pctDelta(core.totalHandoverValue, prevCore.totalHandoverValue) : undefined}
              to={buildDrilldownUrl('/leads', { service: 'Debt Collection', [SALES_MONTH_PARAM]: periodParam })}
            />
            <StatTile label="Emails Sent" value={String(emailStats.sent)} to={buildDrilldownUrl('/activities', { type: 'Email', [SALES_MONTH_PARAM]: periodParam })} />
            <StatTile label="Responded" value={String(emailStats.responded)} to={buildDrilldownUrl('/activities', { type: 'Email', [SALES_MONTH_PARAM]: periodParam })} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <CardHeader title="Deals by Stage" />
              <ChartBar data={dealsByStage} />
            </Card>
            <Card>
              <CardHeader title="Leads by Source" />
              <ChartBar data={leadsBySource} />
            </Card>
          </div>
        </div>
      )}

      {tab === 'Leads' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatTile label="Total Leads" value={String(core.total)} to={buildDrilldownUrl('/leads', { [SALES_MONTH_PARAM]: periodParam })} />
            <StatTile label="No Contact Yet" value={String(core.noContact)} to={buildDrilldownUrl('/leads', { status: 'No Contact Yet', [SALES_MONTH_PARAM]: periodParam })} />
            <StatTile label="Interested" value={String(core.interested)} to={buildDrilldownUrl('/leads', { status: 'Interested', [SALES_MONTH_PARAM]: periodParam })} />
            <StatTile label="Hot Leads" value={String(core.hot)} to={buildDrilldownUrl('/leads', { status: 'Hot Lead', [SALES_MONTH_PARAM]: periodParam })} />
            <StatTile label="Converted" value={String(core.wonLeads)} to={buildDrilldownUrl('/leads', { status: 'Converted', [SALES_MONTH_PARAM]: periodParam })} />
            <StatTile label="Rejected" value={String(core.rejectedLeads)} to={buildDrilldownUrl('/leads', { status: 'Rejected', [SALES_MONTH_PARAM]: periodParam })} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatTile label="Conversion Rate" value={`${core.conversionRate}%`} size="secondary" />
            <StatTile label="Avg Time to Conversion" value={core.avgTimeToConversionDays !== undefined ? `${core.avgTimeToConversionDays}d` : '—'} size="secondary" />
            <StatTile label="Avg Deal Value" value={formatCurrency(core.avgDealValue)} size="secondary" />
            <StatTile label="Avg Handover Value" value={formatCurrency(core.avgHandoverValue)} size="secondary" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <CardHeader title="Leads by Source" />
              <ChartBar data={leadsBySource} />
            </Card>
            <Card>
              <CardHeader title="Leads by Salesperson" />
              <ChartBar data={leadsByRep} />
            </Card>
          </div>
        </div>
      )}

      {tab === 'Pipeline' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatTile label="Pipeline Value" value={formatCurrency(pipelineValue)} to={buildDrilldownUrl('/deals', { view: 'table' })} />
            <StatTile label="Weighted Pipeline" value={formatCurrency(Math.round(weightedPipeline))} />
            <StatTile label="Average Deal Value (Won)" value={formatCurrency(core.avgDealValue)} />
            <StatTile label="Expected Revenue (Top 10)" value={formatCurrency(forecast.reduce((s, d) => s + d.weighted, 0))} />
          </div>
          <Card>
            <CardHeader title="Deals by Stage" />
            <ChartBar data={dealsByStage} />
          </Card>
          <Card padded={false}>
            <div className="p-5 pb-0">
              <CardHeader title="Sales Forecast" subtitle="Weighted value = deal value × probability" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 border-t border-slate-100">
                    <th className="font-medium px-5 py-2.5">Deal</th>
                    <th className="font-medium px-3 py-2.5 text-right">Value</th>
                    <th className="font-medium px-3 py-2.5 text-right">Probability</th>
                    <th className="font-medium px-3 py-2.5 text-right">Weighted Value</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.map((d) => (
                    <tr key={d.id} className="border-t border-slate-50">
                      <td className="px-5 py-2.5 font-medium text-slate-700">
                        <Link to={`/deals/${d.id}`} className="hover:text-brand-600 hover:underline">
                          {d.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-500">{formatCurrency(d.value)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-500">{d.probability}%</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-slate-700">{formatCurrency(d.weighted)}</td>
                    </tr>
                  ))}
                  {forecast.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center text-slate-400 text-sm py-8">
                        No open deals match your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === 'Products & Services' && (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="font-medium px-5 py-3">Service</th>
                  <th className="font-medium px-3 py-3 text-center">Leads</th>
                  <th className="font-medium px-3 py-3 text-center">Engaged</th>
                  <th className="font-medium px-3 py-3 text-center">Won</th>
                  <th className="font-medium px-3 py-3 text-center">Rejected</th>
                  <th className="font-medium px-3 py-3 text-center">Conversion</th>
                  <th className="font-medium px-3 py-3 text-right">Pipeline Value</th>
                  <th className="font-medium px-3 py-3 text-right">Avg Value</th>
                </tr>
              </thead>
              <tbody>
                {servicesReport
                  .sort((a, b) => b.leads - a.leads)
                  .map((s) => (
                    <tr key={s.service} className="border-t border-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-700">{s.service}</td>
                      <td className="px-3 py-3 text-center">
                        <Link
                          to={buildDrilldownUrl('/leads', { service: s.service, [SALES_MONTH_PARAM]: periodParam })}
                          className="text-slate-600 hover:text-brand-600 hover:underline"
                        >
                          {s.leads}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-center text-slate-600">{s.engaged}</td>
                      <td className="px-3 py-3 text-center text-slate-600">{s.won}</td>
                      <td className="px-3 py-3 text-center text-slate-600">{s.rejected}</td>
                      <td className="px-3 py-3 text-center text-slate-600">{s.conversionRate}%</td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-700">{formatCurrency(s.pipelineValue)}</td>
                      <td className="px-3 py-3 text-right text-slate-600">{formatCurrency(s.avgValue)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'Debt Collection' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatTile
              label="Debt Collection Leads"
              value={String(debtCollectionStats.count)}
              to={buildDrilldownUrl('/leads', { service: 'Debt Collection', [SALES_MONTH_PARAM]: periodParam })}
            />
            <StatTile label="Total Handover Amount" value={formatCurrency(debtCollectionStats.totalHandover)} />
            <StatTile label="Average Handover Amount" value={formatCurrency(debtCollectionStats.avgHandover)} />
            <StatTile label="Total Accounts" value={String(debtCollectionStats.totalAccounts)} />
            <StatTile
              label="Converted"
              value={String(debtCollectionStats.won)}
              to={buildDrilldownUrl('/leads', { service: 'Debt Collection', status: 'Converted', [SALES_MONTH_PARAM]: periodParam })}
            />
            <StatTile
              label="Rejected"
              value={String(debtCollectionStats.rejected)}
              to={buildDrilldownUrl('/leads', { service: 'Debt Collection', status: 'Rejected', [SALES_MONTH_PARAM]: periodParam })}
            />
            <StatTile label="Conversion Rate" value={`${debtCollectionStats.conversionRate}%`} />
            <StatTile label="Won Handover Value" value={formatCurrency(debtCollectionStats.wonHandoverValue)} />
          </div>
          {debtCollectionStats.count === 0 && <p className="text-sm text-slate-400">No Debt Collection leads match the selected Sales Cycle and filters.</p>}
        </div>
      )}

      {tab === 'Sales Team' && (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="font-medium px-5 py-3">Salesperson</th>
                  <th className="font-medium px-3 py-3 text-center">Leads Assigned</th>
                  <th className="font-medium px-3 py-3 text-center">Calls</th>
                  <th className="font-medium px-3 py-3 text-center">Meetings</th>
                  <th className="font-medium px-3 py-3 text-center">Proposals</th>
                  <th className="font-medium px-3 py-3 text-center">Emails Sent</th>
                  <th className="font-medium px-3 py-3 text-center">Responded</th>
                  <th className="font-medium px-3 py-3 text-center">Deals Won</th>
                  <th className="font-medium px-3 py-3 text-right">Revenue Won</th>
                  <th className="font-medium px-3 py-3 text-right">Avg Deal Value</th>
                  <th className="font-medium px-3 py-3 text-center">Conversion</th>
                </tr>
              </thead>
              <tbody>
                {salespeople
                  .sort((a, b) => b.revenueWon - a.revenueWon)
                  .map((s) => (
                    <tr key={s.rep.id} className="border-t border-slate-50">
                      <td className="px-5 py-3">
                        <Link to={`/reps/${s.rep.id}`} className="flex items-center gap-2.5 hover:text-brand-600">
                          <UserAvatar userId={s.rep.id} size={26} />
                          <span className="font-medium text-slate-700">{s.rep.name}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <Link
                          to={buildDrilldownUrl('/leads', { owner: s.rep.id, [SALES_MONTH_PARAM]: periodParam })}
                          className="text-slate-600 hover:text-brand-600 hover:underline"
                        >
                          {s.leadsAssigned}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <Link to={buildDrilldownUrl('/activities', { owner: s.rep.id, type: 'Call' })} className="text-slate-600 hover:text-brand-600 hover:underline">
                          {s.calls}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <Link to={buildDrilldownUrl('/activities', { owner: s.rep.id, type: 'Meeting' })} className="text-slate-600 hover:text-brand-600 hover:underline">
                          {s.meetings}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <Link to={buildDrilldownUrl('/activities', { owner: s.rep.id, type: 'Proposal' })} className="text-slate-600 hover:text-brand-600 hover:underline">
                          {s.proposals}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <Link to={buildDrilldownUrl('/activities', { owner: s.rep.id, type: 'Email' })} className="text-slate-600 hover:text-brand-600 hover:underline">
                          {s.emailsSent}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <Link to={buildDrilldownUrl('/activities', { owner: s.rep.id, type: 'Email' })} className="text-slate-600 hover:text-brand-600 hover:underline">
                          {s.emailsResponded}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-center text-slate-600">{s.dealsWon}</td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-700">{formatCurrency(s.revenueWon)}</td>
                      <td className="px-3 py-3 text-right text-slate-600">{formatCurrency(s.avgDealValue)}</td>
                      <td className="px-3 py-3 text-center text-slate-600">{s.conversionRate}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'Lead Sources' && (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="font-medium px-5 py-3">Source</th>
                  <th className="font-medium px-3 py-3 text-center">Leads</th>
                  <th className="font-medium px-3 py-3 text-center">Engaged Leads</th>
                  <th className="font-medium px-3 py-3 text-center">Deals Won</th>
                  <th className="font-medium px-3 py-3 text-right">Revenue</th>
                  <th className="font-medium px-3 py-3 text-center">Conversion Rate</th>
                </tr>
              </thead>
              <tbody>
                {sourcePerformance
                  .sort((a, b) => b.revenue - a.revenue)
                  .map((s) => (
                    <tr key={s.source} className="border-t border-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-700">{s.source}</td>
                      <td className="px-3 py-3 text-center">
                        <Link
                          to={buildDrilldownUrl('/leads', { source: s.source, [SALES_MONTH_PARAM]: periodParam })}
                          className="text-slate-600 hover:text-brand-600 hover:underline"
                        >
                          {s.leads}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-center text-slate-600">{s.engaged}</td>
                      <td className="px-3 py-3 text-center text-slate-600">{s.won}</td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-700">{formatCurrency(s.revenue)}</td>
                      <td className="px-3 py-3 text-center text-slate-600">{s.conversionRate}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'Geography' && (
        <div className="space-y-5">
          <Card>
            <CardHeader title="Leads by Province" />
            <ChartBar data={provinceReport.map((p) => ({ name: p.province, value: p.leads }))} />
          </Card>
          <Card padded={false}>
            <div className="p-5 pb-0">
              <CardHeader title="Province Breakdown" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 border-t border-slate-100">
                    <th className="font-medium px-5 py-2.5">Province</th>
                    <th className="font-medium px-3 py-2.5 text-center">Leads</th>
                    <th className="font-medium px-3 py-2.5 text-center">Won</th>
                    <th className="font-medium px-3 py-2.5 text-center">Conversion</th>
                    <th className="font-medium px-3 py-2.5 text-right">Pipeline Value</th>
                  </tr>
                </thead>
                <tbody>
                  {provinceReport
                    .sort((a, b) => b.leads - a.leads)
                    .map((p) => (
                      <tr key={p.province} className="border-t border-slate-50">
                        <td className="px-5 py-2.5 font-medium text-slate-700">{p.province}</td>
                        <td className="px-3 py-2.5 text-center">
                          <Link
                            to={buildDrilldownUrl('/leads', { province: p.province, [SALES_MONTH_PARAM]: periodParam })}
                            className="text-slate-600 hover:text-brand-600 hover:underline"
                          >
                            {p.leads}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-center text-slate-600">{p.won}</td>
                        <td className="px-3 py-2.5 text-center text-slate-600">{p.conversionRate}%</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-slate-700">{formatCurrency(p.pipelineValue)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card padded={false}>
            <div className="p-5 pb-0">
              <CardHeader title="Top Cities / Towns" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 border-t border-slate-100">
                    <th className="font-medium px-5 py-2.5">City / Town</th>
                    <th className="font-medium px-3 py-2.5 text-center">Leads</th>
                  </tr>
                </thead>
                <tbody>
                  {cityReport.map((c) => (
                    <tr key={c.city} className="border-t border-slate-50">
                      <td className="px-5 py-2.5 font-medium text-slate-700">{c.city}</td>
                      <td className="px-3 py-2.5 text-center">
                        <Link to={buildDrilldownUrl('/leads', { city: c.city, [SALES_MONTH_PARAM]: periodParam })} className="text-slate-600 hover:text-brand-600 hover:underline">
                          {c.leads}
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {cityReport.length === 0 && (
                    <tr>
                      <td colSpan={2} className="text-center text-slate-400 text-sm py-8">
                        No leads with a city captured for this Sales Cycle and filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === 'Rejected Deals' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <CardHeader title="Rejected Deals by Reason" />
              {lostByReason.length === 0 ? (
                <p className="text-sm text-slate-400">No lost deals in this Sales Cycle.</p>
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={lostByReason} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2} isAnimationActive={false}>
                        {lostByReason.map((_, i) => (
                          <Cell key={i} fill={['#794234', '#b28e34', '#5f86ab', '#406d58', '#ad6452', '#3f5d78', '#957323', '#94a3b8', '#799ab9', '#a1b8ce'][i % 10]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card>
              <CardHeader title="Breakdown" />
              <div className="space-y-2">
                {lostByReason.map((r) => (
                  <div key={r.name} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{r.name}</span>
                    <span className="font-semibold text-slate-700">{r.value}</span>
                  </div>
                ))}
                {lostByReason.length === 0 && <p className="text-sm text-slate-400">No lost deals in this Sales Cycle.</p>}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function ChartBar({ data }: { data: { name: string; value: number }[] }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} interval={0} angle={-20} textAnchor="end" height={50} />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
          <Tooltip cursor={{ fill: '#f8fafc' }} />
          <Bar dataKey="value" fill={BAR_COLOR} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
