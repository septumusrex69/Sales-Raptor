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
