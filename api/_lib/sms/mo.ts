import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from '../auth.js'
import { toMsisdn } from './connectMobile.js'
import { MSISDN_KEYS, TEXT_KEYS, params, pick } from './inbound.js'

/**
 * A debtor replying to an SMS.
 *
 * This is the half of an SMS integration that usually gets skipped, and it is the half that
 * matters most on a collections book: a debtor who answers "I'll pay Friday" has just made a
 * promise, and if it dies in a gateway nobody chases them and nobody knows why.
 *
 * So the reply is recorded against the account and written onto the timeline where the collector
 * reads everything else. Matched by number, which is the only thing an inbound message carries —
 * an unmatched reply is still kept, because "somebody texted this number" is worth more than
 * silence even when we cannot say who.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.SMS_WEBHOOK_KEY
  if (!secret) {
    res.status(500).json({ error: 'SMS_WEBHOOK_KEY is not set, so replies cannot be accepted.' })
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

  const from = pick(p, MSISDN_KEYS)
  const text = pick(p, TEXT_KEYS) ?? ''
  const msisdn = from ? toMsisdn(from) : null
  if (!msisdn) {
    res.status(200).json({ ok: true, matched: false })
    return
  }

  /*
   * Which account this belongs to.
   *
   * Numbers are stored as they were typed — "082 123 4567", "+27 82 123 4567" — so a plain equality
   * test finds almost nothing. The last nine digits are the part that does not vary, and the most
   * RECENT message to this number is a better answer than any contact lookup: it is the
   * conversation the debtor is replying to.
   */
  const { data: prior } = await admin
    .from('sms_messages')
    .select('account_id')
    .eq('msisdn', msisdn)
    .eq('direction', 'outbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ account_id: string | null }>()

  const accountId = prior?.account_id ?? null

  const { error } = await admin.from('sms_messages').insert({
    account_id: accountId,
    direction: 'inbound',
    msisdn,
    body: text,
    segments: 1,
    status: 'received',
    provider_raw: JSON.stringify(p).slice(0, 2000),
  })
  if (error) {
    res.status(200).json({ ok: true, matched: false, note: error.message })
    return
  }

  // On the timeline too, so a collector reading the account sees the reply without opening
  // anything. An inbound SMS is not charged: item 1(c) pays for communications the firm sends.
  if (accountId) {
    await admin.from('account_notes').insert({
      account_id: accountId,
      body: `SMS reply from ${msisdn}: ${text}`.slice(0, 2000),
      author_name: 'SMS',
    })
  }
  res.status(200).json({ ok: true, matched: !!accountId })
}
