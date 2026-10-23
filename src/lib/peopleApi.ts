import { supabase } from './supabase'
import type { CarriedEntry, CommissionPayment, PayBasis, PayoverRun } from './clerkCommission.ts'

/**
 * THE PEOPLE WORKSPACE'S READS AND WRITES. Everything here is behind people.pay in the DATABASE --
 * the three tables' policies and both pay functions ask has_capability('people.pay') -- so somebody
 * without the tick who reaches these gets nothing, or a refusal, whatever the screen draws.
 *
 * EVERY COLUMN BY HAND, AND THAT IS THE TRAP CLAUDE.md NAMES: a column in the table and the select but
 * missing from a mapper reads as undefined for ever and nothing fails. check-clerk-commission holds
 * these mappers against schema.sql.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows from PostgREST. */
const n = (v: any): number => Number(v ?? 0)
const nn = (v: any): number | null => (v === null || v === undefined ? null : Number(v))
const s = (v: any): string | null => (v === null || v === undefined ? null : String(v))

export interface EmployeeProfile {
  userId: string
  jobTitle: string | null
  /**
   * A leaver's last day: paid to it, pro rata, and nothing after. (The START date is not here: it is
   * profiles.start_date, which any Administrator writes -- the firm, 23 Oct -- read off the user.)
   */
  endedOn: string | null
  /** Null: whatever the role's department says (defaultPayBasis). */
  payBasis: PayBasis | null
  basicSalary: number | null
  notes: string | null
  updatedBy: string | null
  updatedAt: string | null
}

export const EMPLOYEE_PROFILE_COLUMNS =
  'user_id, job_title, pay_basis, basic_salary, notes, updated_by, updated_at, ended_on'

export function toEmployeeProfile(r: any): EmployeeProfile {
  return {
    userId: String(r.user_id),
    jobTitle: s(r.job_title),
    endedOn: s(r.ended_on),
    payBasis: (s(r.pay_basis) as PayBasis | null),
    basicSalary: nn(r.basic_salary),
    notes: s(r.notes),
    updatedBy: s(r.updated_by),
    updatedAt: s(r.updated_at),
  }
}

export async function fetchEmployeeProfiles(): Promise<EmployeeProfile[]> {
  const { data, error } = await supabase.from('employee_profiles').select(EMPLOYEE_PROFILE_COLUMNS)
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map(toEmployeeProfile)
}

/**
 * WRITTEN WHOLE, as one upsert: the database's trigger compares each field with what was there and
 * writes a history row for each one that changed, with who and when. Who and when are the trigger's
 * to write, never the browser's.
 */
export async function saveEmployeeProfile(p: {
  userId: string; jobTitle: string | null; endedOn: string | null; payBasis: PayBasis | null
  basicSalary: number | null; notes: string | null
}): Promise<void> {
  const { error } = await supabase.from('employee_profiles').upsert({
    user_id: p.userId,
    job_title: p.jobTitle,
    ended_on: p.endedOn,
    pay_basis: p.payBasis,
    basic_salary: p.basicSalary,
    notes: p.notes,
  }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)
}

export interface ProfileChange {
  id: string
  userId: string
  field: string
  oldValue: string | null
  newValue: string | null
  changedBy: string | null
  changedAt: string
}

export async function fetchProfileHistory(userId: string): Promise<ProfileChange[]> {
  const { data, error } = await supabase.from('employee_profile_history')
    .select('id, user_id, field, old_value, new_value, changed_by, changed_at')
    .eq('user_id', userId)
    .order('changed_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    field: String(r.field),
    oldValue: s(r.old_value),
    newValue: s(r.new_value),
    changedBy: s(r.changed_by),
    changedAt: String(r.changed_at),
  }))
}

/* ---------------------------------------------------------------------------------------------- */

export interface CommissionOverride {
  id: string
  companyId: string | null
  accountId: string | null
  /** Fraction (0.02 is 2%). Null: "back to the rule from this day". */
  rate: number | null
  effectiveFrom: string
  reason: string
  setBy: string | null
  setAt: string
  /** Joined for the screen. */
  client: string | null
  caseNumber: string | null
}

