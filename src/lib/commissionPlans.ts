import type { CommissionBand } from './commission.ts'

/**
 * The commission a lead is quoted, from Bredell Ferreira's own price list.
 *
 * Either one flat rate for every account, or one of two sliding scales where the rate drops as
 * an account gets bigger. Anything else is typed in as a custom flat rate. Rates are fractions
 * (0.275, not 27.5), the same as the client record's commission_rate and commission_bands, so a
 * signed lead's terms can move across to the client without being converted.
 */

export type SlidingScaleId = 'SS25' | 'SS30'

/** 30% is the baseline; the rest are what the team agrees to for bigger or better books. */
export const FLAT_RATES = [0.30, 0.275, 0.25, 0.225, 0.20, 0.175, 0.15] as const

/**
 * Bands on the capital of each account, as in src/lib/commission.ts: `upTo` is inclusive, so an
 * account of exactly R100,000 is in the first band. Same convention as every signed mandate.
 */
export const SLIDING_SCALES: Record<SlidingScaleId, { label: string; bands: CommissionBand[] }> = {
  SS25: {
    label: '25% sliding scale',
    bands: [
      { upTo: 100_000, rate: 0.25 },
      { upTo: 500_000, rate: 0.20 },
      { upTo: 1_000_000, rate: 0.15 },
      { upTo: null, rate: 0.10 },
    ],
  },
  SS30: {
    label: '30% sliding scale',
    bands: [
      { upTo: 100_000, rate: 0.30 },
      { upTo: 500_000, rate: 0.25 },
      { upTo: 1_000_000, rate: 0.20 },
      { upTo: null, rate: 0.15 },
    ],
  },
}

export interface CommissionTerms {
  /** A flat rate, as a fraction. Set for a flat rate, list or custom. */
  commissionRate?: number
  /** Set for a sliding scale. Never alongside commissionRate. */
  commissionScale?: SlidingScaleId
}

/** 0.275 → "27.5%". */
export function formatRate(rate: number): string {
  const pct = Math.round(rate * 1000) / 10
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`
}

/** How the terms read wherever they're shown: "30%", "25% sliding scale". */
export function commissionLabel(terms: CommissionTerms): string | undefined {
  if (terms.commissionScale) return SLIDING_SCALES[terms.commissionScale]?.label
  if (terms.commissionRate !== undefined && terms.commissionRate !== null) return formatRate(terms.commissionRate)
  return undefined
}

/** The bands, said in words: "up to R100,000: 25% · R100,001–R500,000: 20% · …". */
export function describeScale(id: SlidingScaleId): string {
  const fmt = (n: number) => `R${n.toLocaleString('en-ZA')}`
  let from = 0
  return SLIDING_SCALES[id].bands.map((b) => {
    const span = b.upTo === null ? `over ${fmt(from)}` : from === 0 ? `up to ${fmt(b.upTo)}` : `${fmt(from + 1)}–${fmt(b.upTo)}`
    if (b.upTo !== null) from = b.upTo
    return `${span}: ${formatRate(b.rate)}`
  }).join(' · ')
}

/**
 * What a sheet's commission cell means: "30%", "27.50%", "25%SS", "SS25%", "25SS", "28%".
 *
 * "SS" means sliding scale, and the number beside it says which. "SS" on its own doesn't say
 * which scale, so it reads as nothing rather than as a guess — the text is kept in the notes.
 */
export function parseCommission(v: string | undefined): CommissionTerms | undefined {
  const s = (v ?? '').replace(/\s+/g, '').toUpperCase()
  if (!s || s === '-') return undefined
  const n = /(\d+(?:[.,]\d+)?)/.exec(s)
  const pct = n ? Number(n[1].replace(',', '.')) : undefined
  if (s.includes('SS')) {
    if (pct === 25) return { commissionScale: 'SS25' }
    if (pct === 30) return { commissionScale: 'SS30' }
    return undefined
  }
  if (pct === undefined || pct <= 0 || pct >= 100) return undefined
  return { commissionRate: Math.round(pct * 10) / 1000 }
}

// ─── The form's one select ───────────────────────────────────────────────────────────────────

/** One value for one <select>: a flat rate as its fraction ("0.275"), a scale id, or "custom". */
export type CommissionChoice = string

export const CUSTOM = 'custom'

export function choiceFromTerms(terms: CommissionTerms): { choice: CommissionChoice; custom: string } {
  if (terms.commissionScale) return { choice: terms.commissionScale, custom: '' }
  if (terms.commissionRate === undefined || terms.commissionRate === null) return { choice: '', custom: '' }
  const listed = FLAT_RATES.find((r) => Math.abs(r - terms.commissionRate!) < 1e-9)
  if (listed !== undefined) return { choice: String(listed), custom: '' }
  return { choice: CUSTOM, custom: String(Math.round(terms.commissionRate * 1000) / 10) }
}

/** Both fields are always returned, so choosing a scale clears a rate that was there before. */
export function termsFromChoice(
  choice: CommissionChoice, custom: string,
): { commissionRate: number | undefined; commissionScale: SlidingScaleId | undefined } {
  if (choice === 'SS25' || choice === 'SS30') return { commissionRate: undefined, commissionScale: choice }
  if (choice === CUSTOM) {
    const pct = Number(custom.replace(',', '.').replace('%', ''))
    return { commissionRate: Number.isFinite(pct) && pct > 0 && pct < 100 ? Math.round(pct * 10) / 1000 : undefined, commissionScale: undefined }
  }
  const rate = Number(choice)
  return { commissionRate: choice && Number.isFinite(rate) ? rate : undefined, commissionScale: undefined }
}

export const COMMISSION_OPTIONS: { value: CommissionChoice; label: string }[] = [
  ...FLAT_RATES.map((r) => ({ value: String(r), label: r === 0.30 ? `${formatRate(r)} (baseline)` : formatRate(r) })),
  { value: 'SS25', label: SLIDING_SCALES.SS25.label },
  { value: 'SS30', label: SLIDING_SCALES.SS30.label },
  { value: CUSTOM, label: 'Custom…' },
]
