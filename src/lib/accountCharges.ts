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
 *   The item's monthly allowance. A credit bureau search is "R16,00" with a maximum of four a
 *   month; the fifth in a month earns nothing. Unlike item 3 this comes back next month, so it
 *   is counted per calendar month rather than for the life of the account.
 *
 * A charge that comes out at zero is still recorded, as an unbilled row. What was done is history
 * whether or not it earned anything, and an account that shows no trace of the work is an account
 * nobody can prove was worked.
 */
import { supabase } from './supabase'
import { itemAmountFor, itemTotalRemaining, monthlyLimit, monthlyRoom, recoverableFee, roundToCents, scheduleFor } from './annexureB'

export interface ChargeResult {
  /** Excluding VAT. Zero where a cap left no room. */
  exclVat: number
  vat: number
  /** Why nothing was charged, for showing to the person who did the work. */
  reason: 'charged' | 'item-total-spent' | 'monthly-limit' | 'at-ceiling'
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
  /**
   * How many units of the item this one charge covers — four bureau searches on an account with
   * a company and three sureties. One row at four times the rate, not four rows: a statement is
   * read by a debtor, and four identical lines is arithmetic homework.
   */
  quantity?: number
  /** Defaults to now. Passed in by tests. */
  at?: Date
}): Promise<ChargeResult> {
  const at = input.at ?? new Date()
  const schedule = scheduleFor(at)

  /*
   * One request, and it returns three numbers rather than a ledger.
   *
   * This used to select every fee row on the account to add up two of its columns — up to 822
   * rows and half a megabyte of JSON on the busiest account, fetched from Paris, to compute two
   * sums Postgres can do in microseconds. The database is where you add up rows.
   */
  const { data, error: basisError } = await supabase
    .rpc('account_charge_basis', { p_account_id: input.accountId, p_item: input.itemId })
    .single<{ capital: number; spent_on_item: number; towards_ceiling: number }>()
  if (basisError) throw new Error(basisError.message)

  const capital = Number(data?.capital ?? 0)
  const spentOnItem = Number(data?.spent_on_item ?? 0)
  const towardsCeiling = Number(data?.towards_ceiling ?? 0)

  const quantity = Math.max(1, Math.floor(input.quantity ?? 1))
  const remainingOnItem = itemTotalRemaining(input.itemId, spentOnItem, schedule)
  const asked = itemAmountFor(input.itemId, quantity, spentOnItem, schedule)

  /*
   * The monthly allowance, for the two items that have one.
   *
   * Only charges that EARNED something count against it: a search recorded at zero took nothing
   * from the debtor, so it cannot be the reason the next one goes unrecovered. Costs an extra
   * count request, and only on the items where the gazette actually imposes a limit.
   */
  const limit = monthlyLimit(input.itemId, schedule)
  let room = Infinity
  if (limit !== null) {
    const monthStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
    const nextMonth = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))
    const { count, error: countError } = await supabase
      .from('account_fees')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', input.accountId)
      .eq('annexure_item', input.itemId)
      .eq('billed', true)
      .gte('incurred_at', monthStart.toISOString())
      .lt('incurred_at', nextMonth.toISOString())
    if (countError) throw new Error(countError.message)
    room = monthlyRoom(limit, count ?? 0)
  }

  const recoverable = room > 0 ? recoverableFee(asked, towardsCeiling, capital, schedule) : 0

  const exclVat = roundToCents(recoverable)
  const vat = roundToCents(exclVat * VAT_RATE)
  const reason: ChargeResult['reason'] =
    exclVat > 0 ? 'charged'
      : room <= 0 ? 'monthly-limit'
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
    // The unit count this row stands for. Named for SMS, which needed it first; it means the
    // same thing here — how many of the item one line covers.
    segments: quantity,
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
export function chargeMessage(r: ChargeResult, itemId: string): string {
  if (r.reason === 'charged') {
    return `Charged R${r.exclVat.toFixed(2)} plus VAT under Annexure B item ${itemId}.`
  }
  if (r.reason === 'item-total-spent') {
    return `No charge: item ${itemId} is a total for the account and it has already been used.`
  }
  if (r.reason === 'monthly-limit') {
    return `No charge: item ${itemId} has already been charged its maximum for this month. It is recorded, and the allowance resets next month.`
  }
  return 'No charge: the account is at the Annexure B fee ceiling.'
}
