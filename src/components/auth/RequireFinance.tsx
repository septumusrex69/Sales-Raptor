import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../store/AuthContext'
import { canViewFinance } from '../../lib/permissions'

/**
 * Keeps everyone but an Administrator out of the Finance section.
 *
 * The firm's own condition for the module: "The Finance section is Administrator only. Sales
 * representatives never see the payment split." Hiding the sidebar entry is what makes the app
 * honest; this is what makes it true, because a URL can be typed.
 *
 * AND NEITHER IS THE REAL BOUNDARY. Every function these screens read checks the role in the
 * database, because they run as security definer and there is no policy to fall back on inside
 * one. This redirects rather than refusing: being told off for a page you never asked for is
 * worse than being put back where your work is.
 */
export function RequireFinance({ children }: { children: ReactNode }) {
  const { currentUser, loading } = useAuth()
  if (loading || !currentUser) return null
  if (!canViewFinance(currentUser.role)) return <Navigate to="/" replace />
  return <>{children}</>
}
