import { supabase } from './supabase'
import { closeAsSettled } from './settlementApi'
import { settleAccount } from './accountEndingApi'

/**
 * ACCOUNTS WHOSE MONEY IS IN AND NOBODY HAS CLOSED THEM (the firm, 12 Oct, on HTH/4004: "accounts
 * that are paid up from the money you received ... I'm sure it's somewhere flagged to be closed").
 *
 * `accounts_ready_to_close` decides it in the database, and two screens read it: the approval queue,
 * about the accounts it has just approved -- the close offered while the money is in front of
 * somebody -- and Ready to close, about the whole book, so one nobody closed then is not lost.
 *
 * TWO KINDS, NEVER INFERRED BEYOND THEM. `settled`: the approved settlement has been paid in full.
 * `paid_up`: the capital is fully paid -- interest or fees may still stand behind it, which is why
 * this is OFFERED and never done by itself. "Capital paid off" is not "settled" (paymentsQueue says
 * the same), and a debtor told they are finished stops paying.
 */
export type ReadyKind = 'settled' | 'paid_up'

export interface ReadyToClose {
  accountId: string
  accountNumber: string | null
  caseNumber: string | null
  debtor: string | null
  companyId: string | null
  client: string | null
  kind: ReadyKind
  settlementId: string | null
  settlementAmount: number | null
  paidToward: number | null
  capitalOutstanding: number
  lastPaidOn: string | null
}

export async function fetchReadyToClose(accountIds?: string[]): Promise<ReadyToClose[]> {
  if (accountIds && accountIds.length === 0) return []
  const { data, error } = await supabase.rpc('accounts_ready_to_close',
    accountIds ? { p_accounts: [...new Set(accountIds)] } : {})
  if (error) throw new Error(error.message)
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    accountId: String(r.account_id),
    accountNumber: (r.account_number as string | null) ?? null,
    caseNumber: (r.case_number as string | null) ?? null,
    debtor: (r.debtor as string | null) ?? null,
    companyId: (r.company_id as string | null) ?? null,
    client: (r.client as string | null) ?? null,
    kind: r.kind as ReadyKind,
    settlementId: (r.settlement_id as string | null) ?? null,
    settlementAmount: n(r.settlement_amount),
    paidToward: n(r.paid_toward),
    capitalOutstanding: Number(r.capital_outstanding ?? 0),
    lastPaidOn: (r.last_paid_on as string | null) ?? null,
  }))
}

/** What the close will be called, in the firm's words. */
export function readyLabel(r: Pick<ReadyToClose, 'kind' | 'settlementAmount'>, money: (n: number) => string): string {
  return r.kind === 'settled'
    ? `Settlement of ${money(r.settlementAmount ?? 0)} paid in full — close as settled; the rest is waived by the client`
    : 'Capital paid in full — close as paid up'
}

/**
 * CLOSE IT THE WAY IT ENDED. A settled one goes through close_as_settled, which checks the money
 * again and closes the offer with the account; a paid-up one through settle_account. Each is its
 * own call, so one refused does not undo the others -- the caller reports which.
 */
export async function closeReady(r: ReadyToClose): Promise<void> {
  if (r.kind === 'settled' && r.settlementId) {
    await closeAsSettled(r.settlementId)
    return
  }
  await settleAccount(r.accountId, 'paid_up',
    `Capital paid in full${r.lastPaidOn ? ` — last payment ${r.lastPaidOn}` : ''}`)
}

/**
 * THE APPROVED SETTLEMENT ON EACH ACCOUNT, with what has already reached trust towards it, for the
 * queue's "Completes the settlement" badge. The same function the account's panel reads, so the
 * badge and the panel agree about how much is still to come.
 */
export async function fetchLiveSettlements(accountIds: string[]): Promise<Map<string, { amount: number; paid: number }>> {
  const out = new Map<string, { amount: number; paid: number }>()
  const ids = [...new Set(accountIds)]
  if (ids.length === 0) return out
  const { data, error } = await supabase.from('account_settlements')
    .select('account_id').in('account_id', ids).eq('status', 'approved')
  if (error) throw new Error(error.message)
  const withOffer = [...new Set(((data ?? []) as { account_id: string }[]).map((r) => r.account_id))]
  await Promise.all(withOffer.map(async (id) => {
    const { data: s } = await supabase.rpc('account_settlement', { p_account: id })
    const row = ((s ?? []) as { state: string; amount: number; paid_toward: number }[])[0]
    if (row && row.state === 'approved') out.set(id, { amount: Number(row.amount), paid: Number(row.paid_toward ?? 0) })
  }))
  return out
}
