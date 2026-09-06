import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, CheckCircle2, Circle, Phone, Inbox, Users2, Handshake, ClipboardCheck, Percent } from 'lucide-react'
import { useAppStore } from '../store/AppStore'
import { useAuth } from '../store/AuthContext'
import { Card, CardHeader } from '../components/ui/Card'
import { UserAvatar } from '../components/ui/Avatar'
import { RescheduleTaskModal } from '../components/ui/RescheduleTaskModal'
import { StatTile } from '../components/ui/StatTile'
import { SalesMonthPicker } from '../components/ui/SalesMonthPicker'
import { CompareSelector, type CompareMode } from '../components/ui/CompareSelector'
import { RingDonut, type RingDonutSlice } from '../components/ui/RingDonut'
import { DashboardHero } from '../components/dashboard/DashboardHero'
import { ActivityBreakdownChart } from '../components/dashboard/ActivityBreakdownChart'
import { formatCurrency, timeAgo, TODAY } from '../data/mockData'
import { getCurrentSalesMonth, getPreviousSalesMonth, isWithinPeriod, encodeSalesMonthParam, type SalesMonthPeriod } from '../lib/salesMonth'
import { buildDrilldownUrl, SALES_MONTH_PARAM } from '../lib/drilldown'
import { downloadCsv } from '../lib/csvExport'
import { topLevelClients, rollupClient, collectionsCoefficient, type ClientRollup } from '../lib/companyRollup'
import { POSITIVE_HEX, NEGATIVE_HEX } from '../lib/colors'
import type { Company, ID, Task, Team, User } from '../types'

function daysAgoLabel(dateIso: string) {
  const diff = Math.round((new Date(dateIso).getTime() - TODAY.getTime()) / (1000 * 60 * 60 * 24))
  if (diff === 0) return 'Today'
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  if (diff === 1) return 'Tomorrow'
  return `In ${diff}d`
}

function pctDelta(curr: number, prev: number): number {
  if (prev === 0) return curr === 0 ? 0 : 100
  return Math.round(((curr - prev) / prev) * 100)
}

/** Bands for a client's collections coefficient — same thresholds used for the bar chart and the "needs a call" list. */
function coefficientTone(pct: number): 'good' | 'mid' | 'low' {
  if (pct >= 40) return 'good'
  if (pct >= 15) return 'mid'
  return 'low'
}
const TONE_HEX: Record<'good' | 'mid' | 'low', string> = { good: 'var(--c-green)', mid: 'var(--c-gold-bronze)', low: 'var(--c-rust-deep)' }

function rollupsFor(subset: Company[], companies: Company[]) {
  return subset
    .map((c) => ({ company: c, rollup: rollupClient(c, companies) }))
    .filter((r) => r.rollup.handoverAmount !== undefined || r.rollup.accountCount !== undefined)
}
function coefficientFor(rollups: { rollup: ClientRollup }[]) {
  const handover = rollups.reduce((s, r) => s + (r.rollup.handoverAmount ?? 0), 0)
  const paid = rollups.reduce((s, r) => s + (r.rollup.paymentsToDate ?? 0), 0)
  return handover > 0 ? (paid / handover) * 100 : undefined
}

type Scope = 'all' | `member:${string}` | `team:${string}`

function scopeIdsFor(scope: Scope, members: User[], teams: Team[]): ID[] {
  if (scope === 'all') return members.map((m) => m.id)
  if (scope.startsWith('member:')) return [scope.slice(7)]
  if (scope.startsWith('team:')) {
    const team = teams.find((t) => t.id === scope.slice(5))
    return team ? members.filter((m) => team.memberIds.includes(m.id)).map((m) => m.id) : []
  }
  return members.map((m) => m.id)
}

