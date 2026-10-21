import { supabase } from './supabase'
import type { Arrangement, ClientReceipt } from './clientArrangement'

/**
 * A CLIENT PAYS AGAINST ITS STATEMENT (S7). The calls; the rules are in record_client_payment.
 *
 * The firm, 12 Oct: "what if the client pays partially? What if he makes an installment arrangement
 * ... shouldn't we just have a statement?" -- approved 13 Oct. A payment into the business account is
 * recorded against the client, any amount up to what they owe, and the database applies it oldest
 * first across the payover shortfall still standing and any unpaid invoice.
 */
export interface OwedItem {
  kind: 'shortfall' | 'invoice'
  id: string
  label: string
  dueOn: string
  owed: number
  paid: number
  remaining: number
}

export async function fetchOwedItems(companyId: string): Promise<OwedItem[]> {
  const { data, error } = await supabase.rpc('client_owed_items', { p_company: companyId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    kind: r.kind as OwedItem['kind'], id: String(r.id), label: String(r.label ?? ''), dueOn: String(r.due_on),
    owed: Number(r.owed), paid: Number(r.paid), remaining: Number(r.remaining),
  }))
}

export async function recordClientPayment(input: {
  companyId: string; amount: number; receivedOn: string; reference: string; note?: string | null
}): Promise<string> {
  const { data, error } = await supabase.rpc('record_client_payment', {
    p_company: input.companyId, p_amount: input.amount, p_received_on: input.receivedOn,
    p_reference: input.reference, p_note: input.note ?? null,
  })
  if (error) throw new Error(error.message)
  return String(data)
}

export async function fetchClientReceipts(companyId: string): Promise<(ClientReceipt & { reference: string })[]> {
  const { data, error } = await supabase.from('client_business_receipts')
    .select('amount, received_on, reference').eq('company_id', companyId).order('received_on')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    amount: Number(r.amount), receivedOn: String(r.received_on), reference: String(r.reference),
  }))
}

/** What has been paid against ONE run, and when -- for the run page. */
export async function fetchClientPaymentsForRun(runId: string): Promise<{ amount: number; receivedOn: string; reference: string }[]> {
  const { data, error } = await supabase.from('client_payment_applications')
    .select('amount, client_business_receipts(received_on, reference)').eq('payover_run_id', runId).order('created_at')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const rc = (Array.isArray(r.client_business_receipts) ? r.client_business_receipts[0] : r.client_business_receipts) as
      { received_on?: string; reference?: string } | null
    return { amount: Number(r.amount), receivedOn: String(rc?.received_on ?? ''), reference: String(rc?.reference ?? '') }
  })
}

export async function fetchArrangement(companyId: string): Promise<Arrangement | null> {
  const { data, error } = await supabase.from('client_payment_arrangements')
    .select('id, instalment, first_due, instalments, created_at, note')
    .eq('company_id', companyId).is('cancelled_at', null).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Record<string, unknown>
  return {
    id: String(r.id), instalment: Number(r.instalment), firstDue: String(r.first_due),
    instalments: Number(r.instalments), createdAt: String(r.created_at), note: (r.note as string | null) ?? null,
  }
}

export async function setArrangement(companyId: string, instalment: number, firstDue: string, instalments: number, note?: string): Promise<void> {
  const { error } = await supabase.rpc('set_client_arrangement', {
    p_company: companyId, p_instalment: instalment, p_first_due: firstDue, p_instalments: instalments, p_note: note ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function cancelArrangement(companyId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_client_arrangement', { p_company: companyId })
  if (error) throw new Error(error.message)
}
