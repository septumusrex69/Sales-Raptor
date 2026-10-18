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
import type { BookSnapshot, IntakeRow } from './companySnapshot'
import { toClientBook, type ClientBook } from './clientBook'

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

/**
 * WORK COMING IN, A DAY AT A TIME (the firm's layout, 18 Oct). Only days that had a handover come
 * back; intakeBars (companySnapshot.ts) lays them on every day of the period.
 */
export async function fetchIntakeByDay(period: Pick<SalesMonthPeriod, 'start' | 'end'>): Promise<IntakeRow[]> {
  const { data, error } = await supabase.rpc('company_intake_by_day', {
    p_from: isoDay(period.start),
    p_to: isoDay(period.end),
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as { day: string; accounts: number | string; capital: number | string; new_accounts?: number | string; new_capital?: number | string }[])
    .map((r) => ({ day: String(r.day).slice(0, 10), accounts: Number(r.accounts), capital: Number(r.capital ?? 0),
      newAccounts: Number(r.new_accounts ?? 0), newCapital: Number(r.new_capital ?? 0) }))
}

/** Signed clients with nothing on the book yet (clients_awaiting_first_handover), as the database has them. */
export async function fetchAwaitingFirstHandover(): Promise<{ company_id: string; name: string; mandate_signed_at: string; account_owner_id: string | null }[]> {
  const { data, error } = await supabase.rpc('clients_awaiting_first_handover')
  if (error) throw new Error(error.message)
  return (data ?? []) as { company_id: string; name: string; mandate_signed_at: string; account_owner_id: string | null }[]
}

export { isoDay }

/** A date as Postgres wants it, in local time — `toISOString` would shift a SAST evening back a day. */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * EACH CLIENT'S BOOK (client_book_summary): first and last handover, accounts, capital, collected,
 * what it handed over in `period`, and its value band. One row a top-level client.
 */
export async function fetchClientBook(period: Pick<SalesMonthPeriod, 'start' | 'end'>): Promise<ClientBook[]> {
  const { data, error } = await supabase.rpc('client_book_summary', { p_from: isoDay(period.start), p_to: isoDay(period.end) })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map(toClientBook)
}
