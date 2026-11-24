/**
 * A SETTLEMENT, AS THE ACCOUNT HOLDS IT (task #69).
 *
 * THE FIRM'S OWN CALL SCRIPT IS THE SPEC: "{{client_name}} has agreed to accept
 * {{settlement_amount}} in full and final settlement, instead of the {{balance}} that is owing.
 * That is {{settlement_saving}} written off. ... It must be one payment, in full, and it must
 * reach our trust account by {{settlement_expiry}}." Its DO NOT list is the rest of the design:
 * "Quote a settlement figure that is not approved on the account. Extend an expiry date yourself.
 * Call a part payment a settlement."
 *
 * PURE, no Supabase -- the rules have to be assertable; the calls live in settlementApi.ts, the
 * same split accountEnding.ts has from accountEndingApi.ts.
 *
 * LAPSED IS DERIVED, by the database's `account_settlement` and never stored: a stored 'lapsed'
 * needs a nightly job, and the night it does not run a collector quotes a dead figure.
 */

/** What the card and the merge read. `state` is `status` with lapsed derived. */
export type SettlementState = 'proposed' | 'approved' | 'lapsed' | 'declined' | 'withdrawn' | 'paid'

export interface Settlement {
  id: string
  accountId: string
  amount: number
  balanceAtOffer: number
  balanceAsAt: string
  saving: number
  status: Exclude<SettlementState, 'lapsed'>
  state: SettlementState
  expiresOn: string | null
  proposedBy: string | null
  proposedAt: string
  proposalNote: string | null
  approvedBy: string | null
  approvedAt: string | null
  approvalEvidence: string | null
  closedBy: string | null
  closedAt: string | null
  closedReason: string | null
  /** Money in the trust account towards it, received from the offer to its expiry. */
  paidToward: number
  /**
   * WHAT THE DEBTOR OFFERED (S22). `amount` is what the client agreed; where the two differ, the client made a counter
   * offer. Null on a row read through account_settlement, which does not carry it -- the approve box then treats the
   * amount as the offer.
   */
  offeredAmount?: number | null
}

export function toSettlement(row: Record<string, unknown>): Settlement {
  const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    amount: n(row.amount),
    balanceAtOffer: n(row.balance_at_offer),
    balanceAsAt: String(row.balance_as_at),
    saving: n(row.saving),
    status: row.status as Settlement['status'],
    state: row.state as SettlementState,
    expiresOn: s(row.expires_on),
    proposedBy: s(row.proposed_by),
    proposedAt: String(row.proposed_at),
    proposalNote: s(row.proposal_note),
    approvedBy: s(row.approved_by),
    approvedAt: s(row.approved_at),
    approvalEvidence: s(row.approval_evidence),
    closedBy: s(row.closed_by),
    closedAt: s(row.closed_at),
    closedReason: s(row.closed_reason),
    paidToward: n(row.paid_toward),
    offeredAmount: row.offered_amount === null || row.offered_amount === undefined ? null : Number(row.offered_amount),
  }
}

/** The firm's words for each state, as the card heads itself. */
export const SETTLEMENT_STATE_LABEL: Record<SettlementState, string> = {
  proposed: 'Waiting for the client',
  approved: 'Approved by the client',
  lapsed: 'Lapsed',
  declined: 'Declined by the client',
  withdrawn: 'Withdrawn',
  paid: 'Paid and settled',
}

/**
 * MAY THIS FIGURE BE SAID TO A DEBTOR? Approved and not lapsed -- and nothing else. A proposal is
 * the debtor's own number and the client has not agreed it; a lapsed one is "the full balance of
 * {{balance}} is owing again". This is the one place the answer is decided: the merge fields and
 * the call script both ask it.
 */
export function isQuotable(s: Settlement | null | undefined): s is Settlement & { expiresOn: string } {
  return !!s && s.state === 'approved' && !!s.expiresOn
}

/**
 * IS IT PAID? Approved (lapsed included -- money that arrived before the expiry still counts, and
 * paidToward only counts money received by then) and the trust account holds the figure.
 * "A part payment does not settle it": anything short is not paid, however close.
 */
export function isPaidInFull(s: Settlement | null | undefined): boolean {
  return !!s && (s.state === 'approved' || s.state === 'lapsed') && s.paidToward + 0.005 >= s.amount
}

