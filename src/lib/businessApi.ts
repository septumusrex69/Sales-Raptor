import { supabase } from './supabase'
import type { BusinessExpense, BusinessMonth, ExpenseCategory, TrustBankCosts } from './businessMonth'
import { toIncomeRow, type IncomeRow } from './businessIncome'
import { clockNow } from './clock.ts'

/** The firm's own books, read and written. Split from businessMonth.ts so a check can import that. */

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

export async function fetchBusinessMonth(from: string, to: string): Promise<BusinessMonth | null> {
  const { data, error } = await supabase.rpc('business_month', { p_from: from, p_to: to })
  if (error) throw new Error(error.message)
  const r = (data as Record<string, unknown>[] | null)?.[0]
  /* NULL RATHER THAN ZEROES WHERE IT REFUSED: the guard is in a `where` clause, so somebody who may
     not see the firm's books gets no row — and drawing zeroes would tell them the firm earned
     nothing, which is a claim rather than a refusal. */
  if (!r) return null
  return {
    earned: n(r.earned), drawn: n(r.drawn), stillInTrust: n(r.still_in_trust),
    invoiced: n(r.invoiced), invoicesPaid: n(r.invoices_paid), owedByClients: n(r.owed_by_clients),
    expenses: n(r.expenses), expensesVat: n(r.expenses_vat), made: n(r.made),
  }
}

/** The trust account's interest and charges for the period, and the firm's balance in trust. Null = refused. */
export async function fetchTrustBankCosts(from: string, to: string): Promise<TrustBankCosts | null> {
  const { data, error } = await supabase.rpc('trust_bank_costs', { p_from: from, p_to: to })
  if (error) throw new Error(error.message)
  const r = (data as Record<string, unknown>[] | null)?.[0]
  if (!r) return null
  return {
    interest: n(r.interest), charges: n(r.charges), repaid: n(r.repaid),
    interestToDate: n(r.interest_to_date), chargesToDate: n(r.charges_to_date), repaidToDate: n(r.repaid_to_date),
    firmHeld: n(r.firm_held),
  }
}

export async function fetchExpenses(from: string, to: string): Promise<BusinessExpense[]> {
  const { data, error } = await supabase
    .from('business_expenses')
    .select('id, incurred_on, category, supplier, description, amount, vat, paid_at, cancelled_at, cancelled_reason')
    .gte('incurred_on', from).lte('incurred_on', to)
    .order('incurred_on', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    incurredOn: String(r.incurred_on ?? ''),
    category: String(r.category) as ExpenseCategory,
    supplier: (r.supplier as string | null) ?? null,
    description: String(r.description ?? ''),
    amount: n(r.amount),
    vat: n(r.vat),
    paidAt: (r.paid_at as string | null) ?? null,
    cancelledAt: (r.cancelled_at as string | null) ?? null,
    cancelledReason: (r.cancelled_reason as string | null) ?? null,
  }))
}

export async function recordExpense(e: {
  incurredOn: string; category: ExpenseCategory; supplier?: string
  description: string; amount: number; vat: number
}): Promise<void> {
  const { error } = await supabase.from('business_expenses').insert({
    incurred_on: e.incurredOn, category: e.category, supplier: e.supplier || null,
    description: e.description, amount: e.amount, vat: e.vat,
  })
  if (error) throw new Error(error.message)
}

/**
 * CANCELLED, NEVER DELETED. "What did we spend in March" has to keep answering the same way next
 * year, so the row stays and carries the reason it stopped counting. The table has no delete
 * policy at all, so a delete would be refused by Postgres anyway.
 */
export async function cancelExpense(id: string, reason: string): Promise<void> {
  const { error } = await supabase.from('business_expenses')
    .update({ cancelled_at: clockNow().toISOString(), cancelled_reason: reason })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * WHAT THE FIRM EARNED IN A PERIOD, client by client. Empty for anybody without business.income --
 * the guard is the function's own `where`, so a refusal is no rows rather than zeroes.
 */
export async function fetchIncome(from: string, to: string): Promise<IncomeRow[]> {
  const { data, error } = await supabase.rpc('business_income', { p_from: from, p_to: to })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map(toIncomeRow)
}

export interface Drawing { id: string; at: string; amount: number; reference: string; drawnBy: string | null }

/** The drawings out of trust in a period, newest first. */
export async function fetchDrawings(from: string, to: string): Promise<Drawing[]> {
  const { data, error } = await supabase.rpc('business_drawings', { p_from: from, p_to: to })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id), at: String(r.entry_at), amount: n(r.amount),
    reference: String(r.reference ?? ''), drawnBy: (r.drawn_by as string | null) ?? null,
  }))
}

/**
 * MOVE THE FIRM'S EARNINGS OUT OF TRUST. draw_from_trust refuses more than the firm holds -- a
 * drawing against anybody else's money is a trust shortfall -- and refuses anybody without both
 * the trust and the business ticks.
 */
export async function drawFromTrust(amount: number, reference: string): Promise<void> {
  const { error } = await supabase.rpc('draw_from_trust', { p_amount: amount, p_reference: reference })
  if (error) throw new Error(error.message)
}
