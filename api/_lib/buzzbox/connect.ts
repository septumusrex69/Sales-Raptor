import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, callerIsAdmin, requireCaller } from '../auth.js'
import { encrypt } from '../crypto.js'
import { BuzzBoxError, getOrganisation, listOrganisations, login } from '../buzzbox.js'

/**
 * Connect the firm's BuzzBox account. One set of credentials for the whole organisation
 * (Administrator only) — individual reps are then matched to their own extension in
 * Settings → Integrations, never given the BuzzBox password.
 *
 * Body: { identity, password, organisationId? }. When the login can see exactly one PABX
 * organisation it is chosen automatically; otherwise the list comes back with a 409 so the
 * admin can pick and resubmit.
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
    res.status(403).json({ error: 'Only administrators can connect BuzzBox.' })
    return
  }

  const { identity, password, organisationId } = (req.body ?? {}) as { identity?: string; password?: string; organisationId?: number | string }
  if (!identity?.trim() || !password) {
    res.status(400).json({ error: 'BuzzBox identity (login email) and password are required.' })
    return
  }

  try {
    // Prove the credentials work before storing anything, same as the mailbox connect flow.
    const jwt = await login(identity.trim(), password)

    let orgId = organisationId !== undefined && organisationId !== '' ? Number(organisationId) : NaN
    let orgName: string | null = null
    if (Number.isFinite(orgId)) {
      const org = await getOrganisation(jwt, orgId)
      orgName = org.name ?? null
    } else {
      const orgs = await listOrganisations(jwt)
      if (orgs.length === 0) {
        res.status(400).json({ error: 'That BuzzBox login has no PABX organisation attached to it.' })
        return
      }
      if (orgs.length > 1) {
        res.status(409).json({
          error: 'This login can see more than one BuzzBox organisation — choose which one to connect.',
          organisations: orgs.map((o) => ({ organisationId: o.organisationId, name: o.name ?? String(o.organisationId) })),
        })
        return
      }
      orgId = orgs[0].organisationId
      orgName = orgs[0].name ?? null
    }

    const { error } = await admin.from('buzzbox_settings').upsert({
      id: 1,
      identity: identity.trim(),
      encrypted_password: encrypt(password),
      organisation_id: orgId,
      organisation_name: orgName,
      connected_by: caller.id,
      updated_at: new Date().toISOString(),
    })
    if (error) {
      res.status(500).json({ error: `Could not save the BuzzBox connection: ${error.message}` })
      return
    }
    res.status(200).json({ ok: true, identity: identity.trim(), organisationId: orgId, organisationName: orgName })
  } catch (err) {
    if (err instanceof BuzzBoxError) {
      res.status(err.status === 401 ? 400 : 502).json({ error: err.message })
      return
    }
    res.status(502).json({ error: 'Could not reach BuzzBox. Please try again.' })
  }
}
