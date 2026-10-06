/**
 * A sliding scale as somebody types it (rands and percentages) and as the engine prices from it
 * (fractions). Pure, and held end to end by e2e/commission-scale; the editor that draws
 * it is components/companies/CommissionScaleEditor.tsx.
 */
import { tierStart } from './commission.ts'

export interface Tier { upTo: string; rate: string }

export const money = (n: number) => n.toLocaleString('en-ZA', {
  style: 'currency', currency: 'ZAR', minimumFractionDigits: 2,
})

const amount = (v: string) => Number(v.replace(/[\s,]/g, ''))

/** The label under a tier's row: where it starts, worked out by tierStart. */
export function startOf(tiers: Tier[], i: number): string {
  const previous = i === 0 ? null : amount(tiers[i - 1]?.upTo ?? '')
  const from = tierStart(i === 0 ? null : previous)
  return from === null ? 'From —' : `From ${money(from)}`
}

/** A percentage typed as 30, as the 0.3 every rate in Raptor is. NaN where it is not a rate. */
export const asFraction = (v: string): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n / 100 : NaN
}

/** What the editor holds, as the bands the engine prices from. */
export function tiersToBands(tiers: Tier[]): { upTo: number | null; rate: number }[] {
  return tiers.map((t) => ({
    upTo: t.upTo.trim() === '' ? null : amount(t.upTo),
    rate: asFraction(t.rate),
  }))
}

/** A stored scale, back into the editor -- so changing one starts from what is there. */
export function bandsToTiers(bands: { upTo: number | null; rate: number }[] | null | undefined): Tier[] {
  if (!bands || bands.length === 0) return [{ upTo: '100000', rate: '' }, { upTo: '', rate: '' }]
  return bands.map((b) => ({
    upTo: b.upTo === null ? '' : String(b.upTo),
    /* Rounded to the cent of a percent: 0.225 is 22.5, not 22.500000000000004. */
    rate: String(Math.round(b.rate * 10000) / 100),
  }))
}

/** The scale in words, for a confirmation that reads the terms back. */
export function scaleTerms(tiers: Tier[]): string[] {
  return tiers.map((t, i) => {
    const from = startOf(tiers, i).replace('From ', '')
    const to = t.upTo.trim() === '' ? 'and above' : `up to ${money(amount(t.upTo))}`
    return `${from} ${to} — ${t.rate}%`
  })
}
