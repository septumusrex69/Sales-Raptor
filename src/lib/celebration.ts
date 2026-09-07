import { getCurrentSalesMonth, isWithinPeriod } from './salesMonth'
import { dealKind } from './dealKind'
import type { Deal } from '../types'

export type CelebrationIntensity = 'win' | 'milestone'

export interface Celebration {
  message: string
  intensity: CelebrationIntensity
}

/** Mandates are the core business, and they come in volume — so the bar is higher. */
export const MANDATE_MILESTONE_EVERY = 10
export const DEAL_MILESTONE_EVERY = 5

/**
 * What to celebrate, and how loudly.
 *
 * Counted within the current sales month rather than over a career. A lifetime total means the
 * person who has been here longest never sees a milestone again while a new starter trips over
 * one every week — the opposite of the intended effect. A month resets for everybody, and it is
 * the period targets are actually set against.
 *
 * Counted per person, too. Somebody else's good month shouldn't fire on your screen.
 */
export function celebrationForWin(deal: Deal, allDeals: Deal[], now: Date = new Date()): Celebration {
  const isHandover = dealKind(deal) === 'Handover'
  const period = getCurrentSalesMonth(now)
  const step = isHandover ? MANDATE_MILESTONE_EVERY : DEAL_MILESTONE_EVERY

  // The deal being won may or may not be in `allDeals` yet depending on where this is called
  // from, so it is counted by id rather than assumed either way.
  const wonThisMonth = allDeals.filter(
    (d) =>
      d.ownerId === deal.ownerId &&
      d.stage === 'Won' &&
      isWithinPeriod(d.wonAt, period) &&
      (dealKind(d) === 'Handover') === isHandover,
  )
  const count = wonThisMonth.some((d) => d.id === deal.id) ? wonThisMonth.length : wonThisMonth.length + 1

  if (count > 0 && count % step === 0) {
    return {
      message: isHandover ? `${count} mandates this month` : `${count} deals won this month`,
      intensity: 'milestone',
    }
  }
  return { message: isHandover ? 'Mandate signed' : 'Deal won', intensity: 'win' }
}
