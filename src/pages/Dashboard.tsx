import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
import { DashboardHero } from '../components/dashboard/DashboardHero'
import { RevenueTrendChart } from '../components/dashboard/RevenueTrendChart'
import { ActivityBreakdownChart } from '../components/dashboard/ActivityBreakdownChart'
import { WinRateByKind } from '../components/dashboard/WinRateByKind'
import { LossReasonsCard } from '../components/dashboard/LossReasonsCard'
import { NeedsAttention, type AttentionItem } from '../components/dashboard/NeedsAttention'
import { dealKind, dealSize, dealSizeLabel } from '../lib/dealKind'
import { RepLeaderboard, type LeaderboardRow } from '../components/dashboard/RepLeaderboard'
import { formatCurrency, formatDate, timeAgo, TODAY } from '../data/mockData'
import { getCurrentSalesMonth, getPreviousSalesMonth, isWithinPeriod, encodeSalesMonthParam, type SalesMonthPeriod } from '../lib/salesMonth'
import { isMeaningfulActivity, isContactActivity } from '../lib/meaningfulActivity'
import { computeAllRepScorecards } from '../lib/repScore'
import { buildDrilldownUrl, SALES_MONTH_PARAM } from '../lib/drilldown'
import { pctDelta } from '../lib/pctDelta'
import { downloadCsv } from '../lib/csvExport'
import type { ID, Task, Team, User } from '../types'
import { isAssignableOwner } from '../lib/permissions'
import { isActiveLead, isEngagedLead } from '../lib/leadStatus'

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

