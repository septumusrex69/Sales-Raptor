import { supabase } from './supabase'

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
