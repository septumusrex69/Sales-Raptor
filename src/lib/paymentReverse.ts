import { supabase } from './supabase'
import { firmDay } from './dateLabels'
import { reversalFates } from './accountBook'

/**
 * EVERYTHING THE REVERSE BOX NEEDS ABOUT ONE PAYMENT, READ BY ITS ID (prompt 11).
 *
 * The box is opened from three screens now -- History, the account, a payover run -- and each holds
 * a different shape of row. Reading the payment here rather than threading three shapes through
 * means the box says the same thing whichever door it was opened from: whether it came off the
 * statement (so it can go back to Needs an account, and cannot become a PTC), whether a run has
 * already carried it (the amber note), and whether it can be reversed at all.
 */
export interface ReverseTarget {
  paymentId: string
  accountId: string
  amount: number
  receivedOn: string
  paidToClient: boolean
  fromStatement: boolean
  swordfish: boolean
  approved: boolean
  reversedOn: string | null
  /** The run that carried it, if any, and where that run stands. */
  runInvoice: string | null
  runStatus: string | null
}

export async function fetchReverseTarget(paymentId: string): Promise<ReverseTarget> {
  const { data, error } = await supabase.from('account_payments')
    .select('id, account_id, amount, received_at, paid_to_client, bank_line_id, paid_over_in_swordfish, approved_at, reversed_at')
    .eq('id', paymentId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('That payment is no longer here.')
  const p = data as {
    id: string; account_id: string; amount: number; received_at: string; paid_to_client: boolean
    bank_line_id: string | null; paid_over_in_swordfish: boolean; approved_at: string | null; reversed_at: string | null
  }
  /* A receipt can sit on a statement line that points at it rather than the other way round. */
  let fromStatement = !!p.bank_line_id
  if (!fromStatement) {
    const { data: l } = await supabase.from('bank_statement_lines').select('id').eq('payment_id', paymentId).limit(1)
    fromStatement = (l ?? []).length > 0
  }
  const { data: al } = await supabase.from('payment_allocations')
    .select('payover_run_id').eq('payment_id', paymentId).neq('status', 'reversed').limit(1)
  const runId = ((al ?? []) as { payover_run_id: string | null }[])[0]?.payover_run_id ?? null
  let runInvoice: string | null = null
  let runStatus: string | null = null
  if (runId) {
    const { data: r } = await supabase.from('payover_runs').select('invoice_number, status').eq('id', runId).maybeSingle()
    runInvoice = (r as { invoice_number?: string } | null)?.invoice_number ?? null
    runStatus = (r as { status?: string } | null)?.status ?? null
  }
  return {
    paymentId: p.id, accountId: p.account_id, amount: Number(p.amount), receivedOn: firmDay(String(p.received_at)),
    paidToClient: !!p.paid_to_client, fromStatement, swordfish: !!p.paid_over_in_swordfish,
    approved: !!p.approved_at, reversedOn: p.reversed_at, runInvoice, runStatus,
  }
}

/**
 * REVERSED AND CAPTURED ON THE OTHER SIDE (the firm, 11 Oct: "from a PTC to an ACB or an ACB to a
 * PTC"). The copy waits in the approval queue as the other kind; a receipt off the statement cannot
 * become a PTC, and the database says so.
 */
export async function reverseSwitchingSide(paymentId: string, reason: string, toPtc: boolean): Promise<void> {
  const { error } = await supabase.rpc('reverse_payment_switching_side', {
    p_payment: paymentId, p_reason: reason, p_paid_to_client: toPtc,
  })
  if (error) throw new Error(error.message)
}

/** The account's own payments, newest first, for the Reverse action on the account page. */
export interface AccountPaymentRow {
  id: string
  receivedOn: string
  amount: number
  paidToClient: boolean
  reference: string | null
  approved: boolean
  reversedOn: string | null
  reversalReason: string | null
  /** Where a reversed one went: "placed on MPG/3003", "back in the approval queue"... */
  reversedTo: string | null
  swordfish: boolean
}

export async function fetchAccountPayments(accountId: string): Promise<AccountPaymentRow[]> {
  const { data, error } = await supabase.from('account_payments')
    .select('id, received_at, amount, paid_to_client, reference, approved_at, reversed_at, reversal_reason, paid_over_in_swordfish, rejected_at, is_demo')
    .eq('account_id', accountId).is('rejected_at', null).order('received_at', { ascending: false }).limit(500)
  if (error) throw new Error(error.message)
  const rows = ((data ?? []) as Record<string, unknown>[]).filter((r) => !r.is_demo)
  const fates = await reversalFates(rows.filter((r) => r.reversed_at).map((r) => String(r.id))).catch(() => new Map<string, string>())
  return rows.map((r) => ({
    /* THE JOHANNESBURG DAY: 00:00 on 3 Jul is stored as 22:00 on the 2nd (prompt 11). */
    id: String(r.id), receivedOn: firmDay(String(r.received_at)), amount: Number(r.amount ?? 0),
    paidToClient: !!r.paid_to_client, reference: (r.reference as string | null) ?? null,
    approved: !!r.approved_at, reversedOn: (r.reversed_at as string | null) ?? null,
    reversalReason: (r.reversal_reason as string | null) ?? null,
    reversedTo: fates.get(String(r.id)) ?? null, swordfish: !!r.paid_over_in_swordfish,
  }))
}

/** The client's own reference for each account, which posted payments do not carry. */
export async function fetchClientReferences(accountIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = [...new Set(accountIds)]
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabase.from('debtor_accounts').select('id, client_reference').in('id', ids.slice(i, i + 150))
    for (const r of (data ?? []) as { id: string; client_reference: string | null }[]) {
      if (r.client_reference) out.set(r.id, r.client_reference)
    }
  }
  return out
}
