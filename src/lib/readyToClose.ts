import { supabase } from './supabase'
import { closeAsSettled } from './settlementApi'
import { settleAccount } from './accountEndingApi'
import { fetchLedgersForAccounts, toAccount } from './accountBook'
import { balanceInputFor } from './balanceInput'
import { computeBalance } from './accountBalance'
import { isWrittenOff } from './accountStatus'
import { firmToday } from './dateLabels'
import { SMALL_RESIDUE, readyKindFor } from './accountEnding'
export { readyKindFor }

/**
 * ACCOUNTS WHOSE MONEY IS IN AND NOBODY HAS CLOSED THEM (the firm, 12 Oct, on HTH/4004: "accounts
 * that are paid up from the money you received ... I'm sure it's somewhere flagged to be closed").
 *
 * `accounts_ready_to_close` decides it in the database, and two screens read it: the approval queue,
 * about the accounts it has just approved -- the close offered while the money is in front of
 * somebody -- and Ready to close, about the whole book, so one nobody closed then is not lost.
 *
 * THREE KINDS, ALL ON THE WHOLE BALANCE (the firm, 12 Oct: "almost always there will still be fees
 * ... this will be regarding the total outstanding balance"):
 *   settled        the approved settlement has been paid in full;
 *   paid_up        nothing is left -- capital, interest and fees all paid;
 *   small_balance  under R50 left after the division -- closes as settled, the rest waived.
 * The balance is computeBalance's, the figure the account page shows; the database only narrows
 * the candidates. Offered, never done by itself.
 */
export type ReadyKind = 'settled' | 'paid_up' | 'small_balance'

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
  /** What is still owed, as the account page works it out. Nil or less for paid up. */
  balance: number | null
  lastPaidOn: string | null
}

export async function fetchReadyToClose(accountIds?: string[]): Promise<ReadyToClose[]> {
  if (accountIds && accountIds.length === 0) return []
  const { data, error } = await supabase.rpc('accounts_ready_to_close',
    accountIds ? { p_accounts: [...new Set(accountIds)] } : {})
  if (error) throw new Error(error.message)
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  const raw = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
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
    balance: null as number | null,
    lastPaidOn: (r.last_paid_on as string | null) ?? null,
    residue: r.kind === 'residue',
  }))
  /*
   * THE CANDIDATES' BALANCES, worked out the way the account page works them out. Same function,
   * same ledgers -- the list must never offer to close an account whose own page says R300 owing.
   */
  const residueIds = raw.filter((r) => r.residue).map((r) => r.accountId)
  const balances = await balancesOf(residueIds)
  const out: ReadyToClose[] = []
  for (const { residue, ...r } of raw) {
    if (!residue) { out.push(r); continue }
    const balance = balances.get(r.accountId)
    if (balance === undefined) continue
    const kind = readyKindFor(balance)
    if (kind) out.push({ ...r, kind, balance })
  }
  return out
}


async function balancesOf(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (ids.length === 0) return out
  const { data, error } = await supabase.from('debtor_accounts').select('*').in('id', ids)
  if (error) throw new Error(error.message)
  const ledgers = await fetchLedgersForAccounts(ids)
  const today = firmToday()
  for (const a of (data ?? []).map(toAccount)) {
    const l = ledgers.get(a.id)
    if (!l) continue
    out.set(a.id, computeBalance(balanceInputFor({
      account: {
        capitalHandedOver: a.capitalHandedOver, handoverDate: a.handoverDate,
        interestRateAnnual: a.interestRateAnnual, status: a.status, lastActionAt: a.lastActionAt,
        endedAs: a.endedAs, prescribed: a.prescribed, prescriptionDate: a.prescriptionDate, endedOn: a.endedOn,
      },
      ledgers: l, today, writtenOff: isWrittenOff,
    })).balance)
  }
  return out
}

/** What the close will be called, in the firm's words. */
export function readyLabel(r: Pick<ReadyToClose, 'kind' | 'settlementAmount' | 'balance'>, money: (n: number) => string): string {
  if (r.kind === 'settled') {
    return `Settlement of ${money(r.settlementAmount ?? 0)} paid in full — close as settled; the rest is waived by the client`
  }
  if (r.kind === 'small_balance') {
    return `${money(r.balance ?? 0)} left after the payment — close as settled; the small balance is waived`
  }
  return 'Paid in full — close as paid up'
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
  if (r.kind === 'small_balance') {
    /* SETTLED, NOT WRITTEN OFF (the firm, 12 Oct): the debtor paid and the last few rand were let
       go. The remainder becomes the settlement discount on the statement. */
    await settleAccount(r.accountId, 'settled',
      `Small balance of R${(r.balance ?? 0).toFixed(2)} waived — under R${SMALL_RESIDUE} after the payment`)
    return
  }
  await settleAccount(r.accountId, 'paid_up',
    `Paid in full${r.lastPaidOn ? ` — last payment ${r.lastPaidOn}` : ''}`)
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
