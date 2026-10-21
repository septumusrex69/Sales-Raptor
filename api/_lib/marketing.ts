import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { keyedHash, sameHex } from './crypto.js'
import { siteOrigin } from './workflow/siteOrigin.js'
import { fetchAllRows } from '../../src/lib/fetchAll.js'
import {
  RESEND_BATCH_MAX, RESEND_MIN_GAP_MS, SENDER_ENV, isSendableEmail, newsletterActivitySubject,
  normaliseEmail, parseAudience, renderCampaignEmail, resolveAudience, type AudienceResult, type Recipient,
} from '../../src/lib/marketing.js'

/**
 * NEWS & CAMPAIGNS ON THE SERVER: the sender, the list, the queue and the drain (S10, 21 Oct).
 *
 * THROUGH RESEND, at the firm's agreement, and NOT through anybody's own mailbox. sendAsUser sends
 * as the person pressing the button, one message at a time, from their IMAP account -- right for a
 * letter to one debtor, wrong for five hundred newsletters: a mailbox provider throttles that, and
 * the firm's own addresses would carry the reputation of every bulk send. Resend sends from a domain
 * verified for it, and handles bounces and complaints as a bulk sender must.
 *
 * NOTHING HERE PRETENDS. With RESEND_API_KEY or MARKETING_FROM unset the config says which, the
 * screen shows the firm what to set up, the queue refuses, and the drain does nothing.
 */

/* ------------------------------------------------------------------------------------------------
 * Configuration
 * ---------------------------------------------------------------------------------------------- */

export interface SenderConfig {
  ready: boolean
  missing: string[]
  from: string | null
  replyTo: string | null
  /** Whether bounces and complaints can be heard -- RESEND_WEBHOOK_SECRET is set. */
  webhook: boolean
}

export async function senderConfig(admin: SupabaseClient): Promise<SenderConfig> {
  const missing = SENDER_ENV.filter((k) => !process.env[k]?.trim())
  let replyTo = process.env.MARKETING_REPLY_TO?.trim() || null
  if (!replyTo) {
    /* The firm's general address, Library -> The firm. A reply to a newsletter is a person writing
       to the firm, and belongs in the inbox everybody reads, not in a no-reply void. */
    const { data } = await admin.from('firm_settings').select('email').eq('id', true).maybeSingle()
    replyTo = (data as { email?: string | null } | null)?.email?.trim() || null
  }
  return {
    ready: missing.length === 0,
    missing,
    from: process.env.MARKETING_FROM?.trim() || null,
    replyTo,
    webhook: !!process.env.RESEND_WEBHOOK_SECRET?.trim(),
  }
}

/** The site an unsubscribe link opens. The deployment's own, so a staging link finds staging's row. */
export function originFor(host?: string | null): string | null {
  const own = siteOrigin()
  if (own) return own
  return host ? `https://${host.replace(/^https?:\/\//, '')}` : null
}

/* ------------------------------------------------------------------------------------------------
 * The unsubscribe token: the address, and a keyed hash that proves we wrote it
 * ---------------------------------------------------------------------------------------------- */

/**
 * NO LOGIN AND NO ROW. The token carries the address itself and an HMAC over it under the server's
 * key, so it needs nothing stored, never expires (an unsubscribe link in a two-year-old newsletter
 * must still work -- s69 does not let an objection lapse), and cannot be made for an address
 * somebody else owns. 128 bits of the HMAC is plenty for a link nobody can try a billion of.
 */
export function unsubscribeToken(email: string): string {
  const e = normaliseEmail(email)
  return `${Buffer.from(e, 'utf8').toString('base64url')}.${keyedHash('marketing-unsubscribe', e).slice(0, 32)}`
}

