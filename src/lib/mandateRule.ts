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

/**
 * NO MANDATE OR NO COMMISSION, NO WORK (S10, prompt 13 item 3) -- the sentence to show, or null.
 *
 * The browser's copy of client_work_refusal: the database refuses the batch row and the hand-added
 * debtor alike, and this decides what the client page and the import screen say and offer before
 * anybody gets as far as the refusal. The mandate half keeps the Swordfish exemption above; the
 * commission half has none -- an account with no rate is an account nobody can invoice.
 */
export function hasCommission(c: Pick<Company, 'commissionRate' | 'commissionBands'>): boolean {
  return (c.commissionRate !== null && c.commissionRate !== undefined) || (c.commissionBands?.length ?? 0) > 0
}

export function workBlock(
  c: Pick<Company, 'name' | 'importBatchId' | 'mandateSignedAt' | 'commissionRate' | 'commissionBands'> | null | undefined,
): string | null {
  if (!c) return null
  const noMandate = needsMandate(c)
  const noCommission = !hasCommission(c)
  if (noMandate && noCommission) return `${c.name} has no signed mandate and no commission on record, so no debtors or handovers can be loaded for them. Set both on the client first.`
  if (noMandate) return `${c.name} has no signed mandate on record, so no debtors or handovers can be loaded for them. Set it on the client first.`
  if (noCommission) return `${c.name} has no commission on record, so no debtors or handovers can be loaded for them. Set it on the client first.`
  return null
}

/** Where both are set: the client's own commission-and-mandate card. */
export const clientTermsLink = (companyId: string): string => `/companies/${companyId}#commission-mandate`
