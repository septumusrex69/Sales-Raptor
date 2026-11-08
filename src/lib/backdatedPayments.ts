/**
 * PAYMENTS FOUND LATE: THE CONTROL LIST AND ITS CORRECTIONS (Raptor H19 / S20, phases 1b-3; Stephan, 8 Nov: "build
 * it, Camille can approve the corrections"). The rules and the worked example are the Claude Doc "Payments found
 * late"; the database does every sum (restatement_compute -> restatement_figures), and this file only reads,
 * proposes, approves and cancels -- plus `correctionOf`, the browser's copy of how one payment's correction is read
 * off its old and new split, which check-backdated-payments holds to the doc's figures to the cent.
 *
 *   backdated_payments()               every payment a later-dated payment on its account was split before
 *   backdated_payment_restatements()   the corrections proposed, posted or cancelled for them
 *   propose_restatement / approve_restatement / cancel_restatement
 *
 * NOTHING PAID OVER IS EDITED: a posted correction is an R0.00 correction receipt whose split is the difference,
 * riding the next open payover run as its own line, dated the day it was approved.
 */
import { supabase } from './supabase'
import type { BackdatedPayment, Restatement, RestatementFigures } from './restatement.ts'
export { correctionOf, latestByPayment } from './restatement.ts'
export type { BackdatedPayment, Restatement, RestatementFigures, RestatementLine, SplitFigures } from './restatement.ts'

const n = (v: unknown) => Number(v ?? 0)
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))

export async function fetchBackdatedPayments(): Promise<BackdatedPayment[]> {
  const { data, error } = await supabase.rpc('backdated_payments')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    paymentId: String(r.payment_id), accountId: String(r.account_id), caseNumber: s(r.case_number), debtor: s(r.debtor),
    client: s(r.client), receivedOn: String(r.received_on), capturedOn: s(r.captured_on), approvedOn: s(r.approved_on),
    amount: n(r.amount), paidToClient: !!r.paid_to_client, capturedBy: s(r.captured_by),
    laterAllocated: n(r.later_allocated), laterInvoiced: n(r.later_invoiced),
  }))
}

export async function fetchRestatements(): Promise<Restatement[]> {
  const { data, error } = await supabase.rpc('backdated_payment_restatements')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id), paymentId: String(r.payment_id), accountId: String(r.account_id),
    status: String(r.status) as Restatement['status'], blockedReason: s(r.blocked_reason),
    figures: r.figures as RestatementFigures,
    clientCorrection: n(r.client_correction), firmCorrection: n(r.firm_correction), interestCorrection: n(r.interest_correction),
    proposedAt: String(r.proposed_at), proposedByName: s(r.proposed_by_name),
    postedAt: s(r.posted_at), postedByName: s(r.posted_by_name),
    cancelledAt: s(r.cancelled_at), cancelReason: s(r.cancel_reason),
  }))
}

export async function proposeRestatement(paymentId: string, note: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('propose_restatement', { p_payment: paymentId, p_note: note })
  if (error) throw new Error(error.message)
  return String(data)
}

export async function approveRestatement(id: string): Promise<void> {
  const { error } = await supabase.rpc('approve_restatement', { p_id: id })
  if (error) throw new Error(error.message)
}

export async function cancelRestatement(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_restatement', { p_id: id, p_reason: reason })
  if (error) throw new Error(error.message)
}