export function CommunicationsDashboard() {
  const { deals, tasks, activities, companies, users, teams, userById, companyById, updateTask } = useAppStore()
  const { currentUser } = useAuth()

  const commsTeams = useMemo(() => teams.filter((t) => t.kind === 'Communications'), [teams])
  const commsMemberIds = useMemo(() => new Set(commsTeams.flatMap((t) => t.memberIds)), [commsTeams])
  const members = useMemo(() => users.filter((u) => commsMemberIds.has(u.id)), [users, commsMemberIds])

  const [period, setPeriod] = useState<SalesMonthPeriod>(() => getCurrentSalesMonth(TODAY))
  const [compareMode, setCompareMode] = useState<CompareMode>('previous')
  const [scope, setScope] = useState<Scope>('all')
  const scopeDefaulted = useRef(false)
  useEffect(() => {
    if (scopeDefaulted.current || !currentUser) return
    scopeDefaulted.current = true
    if (currentUser.role !== 'Administrator' && currentUser.role !== 'Sales Manager') {
      setScope(`member:${currentUser.id}`)
    }
  }, [currentUser])
  const [rescheduleTask, setRescheduleTask] = useState<Task | null>(null)

  const scopedIds = useMemo(() => scopeIdsFor(scope, members, commsTeams), [scope, members, commsTeams])
  const scopedIdSet = useMemo(() => new Set(scopedIds), [scopedIds])

  const scopedActivities = useMemo(() => activities.filter((a) => scopedIdSet.has(a.userId)), [activities, scopedIdSet])
  const scopedTasks = useMemo(() => tasks.filter((t) => scopedIdSet.has(t.ownerId)), [tasks, scopedIdSet])
  const scopedDeals = useMemo(() => deals.filter((d) => scopedIdSet.has(d.ownerId)), [deals, scopedIdSet])

  const previousPeriod = useMemo(() => getPreviousSalesMonth(period), [period])

  // Client servicing health — a snapshot of current totals, not scoped to period
  // (Company.handoverAmount/paymentsToDate aren't a time series), but it IS scoped
  // by who the client's Client Liaison (Company.accountOwnerId) actually is: pick
  // one team member and you see only their clients, not the whole book.
  const allClients = useMemo(() => topLevelClients(companies, (id) => deals.some((d) => d.companyId === id && d.stage === 'Won')), [companies, deals])

  // The whole Communications department's book — the baseline an individual gets
  // compared against when they're the one selected in the scope picker.
  const teamClients = useMemo(() => allClients.filter((c) => commsMemberIds.has(c.accountOwnerId)), [allClients, commsMemberIds])
  const teamRollups = useMemo(() => rollupsFor(teamClients, companies), [teamClients, companies])
  const teamCoefficient = coefficientFor(teamRollups)

  // Whichever member/team is currently selected in the scope picker.
  const clients = useMemo(() => allClients.filter((c) => scopedIdSet.has(c.accountOwnerId)), [allClients, scopedIdSet])
  const clientRollups = useMemo(() => rollupsFor(clients, companies), [clients, companies])
  const swordfishClients = useMemo(() => clientRollups.filter((r) => collectionsCoefficient(r.rollup) !== undefined), [clientRollups])
  const bookHandover = clientRollups.reduce((s, r) => s + (r.rollup.handoverAmount ?? 0), 0)
  const bookPaid = clientRollups.reduce((s, r) => s + (r.rollup.paymentsToDate ?? 0), 0)
  const bookCoefficient = bookHandover > 0 ? (bookPaid / bookHandover) * 100 : undefined
  const rankedByCoefficient = useMemo(
    () =>
      [...swordfishClients].sort((a, b) => (collectionsCoefficient(a.rollup) ?? 0) - (collectionsCoefficient(b.rollup) ?? 0)),
    [swordfishClients],
  )
  const coefficientScopeLabel = scope === 'all' ? 'DEPARTMENT COEFFICIENT' : scope.startsWith('team:') ? 'TEAM COEFFICIENT' : 'YOUR COEFFICIENT'

  const kpis = useMemo(() => {
    function compute(p: SalesMonthPeriod) {
      const courtesyCalls = scopedActivities.filter((a) => a.type === 'Courtesy Call' && isWithinPeriod(a.activityDate, p))
      const handovers = scopedActivities.filter((a) => a.type === 'Handover Received' && isWithinPeriod(a.activityDate, p))
      // Meetings "held" is read from scheduled Meeting-type tasks due in the period —
      // the app doesn't yet distinguish a completed meeting from a scheduled one.
      const meetings = scopedTasks.filter((t) => t.type === 'Meeting' && isWithinPeriod(t.dueDate, p))
      const inPerson = meetings.filter((t) => t.title.includes('(In-Person)')).length
      const virtualMeetings = meetings.filter((t) => t.title.includes('(Virtual)')).length
      const won = scopedDeals.filter((d) => d.wonAt && isWithinPeriod(d.wonAt, p))
      const revenueWon = won.reduce((s, d) => s + d.value, 0)
      const touchedCompanyIds = new Set(scopedActivities.filter((a) => a.companyId && isWithinPeriod(a.activityDate, p)).map((a) => a.companyId as string))
      const touchedClients = clients.filter((c) => touchedCompanyIds.has(c.id))
      return {
        courtesyCalls: courtesyCalls.length,
        handovers: handovers.length,
        meetings: meetings.length,
        inPerson,
        virtualMeetings,
        dealsWon: won.length,
        revenueWon,
        clientsTouched: touchedClients.length,
      }
    }
    const curr = compute(period)
    const prev = compareMode === 'previous' ? compute(previousPeriod) : undefined
    return { curr, prev }
  }, [scopedActivities, scopedTasks, scopedDeals, clients, period, previousPeriod, compareMode])

  const secondary = useMemo(() => {
    const clientsWithActivity = new Set(scopedActivities.map((a) => a.companyId).filter(Boolean) as string[])
    const clientsEverContacted = new Set(activities.map((a) => a.companyId).filter(Boolean) as string[])
    const lastContactByClient = new Map<string, string>()
    for (const a of scopedActivities) {
      if (!a.companyId) continue
      const existing = lastContactByClient.get(a.companyId)
      if (!existing || new Date(a.activityDate) > new Date(existing)) lastContactByClient.set(a.companyId, a.activityDate)
    }
    const daysSince = [...lastContactByClient.values()].map((d) => Math.round((TODAY.getTime() - new Date(d).getTime()) / 86400000))
    const avgDaysSinceContact = daysSince.length > 0 ? Math.round(daysSince.reduce((s, v) => s + v, 0) / daysSince.length) : undefined

    const neverContacted = clients.filter((c) => !clientsEverContacted.has(c.id))
    const overdueTasks = scopedTasks.filter((t) => t.status !== 'Completed' && t.status !== 'Cancelled' && new Date(t.dueDate) < TODAY)
    const weekFromNow = new Date(TODAY.getTime() + 7 * 24 * 60 * 60 * 1000)
    const meetingsThisWeek = scopedTasks.filter(
      (t) => t.type === 'Meeting' && t.status !== 'Completed' && t.status !== 'Cancelled' && new Date(t.dueDate) >= TODAY && new Date(t.dueDate) <= weekFromNow,
    )

    return { avgDaysSinceContact, clientsTouchedCount: clientsWithActivity.size, neverContactedCount: neverContacted.length, overdueTasksCount: overdueTasks.length, meetingsThisWeekCount: meetingsThisWeek.length }
  }, [scopedActivities, activities, scopedTasks, clients])

  const leaderboardRows = useMemo(
    () =>
      scopedIds.map((memberId) => {
        const member = userById(memberId)
        const courtesyCalls = activities.filter((a) => a.userId === memberId && a.type === 'Courtesy Call' && isWithinPeriod(a.activityDate, period)).length
        const meetings = tasks.filter((t) => t.ownerId === memberId && t.type === 'Meeting' && isWithinPeriod(t.dueDate, period)).length
        const handovers = activities.filter((a) => a.userId === memberId && a.type === 'Handover Received' && isWithinPeriod(a.activityDate, period)).length
        const won = deals.filter((d) => d.ownerId === memberId && d.wonAt && isWithinPeriod(d.wonAt, period))
        return {
          memberId,
          name: member?.name ?? memberId,
          courtesyCalls,
          meetings,
          handovers,
          dealsWon: won.length,
          revenueWon: won.reduce((s, d) => s + d.value, 0),
        }
      }),
    [scopedIds, activities, tasks, deals, period, userById],
  )
  const [sortKey, setSortKey] = useState<'courtesyCalls' | 'meetings' | 'handovers' | 'dealsWon' | 'revenueWon'>('courtesyCalls')
  const sortedLeaderboard = [...leaderboardRows].sort((a, b) => b[sortKey] - a[sortKey])

  const periodParam = encodeSalesMonthParam(period)
  const recentActivities = scopedActivities.slice(0, 6)
  const recentDeals = useMemo(
    () => [...scopedDeals].filter((d) => d.stage === 'Won').sort((a, b) => new Date(b.wonAt ?? 0).getTime() - new Date(a.wonAt ?? 0).getTime()).slice(0, 5),
    [scopedDeals],
  )
  const tasksDue = useMemo(() => {
    const recentOverdueFloor = new Date(TODAY.getTime() - 14 * 24 * 60 * 60 * 1000)
    return scopedTasks
      .filter((t) => t.status !== 'Completed' && t.status !== 'Cancelled' && new Date(t.dueDate) >= recentOverdueFloor)
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
      .slice(0, 6)
  }, [scopedTasks])

  function handleExport() {
    downloadCsv(`communications-dashboard-${period.key}`, [
      { metric: 'Sales Month', value: period.label },
      { metric: 'Courtesy Calls', value: kpis.curr.courtesyCalls },
      { metric: 'Handovers Received', value: kpis.curr.handovers },
      { metric: 'Meetings Held', value: kpis.curr.meetings },
      { metric: 'Deals Closed', value: kpis.curr.dealsWon },
      { metric: 'Revenue Won', value: kpis.curr.revenueWon },
      { metric: 'Clients Touched', value: kpis.curr.clientsTouched },
      { metric: 'Book-wide Collections Coefficient %', value: bookCoefficient !== undefined ? Math.round(bookCoefficient * 10) / 10 : '' },
    ])
    downloadCsv(
      `communications-team-${period.key}`,
      sortedLeaderboard.map((r) => ({ member: r.name, courtesyCalls: r.courtesyCalls, meetings: r.meetings, handovers: r.handovers, dealsWon: r.dealsWon, revenueWon: r.revenueWon })),
    )
  }

  const recoveryDonut: RingDonutSlice[] =
    bookHandover > 0
      ? [
          { name: 'Paid', value: Math.round(bookPaid), color: POSITIVE_HEX },
          { name: 'Outstanding', value: Math.max(Math.round(bookHandover - bookPaid), 0), color: NEGATIVE_HEX },
        ]
      : []
  const meetingDonut: RingDonutSlice[] =
    kpis.curr.meetings > 0
      ? [
          { name: 'In-Person', value: kpis.curr.inPerson, color: 'var(--c-navy-ink)' },
          { name: 'Virtual', value: kpis.curr.virtualMeetings, color: 'var(--c-gold-light)' },
        ]
      : []

  return (
    <div className="space-y-6">
      <DashboardHero
        eyebrow="Bredell Ferreira · Romulus"
        title="Communications Dashboard"
        subtitle="Client servicing overview — courtesy calls, handovers and meetings"
      >
        <SalesMonthPicker value={period} onChange={setPeriod} referenceDate={TODAY} variant="dark" />
        <CompareSelector value={compareMode} onChange={setCompareMode} variant="dark" />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as Scope)}
          className="text-sm border border-white/20 rounded-lg px-3 py-2 bg-white/10 text-white outline-none"
        >
          <option value="all" className="text-slate-700">
            All Communications Team
          </option>
          <optgroup label="Team Members">
            {members.map((m) => (
              <option key={m.id} value={`member:${m.id}`} className="text-slate-700">
                {m.name}
              </option>
            ))}
          </optgroup>
          {commsTeams.length > 1 && (
            <optgroup label="Teams">
              {commsTeams.map((t) => (
                <option key={t.id} value={`team:${t.id}`} className="text-slate-700">
                  {t.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          onClick={handleExport}
          className="inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-lg text-navy-950 shadow-sm"
          style={{ background: 'var(--skin-gold-gradient)' }}
        >
          <Download size={15} /> Export
        </button>
      </DashboardHero>

      {commsTeams.length === 0 && (
        <Card className="border-gold-300 bg-gold-050">
          <p className="text-sm text-slate-700">
            No team is set up as a Communications team yet, so there's no one to score here.{' '}
            <Link to="/settings" className="font-semibold text-brand-600 hover:underline">
              Set one up in Settings → Teams
            </Link>{' '}
            and assign its members.
          </p>
        </Card>
      )}

      <Card>
        <div className="flex items-start justify-between mb-4 gap-3">
          <CardHeader title="Recovery Rate" subtitle="Payments vs. handover amount for the clients in scope, and this period's meeting format split" />
          <span className="text-xs font-medium text-brand-600 bg-brand-50 px-2.5 py-1 rounded-full whitespace-nowrap shrink-0">{period.label}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[176px_176px_1fr] gap-6 items-start">
          {scope.startsWith('member:') && bookCoefficient !== undefined && teamCoefficient !== undefined ? (
            <ComparisonGauge individualPct={bookCoefficient} teamPct={teamCoefficient} />
          ) : recoveryDonut.length > 0 ? (
            <RingDonut
              data={recoveryDonut}
              centerValue={`${Math.round(bookCoefficient ?? 0)}%`}
              centerColor={coefficientTone(bookCoefficient ?? 0) === 'good' ? POSITIVE_HEX : coefficientTone(bookCoefficient ?? 0) === 'mid' ? 'var(--c-gold-bronze)' : NEGATIVE_HEX}
              centerLabel={coefficientScopeLabel}
              caption="Paid to date ÷ handover amount"
            />
          ) : (
            <p className="text-sm text-slate-400">No handover data for this selection yet.</p>
          )}
          {meetingDonut.length > 0 ? (
            <RingDonut data={meetingDonut} centerValue={kpis.curr.meetings.toString()} centerLabel="MEETINGS HELD" caption="This period's format split" />
          ) : (
            <p className="text-sm text-slate-400">No meetings scheduled this period.</p>
          )}
          <div className="flex flex-col gap-2.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">This period's servicing activity</span>
            {[
              { label: 'Courtesy Calls Made', value: kpis.curr.courtesyCalls, color: 'var(--c-navy)', bg: 'var(--tint-steel)', to: buildDrilldownUrl('/activities', { type: 'Courtesy Call', [SALES_MONTH_PARAM]: periodParam }) },
              { label: 'Handovers Received', value: kpis.curr.handovers, color: 'var(--c-gold-deep)', bg: 'var(--tint-gold-deep)', to: buildDrilldownUrl('/activities', { type: 'Handover Received', [SALES_MONTH_PARAM]: periodParam }) },
              { label: 'Deals Closed by Communications', value: kpis.curr.dealsWon, color: 'var(--c-green)', bg: 'var(--tint-green)', to: buildDrilldownUrl('/deals', { stage: 'Won', view: 'table' }) },
            ].map((p) => (
              <Link key={p.label} to={p.to} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-slate-100 hover:bg-slate-50/60">
                <span className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-extrabold shrink-0" style={{ backgroundColor: p.bg, color: p.color }}>
                  {p.value}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-lg font-extrabold text-slate-800 leading-tight">{p.value}</span>
                  <span className="block text-[11.5px] text-slate-400">{p.label}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100 text-xs text-slate-400">
          <span>Collections Coefficient = Paid to Date ÷ Handover Amount · excludes undisclosed fee recoveries</span>
          <span className="font-semibold text-slate-600 shrink-0">
            {kpis.curr.clientsTouched} of {clients.length} active clients contacted this period
          </span>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatTile
          label="Courtesy Calls"
          value={kpis.curr.courtesyCalls.toString()}
          pctChange={kpis.prev ? pctDelta(kpis.curr.courtesyCalls, kpis.prev.courtesyCalls) : undefined}
          to={buildDrilldownUrl('/activities', { type: 'Courtesy Call', [SALES_MONTH_PARAM]: periodParam })}
          icon={<Phone size={14} className="text-slate-300" />}
        />
        <StatTile
          label="Handovers Received"
          value={kpis.curr.handovers.toString()}
          pctChange={kpis.prev ? pctDelta(kpis.curr.handovers, kpis.prev.handovers) : undefined}
          to={buildDrilldownUrl('/activities', { type: 'Handover Received', [SALES_MONTH_PARAM]: periodParam })}
          icon={<Inbox size={14} className="text-slate-300" />}
        />
        <StatTile
          label="Meetings Held"
          value={kpis.curr.meetings.toString()}
          pctChange={kpis.prev ? pctDelta(kpis.curr.meetings, kpis.prev.meetings) : undefined}
          to={buildDrilldownUrl('/tasks', { view: 'All' })}
          icon={<Users2 size={14} className="text-slate-300" />}
        />
        <StatTile
          label="Deals Closed"
          value={kpis.curr.dealsWon.toString()}
          pctChange={kpis.prev ? pctDelta(kpis.curr.dealsWon, kpis.prev.dealsWon) : undefined}
          to={buildDrilldownUrl('/deals', { stage: 'Won', view: 'table' })}
          icon={<Handshake size={14} className="text-slate-300" />}
        />
        <StatTile
          label="Clients Touched"
          value={`${kpis.curr.clientsTouched} / ${clients.length}`}
          icon={<ClipboardCheck size={14} className="text-slate-300" />}
        />
        <StatTile
          label={scope.startsWith('member:') ? 'Your Collections Coefficient' : scope.startsWith('team:') ? 'Team Collections Coefficient' : 'Collections Coefficient'}
          value={bookCoefficient !== undefined ? `${bookCoefficient.toFixed(1)}%` : '—'}
          accent="gold"
          icon={<Percent size={14} className="text-slate-300" />}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile label="Avg. Days Since Last Contact" value={secondary.avgDaysSinceContact !== undefined ? secondary.avgDaysSinceContact.toString() : '—'} size="secondary" />
        <StatTile label="Clients Never Contacted" value={secondary.neverContactedCount.toString()} size="secondary" />
        <StatTile label="Overdue Follow-ups" value={secondary.overdueTasksCount.toString()} size="secondary" to={buildDrilldownUrl('/tasks', { view: 'Overdue' })} />
        <StatTile label="Meetings This Week" value={secondary.meetingsThisWeekCount.toString()} size="secondary" to={buildDrilldownUrl('/tasks', { view: 'All' })} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Collections Coefficient by Client" subtitle="Paid to date as a share of handover amount — lowest first" />
          {rankedByCoefficient.length === 0 ? (
            <p className="text-sm text-slate-400">No Swordfish client data yet.</p>
          ) : (
            <div className="space-y-2">
              {rankedByCoefficient.map(({ company, rollup }) => (
                <CoefficientBar key={company.id} company={company} rollup={rollup} />
              ))}
            </div>
          )}
          {clientRollups.length > 0 && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 text-xs">
              <span className="text-slate-500">Total: {clientRollups.reduce((s, r) => s + (r.rollup.accountCount ?? 0), 0).toLocaleString()} accounts</span>
              <span className="font-semibold text-slate-700">{bookCoefficient !== undefined ? `${bookCoefficient.toFixed(1)}% overall` : '—'}</span>
            </div>
          )}
        </Card>
        <ActivityBreakdownChart activities={scopedActivities.filter((a) => isWithinPeriod(a.activityDate, period))} />
      </div>

      {rankedByCoefficient.length > 0 && (
        <Card padded={false}>
          <div className="p-5 pb-0">
            <CardHeader title="Needs a Courtesy Call" subtitle="Lowest collections coefficient — most likely to need attention" />
          </div>
          <div className="px-5 pb-5 divide-y divide-slate-50">
            {rankedByCoefficient.slice(0, 3).map(({ company, rollup }) => {
              const pct = collectionsCoefficient(rollup) ?? 0
              return (
                <Link key={company.id} to={`/companies/${company.id}`} className="flex items-center justify-between py-2.5 hover:bg-slate-50/60 -mx-1 px-1 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-slate-700">{company.name}</p>
                    <p className="text-xs text-slate-400">{(rollup.accountCount ?? 0).toLocaleString()} accounts</p>
                  </div>
                  <span className="text-sm font-bold" style={{ color: TONE_HEX[coefficientTone(pct)] }}>
                    {pct.toFixed(1)}%
                  </span>
                </Link>
              )
            })}
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div className="p-5 pb-0">
          <CardHeader title="Communications Team" subtitle="Click a column to sort" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-t border-slate-100">
                <th className="font-medium px-5 py-2.5">Team Member</th>
                {(
                  [
                    { key: 'courtesyCalls', label: 'Courtesy Calls' },
                    { key: 'meetings', label: 'Meetings' },
                    { key: 'handovers', label: 'Handovers Logged' },
                    { key: 'dealsWon', label: 'Deals Won' },
                    { key: 'revenueWon', label: 'Revenue Won' },
                  ] as const
                ).map((c) => (
                  <th
                    key={c.key}
                    onClick={() => setSortKey(c.key)}
                    className="font-medium px-3 py-2.5 text-right cursor-pointer select-none hover:text-slate-600 whitespace-nowrap"
                  >
                    {c.label}
                    {sortKey === c.key ? ' ▼' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedLeaderboard.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-slate-400 text-sm py-8">
                    No Communications team members yet.
                  </td>
                </tr>
              ) : (
                sortedLeaderboard.map((r, i) => (
                  <tr key={r.memberId} className={i === 0 ? 'border-t border-slate-50 bg-gold-300/25 hover:bg-gold-300/35' : 'border-t border-slate-50 hover:bg-slate-50/60'}>
                    <td className="px-5 py-2.5">
                      <span className="flex items-center gap-2 font-medium text-slate-700">
                        <UserAvatar userId={r.memberId} size={24} />
                        {r.name}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{r.courtesyCalls}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{r.meetings}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{r.handovers}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{r.dealsWon}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{formatCurrency(r.revenueWon)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2" padded={false}>
          <div className="p-5 pb-0">
            <CardHeader title="Recent Deals Closed" action={<Link to="/deals" className="text-xs font-medium text-brand-600 hover:underline">View all deals</Link>} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-t border-slate-100">
                  <th className="font-medium px-5 py-2.5">Deal</th>
                  <th className="font-medium px-3 py-2.5">Client</th>
                  <th className="font-medium px-3 py-2.5 text-right">Value</th>
                  <th className="font-medium px-3 py-2.5">Closed By</th>
                </tr>
              </thead>
              <tbody>
                {recentDeals.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center text-slate-400 text-sm py-8">
                      No deals closed yet.
                    </td>
                  </tr>
                ) : (
                  recentDeals.map((d) => (
                    <tr key={d.id} className="border-t border-slate-50 hover:bg-slate-50/60">
                      <td className="px-5 py-2.5">
                        <Link to={`/deals/${d.id}`} className="font-medium text-slate-700 hover:text-brand-600">
                          {d.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-slate-500">{companyById(d.companyId)?.name}</td>
                      <td className="px-3 py-2.5 text-right font-medium text-slate-700">{formatCurrency(d.value)}</td>
                      <td className="px-3 py-2.5 text-slate-500">{userById(d.ownerId)?.name}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-0">
            <CardHeader title="Recent Activity" action={<Link to="/activities" className="text-xs font-medium text-brand-600 hover:underline">View all</Link>} />
          </div>
          <div className="px-5 pb-5 space-y-3.5 max-h-80 overflow-y-auto">
            {recentActivities.length === 0 ? (
              <p className="text-sm text-slate-400">No activity recorded yet.</p>
            ) : (
              recentActivities.map((a) => (
                <div key={a.id} className="flex gap-3">
                  <UserAvatar userId={a.userId} size={26} />
                  <div className="min-w-0">
                    <p className="text-[13px] text-slate-700 leading-snug">{a.subject}</p>
                    <p className="text-[11px] text-slate-400">{timeAgo(a.activityDate)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card padded={false}>
        <div className="p-5 pb-0">
          <CardHeader title="Meetings & Follow-ups Due" subtitle="Overdue, due today, and this week" action={<Link to="/tasks" className="text-xs font-medium text-brand-600 hover:underline">View all tasks</Link>} />
        </div>
        <div className="px-5 pb-5 divide-y divide-slate-50">
          {tasksDue.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2.5">
              <button onClick={() => updateTask(t.id, { status: 'Completed', completedAt: new Date().toISOString() })} className="text-slate-300 hover:text-[var(--c-green)] shrink-0">
                <Circle size={18} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-slate-700 truncate">{t.title}</p>
                <p className="text-[11px] text-slate-400">{t.relatedToLabel ?? t.type}</p>
              </div>
              <span className={`text-xs font-medium w-20 text-right shrink-0 ${new Date(t.dueDate) < TODAY ? 'text-[var(--c-rust-deep)]' : 'text-slate-500'}`}>{daysAgoLabel(t.dueDate)}</span>
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

/** Two concentric progress rings — inner = the selected individual's own Collections Coefficient, outer = the whole Communications team's, so a single glance shows how they compare. */
function ComparisonGauge({ individualPct, teamPct }: { individualPct: number; teamPct: number }) {
  const SIZE = 160
  const OUTER_R = 69
  const INNER_R = 48
  const STROKE = 15
  const outerCirc = 2 * Math.PI * OUTER_R
  const innerCirc = 2 * Math.PI * INNER_R
  const outerLen = (Math.max(Math.min(teamPct, 100), 0) / 100) * outerCirc
  const innerLen = (Math.max(Math.min(individualPct, 100), 0) / 100) * innerCirc
  const outerColor = TONE_HEX[coefficientTone(teamPct)]
  const innerColor = TONE_HEX[coefficientTone(individualPct)]
  return (
    <div className="flex flex-col items-center gap-2.5">
      <div className="h-40 w-40 relative">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full -rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={OUTER_R} fill="none" stroke="var(--tint-steel-alt)" strokeWidth={STROKE} />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={OUTER_R}
            fill="none"
            stroke={outerColor}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeOpacity={0.45}
            strokeDasharray={`${outerLen} ${outerCirc - outerLen}`}
          />
          <circle cx={SIZE / 2} cy={SIZE / 2} r={INNER_R} fill="none" stroke="var(--tint-steel-alt)" strokeWidth={STROKE} />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={INNER_R}
            fill="none"
            stroke={innerColor}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${innerLen} ${innerCirc - innerLen}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-2">
          <span className="text-[22px] font-extrabold leading-none" style={{ color: innerColor }}>
            {individualPct.toFixed(0)}%
          </span>
          <span className="text-[9px] font-semibold text-slate-400 mt-1 tracking-wide text-center leading-tight">YOUR COEFFICIENT</span>
        </div>
      </div>
      <span className="text-[11px] text-slate-400 text-center -mt-1">
        Inner = you · Outer = team ({teamPct.toFixed(0)}%)
      </span>
    </div>
  )
}

function CoefficientBar({ company, rollup }: { company: Company; rollup: ClientRollup }) {
  const pct = collectionsCoefficient(rollup)
  if (pct === undefined) return null
  const tone = coefficientTone(pct)
  const widthPct = Math.max(Math.min(pct, 100), 3)
  return (
    <Link to={`/companies/${company.id}`} className="flex items-center gap-3 group">
      <span className="w-32 text-xs font-medium text-slate-500 shrink-0 truncate group-hover:text-slate-700">{company.name}</span>
      <div className="flex-1 bg-slate-50 rounded-md h-7 relative overflow-hidden">
        <div className="h-full rounded-md flex items-center justify-end px-2.5" style={{ width: `${widthPct}%`, backgroundColor: TONE_HEX[tone] }}>
          <span className="text-white text-xs font-semibold">{pct.toFixed(1)}%</span>
        </div>
      </div>
      <span className="w-16 text-[11px] text-slate-400 text-right shrink-0">{(rollup.accountCount ?? 0).toLocaleString()} accts</span>
    </Link>
  )
}
