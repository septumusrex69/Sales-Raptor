import type { Company } from '../types'

/**
 * DOES THIS CLIENT NEED A MANDATE DATE BEFORE A HANDOVER? (prompt 10)
 *
 * "No mandate, no handover" is the firm's rule for a client SIGNED IN RAPTOR. A client the
 * Swordfish import brought across already has a book with the firm, and Swordfish's register
 * carries "Sign Date" for some clients and not others -- so for them a missing date is a gap in
 * the old system's records, not a client nobody signed. They take handovers without one.
 *
 * The database holds the same rule (client_needs_mandate, and the handovers_need_a_mandate trigger
 * on the batch row), so this only decides what the screen says and offers.
 */
export function fromSwordfish(c: Pick<Company, 'importBatchId'> | null | undefined): boolean {
  return !!c?.importBatchId
}

export function needsMandate(c: Pick<Company, 'importBatchId' | 'mandateSignedAt'> | null | undefined): boolean {
  return !!c && !fromSwordfish(c) && !c.mandateSignedAt
}
