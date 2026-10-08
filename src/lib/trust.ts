import { supabase } from './supabase'
import type { TrustCycle } from './trustCycles.ts'
import { toFirmHeld, type FirmHeld } from './firmHeld.ts'

export type { TrustCycle } from './trustCycles.ts'

/**
 * THE TRUST ACCOUNT, READ BACK.
 *
 * Everything here was built in the database over the last few prompts and has never had a face:
 * the creditors ledger, the debtors inside it, and the reconciliation of the two against what the
 * bank actually holds. `check-financial-immutability` is what keeps the ledger itself honest; this
 * file only reads.
 *
 * ONE RPC FOR THE POSITION, NOT FOUR QUERIES. `trust_position()` nets a client across their whole
 * book and a debtor per account -- a distinction that is wrong in both directions if the browser
 * does the summing -- and it is the SAME arithmetic the reconciliation uses. Summed again up here
 * the two would drift, and the failure would not be a wrong screen: it would be the trust account
 * reading as balanced on one page and short on another.
 */

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

export interface TrustPosition {
  /** What the bank says is in the trust account. */
  trustCash: number
  /** Everything owed OUT of it. */
  creditors: number
  /** Everything owed back TO it — a PTC makes a trust debtor of a client. */
  debtors: number
  netOwed: number
  /**
   * Cash less what is owed. NOT always zero, and the screen exists because it is not: a negative
   * difference means the bank holds less than the firm says it owes, which is a trust shortfall
   * and the one number on this page somebody has to act on.
   */
  difference: number
  owedToClients: number
  owedToDebtors: number
  owedToFirm: number
  /** Receipts on the statement nobody has placed. Still somebody's money; not yet known whose. */
  unidentified: number
  /** Clients who owe the trust rather than are owed by it. */
  owedByClients: number
}

/**
 * THE FIRM'S SHARE, BY WHAT IT IS (firm_held_parts). Null where the function refused, as trust_position below:
 * no row is a refusal, not an empty share.
 */
export async function fetchFirmHeld(): Promise<FirmHeld | null> {
  const { data, error } = await supabase.rpc('firm_held_parts')
  if (error) throw new Error(error.message)
  const row = (data as Record<string, unknown>[] | null)?.[0]
  return row ? toFirmHeld(row) : null
}

/**
 * OVERPAYMENTS KEPT: parked, and not yet taken by the firm (overpayments_kept). Still the debtors'
 * money, so it is a PART of owedToDebtors, drawn as its own line. Null where the function refused.
 */
export async function fetchOverpaymentsKept(): Promise<{ amount: number; accounts: number } | null> {
  const { data, error } = await supabase.rpc('overpayments_kept')
  if (error) throw new Error(error.message)
  const row = (data as Record<string, unknown>[] | null)?.[0]
  return row ? { amount: Number(row.amount ?? 0), accounts: Number(row.accounts ?? 0) } : null
}

export async function fetchTrustPosition(): Promise<TrustPosition | null> {
  const { data, error } = await supabase.rpc('trust_position')
  if (error) throw new Error(error.message)
  const row = (data as Record<string, unknown>[] | null)?.[0]
  /*
   * NULL RATHER THAN ZEROES WHERE THE FUNCTION REFUSED. It is `security definer` with its guard in
   * a `where` clause, so somebody who may not see it gets NO ROW rather than an error — and a
   * screen that turned that into R 0.00 would tell an unauthorised person the trust account is
   * empty, which is a statement about the firm's money rather than a refusal.
   */
  if (!row) return null
  return {
    trustCash: n(row.trust_cash),
    creditors: n(row.creditors),
    debtors: n(row.debtors),
    netOwed: n(row.net_owed),
    difference: n(row.difference),
    owedToClients: n(row.owed_to_clients),
    owedToDebtors: n(row.owed_to_debtors),
    owedToFirm: n(row.owed_to_firm),
    unidentified: n(row.unidentified),
    owedByClients: n(row.owed_by_clients),
  }
}

