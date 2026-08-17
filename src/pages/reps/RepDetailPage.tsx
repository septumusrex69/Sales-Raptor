import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { Card, CardHeader } from '../../components/ui/Card'
import { UserAvatar } from '../../components/ui/Avatar'
import { SalesMonthPicker } from '../../components/ui/SalesMonthPicker'
import { RepScorecardCard } from '../../components/dashboard/RepScorecard'
import { formatCurrency, TODAY } from '../../data/mockData'
import { decodeSalesMonthParam, getCurrentSalesMonth, isWithinPeriod, type SalesMonthPeriod } from '../../lib/salesMonth'
import { isContactActivity, isMeaningfulActivity, MEANINGFUL_ACTIVITY_TYPES } from '../../lib/meaningfulActivity'
import { computeRepScorecard } from '../../lib/repScore'

const TABS = ['Workload', 'Activity', 'Effectiveness', 'Commercial Performance', 'Discipline'] as const
type Tab = (typeof TABS)[number]

function minutesToLabel(mins: number): string {
  if (mins < 60) return `${Math.round(mins)}m`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / (60 * 24))}d`
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-400 mb-0.5">{label}</dt>
      <dd className="text-slate-700 font-medium">{value ?? '—'}</dd>
    </div>
  )
}

export function RepDetailPage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const { leads, deals, activities, tasks, teams, userById } = useAppStore()
  const [tab, setTab] = useState<Tab>('Workload')
  const [period, setPeriod] = useState<SalesMonthPeriod>(() => decodeSalesMonthParam(searchParams.get('salesMonth')) ?? getCurrentSalesMonth(TODAY))

  const rep = userById(id)

  const data = useMemo(() => {
    if (!id) return undefined
    const ownLeads = leads.filter((l) => l.ownerId === id)
    const activeLeads = ownLeads.filter((l) => l.status !== 'Converted' && l.status !== 'Lost')
    const newLeads = ownLeads.filter((l) => isWithinPeriod(l.createdAt, period))
    const touchedIds = new Set(
      activities.filter((a) => a.userId === id && a.leadId && isMeaningfulActivity(a) && isWithinPeriod(a.activityDate, period)).map((a) => a.leadId as string),
    )
    const touched = activeLeads.filter((l) => touchedIds.has(l.id) || (l.lastContactAt && isWithinPeriod(l.lastContactAt, period)))

    const ownDeals = deals.filter((d) => d.ownerId === id)
    const openDeals = ownDeals.filter((d) => d.stage !== 'Won' && d.stage !== 'Lost')
    const won = ownDeals.filter((d) => d.wonAt && isWithinPeriod(d.wonAt, period))
    const lost = ownDeals.filter((d) => d.lostAt && isWithinPeriod(d.lostAt, period))
    const closed = won.length + lost.length
    const revenueWon = won.reduce((s, d) => s + d.value, 0)

    const repActivitiesInPeriod = activities.filter((a) => a.userId === id && isMeaningfulActivity(a) && isWithinPeriod(a.activityDate, period))
    const byType = Object.fromEntries(MEANINGFUL_ACTIVITY_TYPES.map((t) => [t, repActivitiesInPeriod.filter((a) => a.type === t).length]))

    const ownTasks = tasks.filter((t) => t.ownerId === id)
    const tasksDueInPeriod = ownTasks.filter((t) => t.status !== 'Cancelled' && isWithinPeriod(t.dueDate, period))
    const completedOnTime = tasksDueInPeriod.filter((t) => t.completedAt && new Date(t.completedAt) <= new Date(t.dueDate))
    const overdueTasks = ownTasks.filter((t) => t.status !== 'Completed' && t.status !== 'Cancelled' && new Date(t.dueDate) < TODAY)

    const responseTimes: number[] = []
    for (const lead of newLeads) {
      const firstContact = activities
        .filter((a) => a.leadId === lead.id && isContactActivity(a) && new Date(a.activityDate) >= new Date(lead.createdAt))
        .sort((a, b) => new Date(a.activityDate).getTime() - new Date(b.activityDate).getTime())[0]
      if (firstContact) responseTimes.push((new Date(firstContact.activityDate).getTime() - new Date(lead.createdAt).getTime()) / 60000)
    }
    const avgResponseMins = responseTimes.length > 0 ? responseTimes.reduce((s, v) => s + v, 0) / responseTimes.length : undefined

    const leadsNoNextAction = activeLeads.filter((l) => !l.nextFollowUpAt)
    const dealsNoNextAction = openDeals.filter((d) => !d.nextActionAt)
    const thirtyDaysAgo = new Date(TODAY.getTime() - 30 * 24 * 60 * 60 * 1000)
    const dormantDeals = openDeals.filter((d) => !activities.some((a) => a.dealId === d.id && new Date(a.activityDate) >= thirtyDaysAgo))

    const weightedPipeline = openDeals.reduce((s, d) => s + (d.value * d.probability) / 100, 0)
    const avgDealValue = won.length > 0 ? Math.round(revenueWon / won.length) : 0
    const sortedValues = [...won.map((d) => d.value)].sort((a, b) => a - b)
    const medianDealValue = sortedValues.length > 0 ? sortedValues[Math.floor(sortedValues.length / 2)] : 0

    const contactRate = newLeads.length > 0 ? Math.round((newLeads.filter((l) => l.status !== 'New').length / newLeads.length) * 100) : 0
    const qualificationRate =
      newLeads.length > 0 ? Math.round((newLeads.filter((l) => ['Qualified', 'Proposal Required', 'Converted'].includes(l.status)).length / newLeads.length) * 100) : 0
    const winRate = closed > 0 ? Math.round((won.length / closed) * 100) : 0
    const leadToWinRate = newLeads.length > 0 ? Math.round((won.length / newLeads.length) * 100) : 0

    return {
      ownLeads,
      activeLeads,
      newLeads,
      touched,
      openDeals,
      won,
      lost,
      closed,
      revenueWon,
      byType,
      totalActivities: repActivitiesInPeriod.length,
      tasksDueInPeriod,
      completedOnTime,
      overdueTasks,
      avgResponseMins,
      leadsNoNextAction,
      dealsNoNextAction,
      dormantDeals,
      weightedPipeline,
      avgDealValue,
      medianDealValue,
      contactRate,
      qualificationRate,
      winRate,
      leadToWinRate,
    }
  }, [id, leads, deals, activities, tasks, period])

  const scorecard = useMemo(() => (id ? computeRepScorecard(id, period, { leads, deals, activities, tasks }, TODAY) : undefined), [id, period, leads, deals, activities, tasks])

  if (!rep || !data || !scorecard) {
    return (
      <div className="text-center py-16 text-slate-400">
        Representative not found. <Link to="/" className="text-brand-600 hover:underline">Back to dashboard</Link>
      </div>
    )
  }

  const team = teams.find((t) => t.id === rep.teamId)

  return (
    <div className="space-y-5">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={15} /> Back to Dashboard
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <UserAvatar userId={rep.id} size={44} />
            <div>
              <h2 className="text-lg font-semibold text-slate-800">{rep.name}</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {rep.role}
                {team ? ` · ${team.name}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-xs text-slate-400">Revenue Won</p>
              <p className="text-lg font-bold text-slate-800">{formatCurrency(data.revenueWon)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Win Rate</p>
              <p className="text-lg font-bold text-slate-800">{data.winRate}%</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Overall Score</p>
              <p className="text-lg font-bold text-slate-800">{scorecard.overall}/100</p>
            </div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-slate-100">
          <SalesMonthPicker value={period} onChange={setPeriod} referenceDate={TODAY} />
        </div>
      </Card>

      <RepScorecardCard scorecard={scorecard} repName={rep.name} />

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
          </button>
        ))}
      </div>

      {tab === 'Workload' && (
        <Card>
          <CardHeader title="Workload" subtitle={period.rangeLabel} />
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3.5 text-sm">
            <Field label="Leads Assigned" value={data.activeLeads.length.toString()} />
            <Field label="New Leads" value={data.newLeads.length.toString()} />
            <Field label="Leads Touched" value={data.touched.length.toString()} />
            <Field label="Untouched Leads" value={(data.activeLeads.length - data.touched.length).toString()} />
            <Field label="Open Deals" value={data.openDeals.length.toString()} />
            <Field label="Closed Deals" value={data.closed.toString()} />
          </dl>
        </Card>
      )}

      {tab === 'Activity' && (
        <Card>
          <CardHeader title="Activity" subtitle={period.rangeLabel} />
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3.5 text-sm">
            <Field label="Total Activities" value={data.totalActivities.toString()} />
            <Field label="Calls" value={data.byType.Call?.toString()} />
            <Field label="Emails" value={data.byType.Email?.toString()} />
            <Field label="WhatsApps" value={data.byType.WhatsApp?.toString()} />
            <Field label="Meetings" value={data.byType.Meeting?.toString()} />
            <Field label="Notes" value={data.byType.Note?.toString()} />
            <Field label="Proposals" value={data.byType.Proposal?.toString()} />
            <Field label="Tasks Logged" value={data.byType.Task?.toString()} />
            <Field label="Activities per Lead" value={data.activeLeads.length > 0 ? (data.totalActivities / data.activeLeads.length).toFixed(1) : '—'} />
          </dl>
        </Card>
      )}

      {tab === 'Effectiveness' && (
        <Card>
          <CardHeader title="Effectiveness" subtitle={period.rangeLabel} />
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3.5 text-sm">
            <Field label="Contact Rate" value={`${data.contactRate}%`} />
            <Field label="Qualification Rate" value={`${data.qualificationRate}%`} />
            <Field label="Win Rate" value={`${data.winRate}%`} />
            <Field label="Lead → Win Rate" value={`${data.leadToWinRate}%`} />
            <Field label="Deals Won" value={data.won.length.toString()} />
            <Field label="Deals Lost" value={data.lost.length.toString()} />
          </dl>
        </Card>
      )}

      {tab === 'Commercial Performance' && (
        <Card>
          <CardHeader title="Commercial Performance" subtitle={period.rangeLabel} />
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3.5 text-sm">
            <Field label="Deals Won" value={data.won.length.toString()} />
            <Field label="Deals Lost" value={data.lost.length.toString()} />
            <Field label="Revenue Won" value={formatCurrency(data.revenueWon)} />
            <Field label="Average Deal Value" value={formatCurrency(data.avgDealValue)} />
            <Field label="Median Deal Value" value={formatCurrency(data.medianDealValue)} />
            <Field label="Weighted Pipeline" value={formatCurrency(Math.round(data.weightedPipeline))} />
            <Field label="Revenue per Lead Assigned" value={formatCurrency(data.activeLeads.length > 0 ? Math.round(data.revenueWon / data.activeLeads.length) : 0)} />
          </dl>
        </Card>
      )}

      {tab === 'Discipline' && (
        <Card>
          <CardHeader title="Discipline" subtitle={period.rangeLabel} />
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3.5 text-sm">
            <Field label="Avg First Response Time" value={data.avgResponseMins !== undefined ? minutesToLabel(data.avgResponseMins) : '—'} />
            <Field label="Tasks Completed On Time" value={`${data.tasksDueInPeriod.length > 0 ? Math.round((data.completedOnTime.length / data.tasksDueInPeriod.length) * 100) : 0}%`} />
            <Field label="Overdue Tasks" value={data.overdueTasks.length.toString()} />
            <Field label="Leads With No Next Action" value={data.leadsNoNextAction.length.toString()} />
            <Field label="Deals With No Next Action" value={data.dealsNoNextAction.length.toString()} />
            <Field label="Dormant Opportunities" value={data.dormantDeals.length.toString()} />
          </dl>
        </Card>
      )}
    </div>
  )
}
