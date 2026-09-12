import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient } from '../auth.js'
import { parseCallEvent, numberTail } from '../../../src/lib/buzzboxEvents.js'

/**
 * BuzzBox telling us what happened to a call.
 *
 * It records what happened and charges nothing. FreeSWITCH can tell us a phone was picked up; it
 * cannot tell us WHO picked it up, and a voicemail greeting answers exactly like a person. So the
 * fee stays with the collector, who knows. What this does buy is certainty in the other
 * direction: a call that never bridged was never answered, and nobody has to be asked about it.
 *
 * The payload's shape is not documented by BuzzBox -- it was read off real calls, and
 * src/lib/buzzboxEvents.ts holds both the reading and the reasoning. See
 * scripts/qa/check-buzzbox-events.mjs, whose fixtures are those captured payloads verbatim.
 *
 * Open to the internet, so it is gated on the same key the SMS webhooks use, carried in the URL
 * BuzzBox is given. Always answers 200 past the gate: a provider that gets an error retries, and
 * retrying an event we could not match helps nobody.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.SMS_WEBHOOK_KEY
  if (!secret) {
    res.status(500).json({ error: 'SMS_WEBHOOK_KEY is not set on this deployment.' })
    return
  }
  const key = typeof req.query.key === 'string' ? req.query.key : ''
  if (key !== secret) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body
  const event = parseCallEvent(body)

  const admin = adminClient()
  if (!admin) {
    // Nothing to write to. Say so in the log rather than silently dropping a real call event.
    console.error('[buzzbox-webhook] no Supabase configuration; event dropped', event.event)
    res.status(200).json({ ok: true, stored: false })
    return
  }

  try {
    const outcome = await apply(admin, event)
    res.status(200).json({ ok: true, ...outcome })
  } catch (err) {
    // A thrown error here would make BuzzBox retry an event that will fail again. Log and accept.
    console.error('[buzzbox-webhook] failed', event.event, event.externalId, err)
    res.status(200).json({ ok: true, handled: false })
  }
}

interface CallRow {
  id: string
  account_id: string
  number: string
  placed_by: string | null
  placed_by_name: string | null
  answered_at: string | null
  consultation_charged_at: string | null
}

/** How far back a call event may reach for the dial that started it. */
const MATCH_WINDOW_MINUTES = 15

async function apply(admin: SupabaseClient, event: ReturnType<typeof parseCallEvent>) {
  const call = await findCall(admin, event)
  if (!call) return { matched: false }

  // Learned on the first event that names both. Later events then match directly, and the unique
  // index means two calls can never claim the same BuzzBox id.
  if (event.externalId) {
    await admin.from('account_calls').update({ external_id: event.externalId })
      .eq('id', call.id).is('external_id', null)
  }

  if (event.ended) {
    await admin.from('account_calls')
      .update({ ended_at: event.at ?? new Date().toISOString(), hangup_cause: event.hangupCause })
      .eq('id', call.id).is('ended_at', null)
  }

  if (!event.answered) return { matched: true, answered: false }

  /*
   * Record that the line connected. Do NOT charge for it.
   *
   * This used to raise the item 7 consultation here, and it was wrong in a way only a real
   * afternoon of calls exposed: a voicemail system answering IS a bridge. FreeSWITCH joins two
   * live legs whether the second one is the debtor or their network's "please leave a message".
   * Every call that went to voicemail billed R60 for a consultation that never happened.
   *
   * Nothing in the payload distinguishes them, and nothing could -- the difference is who was on
   * the other end, which is knowable only to the person who listened. So the webhook now reports
   * and the collector decides. What this still buys is the case where the call NEVER bridged:
   * that is certain, so nobody is asked about it.
   */
  await admin.from('account_calls')
    .update({ answered_at: event.at ?? new Date().toISOString() })
    .eq('id', call.id)
    .is('answered_at', null)

  return { matched: true, answered: true, charged: false }
}

/**
 * Which call this event belongs to.
 *
 * By BuzzBox's own id once we have seen it. Before that, by the two facts both sides know: the
 * extension that rang and the number it rang. Numbers are compared on their last nine digits
 * because we dial E.164 and BuzzBox reports the local form -- see numberTail.
 *
 * The window is deliberate. Without it, a debtor rung yesterday and rung again today would have
 * today's answer attached to yesterday's call, and the fee would land on whichever row sorted
 * first. Fifteen minutes is longer than any call and shorter than any gap between two of them.
 */
async function findCall(admin: SupabaseClient, event: ReturnType<typeof parseCallEvent>): Promise<CallRow | null> {
  const columns = 'id, account_id, number, placed_by, placed_by_name, answered_at, consultation_charged_at'

  if (event.externalId) {
    const { data } = await admin.from('account_calls').select(columns)
      .eq('external_id', event.externalId).maybeSingle<CallRow>()
    if (data) return data
  }

  const tail = numberTail(event.number)
  if (!tail) return null

  const since = new Date(Date.now() - MATCH_WINDOW_MINUTES * 60_000).toISOString()
  let q = admin.from('account_calls').select(columns)
    .eq('number_tail', tail)
    .gte('placed_at', since)
    .is('external_id', null)
  // The extension narrows it further when the event names one — two collectors ringing the same
  // debtor in the same quarter hour is rare, but it is exactly the case that would misfile a fee.
  if (event.extension) q = q.eq('extension', event.extension)

  const { data } = await q.order('placed_at', { ascending: false }).limit(1)
  return (data?.[0] as CallRow | undefined) ?? null
}

function safeJson(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return {} }
}
