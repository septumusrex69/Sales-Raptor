import { supabase } from './supabase'
import { toPaidOut, toPaymentToMake, type PaidOut, type PaymentToMake } from './paymentsOut.ts'
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

/** What has gone out of trust: everything not yet on the statement, and what was confirmed since `since`. */
export async function fetchPaymentsOutPaid(since: string): Promise<PaidOut[]> {
  const { data, error } = await supabase.rpc('payments_out_paid', { p_since: since })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map(toPaidOut)
}

/** A refund paid at the bank, recorded by hand; the statement line confirms it later. */
export async function markRefundPaid(refundId: string, reference: string, paidAt: string): Promise<void> {
  const { error } = await supabase.rpc('mark_refund_paid', { p_refund: refundId, p_reference: reference, p_paid_at: paidAt })
  if (error) throw new Error(error.message)
}

/** What matching payovers by their BF PO- reference did (match_payovers_by_reference). */
export interface ReferenceMatch { matched: number; differs: number; notes: string[] }

/**
 * MATCH EVERY UNALLOCATED DEBIT THAT NAMES A PAYOVER RUN, BY ITS REFERENCE FIRST (the firm, 10 Oct).
 * Only where the amount is the run's to the cent; anything else is reported and left for a person.
 */
export async function matchPayoversByReference(): Promise<ReferenceMatch> {
  const { data, error } = await supabase.rpc('match_payovers_by_reference')
  if (error) throw new Error(error.message)
  const r = ((Array.isArray(data) ? data[0] : data) ?? {}) as { matched?: number; differs?: number; notes?: string[] }
  return { matched: Number(r.matched ?? 0), differs: Number(r.differs ?? 0), notes: r.notes ?? [] }
}
