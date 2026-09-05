import type { Company, ID } from '../types'

/**
 * A top-level company is a "client" once it has a Won deal of its own, or
 * it's a Swordfish-sourced record (has a code — either a real prefix on a
 * standalone/sub-account, or an internal code on a parent container).
 * Shared by CompaniesList and the Communications Dashboard so both agree
 * on what counts as a client to service.
 */
export function topLevelClients(companies: Company[], hasWonDeal: (companyId: ID) => boolean): Company[] {
  return companies.filter((c) => !c.parentCompanyId && (hasWonDeal(c.id) || !!c.code))
}

export interface ClientRollup {
  accountCount?: number
  handoverAmount?: number
  paymentsToDate?: number
}

/** Parents have no Swordfish totals of their own — roll their children's up. */
export function rollupClient(company: Company, companies: Company[]): ClientRollup {
  const kids = companies.filter((c) => c.parentCompanyId === company.id)
  if (kids.length === 0) return { accountCount: company.accountCount, handoverAmount: company.handoverAmount, paymentsToDate: company.paymentsToDate }
  return {
    accountCount: kids.reduce((s, k) => s + (k.accountCount ?? 0), 0),
    handoverAmount: kids.reduce((s, k) => s + (k.handoverAmount ?? 0), 0),
    paymentsToDate: kids.reduce((s, k) => s + (k.paymentsToDate ?? 0), 0),
  }
}

/** Paid-to-date as a % of handover amount. Undefined when there's no handover amount to divide by. */
export function collectionsCoefficient(rollup: ClientRollup): number | undefined {
  if (!rollup.handoverAmount || rollup.paymentsToDate === undefined) return undefined
  return (rollup.paymentsToDate / rollup.handoverAmount) * 100
}
