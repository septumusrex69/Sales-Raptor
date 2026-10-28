import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../auth.js'
import { credentialsKeyProblem } from '../crypto.js'
import { can } from '../../../src/lib/capabilities.js'
import {
  FIRM_REPORTS_ADDRESS, FIRM_SENDER_NAME, firmSender, isFirmMainDomain, isProspectKind, normaliseEmail, parseKind,
  renderCampaignEmail, resendKeyEnvFor, senderSplit,
} from '../../../src/lib/marketing.js'
import {
  campaignFigures, drainMarketing, idempotencyKey, kindNotReady, loadCampaign, loadExtraSender, originFor, queueCampaign, resendSend,
  resolveOnServer, sendFromNotReady, senderConfig, senderForCampaign, testRecipient, unsubscribeToken,
} from '../marketing.js'
import { knownAddresses, previewOf, rowsFrom, writeImport } from '../marketingLists.js'
import { planProspectImport } from '../../../src/lib/prospectImport.js'

/**
 * /api/email/marketing -- NEWS & CAMPAIGNS, for a signed-in person holding `marketing.send` (S10).
 *
 * A route on the email dispatcher rather than a file of its own: api/ is at Vercel's twelve.
 *
 *   { step: 'config' }                     is the sender set up, and if not, what is missing
 *   { step: 'preview', audience, kind, sendFrom, senderAddressId }
 *                                          how many, a sample, who was left out and why, and who it goes from
 *   { step: 'figures', campaignId }        a campaign's results, whole and split by sender
 *   { step: 'import-preview', rows }       what an uploaded prospect list would add (S10, 22 Oct)
 *   { step: 'import', rows, name, fileName }   ...and adding it: a marketing_lists row and its leads
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

  const body = (req.body ?? {}) as {
    step?: string; campaignId?: unknown; audience?: unknown; kind?: unknown; rows?: unknown; name?: unknown; fileName?: unknown
    sendFrom?: unknown; senderAddressId?: unknown
  }
  const campaignId = typeof body.campaignId === 'string' ? body.campaignId : ''
  const hostHeader = req.headers['x-forwarded-host'] ?? req.headers.host
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader ?? null
  const config = await senderConfig(admin)

  if (body.step === 'config') {
    res.status(200).json({ ...config, keyProblem: credentialsKeyProblem() })
    return
  }

  if (body.step === 'preview') {
    const kind = parseKind(body.kind)
    const resolved = await resolveOnServer(admin, body.audience, kind, {
      sendFrom: body.sendFrom, senderAddressId: typeof body.senderAddressId === 'string' ? body.senderAddressId : null,
    })
    if ('error' in resolved) { res.status(400).json({ error: resolved.error }); return }
    res.status(200).json({
      kind,
      /* WHO IT GOES FROM, counted in the same pass as who it goes to (S13): the split approved is the split queued. */
      senders: resolved.senders ? senderSplit(resolved.senders) : null,
      count: resolved.recipients.length,
      firstApproaches: resolved.recipients.filter((r) => r.firstApproach).length,
      sample: resolved.recipients.slice(0, 12).map((r) => ({
        email: r.email, firstName: r.firstName, companyName: r.companyName, via: r.via, firstApproach: r.firstApproach,
      })),
      excluded: resolved.excluded,
    })
    return
  }

  /*
   * A PROSPECT LIST, previewed and then written: the same plan both times (marketingLists.ts). The
   * leads it makes are the sales side's, so marketing.send -- checked above -- is the whole gate.
   */
  if (body.step === 'figures') {
    if (!campaignId) { res.status(400).json({ error: 'Which campaign?' }); return }
    res.status(200).json(await campaignFigures(admin, campaignId))
    return
  }

  if (body.step === 'import-preview' || body.step === 'import') {
    const rows = rowsFrom(body.rows)
    if ('error' in rows) { res.status(400).json({ error: rows.error }); return }
    if (body.step === 'import-preview') {
      res.status(200).json(previewOf(planProspectImport(rows, await knownAddresses(admin))))
      return
    }
    const out = await writeImport(admin, rows, {
      name: typeof body.name === 'string' ? body.name : '',
      fileName: typeof body.fileName === 'string' ? body.fileName : null,
      callerId: caller.id,
    })
    if ('error' in out) { res.status(out.status).json({ error: out.error }); return }
    res.status(200).json(out)
    return
  }

  /*
   * EVERYTHING BELOW SENDS, so nothing below runs on a half-set-up sender -- and which half matters
   * depends on the campaign: news needs MARKETING_FROM, a prospect campaign MARKETING_PROSPECT_DOMAIN.
   */
  if (!process.env.RESEND_API_KEY?.trim()) {
    res.status(412).json({ error: 'Sending is not set up yet: RESEND_API_KEY must be set in Vercel.', missing: ['RESEND_API_KEY'] })
    return
  }
  /* The unsubscribe token is keyed with the server's key; without it there is no link to put in. */
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) { res.status(500).json({ error: keyProblem }); return }
  if (!campaignId) { res.status(400).json({ error: 'Which campaign?' }); return }
  const current = await loadCampaign(admin, campaignId)
  if (!current) { res.status(404).json({ error: 'No such campaign.' }); return }
  const notReady = kindNotReady(config, current.kind)
  if (notReady && body.step !== 'cancel' && body.step !== 'drain') {
    res.status(412).json({ error: notReady })
    return
  }

  if (body.step === 'test') {
    const campaign = current
    let sender = await senderForCampaign(admin, config, campaign)
    if ('error' in sender) { res.status(412).json({ error: sender.error }); return }
    let key = process.env.RESEND_API_KEY as string
    /*
     * A TEST FROM WHAT WAS CHOSEN (S13), so the From and Reply-To can be checked in a real inbox: reports@,
     * the extra address, or -- in liaison mode -- the person pressing it if they are a liaison on the firm's
     * domain, else reports@ (the address their clients without a liaison would get).
     */
    if (campaign.kind === 'news' && campaign.send_from !== 'news') {
      const extra = campaign.send_from === 'address' ? await loadExtraSender(admin, campaign.sender_address_id) : null
      const notReady = sendFromNotReady(config, campaign.send_from, extra?.address)
      if (notReady) { res.status(412).json({ error: notReady }); return }
      const mine = normaliseEmail(profile.email)
      const choice = campaign.send_from === 'address' && extra ? firmSender(extra.display_name, extra.address)
        : campaign.send_from === 'liaison' && ['Liaison', 'Liaison Manager'].includes(profile.role) && isFirmMainDomain(mine)
          ? firmSender(profile.name, mine)
          : firmSender(FIRM_SENDER_NAME, FIRM_REPORTS_ADDRESS)
      if ('error' in choice) { res.status(412).json({ error: choice.error }); return }
      sender = choice
      key = process.env[resendKeyEnvFor(choice.replyTo ?? '')]?.trim() ?? ''
    }
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
        firmAddress: f.postal_address?.trim() || f.physical_address?.trim() || null,
        basis: campaign.kind === 'introduction' ? 'introduction' : 'client',
        /* The test's button opens the page's sample, never a real consent. */
        optInUrl: campaign.kind === 'introduction' ? `${origin}/opt-in/preview` : null,
      },
    )
    /* A TEST IS NOT A SEND: no row, no timeline line, and a fresh key each press so a second test
       after an edit is not answered with the first. */
    const outcome = await resendSend(key, [{
      from: sender.from, to: [r.email], ...(sender.replyTo ? { reply_to: sender.replyTo } : {}),
      subject: `[Test] ${rendered.subject}`, html: rendered.html, text: rendered.text, headers: {},
    }], idempotencyKey([campaignId, String(Date.now())]))
    if (!outcome.ok) { res.status(502).json({ error: `The test did not go: ${outcome.message}` }); return }
    res.status(200).json({ sentTo: r.email, from: sender.from })
    return
  }

  if (body.step === 'queue') {
    /* A prospect campaign whose marketer has no address would queue a list that can never go. */
    if (isProspectKind(current.kind)) {
      const sender = await senderForCampaign(admin, config, current)
      if ('error' in sender) { res.status(412).json({ error: sender.error }); return }
    }
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
