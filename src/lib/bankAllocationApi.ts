import { supabase } from './supabase'
import { toPaymentToMake, type PaymentToMake } from './paymentsOut.ts'
import { toStatementLine, type AllocationKind, type Candidate, type StatementLine } from './bankLineAllocation'

/**
 * ALLOCATING TRUST STATEMENT LINES, THE CALLS (prompt 12). The rules are in bankLineAllocation.ts
 * and, decisively, in allocate_bank_line -- the only thing that writes a line's allocation or the
 * ledger entry behind it, and it asks finance.view itself.
 */

/** Every line that moved money and is not yet accounted for. Empty for anybody without the trust tick. */
export async function fetchLinesToAllocate(): Promise<StatementLine[]> {
  const { data, error } = await supabase.rpc('bank_lines_to_allocate')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map(toStatementLine)
}

export async function fetchAllocationCandidates(): Promise<Candidate[]> {
  const { data, error } = await supabase.rpc('bank_allocation_candidates')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    kind: r.kind as Candidate['kind'],
    id: String(r.id),
    amount: Number(r.amount),
    label: String(r.label ?? ''),
    reference: r.reference === null || r.reference === undefined ? null : String(r.reference),
  }))
}

/** Every payment still to be made out of trust: approved runs and refunds due (payments_to_make). */
export async function fetchPaymentsToMake(): Promise<PaymentToMake[]> {
  const { data, error } = await supabase.rpc('payments_to_make')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map(toPaymentToMake)
}

export async function allocateBankLine(
  lineId: string, kind: AllocationKind, reason: string | null, targetId: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('allocate_bank_line', {
    p_line: lineId, p_kind: kind, p_reason: reason || null, p_target: targetId,
  })
  if (error) throw new Error(error.message)
}
