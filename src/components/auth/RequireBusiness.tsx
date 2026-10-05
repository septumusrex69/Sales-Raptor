import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../store/AuthContext'
import { canViewBusiness } from '../../lib/permissions'

/**
 * Keeps everyone without `business.view` out of the firm's own accounts.
 *
 * A SEPARATE GUARD FROM RequireFinance, which is the whole point of the split. The firm: "the
 * trust and the business should be separated. It shouldn't be in the same tab in finance... we
 * have one place where we manage the trust and we have another place outside where we manage the
 * business." Trust is other people's money and this is Bredell Ferreira's, and the two lists of
 * people who should see each are not the same list in either direction.
 *
 * IT IS THE ONLY BOUNDARY TODAY, AND THAT IS WORTH SAYING OUT LOUD. RequireFinance can afford to
 * call itself a courtesy because every function behind it checks the role again in the database.
 * Nothing is behind this one yet -- the business tables are still to be built -- so until the
 * first of them arrives with a policy that asks has_capability('business.view'), this redirect is
 * all there is. The screens it covers read client_charges, which has its own policy, and the trust
 * position, which has its own guard; neither is widened by being drawn here.
 *
 * Redirects rather than refusing, like its sibling: being told off for a page you never asked for
 * is worse than being put back where your work is.
 */
export function RequireBusiness({ children }: { children: ReactNode }) {
  const { currentUser, loading } = useAuth()
  if (loading || !currentUser) return null
  if (!canViewBusiness(currentUser)) return <Navigate to="/" replace />
  return <>{children}</>
}
