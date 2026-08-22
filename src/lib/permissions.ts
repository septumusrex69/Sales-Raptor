import type { User } from '../types'

/**
 * Whether `user` may edit, close, or delete a record owned by `ownerId` —
 * the owner themselves, or an Administrator/Sales Manager. Mirrors the
 * Supabase RLS update/delete policies in supabase/schema.sql exactly, so
 * the UI only ever offers actions the database will actually allow;
 * RLS remains the real enforcement boundary, this just avoids a
 * confusing "button works, then silently fails" experience.
 */
export function canEditOwned(user: Pick<User, 'id' | 'role'> | null | undefined, ownerId: string | undefined): boolean {
  if (!user) return false
  if (user.role === 'Administrator' || user.role === 'Sales Manager') return true
  return !!ownerId && user.id === ownerId
}

/** Reassigning a record to a different owner is a managerial action, independent of who currently owns it. */
export function canReassign(user: Pick<User, 'role'> | null | undefined): boolean {
  return user?.role === 'Administrator' || user?.role === 'Sales Manager'
}
