import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient } from '../auth.js'
import { credentialsKeyProblem } from '../crypto.js'
import { readUnsubscribeToken } from '../marketing.js'

/**
 * /api/email/unsubscribe -- ANONYMOUS, and the signed token is the whole of the authority (S10).
 *
 * POPIA s69(4)(b): every marketing email must give the person a way to make it stop. Three doors,
 * one rule:
 *
 *   POST ?t=<token>, body "List-Unsubscribe=One-Click"   a mail client's own Unsubscribe button
 *                                                        (RFC 8058) -- no page, no question.
 *   POST { token, step: 'status' | 'unsubscribe' | 'resubscribe' }   the page at /unsubscribe/<token>.
 *   GET ?t=<token>                                       somebody pasted the header's address into a
 *                                                        browser: sent to the page, never acted on,
 *                                                        because a link scanner GETs everything.
 *
 * NOTHING THE CALLER SENDS IS TRUSTED BUT THE TOKEN. It names one address and proves we wrote it;
 * the answer says that address's state and nothing about anybody else. A bad token is a 404 that
 * says only that the link is not one of ours.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const fromQuery = typeof req.query.t === 'string' ? req.query.t : ''
  if (req.method === 'GET') {
    res.setHeader('Location', fromQuery ? `/unsubscribe/${encodeURIComponent(fromQuery)}` : '/')
    res.status(303).end()
    return
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const admin = adminClient()
  if (!admin) { res.status(500).json({ error: 'Server is missing Supabase configuration.' }); return }
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) { res.status(500).json({ error: keyProblem }); return }

  const body = (typeof req.body === 'object' && req.body ? req.body : {}) as { token?: unknown; step?: unknown }
  const raw = typeof req.body === 'string' ? req.body : ''
  const oneClick = !!fromQuery && (raw.includes('List-Unsubscribe=One-Click')
    || (body as Record<string, unknown>)['List-Unsubscribe'] === 'One-Click')
  const token = fromQuery || (typeof body.token === 'string' ? body.token : '')
  const email = readUnsubscribeToken(token)
  if (!email) { res.status(404).json({ error: 'This link is not one of ours, or it has been cut short.' }); return }

  const step = oneClick ? 'unsubscribe' : (typeof body.step === 'string' ? body.step : 'status')
  if (step === 'unsubscribe') {
    await unsubscribe(admin, email, oneClick ? 'one-click header' : 'unsubscribe link')
  } else if (step === 'resubscribe') {
    await admin.from('marketing_preferences').upsert(
      { email, status: 'subscribed', how: 're-subscribed from the link', reason: 'Re-subscribed from the unsubscribe page' },
      { onConflict: 'email' },
    )
  } else if (step !== 'status') {
    res.status(400).json({ error: 'Unknown step.' })
    return
  }
  const { data } = await admin.from('marketing_preferences').select('status, changed_at').eq('email', email).maybeSingle()
  const row = data as { status: string; changed_at: string } | null
  res.status(200).json({
    email: maskEmail(email),
    status: row?.status ?? 'subscribed',
    changedAt: row?.changed_at ?? null,
  })
}

/**
 * THE FIRST OBJECTION'S DATE IS KEPT. Pressing the link twice must not move "Unsubscribed from news
 * on 3 March" to today, and a hard bounce already on file is a stronger state than an unsubscribe.
 */
export async function unsubscribe(admin: SupabaseClient, email: string, how: string, campaignId?: string | null) {
  const { data } = await admin.from('marketing_preferences').select('status').eq('email', email).maybeSingle()
  const current = (data as { status?: string } | null)?.status
  if (current === 'unsubscribed') return
  if (current === 'undeliverable' && how !== 'complaint') return
  await admin.from('marketing_preferences').upsert(
    { email, status: 'unsubscribed', how, reason: null, campaign_id: campaignId ?? null },
    { onConflict: 'email' },
  )
}

/** Enough of the address for the person to recognise it, not enough to harvest from a forwarded link. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!domain) return email
  return `${user.slice(0, 2)}${'•'.repeat(Math.max(1, Math.min(6, user.length - 2)))}@${domain}`
}
