import { useEffect, useRef, useState } from 'react'
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
  if (user.role === 'Administrator' || user.role === 'Sales Manager' || user.role === 'Liaison Manager') return true
  return !!ownerId && user.id === ownerId
}

/** Reassigning a record to a different owner is a managerial action, independent of who currently owns it. */
export function canReassign(user: Pick<User, 'role'> | null | undefined): boolean {
  return user?.role === 'Administrator' || user?.role === 'Sales Manager' || user?.role === 'Liaison Manager'
}

/** Roles eligible to own a Lead/Deal/Task/Contact/Company — i.e. show up in "assign to" / "Client Liaison" pickers. */
export function isAssignableOwner(role: Pick<User, 'role'>['role']): boolean {
  return role === 'Administrator' || role.includes('Sales') || role === 'Liaison' || role === 'Liaison Manager'
}

/**
 * "Owner" list-filter state that defaults to the current user's own
 * records the moment their profile loads — Administrators/Sales
 * Managers default to "All" instead, since seeing the whole team is
 * their normal view. A pre-supplied value (e.g. a drill-down link's
 * `?owner=` URL param) always wins and is never overridden.
 *
 * currentUser is typically still null on first render (the profile
 * fetch after sign-in is async), so this can't be a useState initializer
 * — it applies once, in an effect, the moment currentUser actually
 * arrives, and never again afterward (so it doesn't stomp on a later
 * manual filter change).
 */
export function useDefaultOwnerFilter(
  initialValue: string | undefined,
  currentUser: Pick<User, 'id' | 'role'> | null | undefined,
): [string, (value: string) => void] {
  const [owner, setOwner] = useState(initialValue ?? 'All')
  const defaulted = useRef(!!initialValue)
  useEffect(() => {
    if (defaulted.current || !currentUser) return
    defaulted.current = true
    if (currentUser.role !== 'Administrator' && currentUser.role !== 'Sales Manager') {
      setOwner(currentUser.id)
    }
  }, [currentUser])
  return [owner, setOwner]
}
