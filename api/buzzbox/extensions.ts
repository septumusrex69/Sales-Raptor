import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient, requireCaller } from '../_lib/auth.js'
import { decrypt } from '../_lib/crypto.js'
import { BuzzBoxError, getToken, listExtensions, type BuzzBoxJwt } from '../_lib/buzzbox.js'

export interface BuzzBoxConnection {
  identity: string
  organisationId: number
}

/** The stored credentials as a live token, or null when BuzzBox isn't connected. Shared by every route that talks to BuzzBox on the firm's behalf. */
export async function connectedSession(admin: SupabaseClient): Promise<{ jwt: BuzzBoxJwt; connection: BuzzBoxConnection } | null> {
  const { data } = await admin.from('buzzbox_settings').select('identity, encrypted_password, organisation_id').eq('id', 1).maybeSingle()
  if (!data) return null
  const jwt = await getToken(data.identity, decrypt(data.encrypted_password))
  return { jwt, connection: { identity: data.identity, organisationId: Number(data.organisation_id) } }
}

/**
 * The organisation's extensions (number, name, email), so a person can pick theirs from a
 * list instead of typing it. Extension numbers and names are the phone list on the wall —
 * nothing here is sensitive enough to restrict below "signed in".
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
  try {
    const session = await connectedSession(admin)
    if (!session) {
      res.status(400).json({ error: 'BuzzBox is not connected.' })
      return
    }
    const contacts = await listExtensions(session.jwt, session.connection.organisationId)
    const extensions = contacts
      .filter((c) => c.extension !== undefined && c.extension !== null)
      .map((c) => ({ extension: String(c.extension), name: c.name ?? '', email: c.email ?? '' }))
      .sort((a, b) => Number(a.extension) - Number(b.extension))
    res.status(200).json({ extensions })
  } catch (err) {
    if (err instanceof BuzzBoxError) {
      res.status(502).json({ error: err.message })
      return
    }
    res.status(502).json({ error: 'Could not reach BuzzBox. Please try again.' })
  }
}
