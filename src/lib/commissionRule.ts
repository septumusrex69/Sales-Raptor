/**
 * WHAT A CLIENT'S COMMISSION RULE IS, AND WHERE AN ACCOUNT'S RATE CAME FROM (prompt 9).
 *
 * THE RULE THE FIRM'S MANDATES STATE, settled against the engine that disagreed with it: on a
 * sliding scale each account gets ONE rate, from the band its capital handed over falls in,
 * decided once at handover; the boundary rand belongs to the lower band (rateForCapital,
 * swordfishClients.ts, docs/debt-collection-model.md §3a). The database says the same thing in
 * account_commission_rate, which is what the engine charges; this is the browser's statement of it,
 * so a screen can say WHY an account is on its rate.
 *
 * THREE SOURCES, IN THE ORDER THE ENGINE ASKS THEM:
 *   1. the account's own rate -- what Swordfish billed it, or what its handover stamped;
 *   2. the client's band, on this account's capital handed over;
 *   3. the client's flat rate.
 *
 * Pure: no database, no React, so check-commission-rule can hold it.
 */
import { rateForCapital, type CommissionBand } from './commission.ts'

export interface ClientCommission {
  commissionRate?: number | null
  commissionBands?: CommissionBand[] | null
  commissionTiers?: { prefix: string; rate: number }[] | null
}

export type RuleKind =
  /** Bands captured from the mandate: the rule prices every new account. */
  | 'scale'
  /** The register shows a scale, but its rand boundaries have not been captured. Blocks a handover. */
  | 'scale_without_bands'
  | 'flat'
  | 'none'

export function ruleKind(c: ClientCommission): RuleKind {
  if (c.commissionBands && c.commissionBands.length > 0) return 'scale'
  if (c.commissionTiers && c.commissionTiers.length > 1) return 'scale_without_bands'
  if (c.commissionRate !== null && c.commissionRate !== undefined) return 'flat'
  return 'none'
}

/** "30%", "22.5%": a fraction as the firm writes it. */
export const pct = (r: number): string => `${Math.round(r * 10000) / 100}%`

const rands = (n: number): string => `R${Math.round(n).toLocaleString('en-ZA')}`

/** One band in words: "R0–R25 000 · 25%", "R25 000+ · 22.5%". */
export function bandWords(bands: CommissionBand[], i: number): string {
  const from = i === 0 ? 0 : (bands[i - 1].upTo ?? 0)
  const b = bands[i]
  return b.upTo === null ? `${rands(from)}+ · ${pct(b.rate)}` : `${rands(from)}–${rands(b.upTo)} · ${pct(b.rate)}`
}

/** The register's tiers in words: "KIS 21% · KIS2 15% · KIS3 12% · KIS4 10%". */
export function tierWords(tiers: { prefix: string; rate: number }[]): string {
  return tiers.map((t) => `${t.prefix} ${pct(t.rate)}`).join(' · ')
}

/** The rate the client's CURRENT rule gives an account of this capital. Undefined where it gives none. */
export function ruleRateFor(c: ClientCommission, capitalHandedOver: number | null | undefined): number | undefined {
  if (c.commissionBands && c.commissionBands.length > 0) {
    if (capitalHandedOver === null || capitalHandedOver === undefined) return undefined
    return rateForCapital(capitalHandedOver, { source: '', bands: c.commissionBands })
  }
  if (c.commissionRate !== null && c.commissionRate !== undefined) return c.commissionRate
  return undefined
}

export interface AccountRate {
  rate: number | null
  /** The rate and its source in one line: "21% — as billed in Swordfish (KIS tier)". */
  label: string
  /** Where the account's rate is not what its client's current rule would give it. */
  offRule: boolean
  /** What the rule would give instead, where it gives anything. */
  ruleRate: number | null
}

/**
 * WHICH REGISTER TIER AN IMPORTED ACCOUNT WAS BILLED UNDER, read back off its reference and rate.
 *
 * The import never stored the prefix; it stored the reference (KIS0012) and the rate the prefix
 * gave it (21%). So the tier is the one whose prefix starts the reference AND whose rate is the
 * billed rate -- both, because KIS2 accounts also start with "KIS", and two tiers can share a rate.
 * Longest prefix wins among those. Null where nothing matches: a label that names the wrong tier is
 * worse than one that names none.
 */
export function tierPrefixFor(
  reference: string | null | undefined, rate: number, tiers: { prefix: string; rate: number }[] | null | undefined,
): string | null {
  if (!reference || !tiers) return null
  const ref = reference.toUpperCase()
  const hits = tiers
    .filter((t) => ref.startsWith(t.prefix.toUpperCase()) && Math.round(t.rate * 10000) === Math.round(rate * 10000))
    .sort((a, b) => b.prefix.length - a.prefix.length)
  return hits[0]?.prefix ?? null
}

/**
 * AN ACCOUNT'S RATE, WITH WHERE IT CAME FROM -- the line a payment and an account both show.
 *
 * `prefix` is the Swordfish prefix the account was filed under, where the caller knows it;
 * otherwise `reference` is matched against the client's register tiers (tierPrefixFor).
 */
export function accountRate(input: {
  accountRate: number | null | undefined
  capitalHandedOver: number | null | undefined
  imported: boolean
  prefix?: string | null
  reference?: string | null
  client: ClientCommission
}): AccountRate {
  const { client } = input
  const rule = ruleRateFor(client, input.capitalHandedOver)
  const ruleRate = rule ?? null

  if (input.accountRate !== null && input.accountRate !== undefined) {
    const r = input.accountRate
    const prefix = input.prefix ?? tierPrefixFor(input.reference, r, client.commissionTiers)
    const label = input.imported
      ? `${pct(r)} — as billed in Swordfish${prefix ? ` (${prefix} tier)` : ''}`
      : `${pct(r)} — set on this account`
    /* Off the rule only where there IS a rule to be off. A client with no rule yet is not evidence
       that the account is wrong; a warning that fires when nothing is wrong teaches people to skip it. */
    const offRule = rule !== undefined && Math.round(rule * 10000) !== Math.round(r * 10000)
    return { rate: r, label, offRule, ruleRate }
  }

  const bands = client.commissionBands ?? []
  if (bands.length > 0 && rule !== undefined) {
    const i = bands.findIndex((b) => b.upTo === null || (input.capitalHandedOver ?? 0) <= b.upTo)
    return { rate: rule, label: `${pct(rule)} — band ${bandWords(bands, i).split(' · ')[0]}`, offRule: false, ruleRate }
  }
  if (rule !== undefined) return { rate: rule, label: `${pct(rule)} — client flat rate`, offRule: false, ruleRate }
  if (ruleKind(client) === 'scale_without_bands') {
    return { rate: null, label: 'No rate — the client is on a scale whose boundaries are not captured', offRule: false, ruleRate }
  }
  return { rate: null, label: 'No rate set', offRule: false, ruleRate }
}

/**
 * WHY A HANDOVER FOR THIS CLIENT CANNOT BE PRICED, in the sentence the firm asked for -- or null.
 *
 * "Kestrel is on a 4-tier scale but its rand boundaries are not captured — set them on the client
 * first." Pricing anyway would put every new account on one rate whatever its size, which is how the
 * scale was being lost for new business.
 */
export function handoverRateBlock(clientName: string, c: ClientCommission): string | null {
  if (ruleKind(c) !== 'scale_without_bands') return null
  const n = c.commissionTiers?.length ?? 0
  return `${clientName} is on a ${n}-tier scale but its rand boundaries are not captured — set them on the client first.`
}
