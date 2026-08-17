import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
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
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function loadProfile(userId: string) {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single<ProfileRow>()
      if (active && data) setCurrentUser(mapProfileRow(data))
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session) loadProfile(data.session.user.id)
      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!active) return
      setSession(newSession)
      if (newSession) loadProfile(newSession.user.id)
      else setCurrentUser(null)
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

  return (
    <AuthContext.Provider value={{ session, currentUser, loading, signIn, signOut, updateCurrentUserLocal }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