/** The address a token speaks for, or null if it was not ours. */
export function readUnsubscribeToken(token: string | null | undefined): string | null {
  const [payload, sig] = (token ?? '').split('.')
  if (!payload || !sig || !/^[0-9a-f]{32}$/.test(sig)) return null
  let email: string
  try { email = Buffer.from(payload, 'base64url').toString('utf8') } catch { return null }
  if (email !== normaliseEmail(email) || !email.includes('@')) return null
  return sameHex(keyedHash('marketing-unsubscribe', email).slice(0, 32), sig) ? email : null
}

/* ------------------------------------------------------------------------------------------------
 * Resend
 * ---------------------------------------------------------------------------------------------- */

export interface OutgoingEmail {
  from: string
  to: string[]
  reply_to?: string
  subject: string
  html: string
  text: string
  headers: Record<string, string>
}

export type SendOutcome =
  | { ok: true; ids: string[] }
  | { ok: false; status: number; message: string }

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/**
 * ONE CALL TO RESEND: a batch of up to a hundred, or one email.
 *
 * THE IDEMPOTENCY KEY IS WHAT MAKES A RETRY SAFE. A chunk whose function died after Resend accepted
 * it is claimed again fifteen minutes later; the same rows give the same key, and Resend answers the
 * second call with the first call's result instead of sending again.
 */
export async function resendSend(
  apiKey: string, emails: OutgoingEmail[], idempotencyKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<SendOutcome> {
  const single = emails.length === 1
  let res
  try {
    res = await fetchImpl(single ? 'https://api.resend.com/emails' : 'https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(single ? emails[0] : emails),
    })
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : 'Resend could not be reached.' }
  }
  const body = await res.json().catch(() => ({})) as { data?: unknown; id?: string; message?: string; name?: string }
  if (!res.ok) return { ok: false, status: res.status, message: body.message ?? body.name ?? `Resend answered ${res.status}.` }
  const ids = single
    ? [body.id ?? (body.data as { id?: string } | undefined)?.id ?? '']
    : ((Array.isArray(body.data) ? body.data : []) as { id?: string }[]).map((d) => d?.id ?? '')
  /* A batch answer that does not line up one-to-one is not something to guess about. */
  if (ids.length !== emails.length) return { ok: false, status: 502, message: 'Resend answered with a different number of emails than were sent.' }
  return { ok: true, ids }
}

export function idempotencyKey(sendIds: string[]): string {
  return `raptor-news-${crypto.createHash('sha256').update([...sendIds].sort().join(',')).digest('hex').slice(0, 40)}`
}

/* ------------------------------------------------------------------------------------------------
 * The list
 * ---------------------------------------------------------------------------------------------- */

interface CampaignRow {
  id: string
  name: string
  subject: string
  preheader: string
  body: string
  image_url: string | null
  audience: unknown
  first_approach: boolean
  status: string
  created_by: string | null
  queued_by: string | null
}

const CAMPAIGN_COLUMNS = 'id, name, subject, preheader, body, image_url, audience, first_approach, status, created_by, queued_by'

export async function loadCampaign(admin: SupabaseClient, id: string): Promise<CampaignRow | null> {
  const { data } = await admin.from('marketing_campaigns').select(CAMPAIGN_COLUMNS).eq('id', id).maybeSingle()
  return (data as CampaignRow | null) ?? null
}

/**
 * EVERYTHING THE AUDIENCE RULE READS, every row of it: the sales tables are small today, and a list
 * that quietly stopped at PostgREST's thousand would be a newsletter that quietly missed people.
 */
