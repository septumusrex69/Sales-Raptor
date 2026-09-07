import type { ID, Target, TargetMetric } from '../types'

export interface TargetMetricDef {
  id: TargetMetric
  label: string
  /** How the number reads — money is formatted as currency, everything else as a count. */
  unit: 'count' | 'currency'
  /** What the number counts, in the words someone setting the target would use. */
  description: string
}

/**
 * The measurable things.
 *
 * Every entry here is a figure the dashboard already computes for the selected sales month, so
 * a target is a line drawn on an existing number rather than a new number invented in order to
 * have something to target. Anything that cannot yet be measured deliberately has no entry —
 * a target against a figure the system does not produce is a promise the dashboard will quietly
 * fail to keep.
 */
export const TARGET_METRICS: TargetMetricDef[] = [
  { id: 'leads', label: 'New Leads', unit: 'count', description: 'Leads created in the sales month' },
  { id: 'mandates', label: 'Mandates Signed', unit: 'count', description: 'Debt collection deals marked Won — a signed mandate' },
  { id: 'deals', label: 'Service Deals Won', unit: 'count', description: 'Won deals other than mandates' },
  { id: 'revenue', label: 'Revenue Won', unit: 'currency', description: 'Fees on won service deals. Excludes handovers, which earn nothing at signature' },
  { id: 'book', label: 'Book Signed', unit: 'currency', description: 'Handover value on mandates signed in the month' },
  { id: 'accounts', label: 'Accounts Signed', unit: 'count', description: 'Debtor accounts handed over on mandates signed in the month' },
  { id: 'activities', label: 'Activities Logged', unit: 'count', description: 'Calls, meetings, emails and notes that move work forward' },
]

export const TARGET_METRIC_BY_ID: Record<TargetMetric, TargetMetricDef> = Object.fromEntries(
  TARGET_METRICS.map((m) => [m.id, m]),
) as Record<TargetMetric, TargetMetricDef>

/**
 * The number in force for one scope, metric and month.
 *
 * A target set for a specific sales month wins over the standing one. That is the whole point
 * of having both: the permanent figure stays permanent, and a short December or a month with
 * two people on leave is handled by overriding that month rather than by editing the real
 * target and forgetting to put it back.
 */
export function resolveTarget(
  targets: Target[],
  scopeType: 'team' | 'user',
  scopeId: ID,
  metric: TargetMetric,
  periodKey: string,
): Target | undefined {
  const candidates = targets.filter((t) => t.scopeType === scopeType && t.scopeId === scopeId && t.metric === metric)
  return candidates.find((t) => t.periodKey === periodKey) ?? candidates.find((t) => !t.periodKey)
}

export type TargetStanding = 'none' | 'below-floor' | 'on-track' | 'met'

export interface TargetProgress {
  metric: TargetMetric
  actual: number
  target: number
  threshold?: number
  /** Capped at 100 for the bar; `ratio` keeps the true figure for the caption. */
  pct: number
  ratio: number
  standing: TargetStanding
}

/**
 * Where a number stands against its target.
 *
 * Three states rather than two, because the business talks in three: below the floor is a
 * problem, between the floor and the goal is acceptable but not finished, and at or past the
 * goal is done. Collapsing that into a single "x% of target" bar loses the floor, which is the
 * half people actually get held to.
 */
export function targetProgress(actual: number, target?: Target): TargetProgress | undefined {
  if (!target || target.targetValue <= 0) return undefined
  const ratio = actual / target.targetValue
  const floor = target.thresholdValue
  const standing: TargetStanding =
    actual >= target.targetValue ? 'met' : floor !== undefined && actual < floor ? 'below-floor' : 'on-track'
  return {
    metric: target.metric,
    actual,
    target: target.targetValue,
    threshold: floor,
    pct: Math.min(Math.round(ratio * 100), 100),
    ratio,
    standing,
  }
}

/**
 * How far into the sales month we are, 0–1.
 *
 * Used to say whether a number is behind *for the point in the month* rather than simply short
 * of a figure nobody could have hit yet. On the third of the month, 10% of target is ahead;
 * on the twenty-eighth it is a crisis, and a bar alone cannot tell the two apart.
 */
export function periodElapsed(start: Date, end: Date, now: Date): number {
  const total = end.getTime() - start.getTime()
  if (total <= 0) return 1
  return Math.max(0, Math.min(1, (now.getTime() - start.getTime()) / total))
}
