import type { RunPayment } from './payover'

/**
 * R-21 (Raptor · Handover 17): TWO PAYMENTS ON ONE ACCOUNT ARE LISTED IN THE ORDER THEY WERE TAKEN OFF
 * THE BALANCE, not the order the database happened to return them.
 *
 * Finance saw Boitshoko Mose twice on a remittance, the top row reading R67.14 outstanding and the one
 * under it R288.39: "the capital outstanding does not calculate from the top payment ... and then take
 * that capital outstanding and minus the 2nd lines' allocated amount." Each figure was right -- they are
 * the capital left after THAT payment was split -- but the list was ordered by surname and received
 * date, so two payments on the same day (or one approved before an earlier-dated one) came out upside
 * down and the running balance read backwards. The capital outstanding only ever goes down as payments
 * land, so within one account the row with the MOST left was posted first. Only the ORDER changes;
 * no figure is recomputed (imported and posted history is frozen at what was posted).
 *
 * Only paid lines are re-slotted among themselves; a reversal, or a line with no account, stays
 * where it was, and accounts keep the positions the database gave them.
 */
export function inRunningOrder<T extends Pick<RunPayment, 'accountId' | 'lineKind' | 'capitalAfter'>>(lines: T[]): T[] {
  const slots = new Map<string, number[]>()
  lines.forEach((l, i) => {
    if (!l.accountId || (l.lineKind !== 'trust' && l.lineKind !== 'ptc')) return
    const at = slots.get(l.accountId)
    if (at) at.push(i); else slots.set(l.accountId, [i])
  })
  const out = lines.slice()
  for (const at of slots.values()) {
    if (at.length < 2) continue
    // Array.prototype.sort is stable, so equal balances keep the order the database gave them.
    const sorted = at.map((i) => lines[i]).sort((a, b) => b.capitalAfter - a.capitalAfter)
    at.forEach((i, k) => { out[i] = sorted[k] })
  }
  return out
}
