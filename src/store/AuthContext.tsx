import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { User, UserRole } from '../types'

interface ProfileRow {
  id: string
  name: string
  email: string
  role: UserRole
  team_id: string | null
  status: 'Active' | 'Inactive'
  phone: string | null
  avatar_color: string
  email_signature: string | null
  email_signature_image_url: string | null
  email_signature_image_width: number | null
  email_signature_image_align: 'left' | 'center' | 'right' | null
}

function mapProfileRow(row: ProfileRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    teamId: row.team_id ?? undefined,
    status: row.status,
    phone: row.phone ?? undefined,
    avatarColor: row.avatar_color,
    emailSignature: row.email_signature ?? undefined,
    emailSignatureImageUrl: row.email_signature_image_url ?? undefined,
    emailSignatureImageWidth: row.email_signature_image_width ?? undefined,
    emailSignatureImageAlign: row.email_signature_image_align ?? undefined,
  }
}

interface AuthContextValue {
  session: Session | null
  /** The signed-in person's profile row, mapped to the app's existing `User` shape. Null while loading or signed out. */
  currentUser: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  /** Patches the locally-held profile immediately (e.g. after Settings → Profile saves a name/phone change), so the UI doesn't wait on a refetch to reflect it. */
  updateCurrentUserLocal: (patch: Partial<User>) => void
  /** Set when the profile row could not be fetched after several tries. The app can't safely
   *  write anything without knowing who the person is, so this is surfaced rather than ignored. */
  profileError: string | null
  /** Try the profile fetch again after a failure. */
  reloadProfile: () => void
  /** True when this session came from an invite/recovery email link — the person has a session but never set a password, so RequireAuth should force them through SetPasswordPage before anything else. */
  passwordSetupRequired: boolean
  /** Sets the password for the current session (invite/recovery flow) and clears passwordSetupRequired on success. */
  completePasswordSetup: (password: string) => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Supabase redirects invite/recovery email links back to the app with
// `type=invite` or `type=recovery` in the URL hash before its client
// library consumes and strips it — captured once, synchronously, at
// module load so it's read before that happens.
const cameFromInviteOrRecoveryLink = /type=(invite|recovery)/.test(window.location.hash)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [passwordSetupRequired, setPasswordSetupRequired] = useState(cameFromInviteOrRecoveryLink)
  const [profileError, setProfileError] = useState<string | null>(null)
  // Held in a ref as well as state so the retry can read the current session without being
  // rebuilt — the effect that owns it deliberately runs once.
  const sessionRef = useRef<Session | null>(null)
  const [reloadProfile, setReloadProfile] = useState<() => void>(() => () => {})

  useEffect(() => {
    let active = true
    let inFlightFor: string | null = null

    /**
     * Fetching the profile is a second request made moments after sign-in, and it can lose a
     * race: the sign-in call resolves fractionally before the new token is attached to outgoing
     * requests, so the first read comes back 401.
     *
     * This used to run once and throw the error away. One lost race then left the app not
     * knowing who was using it for the rest of the session — and because every write stamps the
     * signed-in person's id, Postgres rejected all of them ("invalid input syntax for type
     * uuid") while the only visible symptom was the sidebar reading "Loading…". So read the
     * error, and retry with a widening gap instead of failing silently.
     */
    async function loadProfile(userId: string) {
      if (inFlightFor === userId) return
      inFlightFor = userId
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle<ProfileRow>()
        if (!active) return
        if (data) {
          setCurrentUser(mapProfileRow(data))
          setProfileError(null)
          inFlightFor = null
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt))
        if (!active) return
      }
      inFlightFor = null
      setProfileError('We could not load your profile. Check your connection and try again.')
    }

    setReloadProfile(() => () => {
      const userId = sessionRef.current?.user.id
      if (!userId) return
      inFlightFor = null
      setProfileError(null)
      void loadProfile(userId)
    })

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      sessionRef.current = data.session
      setSession(data.session)
      if (data.session) void loadProfile(data.session.user.id)
      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!active) return
      sessionRef.current = newSession
      setSession(newSession)
      if (!newSession) {
        setCurrentUser(null)
        setProfileError(null)
        return
      }
      // Deferred out of the callback: supabase-js runs these listeners while holding its own
      // auth lock, and calling back into the client from inside can stall.
      const userId = newSession.user.id
      setTimeout(() => {
        if (active) void loadProfile(userId)
      }, 0)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  function updateCurrentUserLocal(patch: Partial<User>) {
    setCurrentUser((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  async function completePasswordSetup(password: string) {
    const { error } = await supabase.auth.updateUser({ password })
    if (!error) setPasswordSetupRequired(false)
    return { error: error?.message ?? null }
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        currentUser,
        loading,
        signIn,
        signOut,
        updateCurrentUserLocal,
        passwordSetupRequired,
        completePasswordSetup,
        profileError,
        reloadProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
