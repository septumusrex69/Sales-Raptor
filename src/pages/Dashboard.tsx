import { useEffect, useMemo, useRef, useState, Suspense, lazy } from 'react'
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
import { DashboardPanes } from '../components/dashboard/DashboardPanes'
import { DashboardHero } from '../components/dashboard/DashboardHero'
import { MonthTrackCard } from '../components/dashboard/MonthTrackCard'
import { MandateOutcomeCard } from '../components/dashboard/MandateOutcomeCard'
import { fetchClientBook, fetchIntakeByDay } from '../lib/companySnapshotData'
import { leadSources, mandateToHandover, monthTrack, type ClientBook } from '../lib/clientBook'
import type { IntakeRow } from '../lib/companySnapshot'
import { clockNow } from '../lib/clock.ts'
/*
 * The only thing on this page that needs the charting library, and it sits below the fold.
 * Loading it separately lets the figures — which are what someone opens the dashboard for —
 * paint without waiting for a chart they have not scrolled to yet.
 */
const SalesTrendCard = lazy(() => import('../components/dashboard/SalesTrendCard')
  .then((m) => ({ default: m.SalesTrendCard })))
import { ActivityBreakdownChart } from '../components/dashboard/ActivityBreakdownChart'
import { WinRateByKind } from '../components/dashboard/WinRateByKind'
import { LossReasonsCard } from '../components/dashboard/LossReasonsCard'
import { NeedsAttention, type AttentionItem } from '../components/dashboard/NeedsAttention'
import { TargetsCard } from '../components/dashboard/TargetsCard'
import {
  SALES_TARGET_METRICS, periodElapsed, resolveTarget, targetProgress,
  type SalesTargetMetric, type TargetProgress,
} from '../lib/targets'
import type { Target, TargetMetric } from '../types'
import { dealKind, dealSize, dealSizeLabel } from '../lib/dealKind'
import { MandateToHandoverCard, LeadSourcesCard } from '../components/dashboard/SalesSourceCards'
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

/**
 * `layoutKey` is where the pane arrangement is remembered. The sales page's own by default;
 * Administration passes its own, so the office keeps its arrangement apart from the department's
 * (see AdminOverview).
 */
