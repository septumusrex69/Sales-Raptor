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

/**
 * PAYMENTS OUT CONFIRMED FROM THE STATEMENT ONLY (firm_settings.payouts_statement_only). Read on
 * its own so a screen can hide Mark paid without loading the firm's whole row. A failed read is
 * "off": the database refuses a manual mark when the switch is on whatever the screen showed.
 */
export async function fetchPayoutsStatementOnly(): Promise<boolean> {
  const { data } = await supabase.from('firm_settings').select('payouts_statement_only').limit(1).maybeSingle()
  return Boolean((data as { payouts_statement_only?: boolean } | null)?.payouts_statement_only)
}

/**
 * WHERE THE BANK FIGURE STARTS (firm_settings.trust_opening_balance / trust_opening_date).
 *
 * trust_position's cash is the opening balance plus every trust statement line AFTER its date. With
 * no opening balance it is the statement lines alone -- which is short by whatever was in the
 * account before the first statement Raptor has (on staging, the R15 021.04 of Swordfish receipts
 * that arrived before 8 October). The overview says which of the two it is showing.
 */
export interface TrustOpening {
  accountNumber: string | null
  amount: number | null
  asAt: string | null
}

export async function fetchTrustOpening(): Promise<TrustOpening> {
  const { data } = await supabase.from('firm_settings')
    .select('trust_account_number, trust_opening_balance, trust_opening_date').limit(1).maybeSingle()
  const r = data as { trust_account_number: string | null; trust_opening_balance: number | string | null; trust_opening_date: string | null } | null
  return {
    accountNumber: r?.trust_account_number ?? null,
    amount: r?.trust_opening_balance === null || r?.trust_opening_balance === undefined ? null : Number(r.trust_opening_balance),
    asAt: r?.trust_opening_date ?? null,
  }
}

/**
 * SET THE OPENING BALANCE. One RPC, so the figure and its audit line (with the reason) are written
 * together or not at all; Administrator with the trust tick only, refused in the database.
 */
export async function setTrustOpening(amount: number, asAt: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('set_trust_opening_balance', { p_amount: amount, p_as_at: asAt, p_reason: reason })
  if (error) throw new Error(error.message)
}

/**
 * MONEY IN THE BANK WAITING FOR APPROVAL (trust_awaiting_approval): placed statement lines whose
 * payment is not yet approved -- a new receipt, or one reversed back to the queue. In the bank
 * and on no ledger line, so the overview names it rather than calling it a difference.
 */
