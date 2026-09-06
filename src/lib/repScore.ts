import type { Activity, Deal, ID, Lead, Task } from '../types'
import { isMeaningfulActivity } from './meaningfulActivity'
import { isWithinPeriod, type SalesMonthPeriod } from './salesMonth'
import { isActiveLead, isContactedLead, isEngagedLead } from './leadStatus'

export interface ScoreBreakdownItem {
  label: string
  contribution: number
}

export interface SubScore {
  value: number
  breakdown: ScoreBreakdownItem[]
}

export type ScoreKey = 'activity' | 'leadCoverage' | 'followUp' | 'conversion' | 'win' | 'revenue'

export const SCORE_LABELS: Record<ScoreKey, string> = {
  activity: 'Activity',
  leadCoverage: 'Lead Coverage',
  followUp: 'Follow-Up',
  conversion: 'Conversion',
  win: 'Win',
  revenue: 'Revenue',
}

export interface RepScorecard {
  repId: ID
  period: SalesMonthPeriod
  scores: Record<ScoreKey, SubScore>
  overall: number
}

export const DEFAULT_SCORE_WEIGHTS: Record<ScoreKey, number> = {
  activity: 0.15,
  leadCoverage: 0.15,
  followUp: 0.15,
  conversion: 0.2,
  win: 0.2,
  revenue: 0.15,
}

