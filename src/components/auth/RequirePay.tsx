import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../store/AuthContext'
import { canViewPay } from '../../lib/permissions'

/**
 * Keeps the People workspace -- salaries and the clerks' commission -- from everybody without
 * people.pay, which no role has: the firm named the two people who see pay.
 *
 * A COURTESY, NOT THE BOUNDARY. employee_profiles, its history and the overrides answer nobody
 * without the tick, and both pay functions refuse; somebody who typed the address would see a
 * refusal rather than a salary. This spares them the empty page and puts them back where their work is.
 */
export function RequirePay({ children }: { children: ReactNode }) {
  const { currentUser, loading } = useAuth()
  if (loading || !currentUser) return null
  if (!canViewPay(currentUser)) return <Navigate to="/" replace />
  return <>{children}</>
}
