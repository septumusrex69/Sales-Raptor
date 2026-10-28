/**
 * THE PORTAL PAGE'S CALLS (S14, Raptor H13) -- a client's browser, never staff. Imports no Supabase: the
 * client has no Supabase session and the portal's chunk has no use for the library.
 *
 * The session token lives in localStorage, read defensively: a private window or an iPad with site data
 * blocked throws on access, and the answer then is "sign in", not a blank page.
 */
import { PORTAL_TOKEN_HEADER, type PortalLine } from './clientPortal'

const KEY = 'raptor.portal.token'

export function portalToken(): string | null {
  try { return localStorage.getItem(KEY) } catch { return null }
}
export function savePortalToken(token: string | null): void {
  try { if (token) localStorage.setItem(KEY, token); else localStorage.removeItem(KEY) } catch { /* signed in for this tab only */ }
}

export class PortalSignedOut extends Error {}

async function call<T>(action: string, body: Record<string, unknown> = {}, token: string | null = null): Promise<T> {
  const res = await fetch(`/api/portal/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { [PORTAL_TOKEN_HEADER]: token } : {}) },
    body: JSON.stringify(body),
  })
  const out = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (res.status === 401) throw new PortalSignedOut(out.error ?? 'Please sign in again.')
  if (!res.ok) throw new Error(out.error ?? 'The portal could not be reached just now.')
  return out
}

export const requestPortalCode = (email: string) => call<{ message: string }>('request-code', { email })
export const verifyPortalCode = (email: string, code: string) => call<{ token: string; expiresAt: string }>('verify', { email, code })

export interface PortalMe { name: string; email: string; client: string }
export const fetchPortalMe = (token: string) => call<PortalMe>('me', {}, token)

export interface PortalBook {
  total: number
  totals: { capitalHandedOver: number; paidThisMonth: number; paidToDate: number; capitalOutstanding: number }
  lines: PortalLine[]
}
export const fetchPortalBook = (token: string, q: { search: string; includeClosed: boolean; offset: number }) =>
  call<PortalBook>('book', q, token)

export const portalSignOut = (token: string) => call<{ ok: boolean }>('sign-out', {}, token)
