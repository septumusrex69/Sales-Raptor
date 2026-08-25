import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, CheckCircle2, Circle } from 'lucide-react'
import { useAppStore } from '../store/AppStore'
import { useAuth } from '../store/AuthContext'
import { Card, CardHeader } from '../components/ui/Card'
import { StageBadge, PriorityBadge } from '../components/ui/Badge'
import { UserAvatar } from '../components/ui/Avatar'
import { RescheduleTaskModal } from '../components/ui/RescheduleTaskModal'
import { StatTile } from '../components/ui/StatTile'
import { SalesMonthPicker } from '../components/ui/SalesMonthPicker'
import { CompareSelector, type CompareMode } from '../components/ui/CompareSelector'
import { SalesFunnelChart } from '../components/dashboard/SalesFunnelChart'
import { WinRateCard } from '../components/dashboard/WinRateCard'
import { RevenueTrendChart } from '../components/dashboard/RevenueTrendChart'
import { ActivityBreakdownChart } from '../components/dashboard/ActivityBreakdownChart'
import { RepLeaderboard, type LeaderboardRow } from '../components/dashboard/RepLeaderboard'
import { formatCurrency, formatDate, timeAgo, TODAY } from '../data/mockData'
import { getCurrentSalesMonth, getPreviousSalesMonth, isWithinPeriod, encodeSalesMonthParam, type SalesMonthPeriod } from '../lib/salesMonth'
import { isMeaningfulActivity, isContactActivity } from '../lib/meaningfulActivity'
import { computeAllRepScorecards } from '../lib/repScore'
import { buildDrilldownUrl, SALES_MONTH_PARAM } from '../lib/drilldown'
import { downloadCsv } from '../lib/csvExport'
import type { ID, Task, Team, User } from '../types'

function daysAgoLabel(dateIso: string) {
  const diff = Math.round((new Date(dateIso).getTime() - TODAY.getTime()) / (1000 * 60 * 60 * 24))
  if (diff === 0) return 'Today'
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  if (diff === 1) return 'Tomorrow'
  return `In ${diff}d`
}

type Scope = 'all' | `rep:${string}` | `team:${string}`

function repIdsForScope(scope: Scope, reps: User[], teams: Team[]): ID[] {
  if (scope === 'all') return reps.map((r) => r.id)
  if (scope.startsWith('rep:')) return [scope.slice(4)]
  if (scope.startsWith('team:')) {
    const team = teams.find((t) => t.id === scope.slice(5))
    return team ? reps.filter((r) => team.memberIds.includes(r.id)).map((r) => r.id) : []
  }
  return reps.map((r) => r.id)
}

function pctDelta(curr: number, prev: number): number {
  if (prev === 0) return curr === 0 ? 0 : 100
  return Math.round(((curr - prev) / prev) * 100)
}

