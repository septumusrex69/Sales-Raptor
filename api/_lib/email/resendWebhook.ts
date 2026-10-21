import crypto from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from '../auth.js'
import { normaliseEmail } from '../../../src/lib/marketing.js'
import { unsubscribe } from './unsubscribe.js'

/**
 * /api/email/resend-webhook -- WHAT HAPPENED TO A NEWSLETTER AFTER IT LEFT (S10). ANONYMOUS, and
 * Resend's signature is the authority.
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

  let event: { type?: string; data?: { email_id?: string; to?: string[] | string; bounce?: { type?: string; message?: string } } }
  try { event = JSON.parse(raw) } catch { res.status(400).json({ error: 'Not JSON.' }); return }
  const outcome = bounceOutcome(event)
  if (!outcome) { res.status(200).json({ ignored: event.type ?? null }); return }

  const resendId = event.data?.email_id ?? ''
  const { data: send } = resendId
    ? await admin.from('marketing_sends').select('id, campaign_id, email').eq('resend_id', resendId).maybeSingle()
    : { data: null }
  const row = send as { id: string; campaign_id: string; email: string } | null
  const to = Array.isArray(event.data?.to) ? event.data?.to[0] : event.data?.to
  const email = row?.email ?? normaliseEmail(to)
  if (row) {
    await admin.from('marketing_sends').update({ state: outcome.state, error: outcome.note, updated_at: new Date().toISOString() }).eq('id', row.id)
  }
  if (email && outcome.preference === 'undeliverable') {
    await admin.from('marketing_preferences').upsert(
      { email, status: 'undeliverable', how: 'hard bounce', reason: outcome.note, campaign_id: row?.campaign_id ?? null },
      { onConflict: 'email' },
    )
  } else if (email && outcome.preference === 'unsubscribed') {
    await unsubscribe(admin, email, 'complaint', row?.campaign_id ?? null)
  }
  res.status(200).json({ ok: true })
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