export async function fetchOverrides(): Promise<CommissionOverride[]> {
  const { data, error } = await supabase.from('clerk_commission_overrides')
    .select('id, company_id, account_id, rate, effective_from, reason, set_by, set_at, companies(name), debtor_accounts(case_number)')
    .order('effective_from', { ascending: false })
    .order('set_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map((r) => ({
    id: String(r.id),
    companyId: s(r.company_id),
    accountId: s(r.account_id),
    rate: nn(r.rate),
    effectiveFrom: String(r.effective_from),
    reason: String(r.reason ?? ''),
    setBy: s(r.set_by),
    setAt: String(r.set_at),
    client: s(r.companies?.name),
    caseNumber: s(r.debtor_accounts?.case_number),
  }))
}

/** A new decision. Never an edit: the table has no update policy, so the old decision stays readable. */
export async function addOverride(o: {
  companyId: string | null; accountId: string | null; rate: number | null; effectiveFrom: string; reason: string
}): Promise<void> {
  const { error } = await supabase.from('clerk_commission_overrides').insert({
    company_id: o.companyId,
    account_id: o.accountId,
    rate: o.rate,
    effective_from: o.effectiveFrom,
    reason: o.reason,
  })
  if (error) throw new Error(error.message)
}

/** An account by Raptor's own case number -- the one every notice quotes, and unique. */
export async function findAccountByCase(caseNumber: string): Promise<{ id: string; caseNumber: string; client: string | null } | null> {
  const { data, error } = await supabase.from('debtor_accounts')
    .select('id, case_number, companies(name)')
    .eq('case_number', caseNumber.trim())
    .limit(1)
  if (error) throw new Error(error.message)
  const r = ((data ?? []) as any[])[0]
  return r ? { id: String(r.id), caseNumber: String(r.case_number), client: s(r.companies?.name) } : null
}

/* ---------------------------------------------------------------------------------------------- */

export function toCommissionPayment(r: any): CommissionPayment {
  return {
    paymentId: String(r.payment_id),
    accountId: String(r.account_id),
    caseNumber: s(r.case_number),
    debtor: s(r.debtor),
    companyId: s(r.company_id),
    client: s(r.client),
    receivedOn: String(r.received_on),
    approvedOn: s(r.approved_on),
    reversedOn: s(r.reversed_on),
    reversalReason: s(r.reversal_reason),
    amount: n(r.amount),
    paidToClient: r.paid_to_client === true,
    holderId: s(r.holder_id),
    holderSource: s(r.holder_source),
    clientRate: nn(r.client_rate),
    clientRateSource: s(r.client_rate_source),
    /* THE _set FLAG DECIDES, not the rate: a rate of 0 is a decision ("no commission on this client"),
       and reading it as "no override" would quietly put the rule back. */
    accountOverride: r.account_override_set === true ? n(r.account_override) : null,
    accountOverrideReason: s(r.account_override_reason),
    clientOverride: r.client_override_set === true ? n(r.client_override) : null,
    clientOverrideReason: s(r.client_override_reason),
    payoverRunId: s(r.payover_run_id),
  }
}

/**
 * The payments a period's pay is worked out from: trust receipts in it, reversals in it, and every
 * PTC up to its end. `userId` null is everybody (the month summary).
 */
