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
