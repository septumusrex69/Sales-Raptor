/**
 * THE STORED BALANCE: computeBalance's answer, remembered, so the book can be ORDERED by it.
 *
 * THE FIRM, 18 Oct: "we should be able to sort, for example, highest number to lowest number,
 * collected or outstanding balance." The book is paged in the database, so the order has to be the
 * database's -- and the database had no balance that agreed with the account page. `engine_balances`
 * caps in duplum on the interest alone and says R817,01 on RRC00005 where the page says R760,00.
 *
 * THIS IS NOT A SECOND ARITHMETIC, and that is the whole design. Nothing in SQL works a balance out.
 * The figure in `account_balances` is written by computeBalance -- this file -- over the same ledgers,
 * through the same balanceInputFor, that the account page and the list use. The database only
 * remembers it and knows when it has stopped being true:
 *
 *   - `as_at`: interest runs daily, so a figure is true on ONE day.
 *   - `ledger_version`: every ledger row and every balance input on the account bumps it (triggers,
 *     so none of the many writers can forget). The writer says which version it read BEFORE reading
 *     the ledgers, and a figure is current only while the two agree -- a payment landing mid-way
 *     leaves the row stale rather than marked fresh with the payment missing.
 *
 * WHO KEEPS IT CURRENT: the nightly job for the whole book (api/_lib/workflow/balances.ts, because
 * every figure moves at midnight), and the list for what changed since -- before it sorts by
 * balance, and for every row it draws. The figure a person READS is never this one: the list still
 * draws the live computeBalance answer. This is a sort key.
 *
 * `.js` SPECIFIERS, because an API route reaches this file -- see check-api-imports.
 */
import { computeBalance, type BalanceBreakdown } from './accountBalance.js'
import { balanceInputFor, type LedgerRows } from './balanceInput.js'
import { fetchAllRows } from './fetchAll.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The slice of a Supabase client this file uses. Typed loosely on purpose: the browser's client and
 * the server's service-role client are the same library at two versions of generated types, and
 * all this needs is `from` and `rpc`.
 */
export type BalanceClient = { from: (table: string) => any; rpc: (fn: string, args?: any) => any }

/**
 * THE COLUMNS EACH LEDGER IS READ WITH -- the ones balanceInputFor reads, and no fewer. A shorter
 * list here would be a balance computed from less than the account page had: `annexure_item` and
 * `payment_id` missing count every receipt fee twice, `legacy_name` missing drops R 8 802,11 of
 * promise-to-pay charges. One list, used by the list page and the nightly job alike.
 */
export const LEDGER_SELECT = {
  payments: 'account_id,id,received_at,amount,paid_to_client,reversed_at,receipt_fee_legacy,rejected_at',
  fees: 'account_id,incurred_at,description,amount_excl_vat,vat_amount,billed,segments,cancelled_at,annexure_item,payment_id,legacy_name',
  accruals: 'account_id,accrued_on,days,amount_accrued',
} as const

/** The account's own inputs to the balance, as `debtor_accounts` names them. */
export const ACCOUNT_SELECT =
  'id,capital_handed_over,handover_date,interest_rate_annual,status,last_action_at,ended_as,ended_on,prescribed,prescription_date'

/**
 * Raw ledger rows, grouped by account, in the shape balanceInputFor reads. PURE.
 *
 * EVERY ID GETS AN ENTRY, empty where it has no rows -- an account with no ledger still has a
 * balance (its capital), and a missing entry would read as "could not load".
 */
