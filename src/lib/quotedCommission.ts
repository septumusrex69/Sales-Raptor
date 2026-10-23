/**
 * THE RATE THE LEAD WAS QUOTED IS THE CLIENT'S RATE UNTIL SOMEBODY SAYS OTHERWISE (23 Oct).
 *
 * Stephan, of Convert to Client: "The commission percentage on what the client has signed should go
 * as default in about what it was sent out originally ... But we should be able to change it if we
 * need it. We should basically just confirm it."
 *
 * What was sent out is on the signing request the mandate went with (`signing_requests.mandate`,
 * frozen at send time by SendMandateModal: a flat `rate` or a `scale` of bands, every rate a
 * fraction). The newest one sent from the lead is the offer that stood; a cancelled one was
 * withdrawn and is not. This turns it into what the conversion's commission editor holds -- a
 * percentage typed as "30", or the scale's rows -- so the box opens filled and the person confirms.
 *
 * Only a DEFAULT. Nothing here writes a rate anywhere; the conversion still saves what is in the
 * box, and where nothing was quoted the box stays empty and required, exactly as before.
 *
 * Pure, so a check can hold it.
 */
import { bandsToTiers, type Tier } from './commissionTiers.ts'
import { commissionLine, type MandateCommission } from './mandate.ts'

export type QuotedDefault =
  | { kind: 'fixed'; rate: string; said: string }
  | { kind: 'scale'; tiers: Tier[]; said: string }

/** A rate as the box shows it: 0.3 is "30", 0.225 is "22.5" -- never 22.500000000000004. */
const asPercent = (fraction: number): string => String(Math.round(fraction * 10000) / 100)

/** The commission frozen on a mandate, as the conversion's editor holds it; null where none was quoted. */
export function quotedCommissionDefault(mandate: unknown): QuotedDefault | null {
  const c = (mandate as { commission?: MandateCommission } | null | undefined)?.commission
  if (!c) return null
  if (c.kind === 'rate') {
    if (typeof c.rate !== 'number' || !Number.isFinite(c.rate) || c.rate <= 0) return null
    return { kind: 'fixed', rate: asPercent(c.rate), said: commissionLine(c) }
  }
  if (c.kind === 'scale' && Array.isArray(c.bands) && c.bands.length > 0) {
    return { kind: 'scale', tiers: bandsToTiers(c.bands), said: commissionLine(c) }
  }
  return null
}

/**
 * The offer that stood: the newest signing request carrying terms that was not withdrawn. Rows as
 * PostgREST returns them, in any order.
 */
export function standingMandate<T extends { created_at: string; state?: string | null; mandate?: unknown }>(rows: T[]): T | null {
  return [...rows]
    .filter((r) => r.mandate && r.state !== 'cancelled')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
}
