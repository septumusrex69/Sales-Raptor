import type { StatusChange } from './accountTimeline'
import { supabase } from './supabase'
import { firmDay } from './dateLabels'
import type { WithdrawalCharge } from './accountEnding'

/**
 * ENDING AN ACCOUNT, THE CALLS.
 *
 * Kept apart from accountEnding.ts, which holds the rules. This file imports the Supabase client
 * and so cannot be imported by a QA check -- the same split emailStyle.ts has from firmSettings.ts,
 * and for the same reason: the arithmetic has to be assertable, and a network call never is.
 *
 * NOTHING HERE DECIDES ANYTHING. Each function hands the database what the screen collected; the
 * database works the charge out again from its own copy of the basis, which is what stops the
 * preview and the invoice ever differing.
 */

export async function fetchWithdrawalBasis(accountId: string) {
  const { data, error } = await supabase.rpc('withdrawal_basis', { p_account: accountId })
  if (error) throw new Error(error.message)
  const row = (data as Record<string, unknown>[] | null)?.[0]
  if (!row) return null
  const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
  return {
    fees: n(row.fees),
    interest: n(row.interest),
    commission: n(row.commission),
    vatRate: n(row.vat_rate),
    capital: n(row.capital),
    commissionRate: n(row.commission_rate),
  }
}

export async function withdrawAccount(
  accountId: string, reason: string, charge: WithdrawalCharge, note?: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('withdraw_account', {
    p_account: accountId,
    p_reason: reason,
    p_fees: charge.fees,
    p_interest: charge.interest,
    p_commission: charge.commission,
    p_amount: charge.amount ?? null,
    p_note: note ?? null,
  })
  if (error) throw new Error(error.message)
  return (data as string | null) ?? null
}

export async function settleAccount(
  accountId: string, as: 'paid_up' | 'settled' | 'written_off', reason: string, note?: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('settle_account', {
    p_account: accountId, p_as: as, p_reason: reason, p_note: note ?? null,
  })
  if (error) throw new Error(error.message)
  return (data as string | null) ?? null
}

/* ------------------------------------ the history of it ------------------------------------ */

/**
 * EVERY CLOSE, HOLD AND RE-OPEN, FOR THE TIMELINE (prompt 11). account_status_events records the
 * change of book with who and why; the ending's own word (withdrawn, settled...) is on the account
 * for its current close, and a charge raised that day on the account is the withdrawal fee.
 */
export async function fetchStatusChanges(accountId: string): Promise<StatusChange[]> {
  const [{ data: ev }, { data: acct }, { data: charges }] = await Promise.all([
    supabase.from('account_status_events')
      .select('id, changed_at, changed_by, from_book, to_book, note')
      .eq('account_id', accountId).order('changed_at'),
    supabase.from('debtor_accounts').select('ended_as, ended_at, ended_reason').eq('id', accountId).maybeSingle(),
    supabase.from('client_charges')
      .select('amount, vat, settlement, raised_on, created_at, cancelled_at').eq('account_id', accountId),
  ])
  const rows = ((ev ?? []) as { id: string; changed_at: string; changed_by: string | null; from_book: string | null; to_book: string | null; note: string | null }[])
    .filter((e) => e.from_book !== e.to_book && e.from_book !== null)
  const ids = [...new Set(rows.map((r) => r.changed_by).filter(Boolean))] as string[]
  const { data: people } = ids.length ? await supabase.from('profiles').select('id, name').in('id', ids) : { data: [] }
  const nameOf = new Map(((people ?? []) as { id: string; name: string | null }[]).map((p) => [p.id, p.name ?? null]))
  const a = acct as { ended_as: string | null; ended_at: string | null; ended_reason: string | null } | null
  const live = ((charges ?? []) as { amount: number; vat: number; settlement: string; created_at: string; cancelled_at: string | null }[])
    .filter((c) => !c.cancelled_at)
  /* The last close is the account's current ending; an earlier one closed and was re-opened since. */
  const lastClose = [...rows].reverse().find((r) => r.to_book === 'closed')
  return rows.map((r) => {
    const charge = r.to_book === 'closed'
      ? live.find((c) => Math.abs(new Date(c.created_at).getTime() - new Date(r.changed_at).getTime()) < 5 * 60_000) ?? null
      : null
    return {
      id: r.id, at: r.changed_at, fromBook: r.from_book, toBook: r.to_book,
      endedAs: r === lastClose ? a?.ended_as ?? null : null,
      reason: r.note ?? (r === lastClose ? a?.ended_reason ?? null : null),
      by: r.changed_by ? nameOf.get(r.changed_by) ?? null : null,
      charge: charge ? { total: Math.round((Number(charge.amount) + Number(charge.vat)) * 100) / 100, settlement: charge.settlement } : null,
    }
  })
}

