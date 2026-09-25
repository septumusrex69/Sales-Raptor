/**
 * THE BOOK'S FIGURES FOR THE COMPANY DASHBOARD, fetched.
 *
 * Kept apart from companySnapshot.ts so that the arithmetic beside it can be imported by a check
 * — this module pulls in the Supabase client and nothing in scripts/qa can load that. The same
 * split as handOut/handOutData.
 *
 * ONE ROUND TRIP, AND NOT A ROW OF THE BOOK CROSSES THE WIRE. `company_snapshot` counts eleven
 * things in the database; asked from here they would be eleven requests, or the whole book
 * downloaded to be counted — which CLAUDE.md names as the list that stops working the month it
 * matters, on the one screen the whole firm opens every morning.
 */
import { supabase } from './supabase'
import type { SalesMonthPeriod } from './salesMonth'
import type { BookSnapshot } from './companySnapshot'

export async function fetchBookSnapshot(
  period: SalesMonthPeriod,
  quietDays = 30,
): Promise<BookSnapshot> {
  const { data, error } = await supabase.rpc('company_snapshot', {
    p_from: isoDay(period.start),
    p_to: isoDay(period.end),
    p_quiet_days: quietDays,
  })
  if (error) throw new Error(error.message)
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined
  const n = (key: string): number => Number(row?.[key] ?? 0)
  return {
    intakeAccounts: n('intake_accounts'),
    intakeClients: n('intake_clients'),
    intakeCapital: n('intake_capital'),
    bookAccounts: n('book_accounts'),
    bookCapital: n('book_capital'),
    bookClients: n('book_clients'),
    activeAccounts: n('active_accounts'),
    activeCapital: n('active_capital'),
    activeClients: n('active_clients'),
    unallocatedActive: n('unallocated_active'),
    quietAccounts: n('quiet_accounts'),
    neverActioned: n('never_actioned'),
  }
}


/** A date as Postgres wants it, in local time — `toISOString` would shift a SAST evening back a day. */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