interface ScoreData {
  leads: Lead[]
  deals: Deal[]
  activities: Activity[]
  tasks: Task[]
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
const pct = (numerator: number, denominator: number, fallback = 0) => (denominator > 0 ? (numerator / denominator) * 100 : fallback)

function businessDaysBetween(start: Date, end: Date): number {
  let count = 0
  const d = new Date(start)
  while (d <= end) {
    const day = d.getDay()
    if (day !== 0 && day !== 6) count++
    d.setDate(d.getDate() + 1)
  }
  return Math.max(1, count)
}

function activityScore(repId: ID, period: SalesMonthPeriod, activities: Activity[]): SubScore {
  const repActivities = activities.filter((a) => a.userId === repId && isMeaningfulActivity(a) && isWithinPeriod(a.activityDate, period))
  const businessDays = businessDaysBetween(period.start, period.end)
  const activeDays = new Set(repActivities.map((a) => a.activityDate.slice(0, 10))).size
  const targetActivities = businessDays * 3
  const volumeScore = clamp(pct(repActivities.length, targetActivities, 100))
  const consistencyScore = clamp(pct(activeDays, businessDays, 100))
  return {
    value: clamp((volumeScore + consistencyScore) / 2),
    breakdown: [
      { label: 'Meaningful activities', contribution: repActivities.length },
      { label: 'Active working days', contribution: activeDays },
      { label: 'Business days in period', contribution: businessDays },
      { label: 'Activities per working day', contribution: Math.round((repActivities.length / businessDays) * 10) / 10 },
    ],
  }
}

function leadCoverageScore(repId: ID, period: SalesMonthPeriod, leads: Lead[], activities: Activity[]): SubScore {
  const assigned = leads.filter((l) => l.ownerId === repId && isActiveLead(l))
  const touchedLeadIds = new Set(
    activities.filter((a) => a.leadId && isMeaningfulActivity(a) && isWithinPeriod(a.activityDate, period)).map((a) => a.leadId as string),
  )
  const touched = assigned.filter((l) => touchedLeadIds.has(l.id) || (l.lastContactAt && isWithinPeriod(l.lastContactAt, period)))
  const coverage = pct(touched.length, assigned.length, 100)
  return {
    value: clamp(coverage),
    breakdown: [
      { label: 'Leads assigned', contribution: assigned.length },
      { label: 'Leads touched', contribution: touched.length },
      { label: 'Leads untouched', contribution: assigned.length - touched.length },
      { label: 'Coverage %', contribution: Math.round(coverage) },
    ],
  }
}

function followUpScore(repId: ID, period: SalesMonthPeriod, tasks: Task[], deals: Deal[], referenceDate: Date): SubScore {
  const dueInPeriod = tasks.filter((t) => t.ownerId === repId && t.status !== 'Cancelled' && isWithinPeriod(t.dueDate, period))
  const completedOnTime = dueInPeriod.filter((t) => t.completedAt && new Date(t.completedAt) <= new Date(t.dueDate))
  const overdue = tasks.filter((t) => t.ownerId === repId && t.status !== 'Completed' && t.status !== 'Cancelled' && new Date(t.dueDate) < referenceDate)
  const openNoNextAction = deals.filter((d) => d.ownerId === repId && d.stage !== 'Won' && d.stage !== 'Lost' && !d.nextActionAt)
  const onTimePct = pct(completedOnTime.length, dueInPeriod.length, 100)
  const overduePenaltyScore = Math.max(0, 100 - overdue.length * 10)
  return {
    value: clamp(0.7 * onTimePct + 0.3 * overduePenaltyScore),
    breakdown: [
      { label: 'Tasks due this period', contribution: dueInPeriod.length },
      { label: 'Completed on time', contribution: completedOnTime.length },
      { label: 'Overdue tasks', contribution: overdue.length },
      { label: 'Open deals with no next action', contribution: openNoNextAction.length },
    ],
  }
}

function conversionScore(repId: ID, period: SalesMonthPeriod, leads: Lead[]): SubScore {
  // Historical caveat: lead status is current-state, not event-sourced (no
  // stored qualifiedAt), so this reads current status of leads created in
  // the period — the same known limitation as the dashboard's Sales Funnel.
  const newLeads = leads.filter((l) => l.ownerId === repId && isWithinPeriod(l.createdAt, period))
  const contacted = newLeads.filter(isContactedLead)
  const qualifiedPlus = newLeads.filter(isEngagedLead)
  const contactRate = pct(contacted.length, newLeads.length, 100)
  const qualificationRate = pct(qualifiedPlus.length, newLeads.length, 100)
  return {
    value: clamp((contactRate + qualificationRate) / 2),
    breakdown: [
      { label: 'New leads this period', contribution: newLeads.length },
      { label: 'Contacted', contribution: contacted.length },
      { label: 'Interested or hotter', contribution: qualifiedPlus.length },
      { label: 'Contact rate %', contribution: Math.round(contactRate) },
    ],
  }
}

function winScore(repId: ID, period: SalesMonthPeriod, deals: Deal[]): SubScore {
  const won = deals.filter((d) => d.ownerId === repId && d.wonAt && isWithinPeriod(d.wonAt, period))
  const lost = deals.filter((d) => d.ownerId === repId && d.lostAt && isWithinPeriod(d.lostAt, period))
  const closed = won.length + lost.length
  const winRate = pct(won.length, closed, 50)
  return {
    value: clamp(winRate),
    breakdown: [
      { label: 'Deals won', contribution: won.length },
      { label: 'Deals lost', contribution: lost.length },
      { label: 'Closed deals', contribution: closed },
      { label: 'Win rate %', contribution: Math.round(winRate) },
    ],
  }
}

function revenueScore(repId: ID, period: SalesMonthPeriod, deals: Deal[], teamMaxRevenue?: number): SubScore {
  const won = deals.filter((d) => d.ownerId === repId && d.wonAt && isWithinPeriod(d.wonAt, period))
  const revenueWon = won.reduce((s, d) => s + d.value, 0)
  const avgDealValue = won.length > 0 ? Math.round(revenueWon / won.length) : 0
  const max = teamMaxRevenue && teamMaxRevenue > 0 ? teamMaxRevenue : revenueWon || 1
  return {
    value: clamp(pct(revenueWon, max, 0)),
    breakdown: [
      { label: 'Revenue won', contribution: revenueWon },
      { label: 'Deals won', contribution: won.length },
      { label: 'Average deal value', contribution: avgDealValue },
    ],
  }
}

export function computeRepScorecard(
  repId: ID,
  period: SalesMonthPeriod,
  data: ScoreData,
  referenceDate: Date,
  weights: Record<ScoreKey, number> = DEFAULT_SCORE_WEIGHTS,
  teamMaxRevenue?: number,
): RepScorecard {
  const scores: Record<ScoreKey, SubScore> = {
    activity: activityScore(repId, period, data.activities),
    leadCoverage: leadCoverageScore(repId, period, data.leads, data.activities),
    followUp: followUpScore(repId, period, data.tasks, data.deals, referenceDate),
    conversion: conversionScore(repId, period, data.leads),
    win: winScore(repId, period, data.deals),
    revenue: revenueScore(repId, period, data.deals, teamMaxRevenue),
  }
  const overall = computeOverallScore(scores, weights)
  return { repId, period, scores, overall }
}

export function computeOverallScore(scores: Record<ScoreKey, SubScore>, weights: Record<ScoreKey, number> = DEFAULT_SCORE_WEIGHTS): number {
  const total = (Object.keys(weights) as ScoreKey[]).reduce((sum, key) => sum + scores[key].value * weights[key], 0)
  return clamp(total)
}

/** Computes scorecards for a set of reps, normalizing Revenue Score against the group's top earner for the period. */
export function computeAllRepScorecards(
  repIds: ID[],
  period: SalesMonthPeriod,
  data: ScoreData,
  referenceDate: Date,
  weights: Record<ScoreKey, number> = DEFAULT_SCORE_WEIGHTS,
): RepScorecard[] {
  const revenues = repIds.map((id) => data.deals.filter((d) => d.ownerId === id && d.wonAt && isWithinPeriod(d.wonAt, period)).reduce((s, d) => s + d.value, 0))
  const teamMaxRevenue = Math.max(1, ...revenues)
  return repIds.map((id) => computeRepScorecard(id, period, data, referenceDate, weights, teamMaxRevenue))
}
