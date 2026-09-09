/**
 * Raising a fee against an account.
 *
 * The one place in the app that writes to the fee ledger, and deliberately narrow. accountBook.ts
 * is read-only because a balance assembled by several hands is a balance nobody can defend; this
 * exists so that when the app does have to charge something, the Annexure B arithmetic lives in
 * exactly one function rather than at every call site that fancies raising a fee.
 *
 * Two caps apply to every charge, and both are the gazette's, not ours:
 *
 *   The item's own limit. Item 3 reads "Other necessary expenses not specifically provided for,
 *   **a total amount of**: R25,00" — one R25 for the account, however many sundry expenses it
 *   accumulates. The second query on an account therefore charges nothing under item 3.
 *
 *   The items 1–7 ceiling: the capital, or R1,225, whichever is less. Past it the work continues
 *   and the money stops.
 *
 * A charge that comes out at zero is still recorded, as an unbilled row. What was done is history
 * whether or not it earned anything, and an account that shows no trace of the work is an account
 * nobody can prove was worked.
 */
import { supabase } from './supabase'
import { itemTotalRemaining, recoverableFee, roundToCents, scheduleFor } from './annexureB'

export interface ChargeResult {
  /** Excluding VAT. Zero where a cap left no room. */
  exclVat: number
  vat: number
  /** Why nothing was charged, for showing to the person who did the work. */
  reason: 'charged' | 'item-total-spent' | 'at-ceiling'
}

const VAT_RATE = 0.15

/**
 * Charge an Annexure B item to an account, respecting both caps.
 *
 * Reads the fee ledger first: the item's own spend and the account's total towards the ceiling
 * are both facts about what has already happened, and computing them from anything other than
 * the ledger would be guessing.
 */
export async function chargeItem(input: {
  accountId: string
  /** Annexure B item id, e.g. '3'. */
  itemId: string
  /** Our action catalogue code, for the timeline's icon and for reconciliation. */
  actionCode: string
  description: string
  createdBy?: string | null
  /** Defaults to now. Passed in by tests. */
  at?: Date
}): Promise<ChargeResult> {
  const at = input.at ?? new Date()
  const schedule = scheduleFor(at)

  const [account, fees] = await Promise.all([
    supabase.from('debtor_accounts').select('capital_handed_over').eq('id', input.accountId).maybeSingle(),
    supabase.from('account_fees')
      .select('amount_excl_vat, annexure_item, counts_toward_fee_cap, billed')
      .eq('account_id', input.accountId),
  ])
  if (account.error) throw new Error(account.error.message)
  if (fees.error) throw new Error(fees.error.message)

  const rows = fees.data ?? []
  const spentOnItem = rows
    .filter((f) => f.annexure_item === input.itemId && f.billed)
    .reduce((t, f) => t + Number(f.amount_excl_vat ?? 0), 0)
  const towardsCeiling = rows
    .filter((f) => f.counts_toward_fee_cap && f.billed)
    .reduce((t, f) => t + Number(f.amount_excl_vat ?? 0), 0)

  const capital = Number(account.data?.capital_handed_over ?? 0)
  const remainingOnItem = itemTotalRemaining(input.itemId, spentOnItem, schedule)
  const recoverable = recoverableFee(remainingOnItem, towardsCeiling, capital, schedule)

  const exclVat = roundToCents(recoverable)
  const vat = roundToCents(exclVat * VAT_RATE)
  const reason: ChargeResult['reason'] =
    exclVat > 0 ? 'charged'
      : remainingOnItem <= 0 ? 'item-total-spent'
        : 'at-ceiling'

  const { error } = await supabase.from('account_fees').insert({
    account_id: input.accountId,
    annexure_item: input.itemId,
    tariff_effective_from: schedule.effectiveFrom,
    action_code: input.actionCode,
    description: input.description,
    amount_excl_vat: exclVat,
    vat_rate: VAT_RATE * 100,
    vat_amount: vat,
    counts_toward_fee_cap: true,
    // False where a cap left nothing: the action happened, it just earned nothing. The balance
    // engine already excludes unbilled rows, and the timeline already draws them as "not charged".
    billed: exclVat > 0,
    incurred_at: at.toISOString(),
    source: 'raptor',
    created_by: input.createdBy ?? null,
  })
  if (error) throw new Error(error.message)

  return { exclVat, vat, reason }
}

/** What the person who did the work should be told about what it earned. */
export function chargeMessage(r: ChargeResult): string {
  if (r.reason === 'charged') {
    return `Charged R${r.exclVat.toFixed(2)} plus VAT under Annexure B item 3.`
  }
  if (r.reason === 'item-total-spent') {
    return 'No charge: item 3 is a total for the account and it has already been used.'
  }
  return 'No charge: the account is at the Annexure B fee ceiling.'
}
