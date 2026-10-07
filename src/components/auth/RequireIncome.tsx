import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../store/AuthContext'
import { canViewIncome } from '../../lib/permissions'

/**
 * Keeps the Income screen from everybody without business.income -- which, by the firm's ruling, is
 * nobody until somebody is given it, the Administrator included ("not even for an administrator").
 *
 * A COURTESY, NOT THE BOUNDARY. business_income answers nobody without the tick, so somebody who
 * typed the address would see an empty month rather than the firm's earnings. This only spares them
 * the empty page. Back to the business overview rather than to `/`, because a person who reached
 * this already has the workspace.
 */
export function RequireIncome({ children }: { children: ReactNode }) {
  const { currentUser, loading } = useAuth()
  if (loading || !currentUser) return null
  if (!canViewIncome(currentUser)) return <Navigate to="/business" replace />
  return <>{children}</>
}