export async function fetchCommissionPayments(from: string, to: string, userId: string | null): Promise<CommissionPayment[]> {
  const { data, error } = await supabase.rpc('clerk_commission_lines', { p_from: from, p_to: to, p_user: userId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map(toCommissionPayment)
}

/**
 * THE CLIENTS' PAYOVER RUNS, for the PTC release. NULL, NOT EMPTY, WHEN THEY CANNOT BE READ: a
 * refusal (no trust or business tick) is passed on as "unknown", so every PTC stays held and the page
 * says why, rather than reading as "not on a run yet".
 */
export async function fetchPayoverRuns(companyIds: string[]): Promise<{ runs: Map<string, PayoverRun[]> | null; error: string | null }> {
  if (companyIds.length === 0) return { runs: new Map(), error: null }
  const { data, error } = await supabase.rpc('clerk_commission_runs', { p_companies: companyIds })
  if (error) return { runs: null, error: error.message }
  const out = new Map<string, PayoverRun[]>()
  for (const id of companyIds) out.set(id, [])
  for (const r of (data ?? []) as any[]) {
    const id = String(r.company_id)
    out.set(id, [...(out.get(id) ?? []), toPayoverRun(r)])
  }
  return { runs: out, error: null }
}

export function toPayoverRun(r: any): PayoverRun {
  return {
    id: String(r.run_id),
    companyId: String(r.company_id),
    periodStart: String(r.period_start),
    periodEnd: String(r.period_end),
    status: String(r.status),
    invoiceNumber: String(r.invoice_number ?? ''),
    net: n(r.net_payover),
    carriedIn: n(r.carried_in),
    approvedOn: s(r.approved_on),
    settledOn: s(r.settled_on),
  }
}

/* ---------------------------------------------------------------------------------------------- */

/**
 * THE CLEAN CUT: the day commission starts being worked out in Raptor. One row, people.pay only --
 * not firm_settings, which everybody reads.
 */
export async function fetchCommissionStart(): Promise<string | null> {
  const { data, error } = await supabase.from('people_settings').select('commission_start').maybeSingle()
  if (error) throw new Error(error.message)
  return s((data as any)?.commission_start)
}

export async function saveCommissionStart(day: string | null): Promise<void> {
  const { data, error } = await supabase.from('people_settings').update({ commission_start: day }).eq('id', true).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('The commission start date was not saved.')
}

/**
 * A PERSON'S START DATE, ON THEIR PROFILE ROW -- any Administrator writes it (the firm, 23 Oct: "A
 * user start date can also be asked for any administrator"). The database quietly reverts it for
 * anybody else (protect_profile_privileged_fields), so the row is read back rather than trusted.
 */
export async function saveStartDate(userId: string, day: string | null): Promise<void> {
  const { data, error } = await supabase.from('profiles').update({ start_date: day }).eq('id', userId).select('start_date')
  if (error) throw new Error(error.message)
  const back = s((data as any[] | null)?.[0]?.start_date)
  if (back !== day) throw new Error('The start date was not saved. Only an Administrator can set it.')
}

/* ---------------------------------------------------------------------------------------------- */

export const CARRIED_COLUMNS =
  'id, user_id, company_id, amount, note, source, reverses_id, reason, created_by, created_at'

/**
 * EVERY CARRIED-OVER ENTRY, with its reversal folded onto it. Read whole: the firm carries over a few
 * hundred lines once, and a statement needs all of a person's.
 */
export async function fetchCarried(userId: string | null): Promise<CarriedEntry[]> {
  let q = supabase.from('clerk_commission_carried').select('id, user_id, company_id, amount, note, source, reverses_id, reason, created_by, created_at, companies(name)').order('created_at')
  if (userId) q = q.eq('user_id', userId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return foldCarried((data ?? []) as any[])
}

export interface CarriedRow {
  id: string; userId: string; companyId: string; amount: number; note: string | null; source: string
  reversesId: string | null; reason: string | null; createdBy: string | null; createdAt: string; client: string | null
}

export function toCarriedRow(r: any): CarriedRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    companyId: String(r.company_id),
    amount: n(r.amount),
    note: s(r.note),
    source: String(r.source ?? ''),
    reversesId: s(r.reverses_id),
    reason: s(r.reason),
    createdBy: s(r.created_by),
    createdAt: String(r.created_at),
    client: s(r.companies?.name),
  }
}

/** A reversing row is not an entry of its own: it is the day and reason its original was reversed. */
export function foldCarried(rows: any[]): CarriedEntry[] {
  const all = rows.map(toCarriedRow)
  const rev = new Map(all.filter((r) => r.reversesId).map((r) => [r.reversesId as string, r]))
  return all.filter((r) => !r.reversesId).map((r) => ({
    id: r.id, userId: r.userId, companyId: r.companyId, client: r.client, amount: r.amount, note: r.note,
    source: r.source, createdOn: r.createdAt.slice(0, 10),
    reversedOn: rev.get(r.id)?.createdAt.slice(0, 10) ?? null,
    reversalReason: rev.get(r.id)?.reason ?? null,
  }))
}

/** New entries, all or none (one insert). Who and when are the database's to write. */
export async function addCarried(rows: { userId: string; companyId: string; amount: number; note: string | null; source: string }[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabase.from('clerk_commission_carried').insert(rows.map((r) => ({
    user_id: r.userId, company_id: r.companyId, amount: r.amount, note: r.note, source: r.source,
  })))
  if (error) throw new Error(error.message)
}

/** A correction is a reversing entry with a reason; the database copies clerk, client and amount. */
export async function reverseCarried(id: string, reason: string, original: { userId: string; companyId: string; amount: number }): Promise<void> {
  const { error } = await supabase.from('clerk_commission_carried').insert({
    reverses_id: id, reason, user_id: original.userId, company_id: original.companyId,
    amount: -original.amount, source: 'reversal',
  })
  if (error) throw new Error(error.message)
}
/* eslint-enable @typescript-eslint/no-explicit-any */
