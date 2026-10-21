/**
 * HELD FOR SWORDFISH PAYOVERS (S10; HANDOFF 3a item 2, the design agreed under S8).
 *
 * The cut-over is the end of 10 December 2026. Swordfish still pays clients on 11 Dec and 11 Jan out
 * of the trust account, from money it received before the cut-over, and it cannot say what it owes
 * each client ("Swordfish can do nothing"). So that money has no name on any ledger, and without one
 * the Trust overview read it as "not accounted for" -- then read every Swordfish payout as a
 * shortfall. It is held as ONE bucket instead: set once at the cut-over out of the bank's opening
 * balance (set_swordfish_holding), its debits taken off it from To sort (allocate_swordfish_line),
 * and what is left drawn as its own line.
 *
 * WHAT IS LEFT AFTER THE LAST SWORDFISH RUN IS THE ONE-OFF SWORDFISH DIFFERENCE. Closing it is the
 * firm's decision -- firm fees may be written off, client money may not -- so nothing here closes it;
 * the screen only shows it.
 *
 * PURE, so a check can hold it. The calls are in trust.ts and bankAllocationApi.ts; the arithmetic
 * that counts is swordfish_holding_figures in the database, and this file only reads its answer.
 */

export type SwordfishKind = 'payover' | 'drawing'

/** The firm's words, as the line on the statement then reads. */
export const SWORDFISH_KIND_LABEL: Record<SwordfishKind, string> = {
  payover: 'Swordfish payover',
  drawing: 'Swordfish-era drawing',
}

export const SWORDFISH_KIND_NOTE: Record<SwordfishKind, string> = {
  payover: 'Swordfish paying a client from money it received before the cut-over. Comes off Held for Swordfish payovers; no client’s ledger moves.',
  drawing: 'A drawing Swordfish made for the money it earned before the cut-over. Comes off Held for Swordfish payovers; no ledger moves.',
}

export interface SwordfishHolding {
  /** What was set aside at the cut-over. */
  amount: number
  reason: string
  /** The trust OPENING date: the holding is part of the opening and is dated by it. */
  asAt: string | null
  setAt: string | null
  setBy: string | null
  paidOut: number
  payovers: number
  drawings: number
  lines: number
  /** amount - paidOut: still in the trust account for Swordfish to pay. */
  left: number
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const r2 = (v: number): number => Math.round(v * 100) / 100

export function toSwordfishHolding(row: Record<string, unknown>): SwordfishHolding {
  return {
    amount: n(row.amount),
    reason: String(row.reason ?? ''),
    asAt: row.as_at ? String(row.as_at) : null,
    setAt: row.set_at ? String(row.set_at) : null,
    setBy: row.set_by_name ? String(row.set_by_name) : null,
    paidOut: n(row.paid_out),
    payovers: n(row.payovers),
    drawings: n(row.drawings),
    lines: n(row.lines),
    left: n(row.left_over),
  }
}

/** What is left, or nought where nothing is held -- the one figure the overview's arithmetic adds. */
export function swordfishLeft(h: SwordfishHolding | null | undefined): number {
  return h ? r2(h.left) : 0
}

/**
 * MAY THIS DEBIT COME OFF THE HOLDING? The same three refusals allocate_swordfish_line makes, asked
 * first so a button is never offered and then refused: money OUT only, dated AFTER the opening (a line
 * on or before it is inside the opening balance already), and no more than is left.
 */
export function mayTakeOff(
  line: { direction: string; txnDate: string; amount: number },
  h: SwordfishHolding | null | undefined,
): boolean {
  if (!h || !h.asAt) return false
  if (line.direction !== 'debit') return false
  if (!(line.txnDate > h.asAt)) return false
  return r2(Math.abs(line.amount)) <= r2(h.left) && r2(Math.abs(line.amount)) > 0
}

/** The overview's sentence: "R x set on <date>, R y paid out, R z left". */
export function holdingSentence(h: SwordfishHolding, day: (iso: string) => string): string {
  const on = h.asAt ? ` set on ${day(h.asAt)}` : ''
  return `${randPlain(h.amount)}${on}, ${randPlain(h.paidOut)} paid out, ${randPlain(h.left)} left`
}

/* Plain, so this file stays importable by a check (money.ts formats with Intl the same way). */
function randPlain(v: number): string {
  return `${v < 0 ? '-' : ''}R ${Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`
}
