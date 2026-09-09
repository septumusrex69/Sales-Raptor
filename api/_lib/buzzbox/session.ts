import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '../crypto.js'
import { getToken, type BuzzBoxJwt } from '../buzzbox.js'

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
