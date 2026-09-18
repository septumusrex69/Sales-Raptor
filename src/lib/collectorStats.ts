/**
 * Fetching collector figures. The arithmetic lives in collectorScore.ts, which is pure.
 */
import { supabase } from './supabase'
import type { CollectorStats } from './collectorScore.ts'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON from PostgREST. */
const toStats = (r: any): CollectorStats => ({
  userId: r.user_id,
  inPlayAccounts: Number(r.in_play_accounts ?? 0),
  inPlayValue: Number(r.in_play_value ?? 0),
  collected: Number(r.collected ?? 0),
  payments: Number(r.payments ?? 0),
  calls: Number(r.calls ?? 0),
  callsAnswered: Number(r.calls_answered ?? 0),
  emailsSent: Number(r.emails_sent ?? 0),
  smsSent: Number(r.sms_sent ?? 0),
  notesWritten: Number(r.notes_written ?? 0),
  promisesMade: Number(r.promises_made ?? 0),
  promisesKept: Number(r.promises_kept ?? 0),
  promisesBroken: Number(r.promises_broken ?? 0),
  accountsTouched: Number(r.accounts_touched ?? 0),
  /*
   * EVERY COLUMN BY HAND, and this file is one of the two the codebase names as the trap: a
   * column present in the database, in the type and in the RPC but missing here reads as
   * undefined for ever and nothing fails. diary_capacity sat in that state for months.
   */
  tracesPulled: Number(r.traces_pulled ?? 0),
  traceLeads: Number(r.trace_leads ?? 0),
  tracesWorked: Number(r.traces_worked ?? 0),
  tracesVerified: Number(r.traces_verified ?? 0),
})
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Every collector's figures for a period.
 *
 * The period is half-open — from the start inclusive, to the end exclusive — so two consecutive
 * months cannot both claim a payment that landed on the boundary.
 */
export async function fetchCollectorPerformance(from: Date, to: Date): Promise<CollectorStats[]> {
  const { data, error } = await supabase.rpc('collector_performance', {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown[]).map(toStats)
}

/** One day's takings. The shape src/lib/collectorTrend.ts buckets into the firm's months. */
export interface DailyTake {
  /** The firm's own local day, as 'YYYY-MM-DD'. Never a UTC one — see the RPC. */
  day: string
  collected: number
  payments: number
}

/**
 * Money in, day by day, for one collector or for the whole floor.
 *
 * ONE ROUND TRIP FOR A YEAR. Twelve calls to collector_performance would be twelve of the heaviest
 * query in the system to draw one line on a graph; this is about 365 rows and the caller buckets
 * them into sales months itself, using the same rule every other figure in Raptor uses.
 *
 * `userId` null is the whole floor — what the company line behind a person's own line is drawn
 * from.
 */
export async function fetchCollectorDaily(
  userId: string | null, from: Date, to: Date,
): Promise<DailyTake[]> {
  const { data, error } = await supabase.rpc('collector_daily', {
    p_user: userId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  })
  if (error) throw new Error(error.message)
  /* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON from PostgREST. */
  return ((data ?? []) as any[]).map((r) => ({
    day: String(r.on_day),
    collected: Number(r.collected ?? 0),
    payments: Number(r.payments ?? 0),
  }))
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
