import { supabase } from './supabase'

/**
 * THE FIRM'S OWN ACCOUNTS, READ BACK.
 *
 * Trust is other people's money and this is Bredell Ferreira's. The firm asked for them apart:
 * "the trust and the business should be separated... we have one place where we manage the trust
 * and we have another place outside where we manage the business."
 *
 * ONLY WHAT EXISTS IS IN HERE. Expenses, payroll and the firm's own bank statement are not built;
 * no function in this file pretends otherwise, and the screen says so in words rather than drawing
 * an empty table that reads as a firm which spent nothing.
 */

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

/**
 * A CLIENT WHO OWES THE FIRM, and the two ways that debt gets settled.
 *
 * THE FIRM, ON SETTLING ONE OUT OF TRUST MONEY: "now we're taking money for the business out of
 * the trust for somebody else that owes us... But basically, if they owe the trust, they owe us so
 * we can do that."
 *
 * WHICH IS RIGHT, AND THE REASON IT IS RIGHT IS THE WHOLE RULE. The firm is not taking business
 * money out of the trust account in general -- it is reducing what it hands THIS client, by what
 * THIS client owes it. The money never stops being that client's until the set-off is made, and
 * the set-off is made against their own balance. Settling one client's invoice from another
 * client's trust credit, or from a debtor's overpayment, or from a receipt nobody has placed yet,
 * is a trust shortfall however it is later repaid: those are different people's money sitting in
 * one bank account.
 *
 * SO `settlement` IS PART OF THE CHARGE, not a decision taken later at payover time. 'set_off'
 * says this one comes off what the client is owed; 'invoice' says the client is billed and pays it
 * from their own account. The first requires that they have a credit to take it from.
 *
 * THOSE TWO SPELLINGS ARE THE DATABASE'S, NOT THIS FILE'S. client_charges_settlement_check is a
 * closed list of exactly ('set_off', 'invoice'), and a literal here that drifts from it does not
 * throw -- it silently never matches, so every charge falls into the other bucket. This file was
 * written with 'off_payover' and did precisely that: the whole column read as invoiced, which
 * would have had somebody chase a client for money already coming off their next run.
 * check-workspace-split now holds the literal against the constraint in schema.sql.
 */
export interface ClientDebt {
  companyId: string
  client: string
  /** Billed to the client to pay directly. */
  invoiced: number
  /** To be taken off their next payover. */
  offPayover: number
  total: number
  oldest: string | null
  count: number
}

export async function fetchClientDebts(): Promise<ClientDebt[]> {
  /*
   * PAID AND CANCELLED ARE BOTH GONE, and they are not the same thing: one was settled and one
   * should never have been raised. Neither is owed, which is the question this list asks.
   */
  const { data, error } = await supabase
    .from('client_charges')
    .select('company_id, amount, vat, settlement, raised_on, companies(name)')
    .is('paid_at', null)
    .is('cancelled_at', null)
    .order('raised_on', { ascending: true })
  if (error) throw new Error(error.message)

  const by = new Map<string, ClientDebt>()
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const id = String(r.company_id)
    /* The embed comes back as an object or an array depending on the relationship Supabase infers;
       both shapes have turned up on this codebase, so neither is assumed. */
    const co = r.companies as { name?: string } | { name?: string }[] | null
    const name = (Array.isArray(co) ? co[0]?.name : co?.name) ?? 'Unknown client'
    /* VAT IS PART OF WHAT THEY OWE. The client pays the inclusive figure; splitting it out is a
       question for the firm's VAT return, not for "how much is outstanding". */
    const gross = n(r.amount) + n(r.vat)
    const row = by.get(id) ?? {
      companyId: id, client: name, invoiced: 0, offPayover: 0, total: 0, oldest: null, count: 0,
    }
    if (r.settlement === 'set_off') row.offPayover += gross
    else row.invoiced += gross
    row.total += gross
    row.count += 1
    const raised = r.raised_on ? String(r.raised_on) : null
    /* Ordered oldest-first above, so the first one seen for a client is theirs. */
    if (raised && !row.oldest) row.oldest = raised
    by.set(id, row)
  }
  return [...by.values()].sort((a, b) => b.total - a.total)
}

