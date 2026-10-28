import type { User } from '../types'

/**
 * A CLOSED ACCOUNT IS THE FIRM'S, NOT A COLLECTOR'S (S15, Raptor · Handover 14).
 *
 * Stephan: "if an account is written off or withdrawn or anything, it doesn't stay on a person's
 * name ... it goes to the company's name. Maybe we call it company account or something like that."
 * Asked, he chose the firm's own name: "company" already means a CLIENT everywhere in Raptor, so a
 * "company account" would read as the client's. settle_account and withdraw_account clear
 * `assigned_to` as they close (close_account_admin_or_liaison), and this is what the screen says in
 * its place. A LIVE account with nobody on it is still "Unallocated" -- that one is work waiting for
 * a person, and the two must never read alike.
 */
export const FIRM_DESK = 'Bredell Ferreira'

export function deskLabel(
  account: { assignedTo?: string | null; endedAs?: string | null },
  nameOf: (id: string) => string | null | undefined,
): string | null {
  if (account.assignedTo) return nameOf(account.assignedTo) ?? 'Someone no longer here'
  return account.endedAs ? FIRM_DESK : null
}

/**
 * WHO MAY CLOSE AN ACCOUNT -- paid up, settled, written off or withdrawn. Stephan: "only
 * administrators or client liaison can close an account"; asked, any Administrator and the liaison of
 * THAT account's client (or of the main client, for a sub-account). The browser's copy of
 * `may_close_account`, for drawing the button; the function is the guard.
 */
export function canCloseAccount(
  user: Pick<User, 'id' | 'role'> | null | undefined,
  client: { accountOwnerId?: string | null } | null | undefined,
  mainClient?: { accountOwnerId?: string | null } | null,
): boolean {
  if (!user) return false
  if (user.role === 'Administrator') return true
  return (!!client?.accountOwnerId && client.accountOwnerId === user.id)
    || (!!mainClient?.accountOwnerId && mainClient.accountOwnerId === user.id)
}
