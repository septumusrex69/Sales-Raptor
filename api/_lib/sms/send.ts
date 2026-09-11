import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../auth.js'
import { sendSms, toMsisdn, SmsError } from './connectMobile.js'
import { smsCost } from './cost.js'

/**
 * Send one SMS to a debtor, record it, and charge for it.
 *
 * In that order, and the order is the point. The provider is asked first, because a fee for a
 * message that never left is worse than a message with no fee: the second is a bookkeeping gap,
 * the first is a charge the firm cannot justify.
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

  const { accountId, to, text } = (req.body ?? {}) as { accountId?: string; to?: string; text?: string }
  if (!accountId || !to?.trim() || !text?.trim()) {
    res.status(400).json({ error: 'An account, a number and a message are all required.' })
    return
  }
  const msisdn = toMsisdn(to)
  if (!msisdn) {
    res.status(400).json({ error: `"${to}" is not a number an SMS can be sent to.` })
    return
  }

  const { data: profile } = await admin.from('profiles').select('name').eq('id', caller.id).maybeSingle<{ name: string }>()
  const cost = smsCost(text)
  // Ours, and echoed back on the delivery report. Unique so a retry cannot be mistaken for a
  // second message, and short enough to survive a provider that truncates identifiers.
  const reference = `bf${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

  let result
  try {
    result = await sendSms({ to: msisdn, text, reference })
  } catch (err) {
    if (err instanceof SmsError) {
      res.status(err.status).json({ error: err.message })
      return
    }
    res.status(502).json({ error: 'Could not send the message.' })
    return
  }

  const { data: row, error } = await admin.from('sms_messages').insert({
    account_id: accountId,
    direction: 'outbound',
    msisdn,
    body: text,
    segments: cost.segments,
    encoding: cost.encoding,
    status: 'sent',
    reference,
    provider_id: result.providerId,
    provider_raw: result.raw,
    sent_at: new Date().toISOString(),
    created_by: caller.id,
    created_by_name: profile?.name ?? null,
  }).select('id').single()
  if (error) {
    // The message is gone whether or not we managed to write it down, and saying otherwise would
    // invite somebody to send it again.
    res.status(500).json({ error: `The message was sent, but could not be recorded: ${error.message}` })
    return
  }

  res.status(200).json({
    ok: true,
    id: row.id,
    reference,
    segments: cost.segments,
    encoding: cost.encoding,
    to: msisdn,
  })
}