/**
 * A DEBIT OFF THE TRUST STATEMENT WITH NO PAYOVER RUN BEHIND IT.
 *
 * This is the half of the difference that can be explained by pointing at a row. The firm's own
 * trust account currently carries one: a payment to a client with no run recorded against it. The
 * other half is usually a bank charge, which belongs to no creditor at all and has to be funded
 * rather than matched.
 */
export interface UnreconciledPayout {
  id: string
  txnDate: string
  amount: number
  description: string
  candidateRun: string | null
  candidateInvoice: string | null
  candidateClient: string | null
}

export async function fetchUnreconciledPayouts(): Promise<UnreconciledPayout[]> {
  const { data, error } = await supabase.rpc('unreconciled_payouts')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    txnDate: String(r.txn_date ?? ''),
    amount: n(r.amount),
    description: String(r.description ?? ''),
    candidateRun: (r.candidate_run as string | null) ?? null,
    candidateInvoice: (r.candidate_invoice as string | null) ?? null,
    candidateClient: (r.candidate_client as string | null) ?? null,
  }))
}

/**
 * WHO THE TRUST OWES, AND WHO OWES IT, ONE ROW PER PARTY.
 *
 * `trust_position` says how MUCH is owed out of the account; this says to WHOM. The netting is the
 * database's and is the same expression the position uses -- a client across their whole book, a
 * debtor per account -- so the ledger and the reconciliation cannot disagree about who is owed
 * what, which is the one thing a trust ledger exists to settle.
 *
 * IT DOES NOT SUM TO `netOwed`, AND THAT IS CORRECT. The position adds unplaced receipts to what is
 * owed, because money on the statement with nobody's name on it is still somebody's; this can only
 * list parties it knows. The screen says so, rather than leaving two figures looking like a
 * disagreement.
 */
export type TrustParty = 'client' | 'debtor' | 'firm' | 'unidentified'

export interface TrustBalance {
  party: TrustParty
  whoId: string
  whoName: string
  /** The client's code, the account's case number, or a line saying what the money is. */
  whoDetail: string
  /** Positive is owed OUT of the trust; negative owes the trust. */
  balance: number
  entries: number
  lastAt: string | null
}

export async function fetchTrustBalances(): Promise<TrustBalance[]> {
  const { data, error } = await supabase.rpc('trust_balances')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    party: String(r.party) as TrustParty,
    whoId: String(r.who_id ?? ''),
    whoName: String(r.who_name ?? ''),
    whoDetail: String(r.who_detail ?? ''),
    balance: n(r.balance),
    entries: Number(r.entries ?? 0),
    lastAt: (r.last_at as string | null) ?? null,
  }))
}

/**
 * THE SAME MONEY, SPLIT BY THE PAYOVER IT IS WAITING FOR.
 *
 * `trust_position` is timeless -- one running total per party -- and the firm asked the question it
 * cannot answer: "what is for this month's payover? And what is for next month's payover?" On the
 * 6th of October the trust holds two of them at once, a closed cycle due out on the 11th and an
 * open one four days from closing, and the position adds them together.
 *
 * ONE RPC AND NO SUMMING UP HERE, for the reason every other figure on this screen is read rather
 * than computed: the bucket sums ARE `trust_position`'s party totals, and a browser that re-derived
 * them would be a second arithmetic for one trust balance.
 */
export async function fetchTrustCycles(): Promise<TrustCycle[]> {
  const { data, error } = await supabase.rpc('trust_by_cycle')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    periodStart: String(r.period_start),
    periodEnd: String(r.period_end),
    paysOn: String(r.pays_on),
    isOpen: Boolean(r.is_open),
    toClients: n(r.to_clients),
    firmEarned: n(r.firm_earned),
    firmMoved: n(r.firm_moved),
    toDebtors: n(r.to_debtors),
    unplaced: n(r.unplaced),
    held: n(r.held),
    runs: Number(r.runs ?? 0),
    runsPaid: Number(r.runs_paid ?? 0),
    runsToDo: Number(r.runs_to_do ?? 0),
  }))
}
