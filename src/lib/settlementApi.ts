import { supabase } from './supabase'
import { toSettlement, type Settlement } from './settlement'

/**
 * A SETTLEMENT, THE CALLS. The rules are in settlement.ts and, decisively, in the database:
 * account_settlements has no write policy, so each of these is the only door to what it does,
 * and each asks the tick itself.
 */

/** The live offer on the account, or the newest closed one, or null. */
export async function fetchSettlement(accountId: string): Promise<Settlement | null> {
  const { data, error } = await supabase.rpc('account_settlement', { p_account: accountId })
  if (error) throw new Error(error.message)
  const row = (data as Record<string, unknown>[] | null)?.[0]
  return row ? toSettlement(row) : null
}

/** Put the debtor's offer up. `balance` is the balance the saving is measured from, today. */
export async function proposeSettlement(
  accountId: string, amount: number, balance: number, note?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('propose_settlement', {
    p_account: accountId, p_amount: amount, p_balance: balance, p_note: note ?? null,
  })
  if (error) throw new Error(error.message)
  return String(data)
}

/** Record the client's yes -- also how an expiry is extended or the figure changed. */
export async function approveSettlement(
  id: string, expiresOn: string, evidence: string, amount?: number,
): Promise<void> {
  const { error } = await supabase.rpc('approve_settlement', {
    p_id: id, p_expires_on: expiresOn, p_evidence: evidence, p_amount: amount ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function closeSettlementOffer(
  id: string, as: 'declined' | 'withdrawn', reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('close_settlement_offer', { p_id: id, p_as: as, p_reason: reason })
  if (error) throw new Error(error.message)
}

/** A person confirming it was paid in full: closes the account as settled. */
export async function closeAsSettled(id: string): Promise<void> {
  const { error } = await supabase.rpc('close_as_settled', { p_id: id })
  if (error) throw new Error(error.message)
}
