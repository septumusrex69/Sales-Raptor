import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * WHOSE ACCOUNT THIS IS, AND WHO ELSE MAY ACT ON IT.
 *
 * THE COLLECTOR HOLDING IT, OR SOMEBODY WHO LEADS THE FLOOR. The schema's own note on
 * workflow_run_steps says as much -- "a collector releases a held step on their own account,
 * which the library's Administrator-and-team-leader rule would refuse" -- so the row-level policy
 * is deliberately wide and this is where the narrowing happens.
 *
 * NOT ANY PRE-LEGAL AGENT. The write policy admits every agent, because RLS cannot see which
 * account a step belongs to without a join it would have to do on every row. Left at that, any of
 * thirty-two agents could issue a statutory demand on any of twenty-three thousand accounts --
 * and the record would name them, having never seen the file.
 *
 * ITS OWN FILE BECAUSE TWO ROUTES ASK IT. Releasing a held step and STARTING a workflow are the
 * same question about the same account, and this rule has already drifted once when it was a copy
 * -- 'Call Centre Manager' was added to canLeadCollections and left out here, so the manager could
 * lead the floor everywhere except when releasing a notice, which refused them with no
 * explanation. One caller is a copy waiting to happen; two is where it happens.
 */
export async function mayActOnAccount(
  admin: SupabaseClient, userId: string, accountId: string,
): Promise<boolean> {
  const [{ data: profile }, { data: account }] = await Promise.all([
    admin.from('profiles').select('role').eq('id', userId).maybeSingle(),
    admin.from('debtor_accounts').select('assigned_to').eq('id', accountId).maybeSingle(),
  ])
  if (!profile) return false
  /*
   * canLeadCollections' roles, named here rather than imported: permissions.ts is browser code
   * and reaching into it from a route would put the app's module graph inside a function.
   * check-departments holds this list against the real function, which is the only reason the
   * drift above was ever found.
   */
  if (profile.role === 'Administrator' || profile.role === 'Call Centre Manager'
    || profile.role === 'Pre-legal Team Leader') return true
  return Boolean(account?.assigned_to) && account?.assigned_to === userId
}