function minutesToLabel(mins: number): string {
  if (mins < 60) return `${Math.round(mins)}m`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / (60 * 24))}d`
}

interface DashboardProps {
  /** Given the page's selected period, so a combined view reports one month throughout. */
  communicationsSnapshot?: (period: SalesMonthPeriod) => ReactNode
}

export function Dashboard({ communicationsSnapshot }: DashboardProps = {}) {
  const { leads, deals, tasks, activities, users, teams, userById, companyById, updateTask } = useAppStore()
  const { currentUser } = useAuth()
  const reps = useMemo(() => users.filter((u) => isAssignableOwner(u.role)), [users])
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
      const qualified = scopedLeads.filter((l) => isWithinPeriod(l.createdAt, p) && isEngagedLead(l))
      const converted = scopedLeads.filter((l) => isWithinPeriod(l.createdAt, p) && l.status === 'Converted')
      const won = scopedDeals.filter((d) => d.wonAt && isWithinPeriod(d.wonAt, p))
      const lost = scopedDeals.filter((d) => d.rejectedAt && isWithinPeriod(d.rejectedAt, p))

      // A handover earns nothing at signature, so it carries no deal value — which meant the
      // whole debt collection side of the business summed to zero here and showed up in no
      // figure on the page. Its size is the book signed and the accounts that come with it:
      // separate numbers, deliberately not added to revenue, because they aren't revenue.
      const wonHandovers = won.filter((d) => dealKind(d) === 'Handover')
      const wonServices = won.filter((d) => dealKind(d) !== 'Handover')
      const lostHandovers = lost.filter((d) => dealKind(d) === 'Handover')
      const lostServices = lost.filter((d) => dealKind(d) !== 'Handover')

      const revenueWon = wonServices.reduce((s, d) => s + d.value, 0)
      const bookSigned = wonHandovers.reduce((s, d) => s + (d.handoverAmount ?? 0), 0)
      const accountsSigned = wonHandovers.reduce((s, d) => s + (d.accountsCount ?? 0), 0)

      const closed = won.length + lost.length
      const winRate = closed > 0 ? Math.round((won.length / closed) * 100) : 0
      // A quotation accepted and a mandate signed are different things won in different ways.
      // One blended rate describes neither, so each is kept on its own terms.
      const rate = (w: number, l: number) => (w + l > 0 ? Math.round((w / (w + l)) * 100) : null)
      return {
        newLeads: newLeads.length,
        activities: meaningfulActivities.length,
        qualified: qualified.length,
        converted: converted.length,
        won: won.length,
        lost: lost.length,
        revenueWon,
        bookSigned,
        accountsSigned,
        winRate,
        serviceWinRate: rate(wonServices.length, lostServices.length),
        serviceClosed: wonServices.length + lostServices.length,
        handoverWinRate: rate(wonHandovers.length, lostHandovers.length),
        handoverClosed: wonHandovers.length + lostHandovers.length,
      }
    }
    const curr = compute(period)
    const prev = compareMode === 'previous' ? compute(previousPeriod) : undefined
    return { curr, prev }
  }, [scopedLeads, scopedDeals, scopedActivities, period, previousPeriod, compareMode])

  /**
   * What is still in play — right now, not within the selected month.
   *
   * Deliberately outside the period compute: an open deal is open today whichever month you
   * are looking at, so running it through the previous period would return the identical
   * figure and report a permanent "0% change" that means nothing. It carries no comparison
   * for the same reason.
   *
   * Service value and handover book stay separate here for the same reason they do everywhere
   * else — a fee we will invoice and a book we will collect against are not the same promise.
   */
  const pipeline = useMemo(() => {
    const open = scopedDeals.filter((d) => d.stage !== 'Won' && d.stage !== 'Rejected')
    return {
      count: open.length,
      value: open.filter((d) => dealKind(d) !== 'Handover').reduce((sum, d) => sum + d.value, 0),
      book: open.filter((d) => dealKind(d) === 'Handover').reduce((sum, d) => sum + (d.handoverAmount ?? 0), 0),
    }
  }, [scopedDeals])

  /** The deals *opened* in the selected month, followed to wherever they stand today. */
  const cohort = useMemo(() => scopedDeals.filter((d) => isWithinPeriod(d.createdAt, period)), [scopedDeals, period])

  const secondary = useMemo(() => {
    const activeLeads = scopedLeads.filter(isActiveLead)
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
    const openDeals = scopedDeals.filter((d) => d.stage !== 'Won' && d.stage !== 'Rejected')
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
        const activeOwnLeads = ownLeads.filter(isActiveLead)
        const touchedIds = new Set(
          activities.filter((a) => a.userId === repId && a.leadId && isMeaningfulActivity(a) && isWithinPeriod(a.activityDate, period)).map((a) => a.leadId as string),
        )
        const touched = activeOwnLeads.filter((l) => touchedIds.has(l.id) || (l.lastContactAt && isWithinPeriod(l.lastContactAt, period)))
        const repActivities = activities.filter((a) => a.userId === repId && isMeaningfulActivity(a) && isWithinPeriod(a.activityDate, period))
        const won = deals.filter((d) => d.ownerId === repId && d.wonAt && isWithinPeriod(d.wonAt, period))
        const lost = deals.filter((d) => d.ownerId === repId && d.rejectedAt && isWithinPeriod(d.rejectedAt, period))
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
  // Rejections that happened in the selected period, from both sides of the funnel: a lead
  // turned down before anyone opened a deal is lost business just the same.
  const rejectedLeads = useMemo(
    () => scopedLeads.filter((l) => l.status === 'Rejected' && isWithinPeriod(l.createdAt, period)),
    [scopedLeads, period],
  )
  const rejectedDeals = useMemo(
    () => scopedDeals.filter((d) => d.rejectedAt && isWithinPeriod(d.rejectedAt, period)),
    [scopedDeals, period],
  )

  /**
   * The biggest things still to be closed.
   *
   * Ranked by `dealSize`, not `value`. A handover's `value` is zero by design — the fee only
   * arrives as accounts are collected — so sorting a mixed list on `value` put every mandate
   * at the bottom and the entire debt collection side of the business never appeared in this
   * table once. Each deal is now ranked and shown in the money that actually describes it,
   * with the column saying which is which so the two are never read as one total.
   */
  const topDeals = useMemo(
    () =>
      scopedDeals
        .filter((d) => d.stage !== 'Won' && d.stage !== 'Rejected')
        .sort((a, b) => dealSize(b) - dealSize(a))
        .slice(0, 5),
    [scopedDeals],
  )
  const tasksDue = useMemo(() => {
    const recentOverdueFloor = new Date(TODAY.getTime() - 14 * 24 * 60 * 60 * 1000)
    return scopedTasks
      .filter((t) => t.status !== 'Completed' && t.status !== 'Cancelled' && new Date(t.dueDate) >= recentOverdueFloor)
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
      .slice(0, 6)
  }, [scopedTasks])

  const attentionItems: AttentionItem[] = useMemo(
    () => [
      {
        label: 'Overdue tasks',
        detail: 'Past their due date and still not done',
        count: secondary.overdueTasksCount,
        to: buildDrilldownUrl('/tasks', { view: 'Overdue' }),
      },
      {
        label: 'Leads untouched this month',
        detail: 'Active leads with no call, meeting or email logged in this sales month',
        count: secondary.untouchedCount,
        to: buildDrilldownUrl('/leads', { touched: '0', [SALES_MONTH_PARAM]: periodParam }),
      },
      {
        label: 'Leads with no next action',
        detail: 'Nothing scheduled — they will go quiet unless someone books a follow-up',
        count: secondary.leadsNoNextActionCount,
        to: buildDrilldownUrl('/leads', { noNextAction: '1' }),
      },
      {
        label: 'Deals with no next action',
        detail: 'Open deals with nobody due to do anything next',
        count: secondary.dealsNoNextActionCount,
        to: buildDrilldownUrl('/deals', { noNextAction: '1', view: 'table' }),
      },
      {
        label: 'Deals past their close date',
        detail: 'Still open after the date they were expected to close',
        count: secondary.dealsOverdueCount,
        to: buildDrilldownUrl('/deals', { overdue: '1', view: 'table' }),
      },
    ],
    [secondary, periodParam],
  )

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
      <DashboardHero>
        <SalesMonthPicker value={period} onChange={setPeriod} referenceDate={TODAY} variant="dark" />
        <CompareSelector value={compareMode} onChange={setCompareMode} variant="dark" />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as Scope)}
          className="text-sm border border-white/20 rounded-lg px-3 py-2 bg-white/10 text-white outline-none"
        >
          <option value="all" className="text-slate-700">
            All Sales Reps
          </option>
          <optgroup label="Representatives">
            {reps.map((r) => (
              <option key={r.id} value={`rep:${r.id}`} className="text-slate-700">
                {r.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Teams">
            {teams.map((t) => (
              <option key={t.id} value={`team:${t.id}`} className="text-slate-700">
                {t.name}
              </option>
            ))}
          </optgroup>
        </select>
        <button
          onClick={handleExport}
          className="inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-lg text-navy-950 shadow-sm"
          style={{ background: 'var(--skin-gold-gradient)' }}
        >
          <Download size={15} /> Export
        </button>
      </DashboardHero>

      {communicationsSnapshot?.(period)}

      {/* Six numbers, not sixteen. These are the ones a manager is actually judged on; the
          operational warnings that used to sit alongside them are now one panel below, where
          they read as a worklist instead of competing with the results for attention. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatTile
          label="Revenue Won"
          value={formatCurrency(kpis.curr.revenueWon)}
          pctChange={kpis.prev ? pctDelta(kpis.curr.revenueWon, kpis.prev.revenueWon) : undefined}
          compareLabel={compareMode === 'previous' ? `vs ${previousPeriod.label}` : undefined}
          hint="Fees on won service deals. Handovers are excluded — a signed book earns nothing at signature."
          to={buildDrilldownUrl('/deals', { stage: 'Won', view: 'table', [SALES_MONTH_PARAM]: periodParam })}
        />
        {/* Deliberately its own figure rather than part of revenue. A signed book is work won,
            not money earned — the commission only arrives as accounts are collected. */}
        <StatTile
          label="Book Signed"
          value={formatCurrency(kpis.curr.bookSigned)}
          pctChange={kpis.prev ? pctDelta(kpis.curr.bookSigned, kpis.prev.bookSigned) : undefined}
          compareLabel={compareMode === 'previous' ? `vs ${previousPeriod.label}` : undefined}
          hint="Total handover value on mandates signed this month. Not revenue — it becomes revenue only as it is collected."
          to={buildDrilldownUrl('/deals', { stage: 'Won', service: 'Debt Collection', view: 'table', [SALES_MONTH_PARAM]: periodParam })}
        />
        <StatTile
          label="Accounts Signed"
          value={kpis.curr.accountsSigned.toLocaleString()}
          pctChange={kpis.prev ? pctDelta(kpis.curr.accountsSigned, kpis.prev.accountsSigned) : undefined}
          compareLabel={compareMode === 'previous' ? `vs ${previousPeriod.label}` : undefined}
          hint="Number of debtor accounts handed over on mandates signed this month."
          to={buildDrilldownUrl('/deals', { stage: 'Won', service: 'Debt Collection', view: 'table', [SALES_MONTH_PARAM]: periodParam })}
        />
        <StatTile
          label="Deals Won"
          value={kpis.curr.won.toString()}
          pctChange={kpis.prev ? pctDelta(kpis.curr.won, kpis.prev.won) : undefined}
          compareLabel={compareMode === 'previous' ? `vs ${previousPeriod.label}` : undefined}
          hint="Every deal marked Won in this sales month — service deals and mandates together."
          to={buildDrilldownUrl('/deals', { stage: 'Won', view: 'table', [SALES_MONTH_PARAM]: periodParam })}
        />
        <StatTile
          label="Win Rate"
          value={`${kpis.curr.winRate}%`}
          pctChange={kpis.prev ? pctDelta(kpis.curr.winRate, kpis.prev.winRate) : undefined}
          compareLabel={compareMode === 'previous' ? `vs ${previousPeriod.label}` : undefined}
          hint="Of the deals that closed this month, the share that were won. Open deals are not counted."
          accent="gold"
        />
        <StatTile
          label="Pipeline"
          value={formatCurrency(pipeline.value)}
          hint={`Open service deals, right now — ${pipeline.count} open deals, of which ${formatCurrency(pipeline.book)} is handover book carrying no fee until collected. Not a monthly figure, so it has no comparison.`}
          to={buildDrilldownUrl('/deals', { view: 'table' })}
        />
      </div>

      <NeedsAttention items={attentionItems} />

      <Card padded={false}>
        <div className="p-5 pb-0">
          <CardHeader title="Tasks Due" subtitle="Overdue, due today, and this week" action={<Link to="/tasks" className="text-xs font-medium text-brand-600 hover:underline">View all tasks</Link>} />
        </div>
        <div className="px-5 pb-5 divide-y divide-slate-50">
          {tasksDue.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2.5">
              <button onClick={() => updateTask(t.id, { status: 'Completed', completedAt: new Date().toISOString() })} className="text-slate-300 hover:text-[var(--c-green)] shrink-0">
                <Circle size={18} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-slate-700 truncate flex items-center gap-1.5">
                  {t.title}
                  {t.autoRescheduledFrom && (
                    <span title={`Missed — originally due ${formatDate(t.autoRescheduledFrom)}`} className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-[var(--c-gold)] bg-[var(--tint-gold)] px-1 py-0.5 rounded">
                      Auto-moved
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-slate-400">{t.relatedToLabel ?? t.type}</p>
              </div>
              <PriorityBadge priority={t.priority} />
              <span className={`text-xs font-medium w-20 text-right shrink-0 ${new Date(t.dueDate) < TODAY ? 'text-[var(--c-rust-deep)]' : 'text-slate-500'}`}>
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
              <CheckCircle2 size={22} className="text-[var(--c-green)]" />
              All caught up — no tasks due.
            </div>
          )}
        </div>
      </Card>

      {/* How the month is being worked, as distinct from what it produced. Secondary size on
          purpose — these are rhythm, not results. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatTile
          label="New Leads"
          value={kpis.curr.newLeads.toString()}
          size="secondary"
          pctChange={kpis.prev ? pctDelta(kpis.curr.newLeads, kpis.prev.newLeads) : undefined}
          compareLabel={compareMode === 'previous' ? `vs ${previousPeriod.label}` : undefined}
          to={buildDrilldownUrl('/leads', { [SALES_MONTH_PARAM]: periodParam })}
        />
        <StatTile
          label="Activities Logged"
          value={kpis.curr.activities.toString()}
          size="secondary"
          pctChange={kpis.prev ? pctDelta(kpis.curr.activities, kpis.prev.activities) : undefined}
          compareLabel={compareMode === 'previous' ? `vs ${previousPeriod.label}` : undefined}
          hint="Calls, meetings, emails and notes that move work forward. Automatic system entries and status changes are not counted."
          to={buildDrilldownUrl('/activities', { [SALES_MONTH_PARAM]: periodParam })}
        />
        <StatTile
          label="Leads Touched"
          value={`${secondary.touchedPct}%`}
          size="secondary"
          hint="Share of active leads that had at least one call, meeting or email logged against them in this sales month."
          to={buildDrilldownUrl('/leads', { touched: '1', [SALES_MONTH_PARAM]: periodParam })}
        />
        <StatTile
          label="Avg Response Time"
          value={secondary.avgResponseMins !== undefined ? minutesToLabel(secondary.avgResponseMins) : '—'}
          size="secondary"
          hint="Average time between a lead being created and the first call, meeting or email logged against it."
          to={buildDrilldownUrl('/leads', { [SALES_MONTH_PARAM]: periodParam })}
        />
        <StatTile
          label="Tasks On Time"
          value={`${secondary.onTimePct}%`}
          size="secondary"
          hint="Share of tasks due in this sales month that were completed on or before their due date."
          to={buildDrilldownUrl('/tasks', { view: 'Completed' })}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <SalesFunnelChart deals={scopedDeals} />
        </div>
        <ActivityBreakdownChart activities={scopedActivities.filter((a) => isWithinPeriod(a.activityDate, period))} />
      </div>

      <WinRateCard
        cohort={cohort}
        newLeads={kpis.curr.newLeads}
        qualified={kpis.curr.qualified}
        converted={kpis.curr.converted}
        periodLabel={period.label}
        periodParam={periodParam}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <WinRateByKind
          serviceWinRate={kpis.curr.serviceWinRate}
          serviceClosed={kpis.curr.serviceClosed}
          handoverWinRate={kpis.curr.handoverWinRate}
          handoverClosed={kpis.curr.handoverClosed}
          periodLabel={period.label}
        />
        <LossReasonsCard leads={rejectedLeads} deals={rejectedDeals} periodLabel={period.label} />
      </div>

      <RevenueTrendChart deals={scopedDeals} referenceDate={TODAY} />

      <RepLeaderboard rows={leaderboardRows} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2" padded={false}>
          <div className="p-5 pb-0">
            <CardHeader
              title="Largest Open Deals"
              subtitle="Still to be closed — service deals by fee, mandates by book"
              action={<Link to="/deals" className="text-xs font-medium text-brand-600 hover:underline">View all deals</Link>}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-t border-slate-100">
                  <th className="font-medium px-5 py-2.5">Deal</th>
                  <th className="font-medium px-3 py-2.5">Company</th>
                  <th className="font-medium px-3 py-2.5 text-right">Size</th>
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
                    <td className="px-3 py-2.5 text-right font-medium text-slate-700 tabular-nums whitespace-nowrap">
                      {formatCurrency(dealSize(d))}
                      <span className="ml-1.5 text-[10.5px] font-normal text-slate-400">{dealSizeLabel(d)}</span>
                    </td>
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
