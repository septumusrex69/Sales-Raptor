import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../auth.js'
import { credentialsKeyProblem } from '../crypto.js'
import { can } from '../../../src/lib/capabilities.js'
import { renderCampaignEmail } from '../../../src/lib/marketing.js'
import {
  drainMarketing, idempotencyKey, loadCampaign, originFor, queueCampaign, resendSend, resolveOnServer,
  senderConfig, testRecipient, unsubscribeToken,
} from '../marketing.js'

/**
 * /api/email/marketing -- NEWS & CAMPAIGNS, for a signed-in person holding `marketing.send` (S10).
 *
 * A route on the email dispatcher rather than a file of its own: api/ is at Vercel's twelve.
 *
 *   { step: 'config' }                     is the sender set up, and if not, what is missing
 *   { step: 'preview', audience, firstApproach }   how many, a sample, and who was left out and why
 *   { step: 'test', campaignId }           the campaign to the person pressing it, marked [Test]
 *   { step: 'queue', campaignId }          draw the list and start sending
 *   { step: 'drain', campaignId }          send the next chunks; the screen calls this until done
 *   { step: 'cancel', campaignId }         stop what has not gone yet
 *
 * THE PREVIEW AND THE SEND ARE ONE CALCULATION. Both call resolveOnServer, which is resolveAudience
 * over every row -- so the count somebody approves is the count that goes.
 */
const PRESS_BUDGET_MS = 40_000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const admin = adminClient()
  if (!admin) { res.status(500).json({ error: 'Server is missing Supabase configuration.' }); return }
  const caller = await requireCaller(req, admin)
  if (!caller) { res.status(401).json({ error: 'Invalid or expired session.' }); return }
  const { data: me } = await admin.from('profiles').select('id, name, email, role, grants, revokes, status')
    .eq('id', caller.id).maybeSingle()
  const profile = me as { id: string; name: string; email: string | null; role: string; grants: string[] | null; revokes: string[] | null; status: string } | null
  if (!profile || profile.status !== 'Active'
      || !can({ role: profile.role as never, grants: profile.grants ?? undefined, revokes: profile.revokes ?? undefined }, 'marketing.send')) {
    res.status(403).json({ error: 'Sending news and campaigns is not one of your permissions.' })
    return
  }

  const body = (req.body ?? {}) as { step?: string; campaignId?: unknown; audience?: unknown; firstApproach?: unknown }
  const campaignId = typeof body.campaignId === 'string' ? body.campaignId : ''
  const hostHeader = req.headers['x-forwarded-host'] ?? req.headers.host
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader ?? null
  const config = await senderConfig(admin)

  if (body.step === 'config') {
    res.status(200).json({ ...config, keyProblem: credentialsKeyProblem() })
    return
  }

  if (body.step === 'preview') {
    const resolved = await resolveOnServer(admin, body.audience, body.firstApproach === true)
    if ('error' in resolved) { res.status(400).json({ error: resolved.error }); return }
    res.status(200).json({
      count: resolved.recipients.length,
      firstApproaches: resolved.recipients.filter((r) => r.firstApproach).length,
      sample: resolved.recipients.slice(0, 12).map((r) => ({
        email: r.email, firstName: r.firstName, companyName: r.companyName, via: r.via, firstApproach: r.firstApproach,
      })),
      excluded: resolved.excluded,
    })
    return
  }

  /* EVERYTHING BELOW SENDS, so nothing below runs on a half-set-up sender. */
  if (!config.ready) {
    res.status(412).json({ error: `Sending is not set up yet: ${config.missing.join(' and ')} must be set in Vercel.`, missing: config.missing })
    return
  }
  /* The unsubscribe token is keyed with the server's key; without it there is no link to put in. */
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) { res.status(500).json({ error: keyProblem }); return }
  if (!campaignId) { res.status(400).json({ error: 'Which campaign?' }); return }

  if (body.step === 'test') {
    const campaign = await loadCampaign(admin, campaignId)
    if (!campaign) { res.status(404).json({ error: 'No such campaign.' }); return }
    const to = profile.email || caller.email
    const origin = originFor(host)
    if (!to || !origin) { res.status(400).json({ error: 'Your own address is not known, so there is nowhere to send a test.' }); return }
    const r = testRecipient(profile.name, to)
    const token = unsubscribeToken(r.email)
    const { data: firm } = await admin.from('firm_settings')
      .select('firm_name, email_font, email_size_pt, postal_address, physical_address').eq('id', true).maybeSingle()
    const f = (firm ?? {}) as { firm_name?: string; email_font?: string; email_size_pt?: number; postal_address?: string; physical_address?: string }
    const rendered = renderCampaignEmail(
      { subject: campaign.subject, preheader: campaign.preheader, body: campaign.body, imageUrl: campaign.image_url }, r,
      {
        unsubscribeUrl: `${origin}/unsubscribe/${token}`, firmName: f.firm_name?.trim() || 'Bredell Ferreira',
        face: { emailFont: f.email_font || 'Georgia, serif', emailSizePt: Number(f.email_size_pt) || 11 },
        firmAddress: f.postal_address?.trim() || f.physical_address?.trim() || null, basis: 'client',
      },
    )
    /* A TEST IS NOT A SEND: no row, no timeline line, and a fresh key each press so a second test
       after an edit is not answered with the first. */
    const outcome = await resendSend(process.env.RESEND_API_KEY as string, [{
      from: config.from as string, to: [r.email], ...(config.replyTo ? { reply_to: config.replyTo } : {}),
      subject: `[Test] ${rendered.subject}`, html: rendered.html, text: rendered.text, headers: {},
    }], idempotencyKey([campaignId, String(Date.now())]))
    if (!outcome.ok) { res.status(502).json({ error: `The test did not go: ${outcome.message}` }); return }
    res.status(200).json({ sentTo: r.email })
    return
  }

  if (body.step === 'queue') {
    const q = await queueCampaign(admin, campaignId, caller.id)
    if ('error' in q) { res.status(q.status).json({ error: q.error }); return }
    /* And the first chunks at once, so the person sees it moving. */
    const drained = await drainMarketing(admin, { budgetMs: 15_000, campaignId, host })
    res.status(200).json({ queued: q.queued, excluded: q.excluded, ...drained })
    return
  }

  if (body.step === 'drain') {
    const drained = await drainMarketing(admin, { budgetMs: PRESS_BUDGET_MS, campaignId, host })
    res.status(200).json(drained)
    return
  }

  if (body.step === 'cancel') {
    /* What has gone has gone; what has not is marked skipped and the campaign says cancelled. */
    await admin.from('marketing_campaigns').update({ status: 'cancelled', finished_at: new Date().toISOString() })
      .eq('id', campaignId).eq('status', 'sending')
    await admin.from('marketing_sends').update({ state: 'skipped', error: 'Cancelled before it was sent' })
      .eq('campaign_id', campaignId).eq('state', 'queued')
    res.status(200).json({ cancelled: true })
    return
  }

  res.status(400).json({ error: 'Unknown step.' })
}
