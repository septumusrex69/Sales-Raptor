import { supabase } from './supabase'

/**
 * A CLIENT PAYS WHAT IT OWES INTO THE BUSINESS ACCOUNT, MATCHED TO ITS PAYOVER (the firm, 10 Oct:
 * "that's paid to our business account, not to the trust account. So we would have to match it").
 *
 * A run below nil is the client owing the firm. Recording their payment settles that run: it is not
 * carried into the next payover (or is taken back out of one still being checked), it leaves "What
 * clients owe us, by age", and the client's ledger shows it. The whole amount only, for now -- see
 * record_client_business_receipt for why a part payment is refused rather than guessed at.
 */
export interface ClientBusinessReceipt {
  id: string
  runId: string
  amount: number
  receivedOn: string
  reference: string
  note: string | null
}

export async function recordClientPayment(input: {
  runId: string; amount: number; receivedOn: string; reference: string; note?: string | null
}): Promise<string> {
  const { data, error } = await supabase.rpc('record_client_business_receipt', {
    p_run: input.runId, p_amount: input.amount, p_received_on: input.receivedOn,
    p_reference: input.reference, p_note: input.note ?? null,
  })
  if (error) throw new Error(error.message)
  return String(data)
}

export async function fetchReceiptForRun(runId: string): Promise<ClientBusinessReceipt | null> {
  const { data, error } = await supabase.from('client_business_receipts')
    .select('id, payover_run_id, amount, received_on, reference, note').eq('payover_run_id', runId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Record<string, unknown>
  return {
    id: String(r.id), runId: String(r.payover_run_id), amount: Number(r.amount),
    receivedOn: String(r.received_on), reference: String(r.reference), note: (r.note as string | null) ?? null,
  }
}

/** The runs below nil the client has paid into the business account -- for the runs list's words. */
export async function fetchSettledRunIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from('payover_runs')
    .select('id').not('settled_direct_receipt_id', 'is', null)
  if (error) throw new Error(error.message)
  return new Set(((data ?? []) as { id: string }[]).map((r) => r.id))
}