export async function resolveOnServer(
  admin: SupabaseClient, audienceRaw: unknown, firstApproach: boolean,
): Promise<AudienceResult | { error: string }> {
  const audience = parseAudience(audienceRaw)
  if (!audience) return { error: 'This campaign has no list chosen.' }
  try {
    const [companies, contacts, leads, activities, prefs, approached] = await Promise.all([
      fetchAllRows<Record<string, unknown>>(() => admin.from('companies')
        .select('id, name, email, parent_company_id, services, contact_person').order('id'), { table: 'companies' }),
      fetchAllRows<Record<string, unknown>>(() => admin.from('contacts')
        .select('id, first_name, email, company_id, lead_id').order('id'), { table: 'contacts' }),
      fetchAllRows<Record<string, unknown>>(() => admin.from('leads')
        .select('id, first_name, company_name, email, status, source, created_at, last_contact_at, rejection_reason, status_changed_at, marketing_consent_at')
        .order('id'), { table: 'leads' }),
      audience.kind === 'dormant_leads'
        ? fetchAllRows<Record<string, unknown>>(() => admin.from('activities')
          .select('lead_id, activity_date, type, subject').not('lead_id', 'is', null).order('id'), { table: 'activities', max: 500_000 })
        : Promise.resolve([]),
      fetchAllRows<Record<string, unknown>>(() => admin.from('marketing_preferences')
        .select('email, status').neq('status', 'subscribed').order('email'), { table: 'marketing_preferences' }),
      fetchAllRows<Record<string, unknown>>(() => admin.from('marketing_sends')
        .select('lead_id').eq('first_approach', true).not('lead_id', 'is', null)
        .not('state', 'in', '(failed,skipped)').order('id'), { table: 'marketing_sends' }),
    ])
    const s = (v: unknown) => (typeof v === 'string' ? v : undefined)
    /* THE FIRM'S "NOW", so dormancy on staging follows staging's clock as the status dates do. */
    const { data: firmNow } = await admin.rpc('raptor_now')
    const now = typeof firmNow === 'string' ? new Date(firmNow).toISOString() : new Date().toISOString()
    return resolveAudience({
      audience,
      firstApproach,
      companies: companies.map((c) => ({
        id: String(c.id), name: String(c.name ?? ''), email: s(c.email), parentCompanyId: s(c.parent_company_id),
        services: (Array.isArray(c.services) ? c.services : []) as never[], contactPerson: s(c.contact_person),
      })),
      contacts: contacts.map((c) => ({
        id: String(c.id), firstName: String(c.first_name ?? ''), email: s(c.email), companyId: s(c.company_id), leadId: s(c.lead_id),
      })),
      leads: leads.map((l) => ({
        id: String(l.id), firstName: String(l.first_name ?? ''), companyName: String(l.company_name ?? ''), email: s(l.email),
        status: l.status as never, source: l.source as never, createdAt: String(l.created_at),
        lastContactAt: s(l.last_contact_at), rejectionReason: l.rejection_reason as never,
        statusChangedAt: s(l.status_changed_at), marketingConsentAt: s(l.marketing_consent_at),
      })),
      activities: activities.map((a) => ({
        leadId: s(a.lead_id), activityDate: String(a.activity_date), type: String(a.type), subject: String(a.subject ?? ''),
      })),
      preferences: new Map(prefs.map((p) => [String(p.email), p.status as 'unsubscribed' | 'undeliverable'])),
      approachedLeads: new Set(approached.map((a) => String(a.lead_id))),
      now,
    })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'The list could not be read.' }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Queue
 * ---------------------------------------------------------------------------------------------- */

/**
 * FROM A DRAFT TO A LIST OF SENDS, ONCE.
 *
 * The campaign is claimed first (draft -> sending, conditionally), so a double press queues nothing
 * twice; then every recipient goes in as ONE insert, so a list is either all there or not at all.
 * If the insert fails the campaign goes back to draft and nothing is sent.
 */
export async function queueCampaign(admin: SupabaseClient, campaignId: string, callerId: string)
  : Promise<{ queued: number; excluded: AudienceResult['excluded'] } | { error: string; status: number }> {
  const campaign = await loadCampaign(admin, campaignId)
  if (!campaign) return { error: 'No such campaign.', status: 404 }
  if (campaign.status !== 'draft') return { error: 'This campaign has already been sent.', status: 409 }
  if (!campaign.subject.trim() || !campaign.body.trim()) return { error: 'Give it a subject and a body first.', status: 400 }

  const resolved = await resolveOnServer(admin, campaign.audience, campaign.first_approach)
  if ('error' in resolved) return { error: resolved.error, status: 500 }
  if (resolved.recipients.length === 0) return { error: 'Nobody on this list can be sent to.', status: 400 }

  const { data: claimed } = await admin.from('marketing_campaigns')
    .update({ status: 'sending', queued_at: new Date().toISOString(), queued_by: callerId,
      recipient_count: resolved.recipients.length, updated_at: new Date().toISOString() })
    .eq('id', campaignId).eq('status', 'draft').select('id')
  if (!claimed?.length) return { error: 'This campaign has already been sent.', status: 409 }

  const rows = resolved.recipients.map((r) => ({
    campaign_id: campaignId, email: r.email, first_name: r.firstName, company_name: r.companyName,
    company_id: r.companyId ?? null, contact_id: r.contactId ?? null, lead_id: r.leadId ?? null,
    first_approach: r.firstApproach,
  }))
  const { error } = await admin.from('marketing_sends').insert(rows)
  if (error) {
    await admin.from('marketing_campaigns').update({ status: 'draft', queued_at: null, queued_by: null, recipient_count: null })
      .eq('id', campaignId)
    /* The one-first-approach index: another campaign reached one of these leads a moment ago. */
    const why = /marketing_sends_one_first_approach/.test(error.message)
      ? 'A lead on this list was approached by another campaign a moment ago. Press Send again.'
      : `The list could not be saved, so nothing was sent: ${error.message}`
    return { error: why, status: 409 }
  }
  return { queued: rows.length, excluded: resolved.excluded }
}

/* ------------------------------------------------------------------------------------------------
 * Drain
 * ---------------------------------------------------------------------------------------------- */

interface SendRow {
  id: string
  campaign_id: string
  email: string
  first_name: string | null
  company_name: string | null
  company_id: string | null
  contact_id: string | null
  lead_id: string | null
  first_approach: boolean
  attempts: number
}

interface Result { id: string; state: 'sent' | 'failed' | 'skipped' | 'queued'; resend_id?: string | null; error?: string | null }

export interface DrainReport {
  sent: number
  failed: number
  skipped: number
  remaining: number
  /** Why it stopped before the list was done, when it did -- said on the screen. */
  stoppedFor: string | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The most attempts a row gets before it is reported as failed rather than tried again. */
export const MAX_ATTEMPTS = 3

/**
 * SEND WHAT IS QUEUED, A CHUNK AT A TIME, UNTIL THE BUDGET IS SPENT.
 *
 * Called by the open screen (one campaign, a short budget, again and again) and by the five-minute
 * mail sweep (every campaign, a longer one) -- so a send started on an iPad that is then closed
 * still finishes. The two never send one row twice: marketing_claim_sends hands each a different
 * chunk.
 *
 * THE UNSUBSCRIBE IS READ AGAIN HERE, not only when the list was drawn. Somebody who unsubscribed
 * from last month's newsletter between this one being queued and their chunk going out is skipped.
 */
export async function drainMarketing(
  admin: SupabaseClient,
  opts: { budgetMs: number; campaignId?: string | null; host?: string | null; fetchImpl?: FetchLike },
): Promise<DrainReport> {
  const report: DrainReport = { sent: 0, failed: 0, skipped: 0, remaining: 0, stoppedFor: null }
  const config = await senderConfig(admin)
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? ''
  const origin = originFor(opts.host)
  if (!config.ready || !config.from) { report.stoppedFor = `Not set up: ${config.missing.join(', ')}`; return finish() }
  if (!origin) { report.stoppedFor = 'The site address is not known, so no unsubscribe link can be written.'; return finish() }

  const { data: firmRow } = await admin.from('firm_settings')
    .select('firm_name, email_font, email_size_pt, postal_address, physical_address').eq('id', true).maybeSingle()
  const firm = (firmRow ?? {}) as { firm_name?: string; email_font?: string; email_size_pt?: number; postal_address?: string; physical_address?: string }
  const face = { emailFont: firm.email_font || 'Georgia, "Times New Roman", Times, serif', emailSizePt: Number(firm.email_size_pt) || 11 }
  const firmName = firm.firm_name?.trim() || 'Bredell Ferreira'
  const firmAddress = firm.postal_address?.trim() || firm.physical_address?.trim() || null

  const campaigns = new Map<string, CampaignRow>()
  const started = Date.now()
  let lastCall = 0

  while (Date.now() - started < opts.budgetMs) {
    const { data: claimedRows, error } = await admin.rpc('marketing_claim_sends', {
      p_limit: RESEND_BATCH_MAX, p_campaign: opts.campaignId ?? null,
    })
    if (error) { report.stoppedFor = error.message; break }
    const claimed = (claimedRows ?? []) as SendRow[]
    if (!claimed.length) break

    const results: Result[] = []
    for (const id of new Set(claimed.map((r) => r.campaign_id))) {
      if (!campaigns.has(id)) { const c = await loadCampaign(admin, id); if (c) campaigns.set(id, c) }
    }
    const { data: prefRows } = await admin.from('marketing_preferences').select('email, status')
      .in('email', claimed.map((r) => r.email)).neq('status', 'subscribed')
    const stopped = new Map(((prefRows ?? []) as { email: string; status: string }[]).map((p) => [p.email, p.status]))

    const toSend: { row: SendRow; email: ReturnType<typeof buildEmail> }[] = []
    for (const row of claimed) {
      const campaign = campaigns.get(row.campaign_id)
      if (!campaign) { results.push({ id: row.id, state: 'failed', error: 'The campaign is gone.' }); continue }
      if (stopped.has(row.email)) {
        results.push({ id: row.id, state: 'skipped', error: stopped.get(row.email) === 'undeliverable' ? 'Undeliverable' : 'Unsubscribed before it was sent' })
        continue
      }
      if (!isSendableEmail(row.email)) { results.push({ id: row.id, state: 'failed', error: 'The address does not look right.' }); continue }
      if (row.attempts > MAX_ATTEMPTS) { results.push({ id: row.id, state: 'failed', error: `Gave up after ${MAX_ATTEMPTS} attempts.` }); continue }
      toSend.push({ row, email: buildEmail(campaign, row) })
    }

    let halt: string | null = null
    if (toSend.length) {
      const wait = RESEND_MIN_GAP_MS - (Date.now() - lastCall)
      if (wait > 0) await sleep(wait)
      lastCall = Date.now()
      const outcome = await resendSend(apiKey, toSend.map((t) => t.email), idempotencyKey(toSend.map((t) => t.row.id)), opts.fetchImpl)
      if (outcome.ok) {
        toSend.forEach((t, i) => results.push({ id: t.row.id, state: 'sent', resend_id: outcome.ids[i] || null, error: null }))
      } else if (isValidationFailure(outcome.status) && toSend.length > 1) {
        /* ONE BAD ADDRESS FAILS A WHOLE BATCH at Resend, so the batch is sent again one by one and
           only the email that is actually wrong is reported as failed. */
        for (const t of toSend) {
          const w = RESEND_MIN_GAP_MS - (Date.now() - lastCall)
          if (w > 0) await sleep(w)
          lastCall = Date.now()
          const one = await resendSend(apiKey, [t.email], idempotencyKey([t.row.id]), opts.fetchImpl)
          if (one.ok) results.push({ id: t.row.id, state: 'sent', resend_id: one.ids[0] || null, error: null })
          else if (isValidationFailure(one.status)) results.push({ id: t.row.id, state: 'failed', error: one.message.slice(0, 500) })
          else { results.push({ id: t.row.id, state: 'queued', error: one.message.slice(0, 500) }); halt = haltReason(one) }
        }
      } else if (isValidationFailure(outcome.status)) {
        results.push({ id: toSend[0].row.id, state: 'failed', error: outcome.message.slice(0, 500) })
      } else {
        /* Rate-limited, refused or unreachable: back in the queue untouched, and stop for now. */
        for (const t of toSend) results.push({ id: t.row.id, state: 'queued', error: outcome.message.slice(0, 500) })
        halt = haltReason(outcome)
      }
    }

    await admin.rpc('marketing_record_results', { p_results: results })
    for (const r of results) {
      if (r.state === 'sent') report.sent += 1
      else if (r.state === 'failed') report.failed += 1
      else if (r.state === 'skipped') report.skipped += 1
    }
    await logOnTimelines(admin, campaigns, claimed, results)
    if (halt) { report.stoppedFor = halt; break }
  }
  return finish()

  function buildEmail(campaign: CampaignRow, row: SendRow): OutgoingEmail {
    const token = unsubscribeToken(row.email)
    const rendered = renderCampaignEmail(
      { subject: campaign.subject, preheader: campaign.preheader, body: campaign.body, imageUrl: campaign.image_url },
      { firstName: row.first_name, companyName: row.company_name },
      { unsubscribeUrl: `${origin}/unsubscribe/${token}`, firmName, face, firmAddress, basis: row.lead_id && !row.company_id ? 'lead' : 'client' },
    )
    return {
      from: config.from as string,
      to: [row.email],
      ...(config.replyTo ? { reply_to: config.replyTo } : {}),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      /*
       * RFC 8058 ONE-CLICK. A mail client's own "Unsubscribe" button POSTs to this address with no
       * page in between, and Gmail and Yahoo require it of anybody sending in bulk. It is the API
       * action itself -- the signed token is the whole of the authority.
       */
      headers: {
        'List-Unsubscribe': `<${origin}/api/email/unsubscribe?t=${token}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }
  }

  async function finish(): Promise<DrainReport> {
    let q = admin.from('marketing_sends').select('id', { count: 'exact', head: true }).in('state', ['queued', 'sending'])
    if (opts.campaignId) q = q.eq('campaign_id', opts.campaignId)
    const { count } = await q
    report.remaining = count ?? 0
    return report
  }
}

function isValidationFailure(status: number): boolean {
  return status === 400 || status === 422
}

function haltReason(o: { status: number; message: string }): string {
  if (o.status === 429) return 'Resend asked us to slow down. The rest goes on the next pass.'
  if (o.status === 401 || o.status === 403) return `Resend refused the key or the sending address: ${o.message}`
  return `Resend could not take the emails just now (${o.status || 'no answer'}): ${o.message}`
}

/**
 * ONE LINE ON EACH TIMELINE IT REACHED: an Email activity, "Newsletter: <subject>". Under the name of
 * whoever pressed Send. meaningfulActivity.ts keeps these out of every rep's counts.
 */
async function logOnTimelines(
  admin: SupabaseClient, campaigns: Map<string, CampaignRow>, claimed: SendRow[], results: Result[],
): Promise<void> {
  const sent = new Set(results.filter((r) => r.state === 'sent').map((r) => r.id))
  const rows = claimed.filter((r) => sent.has(r.id)).flatMap((r) => {
    const c = campaigns.get(r.campaign_id)
    const userId = c?.queued_by ?? c?.created_by
    if (!c || !userId) return []
    return [{
      type: 'Email', user_id: userId, subject: newsletterActivitySubject(c.subject),
      notes: `Sent to ${r.email}`, lead_id: r.lead_id, contact_id: r.contact_id, company_id: r.company_id,
      is_read: true,
    }]
  })
  if (rows.length) await admin.from('activities').insert(rows)
}

/** A recipient for a test send: the person pressing it, so the merge shows their own name. */
export function testRecipient(name: string | null, email: string): Recipient {
  return {
    email: normaliseEmail(email), firstName: (name ?? '').trim().split(/\s+/)[0] || null, companyName: 'Bredell Ferreira',
    firstApproach: false, via: 'client',
  }
}
