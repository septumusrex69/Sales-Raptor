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

/*
 * TWO KINDS OF ADMINISTRATOR (S14, 27 Oct): with finance access and without -- the database's
 * profile_has_finance and finance_capabilities (migration administrators_without_finance). These routes
 * act as the service role, which the profile guard lets through, so they hold the same line themselves:
 * an Administrator without finance cannot give it away (an invited Administrator arrives without it),
 * nor change the login email of, or delete, somebody who has it -- a login email changed to an address
 * you control is that person's account.
 */
export const FINANCE_CAPABILITIES = ['finance.view', 'business.view', 'business.income', 'people.pay',
  'payment.approve', 'payment.reverse', 'payment.move']

export async function hasFinance(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await admin.rpc('profile_has_finance', { p_user: userId })
  /* Unreadable is "no": the safe answer for the caller, and for a target it only means a refusal. */
  return !error && data === true
}

/** Null when the caller may act on this person's login; else the sentence to show. */
export async function financeRefusal(admin: SupabaseClient, callerId: string, targetId: string, what: string): Promise<string | null> {
  if (!(await hasFinance(admin, targetId))) return null
  if (await hasFinance(admin, callerId)) return null
  return `Only an Administrator with finance access can ${what} someone who has finance access.`
}

export async function callerIsAdmin(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
  return data?.role === 'Administrator'
}
