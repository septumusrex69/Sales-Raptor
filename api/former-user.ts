import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, callerIsAdmin, requireCaller } from './_lib/auth.js'

/**
 * Somebody who worked here, as a record rather than a login.
 *
 * Three years of leads name eight people in the Marketer column and several of them have since
 * left. Their work still has to belong to them: a lead landing on whoever happened to run the
 * import loses the one thing that column was keeping, and reassigning a departed colleague's
 * book to a current one quietly misstates everybody's numbers.
 *
 * But inviting them is plainly wrong. The existing route is inviteUserByEmail, which sends a
 * real person a real email asking them to set a password on a system they have left.
 *
 * So this creates the account and closes it in the same breath:
 *
 *   NO PASSWORD IS EVER SET, so there is no credential to use.
 *   THE ACCOUNT IS BANNED, which is what stops the way back in. Without it, a password reset to
 *     an address the person still reads would hand them a working session — the one hole that a
 *     passwordless account left open, and the reason banning is not merely belt and braces.
 *   THE PROFILE IS INACTIVE, which is what the app itself reads: RequireAuth turns an inactive
 *     person away at the door.
 *
 * A profile cannot exist without an auth row — profiles.id references auth.users — so there is
 * no lighter way to record a person than this. What there is instead is the guarantee that the
 * row it creates cannot be signed in to.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const admin = adminClient()
  if (!admin) {
    res.status(500).json({ error: 'Server is missing Supabase configuration.' })
    return
  }

  const caller = await requireCaller(req, admin)
  if (!caller) {
    res.status(401).json({ error: 'Invalid or expired session.' })
    return
  }
  if (!(await callerIsAdmin(admin, caller.id))) {
    res.status(403).json({ error: 'Only administrators can add people.' })
    return
  }

  const { email, name, role } = (req.body ?? {}) as {
    email?: string; name?: string; role?: string
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'An email address is needed — it is what identifies the record.' })
    return
  }
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'A name is needed. It is the whole point of the record.' })
    return
  }
  const ALLOWED_ROLES = ['Administrator', 'Sales Manager', 'Sales Representative',
    'Liaison Manager', 'Liaison', 'Pre-legal Team Leader', 'Pre-legal Agent', 'Read Only']
  if (role !== undefined && !ALLOWED_ROLES.includes(role)) {
    res.status(400).json({ error: 'Invalid role.' })
    return
  }

  // createUser rather than inviteUserByEmail: no email is sent, and with no password argument
  // there is no password to sign in with.
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: false,
    user_metadata: { name: name.trim() },
  })
  if (error || !data.user) {
    res.status(400).json({ error: error?.message ?? 'The account could not be created.' })
    return
  }

  /*
   * Banned, and this is the part that matters. A passwordless account is still reachable by
   * "forgot password" if the address still receives mail. A ban is refused at the token
   * endpoint, so no reset link, magic link or OTP produces a session. A hundred years, because
   * the API wants a duration and there is no "forever".
   */
  const { error: banError } = await admin.auth.admin.updateUserById(data.user.id, {
    ban_duration: '876000h',
  })
  if (banError) {
    // A record that can be signed in to is worse than no record, so undo rather than keep it.
    await admin.auth.admin.deleteUser(data.user.id)
    res.status(500).json({
      error: `The account was created but could not be locked (${banError.message}), so it has `
        + `been removed again. Nothing was left behind.`,
    })
    return
  }

  // handle_new_user() has already written the profile row by now; set what it could not know.
  const { error: profileError } = await admin.from('profiles')
    .update({ name: name.trim(), status: 'Inactive', ...(role ? { role } : {}) })
    .eq('id', data.user.id)
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id)
    res.status(500).json({
      error: `The record could not be completed (${profileError.message}) and has been removed `
        + `again rather than left half-made.`,
    })
    return
  }

  res.status(200).json({ ok: true, userId: data.user.id })
}
