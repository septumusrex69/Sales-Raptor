import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, callerIsAdmin, requireCaller } from './_lib/auth.js'

/**
 * Adding a person, in the two ways a firm actually needs.
 *
 * INVITING SOMEBODY sends a real Supabase invite email and is the ordinary case: a new
 * colleague sets their own password and appears in the list.
 *
 * RECORDING SOMEBODY WHO HAS LEFT (`signIn: false`) does not. Three years of leads name eight
 * people in the Marketer column and several of them are no longer here. Their work still has to
 * belong to them — landing it on whoever happened to run the import loses what that column was
 * keeping, and moving it onto a colleague who is still here misstates both their numbers. But
 * emailing a departed person a link to set a password on a system they have left is obviously
 * wrong, so this makes the account and closes it in the same breath:
 *
 *   NO PASSWORD IS EVER SET, so there is no credential to use.
 *   THE ACCOUNT IS BANNED, which is what stops the way back in. Without it a password reset to
 *     an address the person still reads would hand them a working session — the one hole a
 *     passwordless account leaves open, and the reason banning is not merely belt and braces.
 *   THE PROFILE IS INACTIVE, which is what the app itself reads: RequireAuth turns an inactive
 *     person away at the door.
 *
 * If either lock fails to go on, the account is deleted rather than left half-made.
 *
 * BOTH LIVE IN ONE FILE ON PURPOSE. Vercel's Hobby plan allows twelve serverless functions per
 * deployment and this project uses all twelve. A thirteenth file does not fail the build — it
 * builds perfectly and then fails at deploy with exceeded_serverless_functions_per_deployment,
 * which is how it broke three deployments before anyone read the error. A second endpoint for
 * what is one decision (add a person, with or without a way in) was never worth a function.
 *
 * Both paths run server-side only: creating a user needs the service_role secret key, and only
 * an Administrator's own session may trigger either, verified here rather than trusted from the
 * browser.
 */
const ALLOWED_ROLES = ['Administrator', 'Sales Manager', 'Sales Representative',
  'Liaison Manager', 'Liaison', 'Call Centre Manager', 'Pre-legal Team Leader',
  'Pre-legal Agent', 'Read Only']

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

  const { email, name, role, teamId, signIn } = (req.body ?? {}) as {
    email?: string; name?: string; role?: string; teamId?: string; signIn?: boolean
  }
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'Email is required.' })
    return
  }
  if (role !== undefined && !ALLOWED_ROLES.includes(role)) {
    res.status(400).json({ error: 'Invalid role.' })
    return
  }

  /*
   * AN EMAIL THAT IS ALREADY SOMEBODY'S IS REFUSED, BY NAME.
   *
   * The firm: "I created a user called Raap Jasper ... it created the account ... and it shows me
   * Stefnova. It's all weird." No user was created. That address had belonged to a profile since
   * 5 September, and inviteUserByEmail on an existing address SUCCEEDS -- it re-invites them. The
   * name typed into the box was dropped on the floor (handle_new_user only fires on INSERT, and
   * the row was already there), the chosen role was stamped onto that person instead, and the box
   * said "Invite sent ... they'll appear in this list with the role and team you just set."
   *
   * So an administrator believed they had made a new colleague and had in fact quietly changed an
   * existing one. That is the worst shape a bug can have on a screen that manages people.
   *
   * BOTH DOORS, which is why it sits above the fork rather than inside the invite path. Adding
 * somebody "who has left" on an address that is already in use hit createUser and came back
 * with Supabase's own wording -- true, and no help at all about whose address it is.
 *
 * REFUSED RATHER THAN MERGED, and refused with WHO IT IS. "That email is taken" would leave
   * somebody guessing; naming them turns it into one decision -- edit that person, or use another
   * address. Re-sending an invitation has its own button on the list ("Send login link"), so
   * nothing is lost by this being a refusal.
   */
  const { data: taken } = await admin
    .from('profiles').select('name, role').ilike('email', email.trim()).maybeSingle()
  if (taken) {
    const who = (taken as { name?: string; role?: string })
    res.status(409).json({
      error: `${email.trim()} already belongs to ${who.name || 'somebody'}`
        + `${who.role ? ` (${who.role})` : ''}. Change them in the list below, or use a different `
        + 'address. To send their sign-in link again, use "Send login link" on their row.',
    })
    return
  }

  if (signIn === false) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'A name is needed. It is the whole point of the record.' })
      return
    }
    await addFormerUser(admin, res, email, name.trim(), role)
    return
  }

  // Hardcoded rather than derived from the request's Origin header: this email's redirect link
  // must always point at the real production site, never wherever the inviting admin happened
  // to be browsing from.
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: 'https://sales-raptor.vercel.app/login',
    ...(name ? { data: { name } } : {}),
  })
  if (error) {
    res.status(400).json({ error: error.message })
    return
  }

  // handle_new_user() has already created the profile row (defaulting to Sales Representative,
  // no team) by the time inviteUserByEmail resolves — apply what the admin actually chose.
  if (data.user?.id && (role || teamId)) {
    const patch: Record<string, string> = {}
    if (role) patch.role = role
    if (teamId) patch.team_id = teamId
    await admin.from('profiles').update(patch).eq('id', data.user.id)
  }

  res.status(200).json({ ok: true, userId: data.user?.id })
}

async function addFormerUser(
  admin: ReturnType<typeof adminClient> & object,
  res: VercelResponse,
  email: string,
  name: string,
  role: string | undefined,
) {
  // createUser rather than inviteUserByEmail: no email is sent, and with no password argument
  // there is no password to sign in with.
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: false,
    user_metadata: { name },
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

  const { error: profileError } = await admin.from('profiles')
    .update({ name, status: 'Inactive', ...(role ? { role } : {}) })
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
