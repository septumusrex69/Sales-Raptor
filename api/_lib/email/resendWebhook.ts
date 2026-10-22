import crypto from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from '../auth.js'
import { normaliseEmail } from '../../../src/lib/marketing.js'
import { unsubscribe } from './unsubscribe.js'

/**
 * /api/email/resend-webhook -- WHAT HAPPENED TO A NEWSLETTER AFTER IT LEFT (S10). ANONYMOUS, and
 * Resend's signature is the authority.
 *
 * EVERY EVENT IS RECORDED ON ITS SEND (22 Oct). The firm: "see also the success of what's been
 * delivered, what was undelivered, what was opened." email.sent, delivered, delivery_delayed,
 * bounced, complained, opened and clicked each stamp the send (marketing_record_event), keyed on
 * the delivery's svix-id -- Resend retries a delivery it is not sure arrived, and the second copy
 * must not count an open twice. A click on the unsubscribe link is not counted as a click: it is
 * not interest. What the address is told for ever is still only the two below.
 *
 *   email.bounced, permanent   the address does not exist: marked UNDELIVERABLE and never sent news
 *                              again. Sending on to dead addresses is how a domain loses its
 *                              reputation, and then the newsletters reaching live ones go to spam.
 *   email.complained           the person pressed "report spam". That is an objection in the
 *                              plainest terms there are, so it is an UNSUBSCRIBE (POPIA s69).
 *   anything else              acknowledged and ignored.
 *
 * VERIFIED THE WAY RESEND SIGNS (Svix): HMAC-SHA256 over "<svix-id>.<svix-timestamp>.<raw body>"
 * with the base64 secret after "whsec_", compared to each "v1,<base64>" in svix-signature, and a
 * timestamp more than five minutes off refused so an old delivery cannot be replayed. Without
 * RESEND_WEBHOOK_SECRET nothing is accepted at all.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim()
  if (!secret) { res.status(503).json({ error: 'RESEND_WEBHOOK_SECRET is not set, so no delivery report is accepted.' }); return }
  const raw = await rawBody(req)
  const header = (n: string) => { const v = req.headers[n]; return Array.isArray(v) ? v[0] : v ?? '' }
  if (!verifySvix(secret, header('svix-id'), header('svix-timestamp'), header('svix-signature'), raw, Date.now())) {
    res.status(401).json({ error: 'Signature does not match.' })
    return
  }
  const admin = adminClient()
  if (!admin) { res.status(500).json({ error: 'Server is missing Supabase configuration.' }); return }

  let event: ResendEvent
  try { event = JSON.parse(raw) } catch { res.status(400).json({ error: 'Not JSON.' }); return }
  const delivery = deliveryEvent(event, header('svix-id'))
  if (!delivery) { res.status(200).json({ ignored: event.type ?? null }); return }

  const { data: recorded, error } = await admin.rpc('marketing_record_event', {
    p_event_id: delivery.eventId, p_resend_id: delivery.resendId, p_type: delivery.type,
    p_at: delivery.at, p_note: delivery.note, p_count_click: delivery.countClick,
  })
  /* A failure is a 500, so Resend tries again later rather than the event being lost. */
  if (error) { res.status(500).json({ error: error.message }); return }
  const r = (recorded ?? {}) as { status?: string; send_id?: string; campaign_id?: string; email?: string }
  /* The same delivery a second time: already done, and done once. */
  if (r.status === 'duplicate') { res.status(200).json({ duplicate: true }); return }

  const outcome = bounceOutcome(event)
  if (outcome) {
    const to = Array.isArray(event.data?.to) ? event.data?.to[0] : event.data?.to
    const email = r.email ?? normaliseEmail(to)
    if (email && outcome.preference === 'undeliverable') {
      await admin.from('marketing_preferences').upsert(
        { email, status: 'undeliverable', how: 'hard bounce', reason: outcome.note, campaign_id: r.campaign_id ?? null },
        { onConflict: 'email' },
      )
    } else if (email && outcome.preference === 'unsubscribed') {
      await unsubscribe(admin, email, 'complaint', r.campaign_id ?? null, r.send_id ?? null)
    }
  }
  res.status(200).json({ ok: true, status: r.status ?? null })
}

