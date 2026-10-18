import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { VercelRequest } from '@vercel/node'

/** Every /api/email/* and /api/auth/* route needs the same service_role client and caller lookup — shared here instead of copy-pasted per file. */
export function adminClient(): SupabaseClient | null {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return null
  return createClient(supabaseUrl, serviceRoleKey)
}

export async function requireCaller(req: VercelRequest, admin: SupabaseClient): Promise<User | null> {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice('Bearer '.length)
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

/**
 * AN ADMINISTRATOR'S REQUEST COUNTS ONLY AT aal2 (S8, 18 Oct; security audit B-02). Administrators
 * confirm every sign-in with an authenticator app (AdminTwoStep in the browser); this is the server
 * holding the same line, so a stolen password alone cannot invite a person, remove one, or connect a
 * mailbox. Pass the request and the token's `aal` is read; it is the token requireCaller already had
 * verified by Supabase, so the claim cannot be forged without the signing key. Called without `req`
 * (no caller left that does) it checks the role alone, as before.
 */
export async function callerIsAdmin(admin: SupabaseClient, userId: string, req?: VercelRequest): Promise<boolean> {
  const { data } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
  if (data?.role !== 'Administrator') return false
  if (!req) return true
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''
  return tokenAal(token) === 'aal2'
}

/** The `aal` claim of a JWT already verified by Supabase; null when it has none. */
export function tokenAal(token: string): string | null {
  try {
    const part = token.split('.')[1] ?? ''
    const json = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { aal?: unknown }
    return typeof json.aal === 'string' ? json.aal : null
  } catch { return null }
}
