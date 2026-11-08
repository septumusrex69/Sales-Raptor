/**
 * THE SMALL RINGS BESIDE A COLLECTOR'S FIGURES (S19 · Raptor H18). Stephan, 8 Nov: "for the promises, the traces,
 * how the day is spent ... little pie charts to show, you know, how many are kept, how many are taken. So I like
 * what's there and keep it there, but just on the side of it ... make like a small little pie chart."
 *
 * A ring is a part-of-a-whole, so each is drawn only over something that IS a whole -- and says which:
 *   PROMISES  the ones taken: kept, broken, still to come. Kept in the middle as a share of those resolved, the same
 *             rate the bar under the figures shows (a promise not yet due is neither).
 *   THE DAY   the actions: calls, emails, SMS, notes written.
 *   TRACES    what the traces turned up: verified, tried and not right, not tried yet. The hit rate in the middle is
 *             of what was TRIED, never of what the bureau printed -- the card's own rule.
 * NOTHING NEW IS COUNTED: every slice is a figure already on the card, so the ring and the numbers cannot disagree.
 */
export interface RingPart { name: string; value: number; color: string }

/* Status colours for the two that are about outcomes -- good, bad, not yet -- each named in the legend beside it. */
const GOOD = 'var(--c-green)'
const BAD = 'var(--c-rust-deep)'
const NOT_YET = '#a3b1c2'
/* The day's four channels are identities, not states: the validated categorical order (dataviz palette, light). */
const CHANNEL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100']

export function promiseRing(p: { made: number; kept: number; broken: number; resolved: number }): RingPart[] {
  return [
    { name: 'Kept', value: p.kept, color: GOOD },
    { name: 'Broken', value: p.broken, color: BAD },
    { name: 'Still to come', value: Math.max(0, p.made - p.resolved), color: NOT_YET },
  ]
}

export function dayRing(d: { calls: number; emails: number; sms: number; notes: number }): RingPart[] {
  return [
    { name: 'Calls', value: d.calls, color: CHANNEL[0] },
    { name: 'Emails', value: d.emails, color: CHANNEL[1] },
    { name: 'SMS', value: d.sms, color: CHANNEL[2] },
    { name: 'Notes', value: d.notes, color: CHANNEL[3] },
  ]
}

export function traceRing(t: { leads: number; worked: number; verified: number }): RingPart[] {
  const worked = t.worked
  return [
    { name: 'Verified', value: t.verified, color: GOOD },
    { name: 'Tried, not right', value: Math.max(0, worked - t.verified), color: BAD },
    { name: 'Not tried yet', value: Math.max(0, t.leads - worked), color: NOT_YET },
  ]
}

/** The middle of a ring: a whole-number percentage, or a dash where there is nothing to divide. */
export function ringPercent(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)}%`
}
