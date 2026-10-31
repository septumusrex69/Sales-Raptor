import type { DebtorAccount } from './accountBook'

/**
 * WHICH ACCOUNT A TYPED REFERENCE MEANS (Raptor H15, R-14: "a block next to each transaction where we can
 * add the reference number and then a button").
 *
 * EXACT, AND ONLY WHEN IT IS ONE. The accounts search matches part of a number, so DCR181 would also find
 * DCR1811. Placing a receipt credits the debtor AND remits the client and can only be reversed, so a
 * reference that finds nothing, or finds two accounts, places nothing and says so -- the person then uses
 * Place it and looks, as before. Nothing is guessed.
 */
export type ReferenceMatch =
  | { kind: 'one'; account: DebtorAccount }
  | { kind: 'none' }
  | { kind: 'many'; count: number }

const same = (a: string | null | undefined, b: string) => !!a && a.trim().toUpperCase() === b

export function matchReference(reference: string, accounts: DebtorAccount[]): ReferenceMatch {
  const ref = reference.trim().toUpperCase()
  if (!ref) return { kind: 'none' }
  const hits = accounts.filter((a) => same(a.caseNumber, ref) || same(a.accountNumber, ref) || same(a.clientReference, ref))
  const ids = new Set(hits.map((a) => a.id))
  if (ids.size === 1) return { kind: 'one', account: hits[0] }
  return ids.size === 0 ? { kind: 'none' } : { kind: 'many', count: ids.size }
}
