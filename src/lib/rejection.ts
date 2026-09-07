import type { RejectionReason } from '../types'

/**
 * Why business didn't happen — the same list for a lead we never signed and a deal that
 * fell over, so "why did we lose it" is answered the same way whichever record you're on.
 */
export const REJECTION_REASONS: RejectionReason[] = [
  'Not interested anymore',
  'Too expensive',
  'Went with another provider',
  'No response',
  'We declined them',
  'Other',
]
