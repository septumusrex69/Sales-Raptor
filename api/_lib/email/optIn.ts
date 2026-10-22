import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from '../auth.js'
import { credentialsKeyProblem } from '../crypto.js'
import { readOptInToken } from '../marketing.js'
import { maskEmail, unsubscribe } from './unsubscribe.js'

/**
 * /api/email/opt-in -- "YES, KEEP ME INFORMED" (S10, 22 Oct). ANONYMOUS, and the signed token is the
 * whole of the authority, exactly as the unsubscribe link's is.
 *
 * THE FIRM: "everyone gets one introduction email to opt in, 'Yes, keep me informed' button." POPIA
 * s69(2) lets the firm approach somebody who is not a client ONCE, to ask. This is where the answer
 * lands: consent recorded on the LEAD (marketing_consent_at, with how and when in the note) and on
 * the ADDRESS (marketing_preferences, how 'opt-in link'), and the send that asked is marked, so the
 * campaign can say how many said yes. Without this press, nothing more is ever sent: the queue and
 * the drain both refuse a lead with no consent (resolveAudience, sendBlockReason).
 *
 *   POST { token, step: 'yes' }        the page at /opt-in/<token>, the moment it opens
 *   POST { token, step: 'withdraw' }   "that wasn't me": the consent undone and the address unsubscribed
 *   POST { token, step: 'status' }     what this link's address has said
 *   GET  ?t=<token>                    sent to the page, never acted on
 *
 * WHY THE PAGE RECORDS IT ON OPENING rather than asking a second time: the button in the email IS
 * the question, and the firm's design is one press. A link scanner that only fetches does not run
 * the page, and the API never acts on a GET; the undo button on the page covers the rest, and is
 * recorded as an objection rather than quietly reversed.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const fromQuery = typeof req.query.t === 'string' ? req.query.t : ''
  if (req.method === 'GET') {
    res.setHeader('Location', fromQuery ? `/opt-in/${encodeURIComponent(fromQuery)}` : '/')
    res.status(303).end()
    return
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const admin = adminClient()
  if (!admin) { res.status(500).json({ error: 'Server is missing Supabase configuration.' }); return }
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) { res.status(500).json({ error: keyProblem }); return }

  const body = (typeof req.body === 'object' && req.body ? req.body : {}) as { token?: unknown; step?: unknown }
  const sendId = readOptInToken(typeof body.token === 'string' ? body.token : fromQuery)
  if (!sendId) { res.status(404).json({ error: 'This link is not one of ours, or it has been cut short.' }); return }
  const { data: sendRow } = await admin.from('marketing_sends')
    .select('id, campaign_id, email, lead_id, opted_in_at').eq('id', sendId).maybeSingle()
  const send = sendRow as { id: string; campaign_id: string; email: string; lead_id: string | null; opted_in_at: string | null } | null
  if (!send) { res.status(404).json({ error: 'This link is no longer valid.' }); return }

  const step = typeof body.step === 'string' ? body.step : 'status'
  const now = new Date().toISOString()
  if (step === 'yes') {
    const { data: campaign } = await admin.from('marketing_campaigns').select('name').eq('id', send.campaign_id).maybeSingle()
    const campaignName = (campaign as { name?: string } | null)?.name ?? 'an introduction'
    if (send.lead_id) {
      /* THE FIRST YES'S DATE IS KEPT: pressing the button twice does not move it. */
      await admin.from('leads').update({
        marketing_consent_at: now,
        marketing_consent_note: `Pressed “Yes, keep me informed” in the introduction email (${campaignName}).`,
        marketing_consent_by: null,
      }).eq('id', send.lead_id).is('marketing_consent_at', null)
    }
    await admin.from('marketing_preferences').upsert(
      { email: send.email, status: 'subscribed', how: 'opt-in link', reason: 'Pressed “Yes, keep me informed”', campaign_id: send.campaign_id },
      { onConflict: 'email' },
    )
    if (!send.opted_in_at) await admin.from('marketing_sends').update({ opted_in_at: now }).eq('id', send.id)
  } else if (step === 'withdraw') {
    if (send.lead_id) {
      await admin.from('leads').update({
        marketing_consent_at: null,
        marketing_consent_note: 'Withdrawn from the thank-you page after the introduction email.',
        marketing_consent_by: null,
      }).eq('id', send.lead_id)
    }
    await admin.from('marketing_sends').update({ opted_in_at: null }).eq('id', send.id)
    await unsubscribe(admin, send.email, 'unsubscribe link', send.campaign_id, send.id)
  } else if (step !== 'status') {
    res.status(400).json({ error: 'Unknown step.' })
    return
  }
  const { data: pref } = await admin.from('marketing_preferences').select('status').eq('email', send.email).maybeSingle()
  const status = (pref as { status?: string } | null)?.status ?? null
  res.status(200).json({
    email: maskEmail(send.email),
    optedIn: status === 'subscribed' && step !== 'withdraw',
    status: status ?? 'subscribed',
  })
}
