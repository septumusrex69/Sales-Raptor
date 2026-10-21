import { supabase } from './supabase'
import { referenceIn, toPaidOut, toPaymentToMake, type PaidOut, type PaymentToMake } from './paymentsOut.ts'
import { lineNature, toStatementLine, type AllocationKind, type Candidate, type StatementLine } from './bankLineAllocation'
import type { SwordfishKind } from './swordfishHolding.ts'

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

/**
 * A DEBIT OFF HELD FOR SWORDFISH PAYOVERS (S10). No ledger entry: the money leaves the bucket, not
 * anybody's ledger. Refused in the database for a credit, a line on or before the trust opening, or more
 * than is left. Returns what is left.
 */
export async function allocateSwordfishLine(lineId: string, kind: SwordfishKind, note: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('allocate_swordfish_line', { p_line: lineId, p_kind: kind, p_note: note || null })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
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

/**
 * INTEREST AND BANK CHARGES BOOK THEMSELVES ON IMPORT (the firm, 13 Oct: "By default credit interest
 * is interest. Should be allocated as interest"). Only where the bank's own words say so
 * (`lineNature`): CREDIT INTEREST in, ##BANK CHARGE / ##SERVICE FEE out. Each still goes through
 * allocate_bank_line, the one thing that writes an allocation, so it is the same entry a person
 * pressing the button would have made. One that fails is left for Exceptions.
 */
export async function bookObviousLines(): Promise<{ interest: number; charges: number; drawings: number }> {
  const lines = await fetchLinesToAllocate()
  let interest = 0; let charges = 0; let drawings = 0
  /*
   * AND THE FIRM'S DRAWING BY ITS REFERENCE (prompt 12 B3): a debit naming BF FEES-YYMM at exactly the
   * amount of a transfer already recorded is that transfer, the same way BF PO- references match
   * payovers. Exactly one candidate, or it is left for Exceptions ("Already recorded: ...").
   */
  const drawingsOpen = (await fetchAllocationCandidates().catch(() => [] as Candidate[])).filter((c) => c.kind === 'business_transfer')
  const usedDrawings = new Set<string>()
  for (const l of lines) {
    const n = lineNature(l.description, l.direction)
    try {
      if (n === 'bank_interest' || n === 'bank_charge') {
        await allocateBankLine(l.id, n, null, null)
        if (n === 'bank_interest') interest += 1; else charges += 1
        continue
      }
      if (l.direction === 'debit' && /BF\s*FEES/i.test(l.description ?? '')) {
        const cents = Math.round(-l.amount * 100)
        const match = drawingsOpen.filter((c) => !usedDrawings.has(c.id) && Math.round(c.amount * 100) === cents
          && (!c.reference || referenceIn(l.description, c.reference)))
        if (match.length === 1) {
          await allocateBankLine(l.id, 'business_transfer', null, match[0].id)
          usedDrawings.add(match[0].id)
          drawings += 1
        }
      }
    } catch { /* left for a person */ }
  }
  return { interest, charges, drawings }
}

/** A receipt that may be the one a returned debit took back (bounced_receipt_candidates). */
export interface BouncedCandidate {
  paymentId: string; accountId: string; accountNumber: string; caseNumber: string | null; debtor: string | null
  receivedOn: string; amount: number; reference: string | null
  /** The bank's description quotes this account's number: the likely one, offered first. */
  named: boolean
}

export async function fetchBouncedCandidates(lineId: string): Promise<BouncedCandidate[]> {
  const { data, error } = await supabase.rpc('bounced_receipt_candidates', { p_line: lineId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    paymentId: String(r.payment_id), accountId: String(r.account_id), accountNumber: String(r.account_number ?? ''),
    caseNumber: (r.case_number as string | null) ?? null, debtor: (r.debtor as string | null) ?? null,
    receivedOn: String(r.received_on), amount: Number(r.amount), reference: (r.reference as string | null) ?? null,
    named: !!r.named,
  }))
}

/**
 * A RECEIPT THE BANK RETURNED UNPAID (prompt 12): reverses it and closes both statement lines against
 * each other, in one transaction (return_bounced_receipt). Never called without a person choosing
 * the receipt -- the pair is suggested, never made silently.
 */
export async function returnBouncedReceipt(lineId: string, paymentId: string): Promise<void> {
  const { error } = await supabase.rpc('return_bounced_receipt', { p_line: lineId, p_payment: paymentId })
  if (error) throw new Error(error.message)
}

/** Every payment waiting to leave trust, with the banking the bank file needs (payments_out_list). */
export async function fetchPaymentsOutList(): Promise<import('./bankFile').OutgoingPayment[]> {
  const { data, error } = await supabase.rpc('payments_out_list')
  if (error) throw new Error(error.message)
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    kind: r.kind as 'payover' | 'refund' | 'drawing', id: String(r.id), payee: String(r.payee ?? ''),
    amount: Number(r.amount ?? 0), reference: s(r.reference), status: String(r.status ?? ''), dueOn: s(r.due_on),
    holder: s(r.holder), bank: s(r.bank), branch: s(r.branch), accountNo: s(r.account_no),
    companyId: s(r.company_id), accountId: s(r.account_id), caseNumber: s(r.case_number),
  }))
}

/** The banking a payover (on the client) or a refund (on the refund) is paid to. */
export async function setPaymentBanking(kind: 'payover' | 'refund', id: string, holder: string, bank: string, branch: string, account: string): Promise<void> {
  const { error } = await supabase.rpc('set_payment_banking', {
    p_kind: kind, p_id: id, p_holder: holder, p_bank: bank, p_branch: branch, p_account: account,
  })
  if (error) throw new Error(error.message)
}
