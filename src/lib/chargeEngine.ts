/**
 * Raising a fee against an account — the arithmetic and the writes, with the database handed in.
 *
 * Split out of accountCharges.ts so the same code can run in two places. The browser charges
 * through the anon client when a collector clicks something; the BuzzBox webhook charges through
 * the service-role client when a call connects, with no browser involved at all. A second
 * implementation for the server would be a second set of Annexure B rules to keep in step, and
 * the two would drift the first time a cap changed.
 *
 * So the client is a parameter. accountCharges.ts is the browser's thin wrapper around this, and
 * api/_lib/buzzbox/ passes the admin client. Nothing here imports a Supabase client of its own,
 * which is what lets it load under Node — src/lib/supabase.ts reads import.meta.env and throws
 * outside Vite.
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
/*
 * `.js`, not `.ts`, and this is load-bearing.
 *
 * Vercel does not bundle an API route -- it transpiles each file and ships them, so Node resolves
 * these specifiers at runtime against the EMITTED files. A `./accountStatus.ts` specifier survives
 * into the output and points at a file that no longer exists, and every /api/buzzbox/* route dies
 * with ERR_MODULE_NOT_FOUND. It did, on live, for eleven minutes.
 *
 * `.js` is the specifier TypeScript expects for that emit, and Vite resolves it back to the `.ts`
 * source for the browser build. So it works in both places, which is the whole point of this file.
 *
 * The cost: `node --experimental-strip-types` cannot resolve `.js` to a `.ts` file on disk, so the
 * QA script for this module runs with scripts/qa/tsresolve.mjs, which teaches it to.
 */
import { isWrittenOff } from './accountStatus.js'
import {
  itemAmountFor, itemTotalRemaining, monthlyLimit, monthlyRoom, recoverableFee, roundToCents,
  scheduleFor,
} from './annexureB.js'

export interface ChargeResult {
  /** Excluding VAT. Zero where a cap left no room. */
  exclVat: number
  vat: number
  /** Why nothing was charged, for showing to the person who did the work. */
  reason: 'charged' | 'written-off' | 'item-total-spent' | 'monthly-limit' | 'at-ceiling'
}

export interface ChargeInput {
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
}

/**
 * The little of a Supabase client this needs.
 *
 * Structural rather than importing SupabaseClient, for the same reason the file takes a client at
 * all: the type lives in a package the browser bundle already carries and the point here is not
 * to care which client it is. It also keeps the QA scripts able to pass a fake.
 */
export interface ChargeDb {
  rpc: (fn: string, args: Record<string, unknown>) => {
    single: <T>() => PromiseLike<{ data: T | null; error: { message: string } | null }>
  }
  from: (table: string) => any
}

const VAT_RATE = 0.15

/**
 * Charge an Annexure B item to an account, respecting every cap.
 *
 * Reads the fee ledger first: the item's own spend and the account's total towards the ceiling
 * are both facts about what has already happened, and computing them from anything other than
 * the ledger would be guessing.
 */
export async function chargeItemWith(db: ChargeDb, input: ChargeInput): Promise<ChargeResult> {
  const at = input.at ?? new Date()
  const schedule = scheduleFor(at)

  /*
   * One request, and it returns three numbers rather than a ledger.
   *
   * This used to select every fee row on the account to add up two of its columns — up to 822
   * rows and half a megabyte of JSON on the busiest account, fetched from Paris, to compute two
   * sums Postgres can do in microseconds. The database is where you add up rows.
   */
  const { data, error: basisError } = await db
    .rpc('account_charge_basis', { p_account_id: input.accountId, p_item: input.itemId })
    .single<{ capital: number; spent_on_item: number; towards_ceiling: number }>()
  if (basisError) throw new Error(basisError.message)

  const capital = Number(data?.capital ?? 0)
  const spentOnItem = Number(data?.spent_on_item ?? 0)
  const towardsCeiling = Number(data?.towards_ceiling ?? 0)

  /*
   * A written-off account earns nothing more.
   *
   * The statement drops fees dated after the write-off, so charging one produced money that was
   * recorded, announced to the collector, and then invisible everywhere it mattered. The work is
   * still written down — it happened — it simply cannot be recovered.
   */
  const { data: acct, error: statusError } = await db
    .from('debtor_accounts').select('status').eq('id', input.accountId).maybeSingle()
  if (statusError) throw new Error(statusError.message)
  const closed = isWrittenOff((acct as { status?: string | null } | null)?.status)

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
    const { count, error: countError } = await db
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

  const recoverable = !closed && room > 0 ? recoverableFee(asked, towardsCeiling, capital, schedule) : 0

  const exclVat = roundToCents(recoverable)
  const vat = roundToCents(exclVat * VAT_RATE)
  const reason: ChargeResult['reason'] =
    exclVat > 0 ? 'charged'
      : closed ? 'written-off'
        : room <= 0 ? 'monthly-limit'
          : remainingOnItem <= 0 ? 'item-total-spent'
            : 'at-ceiling'

  const { error } = await db.from('account_fees').insert({
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
  if (r.reason === 'written-off') {
    return 'No charge: the account is written off, so nothing further can be recovered. The action is recorded.'
  }
  if (r.reason === 'monthly-limit') {
    return `No charge: item ${itemId} has already been charged its maximum for this month. It is recorded, and the allowance resets next month.`
  }
  return 'No charge: the account is at the Annexure B fee ceiling.'
}
