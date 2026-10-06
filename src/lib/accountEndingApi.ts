import { supabase } from './supabase'
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