/* ------------------------------ payments on a withdrawn account ------------------------------ */

/**
 * THE PAYMENTS ALREADY ON AN ACCOUNT BEING WITHDRAWN (prompt 11; the firm: "it should ask what to do
 * with the payment ... by default, keep it on the account"). Each with the run that carried it and
 * what the client was paid from it, so the box can say what a refund would cost the client.
 */
export interface ReceiptOnFile {
  id: string
  receivedOn: string
  amount: number
  paidToClient: boolean
  swordfish: boolean
  runInvoice: string | null
  runStatus: string | null
  /**
   * Whether it is on a payover run at all. Only an Administrator may read the run itself
   * (payover_runs), and since S15 the client's liaison may withdraw too -- without this, a receipt
   * paid over last month would read "Not on a run yet" to them.
   */
  onRun: boolean
  /** What the client was paid from it: owed back if refunded after its run went out. */
  toClient: number
}

export async function fetchReceiptsOnFile(accountId: string): Promise<ReceiptOnFile[]> {
  const { data, error } = await supabase.from('account_payments')
    .select('id, received_at, amount, paid_to_client, paid_over_in_swordfish, approved_at, reversed_at, rejected_at, is_demo')
    .eq('account_id', accountId).not('approved_at', 'is', null).is('reversed_at', null).is('rejected_at', null)
    .order('received_at')
  if (error) throw new Error(error.message)
  const rows = ((data ?? []) as { id: string; received_at: string; amount: number; paid_to_client: boolean; paid_over_in_swordfish: boolean; is_demo: boolean }[])
    .filter((r) => !r.is_demo)
  if (rows.length === 0) return []
  const { data: al } = await supabase.from('payment_allocations')
    .select('payment_id, to_client, payover_run_id').in('payment_id', rows.map((r) => r.id)).neq('status', 'reversed')
  const alloc = new Map(((al ?? []) as { payment_id: string; to_client: number | null; payover_run_id: string | null }[]).map((a) => [a.payment_id, a]))
  const runIds = [...new Set([...alloc.values()].map((a) => a.payover_run_id).filter(Boolean))] as string[]
  const { data: rs } = runIds.length ? await supabase.from('payover_runs').select('id, invoice_number, status').in('id', runIds) : { data: [] }
  const run = new Map(((rs ?? []) as { id: string; invoice_number: string; status: string }[]).map((r) => [r.id, r]))
  return rows.map((r) => {
    const a = alloc.get(r.id)
    const ru = a?.payover_run_id ? run.get(a.payover_run_id) : undefined
    return {
      id: r.id, receivedOn: firmDay(r.received_at), amount: Number(r.amount), paidToClient: !!r.paid_to_client,
      swordfish: !!r.paid_over_in_swordfish, runInvoice: ru?.invoice_number ?? null, runStatus: ru?.status ?? null,
      onRun: !!a?.payover_run_id,
      toClient: Number(a?.to_client ?? 0),
    }
  })
}

/**
 * WITHDRAW, REFUNDING THE CHOSEN RECEIPTS TO THE DEBTOR, in one transaction: reversed, held as the
 * debtor's credit and decided as a refund -- see withdraw_account_refunding.
 */
export async function withdrawAccountRefunding(
  accountId: string, reason: string, charge: WithdrawalCharge, note: string | undefined,
  refund: string[], payableTo: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('withdraw_account_refunding', {
    p_account: accountId, p_reason: reason,
    p_fees: charge.fees, p_interest: charge.interest, p_commission: charge.commission,
    p_amount: charge.amount ?? null, p_note: note ?? null,
    p_refund: refund, p_payable_to: payableTo,
  })
  if (error) throw new Error(error.message)
  return (data as string | null) ?? null
}
