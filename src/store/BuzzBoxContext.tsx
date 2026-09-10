import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'

/**
 * Whether the firm's BuzzBox PABX is connected and whether *this* person can dial through it.
 *
 * Read once per sign-in (one small request) and shared app-wide, because every phone number
 * on every screen asks the same question: "am I a click-to-dial button or a tel: link?"
 */
export interface BuzzBoxStatus {
  connected: boolean
  identity: string | null
  organisationId: number | null
  organisationName: string | null
  connectedAt: string | null
  /** The signed-in person's own extension, or null if they haven't picked one yet. */
  extension: string | null
}

export type DialResult = { ok: true; from: string; to: string } | { ok: false; error: string }

interface BuzzBoxContextValue {
  /** Null until the first status read completes. */
  status: BuzzBoxStatus | null
  loading: boolean
  /** BuzzBox is connected AND this person has an extension — the only state in which dialling can work. */
  canDial: boolean
  refresh: () => Promise<void>
  /** Ring my extension, then bridge me to `to`. Resolves rather than throws so callers can show the message inline. */
  dial: (to: string, reference?: string) => Promise<DialResult>
}

const BuzzBoxContext = createContext<BuzzBoxContextValue | null>(null)

const DISCONNECTED: BuzzBoxStatus = { connected: false, identity: null, organisationId: null, organisationName: null, connectedAt: null, extension: null }

export function BuzzBoxProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const accessToken = session?.access_token
  const [status, setStatus] = useState<BuzzBoxStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!accessToken) {
      setStatus(null)
      setLoading(false)
      return
    }
    try {
      const res = await fetch('/api/buzzbox/status', { headers: { Authorization: `Bearer ${accessToken}` } })
      const body = (await res.json().catch(() => null)) as BuzzBoxStatus | null
      setStatus(res.ok && body ? body : DISCONNECTED)
    } catch {
      // A network blip must not take the dialler away for the whole session; treat as not connected
      // and let the next refresh (Settings, or a reload) put it back.
      setStatus(DISCONNECTED)
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const dial = useCallback<BuzzBoxContextValue['dial']>(
    async (to, reference) => {
      if (!accessToken) return { ok: false, error: 'You are signed out.' }
      try {
        const res = await fetch('/api/buzzbox/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ to, reference }),
        })
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; from?: string; to?: string; error?: string }
        if (!res.ok || !body.ok) return { ok: false, error: body.error ?? 'BuzzBox could not start the call.' }
        return { ok: true, from: body.from ?? '', to: body.to ?? to }
      } catch {
        return { ok: false, error: 'Could not reach the server.' }
      }
    },
    [accessToken],
  )

  const value = useMemo<BuzzBoxContextValue>(
    () => ({ status, loading, canDial: !!status?.connected && !!status.extension, refresh, dial }),
    [status, loading, refresh, dial],
  )

  return <BuzzBoxContext.Provider value={value}>{children}</BuzzBoxContext.Provider>
}

export function useBuzzBox() {
  const ctx = useContext(BuzzBoxContext)
  if (!ctx) throw new Error('useBuzzBox must be used within BuzzBoxProvider')
  return ctx
}
