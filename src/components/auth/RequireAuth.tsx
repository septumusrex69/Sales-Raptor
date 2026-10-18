import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../store/AuthContext'
import { SetPasswordPage } from '../../pages/auth/SetPasswordPage'
import { IdleTimeout } from './IdleTimeout'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, currentUser, signOut, passwordSetupRequired, profileError, reloadProfile } = useAuth()
  const location = useLocation()

  if (loading) {
    return <div className="flex h-dvh items-center justify-center text-sm text-slate-400">Loading…</div>
  }
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  if (passwordSetupRequired) {
    return <SetPasswordPage />
  }
  // Without a profile the app doesn't know who is using it, and everything it saves is stamped
  // with that person. Letting it through anyway is what turned one failed request into a
  // session where nothing could be saved, so stop here and offer a way out instead.
  if (profileError) {
    return (
      <div className="flex h-dvh items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <p className="font-semibold text-navy-950 mb-1">We couldn't load your profile</p>
          <p className="text-sm text-slate-500 mb-4">{profileError}</p>
          <div className="flex items-center justify-center gap-2">
            <button onClick={reloadProfile} className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
              Try again
            </button>
            <button onClick={() => signOut()} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-500 hover:bg-slate-100">
              Sign out
            </button>
          </div>
        </div>
      </div>
    )
  }
  if (currentUser?.status === 'Inactive') {
    return (
      <div className="flex h-dvh items-center justify-center px-4">
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
  return (
    <>
      <IdleTimeout />
      {children}
    </>
  )
}
