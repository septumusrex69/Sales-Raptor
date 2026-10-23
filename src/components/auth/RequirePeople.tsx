import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../store/AuthContext'
import { canSeeSomeLeave, canViewPay } from '../../lib/permissions'

/**
 * THE PEOPLE WORKSPACE'S DOOR, NOW TWO LISTS WIDE (23 Oct): pay (people.pay, the two people the firm
 * named) or leave (any Administrator, and a team leader for their team -- the firm: "Team leaders can
 * also see the leave of their teams"). Inside, every pay screen keeps RequirePay of its own, so
 * widening this door widened nothing about who sees a salary.
 *
 * A COURTESY, NOT THE BOUNDARY: leave_records answers by leave_visible(), the pay tables by
 * people.pay.
 */
export function RequirePeople({ children }: { children: ReactNode }) {
  const { currentUser, loading } = useAuth()
  if (loading || !currentUser) return null
  if (!canViewPay(currentUser) && !canSeeSomeLeave(currentUser)) return <Navigate to="/" replace />
  return <>{children}</>
}

/** /people itself: the pay list for a pay holder, the leave for everybody else let in. */
export function PeopleHome({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth()
  if (!canViewPay(currentUser)) return <Navigate to="/people/leave" replace />
  return <>{children}</>
}
