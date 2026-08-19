import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../store/AuthContext'
import { SetPasswordPage } from '../../pages/auth/SetPasswordPage'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, currentUser, signOut, passwordSetupRequired } = useAuth()
  const location = useLocation()

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-sm text-slate-400">Loading…</div>
  }
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  if (passwordSetupRequired) {
    return <SetPasswordPage />
  }
  if (currentUser?.status === 'Inactive') {
    return (
      <div className="flex h-screen items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <p className="font-semibold text-navy-950 mb-1">Account deactivated</p>
          <p className="text-sm text-slate-500 mb-4">Your account has been deactivated. Contact your administrator to regain access.</p>
          <button onClick={() => signOut()} className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Sign out
          </button>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