export function ledgerRowsByAccount(
  ids: readonly string[],
  raw: { payments: any[]; fees: any[]; accruals: any[] },
): Map<string, LedgerRows> {
  const out = new Map<string, LedgerRows>()
  for (const id of ids) out.set(id, { payments: [], fees: [], accruals: [] })
  for (const r of raw.payments) {
    /* A REJECTED RECEIPT WAS NEVER THE DEBTOR'S PAYMENT (prompt 11) -- above all the copy a reversal
       leaves behind on its way to Needs an account. It is in no total, on no screen. */
    if (r.rejected_at) continue
    out.get(r.account_id)?.payments.push({
      id: r.id,
      receivedAt: r.received_at,
      amount: Number(r.amount),
      paidToClient: !!r.paid_to_client,
      reversedAt: r.reversed_at,
      receiptFeeLegacy: r.receipt_fee_legacy === null || r.receipt_fee_legacy === undefined
        ? null : Number(r.receipt_fee_legacy),
    })
  }
  for (const r of raw.fees) {
    out.get(r.account_id)?.fees.push({
      incurredAt: r.incurred_at,
      description: r.description ?? '',
      amountExclVat: Number(r.amount_excl_vat ?? 0),
      vatAmount: Number(r.vat_amount ?? 0),
      billed: r.billed !== false,
      segments: r.segments ?? undefined,
      annexureItem: r.annexure_item ?? null,
      paymentId: r.payment_id ?? null,
      cancelledAt: r.cancelled_at ?? null,
      legacyName: r.legacy_name ?? null,
    })
  }
  for (const r of raw.accruals) {
    out.get(r.account_id)?.accruals.push({
      accruedOn: r.accrued_on,
      days: Number(r.days ?? 1),
      amountAccrued: Number(r.amount_accrued ?? 0),
    })
  }
  return out
}

/**
 * The three ledgers for a set of accounts, complete. PAGED, because PostgREST stops at a thousand
 * rows and says nothing -- see fetchAllRows, and the BPM0113 story in accountBook.
 */
export async function fetchLedgerRows(client: BalanceClient, accountIds: readonly string[]): Promise<Map<string, LedgerRows>> {
  const ids = [...new Set(accountIds)]
  if (ids.length === 0) return new Map()
  const [payments, fees, accruals] = await Promise.all([
    fetchAllRows(() => client.from('account_payments').select(LEDGER_SELECT.payments).in('account_id', ids).order('id'), { table: 'payments' }),
    fetchAllRows(() => client.from('account_fees').select(LEDGER_SELECT.fees).in('account_id', ids).order('id'), { table: 'fees' }),
    fetchAllRows(() => client.from('account_interest_accruals').select(LEDGER_SELECT.accruals).in('account_id', ids).order('id'), { table: 'interest' }),
  ])
  return ledgerRowsByAccount(ids, { payments: payments as any[], fees: fees as any[], accruals: accruals as any[] })
}

/** An account row (snake_case, as `ACCOUNT_SELECT` reads it) as balanceInputFor wants it. */
export function balanceAccountFromRow(r: any) {
  return {
    capitalHandedOver: Number(r.capital_handed_over ?? 0),
    handoverDate: r.handover_date ?? null,
    interestRateAnnual: Number(r.interest_rate_annual ?? 0),
    status: r.status ?? '',
    lastActionAt: r.last_action_at ?? null,
    endedAs: r.ended_as ?? null,
    endedOn: r.ended_on ?? null,
    prescribed: !!r.prescribed,
    prescriptionDate: r.prescription_date ?? null,
  }
}

/** One row of what `record_account_balances` takes. */
export interface StoredBalanceRow {
  account_id: string
  version: number
  balance: number
  to_settle: number
  as_at: string
}

/**
 * WHAT IS STORED, off a breakdown. `to_settle` is the list's "To settle" column -- computeBalance's
 * `settlement`, the balance plus the receipt fee on it -- because the order has to be the order of
 * the figure the column shows, not of a figure beside it.
 */
export function storedRow(accountId: string, version: number, b: BalanceBreakdown, today: string): StoredBalanceRow {
  return { account_id: accountId, version, balance: b.balance, to_settle: b.settlement, as_at: today }
}

