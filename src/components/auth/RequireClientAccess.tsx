import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../store/AuthContext'
import { canViewClients } from '../../lib/permissions'

/**
 * Keeps a pre-legal agent out of the client pages.
 *
 * They work debtors, not the firm's relationships — commission rates, mandates and open deals are
 * the liaison's business. Hiding the sidebar entry and the links is what makes the app honest;
 * this is what makes it true, because a URL can be typed. RLS is still the real boundary.
 *
 * Redirects rather than showing a refusal: being told off for a page you never asked for is worse
 * than simply being put back where your work is.
 */
export function RequireClientAccess({ children }: { children: ReactNode }) {
  const { currentUser, loading } = useAuth()
  if (loading || !currentUser) return null
  if (!canViewClients(currentUser.role)) return <Navigate to="/accounts" replace />
  return <>{children}</>
}