type ResendEvent = {
  type?: string
  created_at?: string
  data?: {
    email_id?: string
    created_at?: string
    to?: string[] | string
    bounce?: { type?: string; message?: string }
    click?: { link?: string; timestamp?: string }
  }
}

/** The events Resend sends that a send's results are made of. Anything else is acknowledged and ignored. */
export const DELIVERY_EVENTS = [
  'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.opened', 'email.clicked',
] as const

/**
 * ONE DELIVERY, READ: which send, what happened, when, and the key that makes a retry harmless. Pure,
 * so check-marketing-prospects can hold it. The key is the svix-id, which Resend keeps the same
 * across retries of one delivery; failing that, the event's own type, email and time.
 */
export function deliveryEvent(event: ResendEvent, svixId: string | null | undefined): {
  eventId: string; resendId: string; type: string; at: string | null; note: string | null; countClick: boolean
} | null {
  const type = event.type ?? ''
  if (!(DELIVERY_EVENTS as readonly string[]).includes(type)) return null
  const resendId = event.data?.email_id ?? ''
  if (!resendId) return null
  const at = event.data?.click?.timestamp ?? event.created_at ?? event.data?.created_at ?? null
  const eventId = svixId?.trim() || `${type}:${resendId}:${at ?? ''}`
  const link = event.data?.click?.link ?? ''
  const bounce = bounceOutcome(event)
  return {
    eventId, resendId, type, at,
    note: bounce?.note ?? (type === 'email.delivery_delayed' ? 'Delivery delayed; Resend is still trying' : null),
    /* The way out is not interest: a click on the unsubscribe link is not a click. */
    countClick: !/\/unsubscribe\/|\/api\/email\/unsubscribe/.test(link),
  }
}

/** What an event means for the send and for the address -- pure, so check-marketing can hold it. */
export function bounceOutcome(event: { type?: string; data?: { bounce?: { type?: string; message?: string } } })
  : { state: 'bounced' | 'complained'; preference: 'undeliverable' | 'unsubscribed' | null; note: string } | null {
  if (event.type === 'email.complained') return { state: 'complained', preference: 'unsubscribed', note: 'Reported as spam' }
  if (event.type === 'email.bounced') {
    const kind = (event.data?.bounce?.type ?? '').toLowerCase()
    /* A soft bounce (a full mailbox, a server down for the day) is recorded on the send and the
       address left alone; only a permanent one stops the news. An unlabelled bounce counts as hard,
       because Resend suppresses it anyway and sending on would only be refused. */
    const hard = !kind || kind === 'permanent' || kind === 'hard'
    return {
      state: 'bounced', preference: hard ? 'undeliverable' : null,
      note: `${hard ? 'Hard bounce' : 'Soft bounce'}${event.data?.bounce?.message ? `: ${event.data.bounce.message}` : ''}`.slice(0, 500),
    }
  }
  return null
}

export function verifySvix(secret: string, id: string, timestamp: string, signatures: string, body: string, nowMs: number): boolean {
  if (!id || !timestamp || !signatures) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > 300) return false
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest()
  return signatures.split(' ').some((part) => {
    const [version, sig] = part.split(',')
    if (version !== 'v1' || !sig) return false
    const given = Buffer.from(sig, 'base64')
    return given.length === expected.length && crypto.timingSafeEqual(given, expected)
  })
}

/**
 * THE BYTES RESEND SIGNED. Vercel's helper parses a JSON body before the handler runs; where the
 * stream is still readable it is read here, and otherwise the parsed body is written back out --
 * which is byte-identical for Resend's compact JSON, and if it ever were not, the signature check
 * fails closed and nothing is changed.
 */
async function rawBody(req: VercelRequest): Promise<string> {
  /* The stream first, before anything touches req.body and asks the helper to parse it. */
  if (req.readable && !req.readableEnded) {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    if (chunks.length) return Buffer.concat(chunks).toString('utf8')
  }
  if (typeof req.body === 'string') return req.body
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
  return req.body === undefined ? '' : JSON.stringify(req.body)
}