/**
 * WHAT THE THREE MERGE FIELDS SAY, or nothing at all.
 *
 * NULL UNLESS QUOTABLE, which is what keeps the firm's DO NOT true in every template at once:
 * renderTemplate leaves an unanswered placeholder STANDING, so a settlement email or the
 * settlement script on an account with no approved figure shows the gap rather than a number the
 * client never agreed.
 */
export function settlementMergeValues(
  s: Settlement | null | undefined,
  money: (amount: number) => string,
  longDate: (iso: string) => string,
): { amount: string; expiry: string; saving: string } | null {
  if (!isQuotable(s)) return null
  return { amount: money(s.amount), expiry: longDate(s.expiresOn), saving: money(s.saving) }
}

/**
 * WHAT A SETTLEMENT WOULD PAY, worked out by the engine (Stephan, 18 Nov, S22 · Raptor H20): "an automatic
 * calculation ... the capital outstanding ... our fees ... how much capital will be settled minus commission and how
 * much the client will get out if the settlement has been approved."
 *
 * EVERY FIGURE IS preview_allocation's (read back by `settlement_breakdown`): what allocate_payment would post if the
 * offer arrived today. NOTHING IS ADDED UP HERE except the totals of what the engine handed over -- the client is
 * told what the payover will pay them, and a second calculation is a second answer. Interest still runs until the
 * money arrives, so it is TODAY's split and the letter says so.
 */
export interface SettlementBreakdown {
  amount: number
  /** What the debtor offered; differs from `amount` on a counter offer. */
  offered: number
  /** True where the figures were frozen when the offer was put up (S22) -- what the client is told is what is paid. */
  frozen: boolean
  /** Where the offer was made as a percentage discount. */
  discountPct: number | null
  /** Owed today, before the offer. `fees` are the firm's Annexure B fees left to take. */
  capital: number
  interest: number
  fees: number
  /** The item 9 fee this receipt raises -- already inside `toFees`, shown so nobody counts it twice. */
  receiptFee: number
  toFees: number
  toInterest: number
  toCapital: number
  commission: number
  commissionVat: number
  /** Null where the client has no rate on file; the letter then names commission without a percentage. */
  commissionRate: number | null
  toClient: number
  /** The firm's share: interest, fees and commission (VAT on commission is SARS's, shown apart). */
  bfTakes: number
  /** More than the account can take -- held as the debtor's credit. Should be nought on a real settlement. */
  excess: number
  capitalAfter: number
  interestAfter: number
  feesAfter: number
  asAt: string
}

export function toBreakdown(row: Record<string, unknown>): SettlementBreakdown {
  const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
  return {
    amount: n(row.amount),
    offered: row.offered === null || row.offered === undefined ? n(row.amount) : n(row.offered),
    frozen: row.frozen === true,
    discountPct: row.discount_pct === null || row.discount_pct === undefined ? null : Number(row.discount_pct),
    capital: n(row.capital), interest: n(row.interest), fees: n(row.fees),
    receiptFee: n(row.receipt_fee),
    toFees: n(row.to_fees), toInterest: n(row.to_interest), toCapital: n(row.to_capital),
    commission: n(row.commission), commissionVat: n(row.commission_vat),
    commissionRate: row.commission_rate === null || row.commission_rate === undefined ? null : Number(row.commission_rate),
    toClient: n(row.to_client), bfTakes: n(row.bf_takes), excess: n(row.excess),
    capitalAfter: n(row.capital_after), interestAfter: n(row.interest_after), feesAfter: n(row.fees_after),
    asAt: String(row.as_at ?? ''),
  }
}

const cents = (x: number) => Math.round(x * 100) / 100

/** What is owed today, before the offer: the three parts the engine reported, added. */
export function owedToday(b: SettlementBreakdown): number {
  return cents(b.capital + b.interest + b.fees)
}

/**
 * WHAT IS GIVEN UP, AND BY WHOM. The client gives up capital; the firm gives up fees and interest. Read off the
 * engine's own "left after" figures, so the two halves add to what the debtor is excused.
 */
export function writtenOff(b: SettlementBreakdown): { byClient: number; byFirm: number; total: number } {
  const byClient = cents(b.capitalAfter)
  const byFirm = cents(b.feesAfter + b.interestAfter)
  return { byClient, byFirm, total: cents(byClient + byFirm) }
}