/**
 * THE RUNNING STATEMENT BETWEEN THE FIRM AND ONE CLIENT.
 *
 * THE FIRM ASKED FOR IT BY LISTING IT, which is the specification and is asserted line for line in
 * check-client-account: *"Payover due to client. Payover paid to client. Withdrawal invoice for
 * client. Payover due to client. Withdrawal fee subtracted from payover. Client paid payover.
 * Invoice for executive listing. Invoice paid by client."*
 *
 * THIS IS WHERE THE TWO BOOKS MEET, and it is deliberately neither workspace. The firm does not
 * settle "an invoice from trust" -- it settles Rinda Roo's invoice from Rinda Roo's own money, so
 * the place that shows both is the CLIENT. Trust holds what is owed to them; Business holds what
 * they owe; this is the one view where the two are a single running balance.
 *
 * THE BALANCE IS THE DATABASE'S, NOT THIS FILE'S. `client_account` carries a running `balance`
 * computed in one ordered window, and re-summing the rows in the browser would be a second
 * arithmetic that drifts the first time a same-day ordering differs. A statement whose balance
 * disagrees with the payover it came from is worse than no statement.
 */
export type ClientEntryKind =
  | 'held' | 'owed' | 'set_off' | 'payover_paid' | 'released' | 'reversal' | 're_split'
  | 'charge_pending' | 'invoice_raised' | 'invoice_paid'

export interface ClientEntry {
  on: string
  kind: ClientEntryKind
  description: string
  reference: string | null
  /** The account the line came from, where it came from one (a receipt, a PTC, a reversal). */
  caseNumber: string | null
  amount: number
  balance: number
  runId: string | null
  chargeId: string | null
}

/*
 * THE CLIENT LEDGER (client_ledger, 10 Oct). The firm: "we should have like a ledger for clients.
 * Who owes us and who we paid." Read from the client's TRUST entries -- money held for them, PTC
 * fees they owe, set-offs, releases, reversals, payovers paid -- plus the two things the trust never
 * sees: a charge still waiting for a payover, and an invoice. It replaced `client_account`, which
 * was built from payover runs and saw a PTC fee only once a run had netted it off.
 * Positive is owed TO the client; negative is the client owing us.
 */
export async function fetchClientAccount(companyId: string): Promise<ClientEntry[]> {
  const { data, error } = await supabase.rpc('client_ledger', { p_company: companyId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    on: String(r.entry_on ?? ''),
    kind: String(r.kind) as ClientEntryKind,
    description: String(r.description ?? ''),
    reference: (r.reference as string | null) ?? null,
    caseNumber: (r.case_number as string | null) ?? null,
    amount: n(r.amount),
    balance: n(r.balance),
    runId: (r.run_id as string | null) ?? null,
    chargeId: (r.charge_id as string | null) ?? null,
  }))
}

/**
 * EVERY CLIENT'S BALANCE (client_balances): what the trust holds for them (negative where a PTC
 * leaves them owing), the charges still due from them, and the net -- one list, read by Trust ->
 * Client balances and by Business -> Clients who owe the firm, so the two cannot disagree.
 */
export interface ClientBalance {
  companyId: string
  client: string
  code: string | null
  inTrust: number
  chargesDue: number
  /** Positive: we owe them. Negative: they owe us. */
  net: number
  lastPaidOn: string | null
  lastPaid: number | null
}

export async function fetchClientBalances(): Promise<ClientBalance[]> {
  const { data, error } = await supabase.rpc('client_balances')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    companyId: String(r.company_id),
    client: String(r.client ?? ''),
    code: (r.code as string | null) ?? null,
    inTrust: n(r.in_trust),
    chargesDue: n(r.charges_due),
    net: n(r.net),
    lastPaidOn: (r.last_paid_on as string | null) ?? null,
    lastPaid: r.last_paid === null || r.last_paid === undefined ? null : n(r.last_paid),
  }))
}