export function Dashboard({ layoutKey = 'raptor.dashboard.sales.layout' }: { layoutKey?: string } = {}) {
  const { leads, deals, tasks, activities, users, teams, targets, userById, companyById, updateTask, companies } = useAppStore()
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

  /*
   * THE DEBT-COLLECTION SIDE FIRST (the firm, 18 Oct: "focus more on the debt collection side. And then
   * secondary, the additional revenue one"). The track record over 6 or 12 months, the handovers that
   * came in from NEW clients (the work Sales brought), and each client's book. The handovers are the
   * firm's whole intake, so they are read once for the widest range and cut by month in clientBook.
   */
  const [months, setMonths] = useState<6 | 12>(6)
  const [intake, setIntake] = useState<IntakeRow[] | null>(null)
  const [books, setBooks] = useState<ClientBook[] | null>(null)
  useEffect(() => {
    let live = true
    const end = period.end
    let first = period
    for (let i = 1; i < 12; i++) first = getPreviousSalesMonth(first)
    setIntake(null)
    fetchIntakeByDay({ start: first.start, end }).then((r) => { if (live) setIntake(r) }).catch(() => { if (live) setIntake([]) })
    fetchClientBook(period).then((r) => { if (live) setBooks(r) }).catch(() => { if (live) setBooks([]) })
    return () => { live = false }
  }, [period])

  const repIds = useMemo(() => repIdsForScope(scope, reps, teams), [scope, reps, teams])
  const repIdSet = useMemo(() => new Set(repIds), [repIds])
  const track = useMemo(() => monthTrack({
    current: period, months, leads, deals, intake: intake ?? [], owners: scope === 'all' ? undefined : repIdSet,
  }), [period, months, leads, deals, intake, scope, repIdSet])
  const thisMonth = track[track.length - 1]
  /*
   * The same months as the chart, for the two cards that need a run of months to mean anything: how
   * fast each closer's mandates hand over, and which lead sources sign. (Signed-but-nothing-yet left
   * this page: the firm, 18 Oct, "that's in the communications department, the liaison department's
   * things" -- the Communications dashboard has it.)
   */
  const span = useMemo(() => {
    let first = period
    for (let i = 1; i < months; i++) first = getPreviousSalesMonth(first)
    return { start: first.start, end: period.end }
  }, [period, months])
  const spanLabel = `over the last ${months} months`
  const waitingForLiaison = useMemo(() => companies.filter((c) => c.liaisonNeeded)
    .sort((a, b) => (a.mandateSignedAt ?? '').localeCompare(b.mandateSignedAt ?? '')), [companies])
  const sources = useMemo(() => leadSources({ span, leads, deals, owners: scope === 'all' ? undefined : repIdSet }), [span, leads, deals, scope, repIdSet])
  const toHandover = useMemo(() => {
    const first = new Map((books ?? []).map((b) => [b.companyId, b.firstHandover]))
    const byOwner = mandateToHandover(deals.filter((d) => repIdSet.has(d.ownerId)), (id) => first.get(id) ?? null, span)
    return [...byOwner].map(([ownerId, v]) => ({ ownerId, name: userById(ownerId)?.name ?? 'Former colleague', ...v }))
  }, [books, deals, repIdSet, span, userById])

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
        mandatesWon: wonHandovers.length,
        serviceDealsWon: wonServices.length,
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
  // DEALS ONLY. A debt-collection mandate is counted once, on the Mandates card above; counting it
  // here as well made one signature two wins (the firm: "a mandate is a mandate and a deal is a deal").
  const cohort = useMemo(() => scopedDeals.filter((d) => dealKind(d) !== 'Handover' && isWithinPeriod(d.createdAt, period)), [scopedDeals, period])

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

  /**
   * Progress against target, for whichever scope is being looked at.
   *
   * Which scope owns the number is a genuine question with no universal answer — "the team must
   * sign 75" and "each of you must sign 15" are both real and neither follows from the other —
   * so both are storable and the dashboard reads whichever fits the view. Looking at one rep
   * shows that rep's own target; looking at a team shows the team's; the all-reps view sums the
   * Sales teams' targets, which is the only honest way to total numbers that were set
   * separately.
   */
  const targetProgressItems: TargetProgress[] = useMemo(() => {
    /* Typed to the sales metrics alone, so adding a collections metric is a compile error here
       rather than a silent nought on a rep's dashboard. */
    const actuals: Record<SalesTargetMetric, number> = {
      leads: kpis.curr.newLeads,
      mandates: kpis.curr.mandatesWon,
      deals: kpis.curr.serviceDealsWon,
      revenue: kpis.curr.revenueWon,
      book: kpis.curr.bookSigned,
      accounts: kpis.curr.accountsSigned,
      activities: kpis.curr.activities,
    }

    function forMetric(metric: TargetMetric): Target | undefined {
      if (scope.startsWith('rep:')) return resolveTarget(targets, 'user', scope.slice(4), metric, period.key)
      if (scope.startsWith('team:')) return resolveTarget(targets, 'team', scope.slice(5), metric, period.key)

      // All reps: add up what each Sales team was actually set. Summing is right here and
      // wrong for a single team — two teams each asked for 40 mandates means 80 across the
      // floor, which is exactly what this view is being asked.
      const salesTeams = teams.filter((t) => t.kind !== 'Communications')
      const found = salesTeams
        .map((t) => resolveTarget(targets, 'team', t.id, metric, period.key))
        .filter((t): t is Target => Boolean(t))
      if (found.length === 0) return undefined
      const thresholds = found.map((t) => t.thresholdValue).filter((v): v is number => v != null)
      return {
        ...found[0],
        targetValue: found.reduce((sum, t) => sum + t.targetValue, 0),
        thresholdValue: thresholds.length > 0 ? thresholds.reduce((sum, v) => sum + v, 0) : undefined,
      }
    }

    return SALES_TARGET_METRICS.map((def) => targetProgress(actuals[def.id as SalesTargetMetric], forMetric(def.id))).filter(
      (p): p is TargetProgress => Boolean(p),
    )
  }, [kpis, targets, teams, scope, period])

  /** Only meaningful for the month actually in progress; a past month is simply finished. */
  const elapsed = useMemo(() => (TODAY > period.end ? 1 : periodElapsed(period.start, period.end, TODAY)), [period])

  const attentionItems: AttentionItem[] = useMemo(
    () => [
      {
        label: 'Overdue Tasks',
        detail: 'Past their due date and still not done',
        count: secondary.overdueTasksCount,
        severity: 'late',
        to: buildDrilldownUrl('/tasks', { view: 'Overdue' }),
      },
      {
        label: 'Untouched Leads',
        detail: 'Active leads with no call, meeting or email logged in this sales month',
        count: secondary.untouchedCount,
        to: buildDrilldownUrl('/leads', { touched: '0', [SALES_MONTH_PARAM]: periodParam }),
      },
      {
        label: 'Leads With No Next Action',
        detail: 'Nothing scheduled — they will go quiet unless someone books a follow-up',
        count: secondary.leadsNoNextActionCount,
        to: buildDrilldownUrl('/leads', { noNextAction: '1' }),
      },
      {
        label: 'Deals With No Next Action',
        detail: 'Open deals with nobody due to do anything next',
        count: secondary.dealsNoNextActionCount,
        to: buildDrilldownUrl('/deals', { noNextAction: '1', view: 'table' }),
      },
      {
        label: 'Deals Past Close Date',
        detail: 'Still open after the date they were expected to close',
        count: secondary.dealsOverdueCount,
        severity: 'late',
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
          {/* CLOSERS, NOT REPS (the firm, 18 Oct). And the liaisons are in here too, on purpose: "the
              liaisons will also become sellers ... they are also selling deals, like drafting of
              contracts, executive listings" -- anybody who can be given a deal counts in Deal outcomes
              and on the leaderboard, so the picker says which department each one sits in. */}
          <option value="all" className="text-slate-700">
            All closers and liaisons
          </option>
          <optgroup label="Closers">
            {reps.filter((r) => !r.role.startsWith('Liaison')).map((r) => (
              <option key={r.id} value={`rep:${r.id}`} className="text-slate-700">
                {r.name}
              </option>
            ))}
          </optgroup>
          {reps.some((r) => r.role.startsWith('Liaison')) && (
            <optgroup label="Liaisons">
              {reps.filter((r) => r.role.startsWith('Liaison')).map((r) => (
                <option key={r.id} value={`rep:${r.id}`} className="text-slate-700">
                  {r.name}
                </option>
              ))}
            </optgroup>
          )}
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

      {/* THE PAGE IN THE FIRM'S ORDER (18 Oct): "a mandate is a mandate and a deal is a deal. It's two
          different things ... how many mandates has been signed? Because that's the most important
          thing, and then deals are secondary ... the line graph as well and the stack graph. So
          that's the secondary thing that you see." Mandates, deals, the track record, then what
          to act on, then the detail.

          IN THE THREE ARRANGEMENTS (S9, 20 Oct): the firm asked for Communications' one column / three
          columns / wide-and-narrow on the other dashboards too. DashboardPanes decides where each
          kind goes; the order here is still the firm's, and Mandates and Deals are both narrow so
          they stay side by side in Three columns -- "fit these guys in next to each other". */}
      <DashboardPanes layoutKey={layoutKey} panes={[
        { id: 'mandates', node: (
          <MandateOutcomeCard leads={thisMonth?.leads ?? 0} mandates={thisMonth?.mandates ?? 0} closingRate={thisMonth?.closingRate ?? null}
            newAccounts={thisMonth?.newAccounts ?? 0} newCapital={thisMonth?.newCapital ?? 0} loadingHandovers={intake === null}
            periodLabel={period.label} periodParam={periodParam} />
        ) },
        { id: 'deals', node: (
          <WinRateCard
            showLeadPipeline={false}
            cohort={cohort}
            newLeads={kpis.curr.newLeads}
            qualified={kpis.curr.qualified}
            converted={kpis.curr.converted}
            periodLabel={period.label}
            periodParam={periodParam}
          />
        ) },
        /* SIGNED, WAITING FOR A LIAISON (the firm, 18 Oct: "it should show up in the salesperson's
           dashboard and it should be allocated to a liaison"). Straight under Mandates and Deals once
           there is one: a client who signed and hears nothing is the first thing to put right. */
        waitingForLiaison.length > 0 && { id: 'waiting-for-liaison', node: (
          <Card className="border-gold-300 bg-gold-50/60">
            <div data-testid="waiting-for-liaison">
              <CardHeader title={`Signed, waiting for a liaison · ${waitingForLiaison.length}`}
                subtitle="Assign each one: the liaison is told, and sending the welcome email and the welcome call go on her list." />
              <ul className="divide-y divide-gold-200/70">
                {waitingForLiaison.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-2 text-sm">
                    <Link to={`/companies/${c.id}`} className="min-w-0 flex-1 truncate font-semibold text-slate-800 hover:underline">{c.name}</Link>
                    <span className="shrink-0 text-xs text-slate-500">signed {(c.mandateSignedAt ?? '').slice(0, 10).split('-').reverse().join('/')}</span>
                    <Link to={`/companies/${c.id}`} className="shrink-0 rounded-lg bg-navy-900 px-3 py-1 text-xs font-semibold text-white">Assign</Link>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        ) },
        { id: 'track-pipeline', kind: 'wide', node: (
          <MonthTrackCard kind="pipeline" rows={track} months={months} onMonths={setMonths} testId="sales-track"
          title="Leads and mandates, month by month" subtitle="Each bar is the leads; the navy part was signed. The % is the closing rate." />
        ) },
        { id: 'track-new', kind: 'wide', node: (
          <MonthTrackCard kind="new" rows={track} months={months} onMonths={setMonths} testId="sales-new-handovers"
          title="Handovers from new clients" subtitle="Clients in their first three months of handovers" />
        ) },
        { id: 'mandate-to-handover', node: (
          <MandateToHandoverCard rows={toHandover} spanLabel={spanLabel} />
        ) },
        { id: 'lead-sources', node: (
          <LeadSourcesCard rows={sources} spanLabel={spanLabel} />
        ) },
        { id: 'leaderboard', kind: 'wide', node: (
          <RepLeaderboard rows={leaderboardRows} />
        ) },
        { id: 'needs-attention', kind: 'wide', node: (
          <NeedsAttention items={attentionItems} />
        ) },
        { id: 'tasks-due', node: (
          <Card padded={false}>
            <div className="p-5 pb-0">
              <CardHeader title="Tasks Due" subtitle="Overdue, due today, and this week" action={<Link to="/tasks" className="text-xs font-medium text-brand-600 hover:underline">View all tasks</Link>} />
            </div>
            <div className="px-5 pb-5 divide-y divide-slate-50">
              {tasksDue.map((t) => (
                /* One line a task, the checking-list look: what it is about trails the title in grey. */
                <div key={t.id} className="flex items-center gap-3 py-1.5 text-[12.5px] whitespace-nowrap">
                  <button onClick={() => updateTask(t.id, { status: 'Completed', completedAt: clockNow().toISOString() })} className="text-slate-300 hover:text-[var(--c-green)] shrink-0">
                    <Circle size={15} />
                  </button>
                  <p className="min-w-0 flex-1 flex items-center gap-1.5">
                    <span className="min-w-0 truncate" title={`${t.title} · ${t.relatedToLabel ?? t.type}`}>
                      <span className="font-medium text-slate-700">{t.title}</span>
                      <span className="text-slate-400"> &middot; {t.relatedToLabel ?? t.type}</span>
                    </span>
                    {t.autoRescheduledFrom && (
                      <span title={`Missed — originally due ${formatDate(t.autoRescheduledFrom)}`} className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-[var(--c-gold)] bg-[var(--tint-gold)] px-1 py-0.5 rounded">
                        Auto-moved
                      </span>
                    )}
                  </p>
                  <PriorityBadge priority={t.priority} />
                  <span className={`text-[12px] font-medium w-20 text-right shrink-0 ${new Date(t.dueDate) < TODAY ? 'text-[var(--c-rust-deep)]' : 'text-slate-500'}`}>
                    {daysAgoLabel(t.dueDate)}
                  </span>
                  <UserAvatar userId={t.ownerId} size={18} />
                  <button onClick={() => setRescheduleTask(t)} className="text-[12px] font-medium text-brand-600 hover:underline shrink-0">
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
        ) },
        { id: 'targets', node: (
          <TargetsCard
            title="Targets"
            subtitle={
              scope.startsWith('rep:')
                ? `${userById(scope.slice(4))?.name ?? 'This closer'}'s targets for ${period.label} — the marker shows how far through the month we are`
                : `Targets for ${period.label} — the marker shows how far through the month we are`
            }
            items={targetProgressItems}
            elapsed={elapsed}
          />
        ) },
        /* THE DETAIL, for whoever wants to dig. The month's results in secondary size, then how the
           month is being worked: figure rows, so across the page in every arrangement. */
        { id: 'results', kind: 'full', node: (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <StatTile
              size="secondary"
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
              size="secondary"
              label="Book Signed"
              value={formatCurrency(kpis.curr.bookSigned)}
              pctChange={kpis.prev ? pctDelta(kpis.curr.bookSigned, kpis.prev.bookSigned) : undefined}
              compareLabel={compareMode === 'previous' ? `vs ${previousPeriod.label}` : undefined}
              hint="Total handover value on mandates signed this month. Not revenue — it becomes revenue only as it is collected."
              to={buildDrilldownUrl('/deals', { stage: 'Won', service: 'Debt Collection', view: 'table', [SALES_MONTH_PARAM]: periodParam })}
            />
            <StatTile
              size="secondary"
              label="Accounts Signed"
              value={kpis.curr.accountsSigned.toLocaleString()}
              pctChange={kpis.prev ? pctDelta(kpis.curr.accountsSigned, kpis.prev.accountsSigned) : undefined}
              compareLabel={compareMode === 'previous' ? `vs ${previousPeriod.label}` : undefined}
              hint="Number of debtor accounts handed over on mandates signed this month."
              to={buildDrilldownUrl('/deals', { stage: 'Won', service: 'Debt Collection', view: 'table', [SALES_MONTH_PARAM]: periodParam })}
            />
            <StatTile
              size="secondary"
              label="Deals Won"
              value={kpis.curr.won.toString()}
              pctChange={kpis.prev ? pctDelta(kpis.curr.won, kpis.prev.won) : undefined}
              compareLabel={compareMode === 'previous' ? `vs ${previousPeriod.label}` : undefined}
              hint="Every deal marked Won in this sales month — service deals and mandates together."
              to={buildDrilldownUrl('/deals', { stage: 'Won', view: 'table', [SALES_MONTH_PARAM]: periodParam })}
            />
            <StatTile
              size="secondary"
              label="Win Rate"
              value={`${kpis.curr.winRate}%`}
              pctChange={kpis.prev ? pctDelta(kpis.curr.winRate, kpis.prev.winRate) : undefined}
              compareLabel={compareMode === 'previous' ? `vs ${previousPeriod.label}` : undefined}
              hint="Of the deals that closed this month, the share that were won. Open deals are not counted."
              accent="gold"
            />
            <StatTile
              size="secondary"
              label="Pipeline"
              value={formatCurrency(pipeline.value)}
              hint={`Open service deals, right now — ${pipeline.count} open deals, of which ${formatCurrency(pipeline.book)} is handover book carrying no fee until collected. Not a monthly figure, so it has no comparison.`}
              to={buildDrilldownUrl('/deals', { view: 'table' })}
            />
          </div>
        ) },
        { id: 'rhythm', kind: 'full', node: (
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
        ) },
        { id: 'funnel', kind: 'wide', node: (
          <SalesFunnelChart deals={scopedDeals} />
        ) },
        { id: 'activity-breakdown', node: (
          <ActivityBreakdownChart activities={scopedActivities.filter((a) => isWithinPeriod(a.activityDate, period))} />
        ) },
        { id: 'win-rate-by-kind', node: (
          <WinRateByKind
            serviceWinRate={kpis.curr.serviceWinRate}
            serviceClosed={kpis.curr.serviceClosed}
            handoverWinRate={kpis.curr.handoverWinRate}
            handoverClosed={kpis.curr.handoverClosed}
            periodLabel={period.label}
          />
        ) },
        { id: 'loss-reasons', node: (
          <LossReasonsCard leads={rejectedLeads} deals={rejectedDeals} periodLabel={period.label} />
        ) },
        { id: 'sales-trend', kind: 'wide', node: (
          <Suspense fallback={<div className="card h-72" aria-hidden />}>
            <SalesTrendCard deals={scopedDeals} leads={scopedLeads} referenceDate={TODAY} />
          </Suspense>
        ) },
        { id: 'largest-open-deals', kind: 'wide', node: (
          <Card padded={false}>
            <div className="p-5 pb-0">
              <CardHeader
                title="Largest Open Deals"
                subtitle="Still to be closed — service deals by fee, mandates by book"
                action={<Link to="/deals" className="text-xs font-medium text-brand-600 hover:underline">View all deals</Link>}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full list-table whitespace-nowrap">
                <thead>
                  <tr className="text-left border-y border-slate-100 text-slate-400">
                    <th className="font-medium px-3 py-2">Deal</th>
                    <th className="font-medium px-2 py-2">Company</th>
                    <th className="font-medium px-2 py-2 text-right">Size</th>
                    <th className="font-medium px-2 py-2">Stage</th>
                    <th className="font-medium px-2 py-2">Close Date</th>
                  </tr>
                </thead>
                <tbody>
                  {topDeals.map((d) => (
                    <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-3 py-1.5">
                        <Link to={`/deals/${d.id}`} title={d.name}
                          className="block max-w-[16rem] truncate font-medium text-slate-700 hover:text-brand-600">
                          {d.name}
                        </Link>
                      </td>
                      <td className="px-2 py-1.5 text-slate-500">{companyById(d.companyId)?.name}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium text-slate-700 whitespace-nowrap">
                        {formatCurrency(dealSize(d))}
                        <span className="ml-1.5 text-[10.5px] font-normal text-slate-400">{dealSizeLabel(d)}</span>
                      </td>
                      <td className="px-2 py-1.5">
                        <StageBadge stage={d.stage} />
                      </td>
                      <td className="px-2 py-1.5 text-slate-500">{formatDate(d.expectedCloseDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) },
        { id: 'recent-activities', node: (
          <Card padded={false}>
            <div className="p-5 pb-0">
              <CardHeader title="Recent Activities" action={<Link to="/activities" className="text-xs font-medium text-brand-600 hover:underline">View all</Link>} />
            </div>
            <div className="px-5 pb-5 divide-y divide-slate-50 max-h-80 overflow-y-auto">
              {recentActivities.map((a) => (
                <div key={a.id} className="flex items-center gap-2 py-1.5 text-[12.5px] whitespace-nowrap">
                  <UserAvatar userId={a.userId} size={18} />
                  <p className="min-w-0 flex-1 truncate text-slate-700" title={a.subject}>{a.subject}</p>
                  <p className="shrink-0 text-[11px] text-slate-400">{timeAgo(a.activityDate)}</p>
                </div>
              ))}
            </div>
          </Card>
        ) },
      ]} />

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