export async function fetchTrustAwaiting(): Promise<{ amount: number; payments: number } | null> {
  const { data, error } = await supabase.rpc('trust_awaiting_approval')
  if (error) throw new Error(error.message)
  const row = (data as Record<string, unknown>[] | null)?.[0]
  return row ? { amount: n(row.amount), payments: n(row.payments) } : null
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
 * WHAT ONE BALANCE IS MADE OF: its entries, newest first, each with the running balance after it.
 * The firm, 8 Oct: "no details what this is for". The running figure is the database's
 * (`trust_entries`), the most recent 500 carrying the balance from everything before them.
 */
export interface TrustEntry {
  id: string
  at: string
  reason: string
  amount: number
  balance: number
  accountId: string | null
  caseNumber: string | null
  debtorName: string | null
  runId: string | null
  invoiceNumber: string | null
  onStatement: string | null
}

export async function fetchTrustEntries(party: TrustParty, who: string): Promise<TrustEntry[]> {
  const { data, error } = await supabase.rpc('trust_entries', { p_party: party, p_who: who })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    at: String(r.entry_at),
    reason: String(r.reason ?? ''),
    amount: n(r.amount),
    balance: n(r.balance),
    accountId: (r.account_id as string | null) ?? null,
    caseNumber: (r.case_number as string | null) ?? null,
    debtorName: (r.debtor_name as string | null) ?? null,
    runId: (r.run_id as string | null) ?? null,
    invoiceNumber: (r.invoice_number as string | null) ?? null,
    onStatement: (r.on_statement as string | null) ?? null,
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

/*
 * THE TRUST OVERVIEW, SPLIT (10 Oct). The firm: "Everything that's in the trust, this is what it's
 * for ... Now you've incorporated PTCs in this ... We should report on that separately." Four reads,
 * each one database function, nothing summed twice:
 *  - trust_cash_by_cycle: the money IN the trust account, by the cycle it is for and whose it is.
 *    A PTC's entry is left out (no money came in); what a paid payover kept back is the firm's.
 *  - ptc_by_run: each payover's PTCs -- owed to the firm, set off from the client's own trust
 *    money, and short.
 *  - ptc_ageing: what each client still owes after set-off, dated from the payover that invoiced it.
 *  - collections_by_payover: into trust + paid straight to clients, counted from the payments and
 *    from the runs, so the two can be held against each other.
 */
export interface TrustCashCycle {
  periodStart: string
  periodEnd: string
  paysOn: string
  isOpen: boolean
  forClients: number
  /** Earned on receipts, plus what paid payovers kept back (of which `firmSetOff`). */
  forFirm: number
  firmSetOff: number
  /** Bank interest, bank charges, drawings and transfers -- the firm's, but not earned on a receipt. */
  firmOther: number
  forDebtors: number
  unplaced: number
  total: number
}

export async function fetchTrustCashByCycle(): Promise<TrustCashCycle[]> {
  const { data, error } = await supabase.rpc('trust_cash_by_cycle')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    periodStart: String(r.period_start),
    periodEnd: String(r.period_end),
    paysOn: String(r.pays_on),
    isOpen: Boolean(r.is_open),
    forClients: n(r.for_clients),
    forFirm: n(r.for_firm),
    firmSetOff: n(r.firm_set_off),
    firmOther: n(r.firm_other),
    forDebtors: n(r.for_debtors),
    unplaced: n(r.unplaced),
    total: n(r.total),
  }))
}

export interface PtcRun {
  runId: string
  companyId: string
  client: string
  invoiceNumber: string | null
  periodStart: string
  paysOn: string
  status: string
  /** What the debtors paid straight to the client. */
  received: number
  /** The firm's share of it: fees, interest, commission and VAT. */
  owed: number
  /** Covered by the client's own trust money on this payover. */
  setOff: number
  /** Not covered: the client owes it. */
  short: number
}

export async function fetchPtcByRun(): Promise<PtcRun[]> {
  const { data, error } = await supabase.rpc('ptc_by_run')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    runId: String(r.run_id),
    companyId: String(r.company_id),
    client: String(r.client ?? ''),
    invoiceNumber: (r.invoice_number as string | null) ?? null,
    periodStart: String(r.period_start),
    paysOn: String(r.pays_on),
    status: String(r.status),
    received: n(r.ptc_received),
    owed: n(r.ptc_owed),
    setOff: n(r.set_off),
    short: n(r.short),
  }))
}

export interface PtcAgeing {
  companyId: string
  client: string
  owed: number
  /** The payover date that first invoiced it; a shortfall carried forward keeps it. */
  since: string
  runId: string
  invoiceNumber: string | null
  /** False until that payover date: the remittance advice that invoices it has not gone yet. */
  invoiced: boolean
}

export async function fetchPtcAgeing(): Promise<PtcAgeing[]> {
  const { data, error } = await supabase.rpc('ptc_ageing')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    companyId: String(r.company_id),
    client: String(r.client ?? ''),
    owed: n(r.owed),
    since: String(r.since),
    runId: String(r.run_id),
    invoiceNumber: (r.invoice_number as string | null) ?? null,
    invoiced: Boolean(r.invoiced),
  }))
}

export interface PayoverTie {
  paysOn: string
  intoTrust: number
  paidDirect: number
  payments: number
  runsIntoTrust: number
  runsPaidDirect: number
}

export async function fetchCollectionsByPayover(): Promise<PayoverTie[]> {
  const { data, error } = await supabase.rpc('collections_by_payover')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    paysOn: String(r.pays_on),
    intoTrust: n(r.into_trust),
    paidDirect: n(r.paid_direct),
    payments: Number(r.payments ?? 0),
    runsIntoTrust: n(r.runs_into_trust),
    runsPaidDirect: n(r.runs_paid_direct),
  }))
}
