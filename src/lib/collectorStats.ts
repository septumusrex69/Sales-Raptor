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