/**
 * Does the stored figure already say what the screen says, on this version and day? Then there is
 * nothing to write. Compared in CENTS: numeric comes back as a string or a float, and 760 vs 760.00
 * is not a difference.
 */
export function storedAgrees(
  stored: { to_settle: number | string | null; as_at: string | null; computed_version: number | string | null; ledger_version: number | string } | null | undefined,
  b: BalanceBreakdown,
  today: string,
): boolean {
  if (!stored || stored.to_settle === null || stored.computed_version === null) return false
  return Number(stored.computed_version) === Number(stored.ledger_version)
    && stored.as_at === today
    && Math.round(Number(stored.to_settle) * 100) === Math.round(b.settlement * 100)
}

/** Fifty accounts a round: three ledger reads and one write. The same bound the list's page has. */
const BATCH = 50

/**
 * WORK OUT AND STORE THE BALANCE OF THESE ACCOUNTS, through computeBalance. Returns how many were
 * written.
 *
 * THE VERSION IS READ FIRST, then the account and the ledgers. Read the other way round, a payment
 * committed between the two reads would be in the version and not in the figure, and the figure
 * would be stored as current without it.
 */
export async function refreshBalances(client: BalanceClient, accountIds: readonly string[], today: string): Promise<number> {
  let written = 0
  const ids = [...new Set(accountIds)]
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH)
    const { data: versions, error: vErr } = await client.from('account_balances')
      .select('account_id,ledger_version').in('account_id', chunk)
    if (vErr) throw new Error(vErr.message)
    const version = new Map<string, number>(((versions ?? []) as any[]).map((v) => [v.account_id, Number(v.ledger_version)]))
    const { data: accounts, error: aErr } = await client.from('debtor_accounts').select(ACCOUNT_SELECT).in('id', chunk)
    if (aErr) throw new Error(aErr.message)
    const ledgers = await fetchLedgerRows(client, chunk)
    const rows: StoredBalanceRow[] = []
    for (const a of (accounts ?? []) as any[]) {
      const b = computeBalance(balanceInputFor({
        account: balanceAccountFromRow(a), ledgers: ledgers.get(a.id)!, today,
      }))
      rows.push(storedRow(a.id, version.get(a.id) ?? 0, b, today))
    }
    written += await recordBalances(client, rows)
  }
  return written
}

/** The write, which drops anything older than what is already stored (see the SQL). */
export async function recordBalances(client: BalanceClient, rows: readonly StoredBalanceRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const { data, error } = await client.rpc('record_account_balances', { p_rows: rows })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

/**
 * BRING THE STORED FIGURES UP TO DATE, up to `limit` accounts. `onlyStale` asks only for the ones a
 * ledger has moved on since they were worked out -- what the list does before it sorts, a handful
 * on a working day -- and without it every account not current today, which is the nightly job.
 * Returns how many it worked through and whether any are left.
 */
export async function refreshOutOfDate(
  client: BalanceClient,
  today: string,
  opts: { limit: number; onlyStale?: boolean; until?: number },
): Promise<{ done: number; more: boolean }> {
  let done = 0
  for (;;) {
    if (opts.until && Date.now() > opts.until) return { done, more: true }
    const room = opts.limit - done
    if (room <= 0) return { done, more: true }
    const { data, error } = await client.rpc('accounts_needing_balance', {
      p_limit: Math.min(room, 500), p_only_stale: !!opts.onlyStale,
    })
    if (error) throw new Error(error.message)
    const ids = ((data ?? []) as any[]).map((r) => (typeof r === 'string' ? r : r.accounts_needing_balance ?? r.id))
    if (ids.length === 0) return { done, more: false }
    const n = await refreshBalances(client, ids, today)
    done += ids.length
    /* NOTHING WRITTEN FOR A FULL ROUND means every one of them was overtaken by a ledger change
       mid-way (or refused): asking again would ask for the same ids for ever. Stop and say so. */
    if (n === 0) return { done, more: true }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
