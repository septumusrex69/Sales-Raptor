import { supabase } from './supabase'
import type { ExcessDisposal, ParkedCredit } from './excessCredit'

/**
 * DECIDING AN OVERPAYMENT, THE CALLS.
 *
 * Kept apart from excessCredit.ts, which holds the rules, so a QA check can import the arithmetic
 * without pulling in the Supabase client. Same split as accountEnding / accountEndingApi.
 */

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

export async function disposeExcessCredit(
  allocationId: string, disposal: ExcessDisposal, reason: string,
  extra?: { payableTo?: string; moveTo?: string },
): Promise<string | null> {
  const { data, error } = await supabase.rpc('dispose_excess_credit', {
    p_allocation: allocationId,
    p_disposal: disposal,
    p_reason: reason,
    p_payable_to: extra?.payableTo ?? null,
    p_move_to: extra?.moveTo ?? null,
  })
  if (error) throw new Error(error.message)
  return (data as string | null) ?? null
}

export async function fetchParkedCredits(): Promise<ParkedCredit[]> {
  const { data, error } = await supabase.rpc('parked_credits')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    allocationId: String(r.allocation_id),
    accountId: String(r.account_id),
    caseNumber: (r.case_number as string | null) ?? null,
    debtor: String(r.debtor ?? ''),
    client: (r.client as string | null) ?? null,
    amount: n(r.amount),
    parkedOn: (r.parked_on as string | null) ?? null,
    ripeOn: (r.ripe_on as string | null) ?? null,
    ripe: r.ripe === true,
    takenAt: (r.taken_at as string | null) ?? null,
    reason: (r.reason as string | null) ?? null,
  }))
}

/** The firm takes a credit nobody claimed. Refused before its period has run. */
export async function takeParkedCredit(allocationId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('take_parked_credit', {
    p_allocation: allocationId, p_reason: reason,
  })
  if (error) throw new Error(error.message)
}

/** And gives it back, because the debtor coming back is the case this has to survive. */
export async function returnParkedCredit(allocationId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('return_parked_credit', {
    p_allocation: allocationId, p_reason: reason,
  })
  if (error) throw new Error(error.message)
}
