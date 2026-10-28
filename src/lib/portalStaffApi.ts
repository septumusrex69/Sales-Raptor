/**
 * WHO AT A CLIENT MAY SIGN IN TO THE PORTAL -- the staff half (S14, Raptor H13). The tables have no
 * policies (client_portal migration), so even this goes through api/portal with the caller's session,
 * which checks dispute.write_to_client.
 */
import { supabase } from './supabase'

async function call<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('You are signed out. Sign in again and retry.')
  const res = await fetch(`/api/portal/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const out = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(out.error ?? 'The portal could not be reached just now.')
  return out
}

export interface PortalContact {
  id: string
  email: string
  name: string
  active: boolean
  invited_at: string
  last_login_at: string | null
  invited_by: string | null
}

export const fetchPortalContacts = (companyId: string) =>
  call<{ users: PortalContact[] }>('staff-list', { companyId }).then((r) => r.users)
export const invitePortalContact = (companyId: string, email: string, name: string) =>
  call<{ id: string; emailed: boolean; emailError: string | null; url: string }>('staff-invite', { companyId, email, name })
export const setPortalContactActive = (id: string, active: boolean) =>
  call<{ ok: boolean }>('staff-set-active', { id, active })
