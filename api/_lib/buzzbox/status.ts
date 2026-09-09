import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../auth.js'

/**
 * Is BuzzBox connected for the firm, and does the caller have an extension to dial from?
 * Never returns the password. Any signed-in person may ask — the answer decides whether
 * phone numbers in the app render as click-to-dial or as plain tel: links.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
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

  const [{ data: settings }, { data: profile }] = await Promise.all([
    admin.from('buzzbox_settings').select('identity, organisation_id, organisation_name, updated_at').eq('id', 1).maybeSingle(),
    admin.from('profiles').select('buzzbox_extension').eq('id', caller.id).maybeSingle(),
  ])

  res.status(200).json({
    connected: !!settings,
    identity: settings?.identity ?? null,
    organisationId: settings?.organisation_id ?? null,
    organisationName: settings?.organisation_name ?? null,
    connectedAt: settings?.updated_at ?? null,
    extension: profile?.buzzbox_extension ?? null,
  })
}
