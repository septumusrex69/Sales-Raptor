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

/* ---------------------------------------------------------------------------------------------
 * WHAT THE CLIENT ACTUALLY HAS, AS AGAINST WHAT THE REGISTER SAYS
 * ------------------------------------------------------------------------------------------- */

/**
 * One client's figures, counted off the accounts themselves.
 *
 * THE FIRM, AFTER THE FIRST TEST IMPORT: "The Accounts, Handover Amount and Payments to Date
 * columns read the figures typed into the client register. The real Meridian test client showed
 * 277 accounts while it held 6. Summit Fitness showed '—' while it had 5."
 *
 * `companies.account_count` and its two neighbours are what Swordfish's own summary said at the
 * moment of import. They are worth keeping and worth LABELLING as that -- a client who was told
 * they handed over 277 and whose file holds 6 is a conversation somebody needs to have -- but they
 * are not the book, and a column headed "Accounts" has to be the book.
 */
export interface ClientBookTotals {
  accounts: number
  capital: number
  outstanding: number
  paid: number
}

const EMPTY: ClientBookTotals = { accounts: 0, capital: 0, outstanding: 0, paid: 0 }

/**
 * A client's own totals plus every sub-account's, from a map keyed by company id.
 *
 * ROLLED UP THE SAME WAY THE REGISTER FIGURES ARE, because the hierarchy is the same hierarchy:
 * Baobab Hillcrest and Baobab Arcadia Street are two Swordfish codes under one client, and the
 * firm reads the parent. A parent that counted only its OWN accounts would read nil beside two
 * children holding four.
 */
export function rollupBookTotals(
  company: Company,
  companies: Company[],
  totals: Map<string, ClientBookTotals>,
): ClientBookTotals {
  const own = totals.get(company.id) ?? EMPTY
  const kids = companies.filter((c) => c.parentCompanyId === company.id)
  return kids.reduce((sum, k) => {
    const kid = rollupBookTotals(k, companies, totals)
    return {
      accounts: sum.accounts + kid.accounts,
      capital: sum.capital + kid.capital,
      outstanding: sum.outstanding + kid.outstanding,
      paid: sum.paid + kid.paid,
    }
  }, own)
}

/**
 * WHERE THE REGISTER AND THE BOOK DISAGREE, in accounts.
 *
 * Null where the register says nothing, which is most of them -- and "nothing" is not a
 * disagreement. Shown rather than reconciled: which of the two is right is the firm's question to
 * ask the client, not Raptor's to decide.
 */
export function registerGap(
  register: ClientRollup, actual: ClientBookTotals,
): number | null {
  if (register.accountCount === undefined || register.accountCount === null) return null
  return register.accountCount - actual.accounts
}