function minutesToLabel(mins: number): string {
  if (mins < 60) return `${Math.round(mins)}m`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / (60 * 24))}d`
}

export function Dashboard() {
  const { leads, deals, tasks, activities, users, teams, userById, companyById, updateTask } = useAppStore()
  const { currentUser } = useAuth()
  const reps = useMemo(() => users.filter((u) => u.role.includes('Sales') || u.role === 'Administrator'), [users])
  const [period, setPeriod] = useState<SalesMonthPeriod>(() => getCurrentSalesMonth(TODAY))
  const [compareMode, setCompareMode] = useState<CompareMode>('previous')
  // Reps land on their own numbers by default (their own dashboard, not the
  // whole team's) but can still switch the scope selector to view anyone —
  // Administrators/Sales Managers default to the full team view as before.
  // currentUser is often still null on first render (the profile loads
  // asynchronously after sign-in), so a useState initializer would freeze
  // in the wrong default forever — this instead applies it once, the
  // moment currentUser actually becomes available, and never again after
  // that (so it doesn't stomp on a later manual scope change).
  const [scope, setScope] = useState<Scope>('all')
  const scopeDefaulted = useRef(false)
  useEffect(() => {
    if (scopeDefaulted.current || !currentUser) return
    scopeDefaulted.current = true
    if (currentUser.role !== 'Administrator' && currentUser.role !== 'Sales Manager') {
      setScope(`rep:${currentUser.id}`)
    }
  }, [currentUser])
  const [rescheduleTask, setRescheduleTask] = useState<Task | null>(null)

  const repIds = useMemo(() => repIdsForScope(scope, reps, teams), [scope, reps, teams])
  const repIdSet = useMemo(() => new Set(repIds), [repIds])

  const scopedLeads = useMemo(() => leads.filter((l) => repIdSet.has(l.ownerId)), [leads, repIdSet])
  const scopedDeals = useMemo(() => deals.filter((d) => repIdSet.has(d.ownerId)), [deals, repIdSet])
  const scopedActivities = useMemo(() => activities.filter((a) => repIdSet.has(a.userId)), [activities, repIdSet])
  const scopedTasks = useMemo(() => tasks.filter((t) => repIdSet.has(t.ownerId)), [tasks, repIdSet])

  const previousPeriod = useMemo(() => getPreviousSalesMonth(period), [period])

  const kpis = useMemo(() => {
    function compute(p: SalesMonthPeriod) {
      const newLeads = scopedLeads.filter((l) => isWithinPeriod(l.createdAt, p))
      const meaningfulActivities = scopedActivities.filter((a) => isMeaningfulActivity(a) && isWithinPeriod(a.activityDate, p))
      const qualified = scopedLeads.filter(
        (l) => isWithinPeriod(l.createdAt, p) && ['Qualified', 'Proposal Required', 'Converted'].includes(l.status),
      )
      const converted = scopedLeads.filter((l) => isWithinPeriod(l.createdAt, p) && l.status === 'Converted')
      const won = scopedDeals.filter((d) => d.wonAt && isWithinPeriod(d.wonAt, p))
      const lost = scopedDeals.filter((d) => d.lostAt && isWithinPeriod(d.lostAt, p))
      const revenueWon = won.reduce((s, d) => s + d.value, 0)
      const closed = won.length + lost.length
      const winRate = closed > 0 ? Math.round((won.length / closed) * 100) : 0
      return {
        newLeads: newLeads.length,
        activities: meaningfulActivities.length,
        qualified: qualified.length,
        converted: converted.length,
        won: won.length,
        lost: lost.length,
        revenueWon,
        winRate,
      }
    }
    const curr = compute(period)
    const prev = compareMode === 'previous' ? compute(previousPeriod) : undefined
    return { curr, prev }
  }, [scopedLeads, scopedDeals, scopedActivities, period, previousPeriod, compareMode])

  const secondary = useMemo(() => {
    const activeLeads = scopedLeads.filter((l) => l.status !== 'Converted' && l.status !== 'Lost')
    const newLeadsThisPeriod = scopedLeads.filter((l) => isWithinPeriod(l.createdAt, period))
    const touchedLeadIds = new Set(
      scopedActivities.filter((a) => a.leadId && isMeaningfulActivity(a) && isWithinPeriod(a.activityDate, period)).map((a) => a.leadId as string),
    )
    const touched = activeLeads.filter((l) => touchedLeadIds.has(l.id) || (l.lastContactAt && isWithinPeriod(l.lastContactAt, period)))
    const touchedPct = activeLeads.length > 0 ? Math.round((touched.length / activeLeads.length) * 100) : 0

    const responseTimes: number[] = []
    for (const lead of newLeadsThisPeriod) {
      const firstContact = scopedActivities
        .filter((a) => a.leadId === lead.id && isContactActivity(a) && new Date(a.activityDate) >= new Date(lead.createdAt))
        .sort((a, b) => new Date(a.activityDate).getTime() - new Date(b.activityDate).getTime())[0]
      if (firstContact) {
        responseTimes.push((new Date(firstContact.activityDate).getTime() - new Date(lead.createdAt).getTime()) / 60000)
      }
    }
    const avgResponseMins = responseTimes.length > 0 ? responseTimes.reduce((s, v) => s + v, 0) / responseTimes.length : undefined

    const tasksDueInPeriod = scopedTasks.filter((t) => t.status !== 'Cancelled' && isWithinPeriod(t.dueDate, period))
    const completedOnTime = tasksDueInPeriod.filter((t) => t.completedAt && new Date(t.completedAt) <= new Date(t.dueDate))
    const onTimePct = tasksDueInPeriod.length > 0 ? Math.round((completedOnTime.length / tasksDueInPeriod.length) * 100) : 0
    const overdueTasks = scopedTasks.filter((t) => t.status !== 'Completed' && t.status !== 'Cancelled' && new Date(t.dueDate) < TODAY)

    const leadsNoNextAction = activeLeads.filter((l) => !l.nextFollowUpAt)
    const openDeals = scopedDeals.filter((d) => d.stage !== 'Won' && d.stage !== 'Lost')
    const dealsNoNextAction = openDeals.filter((d) => !d.nextActionAt)
    const dealsOverdue = openDeals.filter((d) => new Date(d.expectedCloseDate) < TODAY)

    return {
      avgResponseMins,
      touchedPct,
      untouchedCount: activeLeads.length - touched.length,
      onTimePct,
      overdueTasksCount: overdueTasks.length,
      leadsNoNextActionCount: leadsNoNextAction.length,
      dealsNoNextActionCount: dealsNoNextAction.length,
      dealsOverdueCount: dealsOverdue.length,
    }
  }, [scopedLeads, scopedActivities, scopedTasks, scopedDeals, period])

  const scorecards = useMemo(() => computeAllRepScorecards(repIds, period, { leads, deals, activities, tasks }, TODAY), [repIds, period, leads, deals, activities, tasks])

  const leaderboardRows: LeaderboardRow[] = useMemo(
    () =>
      repIds.map((repId) => {
        const rep = userById(repId)
        const ownLeads = leads.filter((l) => l.ownerId === repId)
        const activeOwnLeads = ownLeads.filter((l) => l.status !== 'Converted' && l.status !== 'Lost')
        const touchedIds = new Set(
          activities.filter((a) => a.userId === repId && a.leadId && isMeaningfulActivity(a) && isWithinPeriod(a.activityDate, period)).map((a) => a.leadId as string),
        )
        const touched = activeOwnLeads.filter((l) => touchedIds.has(l.id) || (l.lastContactAt && isWithinPeriod(l.lastContactAt, period)))
        const repActivities = activities.filter((a) => a.userId === repId && isMeaningfulActivity(a) && isWithinPeriod(a.activityDate, period))
        const won = deals.filter((d) => d.ownerId === repId && d.wonAt && isWithinPeriod(d.wonAt, period))
        const lost = deals.filter((d) => d.ownerId === repId && d.lostAt && isWithinPeriod(d.lostAt, period))
        const closed = won.length + lost.length
        const scorecard = scorecards.find((s) => s.repId === repId)
        return {
          repId,
          name: rep?.name ?? repId,
          leadsAssigned: activeOwnLeads.length,
          leadsTouched: touched.length,
          totalActivities: repActivities.length,
          dealsWon: won.length,
          revenueWon: won.reduce((s, d) => s + d.value, 0),
          winRate: closed > 0 ? Math.round((won.length / closed) * 100) : 0,
          overallScore: scorecard?.overall ?? 0,
        }
      }),
    [repIds, leads, deals, activities, period, scorecards, userById],
  )

  const periodParam = encodeSalesMonthParam(period)

  const recentActivities = scopedActivities.slice(0, 6)
  const topDeals = useMemo(() => [...scopedDeals].filter((d) => d.stage !== 'Lost').sort((a, b) => b.value - a.value).slice(0, 5), [scopedDeals])
  const tasksDue = useMemo(() => {
    const recentOverdueFloor = new Date(TODAY.getTime() - 14 * 24 * 60 * 60 * 1000)
    return scopedTasks
      .filter((t) => t.status !== 'Completed' && t.status !== 'Cancelled' && new Date(t.dueDate) >= recentOverdueFloor)
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
      .slice(0, 6)
  }, [scopedTasks])

  function handleExport() {
    downloadCsv(`sales-dashboard-${period.key}`, [
      { metric: 'Sales Month', value: period.label },
      { metric: 'Range', value: period.rangeLabel },
      { metric: 'New Leads', value: kpis.curr.newLeads },
      { metric: 'Total Activities', value: kpis.curr.activities },
      { metric: 'Qualified Leads', value: kpis.curr.qualified },
      { metric: 'Deals Won', value: kpis.curr.won },
      { metric: 'Revenue Won', value: kpis.curr.revenueWon },
      { metric: 'Win Rate %', value: kpis.curr.winRate },
    ])
    downloadCsv(
      `sales-leaderboard-${period.key}`,
      leaderboardRows.map((r) => ({
        rep: r.name,
        leadsAssigned: r.leadsAssigned,
        leadsTouched: r.leadsTouched,
        activities: r.totalActivities,
        dealsWon: r.dealsWon,
        revenueWon: r.revenueWon,
        winRatePct: r.winRate,
        overallScore: r.overallScore,
      })),
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Sales Dashboard</h2>
          <p className="text-sm text-slate-400 mt-0.5">Real-time overview of your sales performance</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SalesMonthPicker value={period} onChange={setPeriod} referenceDate={TODAY} />
          <CompareSelector value={compareMode} onChange={setCompareMode} />
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 outline-none"
          >
            <option value="all">All Sales Reps</option>
            <optgroup label="Representatives">
              {reps.map((r) => (
                <option key={r.id} value={`rep:${r.id}`}>
                  {r.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Teams">
              {teams.map((t) => (
                <option key={t.id} value={`team:${t.id}`}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          </select>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700"
          >
            <Download size={15} /> Export
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatTile
          label="New Leads"
          value={kpis.curr.newLeads.toString()}
          pctChange={kpis.prev ? pctDelta(kpis.curr.newLeads, kpis.prev.newLeads) : undefined}
          to={buildDrilldownUrl('/leads', { [SALES_MONTH_PARAM]: periodParam })}
        />
        <StatTile
          label="Total Activities"
          value={kpis.curr.activities.toString()}
          pctChange={kpis.prev ? pctDelta(kpis.curr.activities, kpis.prev.activities) : undefined}
          to={buildDrilldownUrl('/activities', { [SALES_MONTH_PARAM]: periodParam })}
        />
        <StatTile
          label="Qualified Leads"
          value={kpis.curr.qualified.toString()}
          pctChange={kpis.prev ? pctDelta(kpis.curr.qualified, kpis.prev.qualified) : undefined}
          to={buildDrilldownUrl('/leads', { status: 'Qualified', [SALES_MONTH_PARAM]: periodParam })}
        />
        <StatTile
          label="Deals Won"
          value={kpis.curr.won.toString()}
          pctChange={kpis.prev ? pctDelta(kpis.curr.won, kpis.prev.won) : undefined}
          to={buildDrilldownUrl('/deals', { stage: 'Won', view: 'table', [SALES_MONTH_PARAM]: periodParam })}
        />
        <StatTile
          label="Revenue Won"
          value={formatCurrency(kpis.curr.revenueWon)}
          pctChange={kpis.prev ? pctDelta(kpis.curr.revenueWon, kpis.prev.revenueWon) : undefined}
          to={buildDrilldownUrl('/deals', { stage: 'Won', view: 'table', [SALES_MONTH_PARAM]: periodParam })}
        />
        <StatTile
          label="Win Rate"
          value={`${kpis.curr.winRate}%`}
          pctChange={kpis.prev ? pctDelta(kpis.curr.winRate, kpis.prev.winRate) : undefined}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile
          label="Avg Response Time"
          value={secondary.avgResponseMins !== undefined ? minutesToLabel(secondary.avgResponseMins) : '—'}
          size="secondary"
          to={buildDrilldownUrl('/leads', { [SALES_MONTH_PARAM]: periodParam })}
        />
        <StatTile
          label="Leads Touched"
          value={`${secondary.touchedPct}%`}
          size="secondary"
          to={buildDrilldownUrl('/leads', { touched: '1', [SALES_MONTH_PARAM]: periodParam })}
        />
        <StatTile
          label="Tasks Completed On Time"
          value={`${secondary.onTimePct}%`}
          size="secondary"
          to={buildDrilldownUrl('/tasks', { view: 'Completed' })}
        />
        <StatTile label="Overdue Tasks" value={secondary.overdueTasksCount.toString()} size="secondary" to={buildDrilldownUrl('/tasks', { view: 'Overdue' })} />
        <StatTile
          label="Leads With No Next Action"
          value={secondary.leadsNoNextActionCount.toString()}
          size="secondary"
          to={buildDrilldownUrl('/leads', { noNextAction: '1' })}
        />
        <StatTile
          label="Deals With No Next Action"
          value={secondary.dealsNoNextActionCount.toString()}
          size="secondary"
          to={buildDrilldownUrl('/deals', { noNextAction: '1', view: 'table' })}
        />
        <StatTile label="Deals Overdue" value={secondary.dealsOverdueCount.toString()} size="secondary" to={buildDrilldownUrl('/deals', { overdue: '1', view: 'table' })} />
        <StatTile
          label="Leads Untouched"
          value={secondary.untouchedCount.toString()}
          size="secondary"
          to={buildDrilldownUrl('/leads', { touched: '0', [SALES_MONTH_PARAM]: periodParam })}
        />
      </div>

      <WinRateCard
        deals={scopedDeals}
        won={kpis.curr.won}
        lost={kpis.curr.lost}
        winRate={kpis.curr.winRate}
        newLeads={kpis.curr.newLeads}
        qualified={kpis.curr.qualified}
        converted={kpis.curr.converted}
        periodLabel={period.label}
        periodParam={periodParam}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <SalesFunnelChart deals={scopedDeals} />
        </div>
        <ActivityBreakdownChart activities={scopedActivities.filter((a) => isWithinPeriod(a.activityDate, period))} />
      </div>

      <RevenueTrendChart deals={scopedDeals} referenceDate={TODAY} />

      <RepLeaderboard rows={leaderboardRows} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2" padded={false}>
          <div className="p-5 pb-0">
            <CardHeader title="Top Deals" action={<Link to="/deals" className="text-xs font-medium text-brand-600 hover:underline">View all deals</Link>} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-t border-slate-100">
                  <th className="font-medium px-5 py-2.5">Deal</th>
                  <th className="font-medium px-3 py-2.5">Company</th>
                  <th className="font-medium px-3 py-2.5 text-right">Value</th>
                  <th className="font-medium px-3 py-2.5">Stage</th>
                  <th className="font-medium px-3 py-2.5">Close Date</th>
                </tr>
              </thead>
              <tbody>
                {topDeals.map((d) => (
                  <tr key={d.id} className="border-t border-slate-50 hover:bg-slate-50/60">
                    <td className="px-5 py-2.5">
                      <Link to={`/deals/${d.id}`} className="font-medium text-slate-700 hover:text-brand-600">
                        {d.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">{companyById(d.companyId)?.name}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-slate-700">{formatCurrency(d.value)}</td>
                    <td className="px-3 py-2.5">
                      <StageBadge stage={d.stage} />
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">{formatDate(d.expectedCloseDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-0">
            <CardHeader title="Recent Activities" action={<Link to="/activities" className="text-xs font-medium text-brand-600 hover:underline">View all</Link>} />
          </div>
          <div className="px-5 pb-5 space-y-3.5 max-h-80 overflow-y-auto">
            {recentActivities.map((a) => (
              <div key={a.id} className="flex gap-3">
                <UserAvatar userId={a.userId} size={26} />
                <div className="min-w-0">
                  <p className="text-[13px] text-slate-700 leading-snug">{a.subject}</p>
                  <p className="text-[11px] text-slate-400">{timeAgo(a.activityDate)}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card padded={false}>
        <div className="p-5 pb-0">
          <CardHeader title="Tasks Due" subtitle="Overdue, due today, and this week" action={<Link to="/tasks" className="text-xs font-medium text-brand-600 hover:underline">View all tasks</Link>} />
        </div>
        <div className="px-5 pb-5 divide-y divide-slate-50">
          {tasksDue.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2.5">
              <button onClick={() => updateTask(t.id, { status: 'Completed', completedAt: new Date().toISOString() })} className="text-slate-300 hover:text-[#406d58] shrink-0">
                <Circle size={18} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-slate-700 truncate flex items-center gap-1.5">
                  {t.title}
                  {t.autoRescheduledFrom && (
                    <span title={`Missed — originally due ${formatDate(t.autoRescheduledFrom)}`} className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-[#b28e34] bg-[#f7f4eb] px-1 py-0.5 rounded">
                      Auto-moved
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-slate-400">{t.relatedToLabel ?? t.type}</p>
              </div>
              <PriorityBadge priority={t.priority} />
              <span className={`text-xs font-medium w-20 text-right shrink-0 ${new Date(t.dueDate) < TODAY ? 'text-[#794234]' : 'text-slate-500'}`}>
                {daysAgoLabel(t.dueDate)}
              </span>
              <UserAvatar userId={t.ownerId} size={24} />
              <button onClick={() => setRescheduleTask(t)} className="text-xs font-medium text-brand-600 hover:underline shrink-0">
                Reschedule
              </button>
            </div>
          ))}
          {tasksDue.length === 0 && (
            <div className="py-6 text-center text-sm text-slate-400 flex flex-col items-center gap-2">
              <CheckCircle2 size={22} className="text-[#406d58]" />
              All caught up — no tasks due.
            </div>
          )}
        </div>
      </Card>

      {rescheduleTask && (
        <RescheduleTaskModal
          task={rescheduleTask}
          onClose={() => setRescheduleTask(null)}
          onSave={(dueDate) => updateTask(rescheduleTask.id, { dueDate, autoRescheduledFrom: undefined })}
        />
      )}
    </div>
  )
}
