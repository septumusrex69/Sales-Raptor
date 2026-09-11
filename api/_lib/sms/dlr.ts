import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from '../auth.js'
import { deliveryStatus, params, pick, REFERENCE_KEYS, STATUS_KEYS } from './inbound.js'

/**
 * Connect Mobile telling us what happened to a message.
 *
 * Open to the internet, because that is what a webhook is, so it is gated on a secret that lives
 * in the endpoint URL the provider is given. Without it anyone who guessed the address could mark
 * the firm's messages delivered — which sounds harmless until a collector stops chasing a debtor
 * who never received anything.
 *
 * Always answers 200 once past the gate. A provider that gets an error retries, and a retry loop
 * over a payload we could not match helps nobody; the row is updated where it can be matched and
 * the payload is kept either way.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.SMS_WEBHOOK_KEY
  if (!secret) {
    res.status(500).json({ error: 'SMS_WEBHOOK_KEY is not set, so delivery reports cannot be accepted.' })
    return
  }
  const p = params(req)
  if (p.key !== secret) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const admin = adminClient()
  if (!admin) {
    res.status(500).json({ error: 'Server is missing Supabase configuration.' })
    return
  }

  const reference = pick(p, REFERENCE_KEYS)
  const status = deliveryStatus(pick(p, STATUS_KEYS))
  const raw = JSON.stringify(p).slice(0, 2000)

  if (!reference) {
    // Nothing to attach it to. Answering 200 anyway: there is no retry that would make this match.
    res.status(200).json({ ok: true, matched: false })
    return
  }

  const patch: Record<string, unknown> = { provider_raw: raw }
  if (status) {
    patch.status = status
    patch.status_detail = pick(p, STATUS_KEYS)
    if (status === 'delivered') patch.delivered_at = new Date().toISOString()
  }
  const { data, error } = await admin
    .from('sms_messages').update(patch).eq('reference', reference).select('id')
  if (error) {
    res.status(200).json({ ok: true, matched: false, note: error.message })
    return
  }
  res.status(200).json({ ok: true, matched: (data?.length ?? 0) > 0, status })
}
