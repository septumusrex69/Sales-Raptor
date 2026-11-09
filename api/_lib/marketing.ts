import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { keyedHash, sameHex } from './crypto.js'
import { siteOrigin } from './workflow/siteOrigin.js'
import { fetchAllRows } from '../../src/lib/fetchAll.js'
import {
  DEFAULT_WARMUP_CEILING, LEAD_AUDIENCES, PROSPECT_SENDER_ENV, RESEND_BATCH_MAX, RESEND_MIN_GAP_MS, SENDER_ENV,
  FIRM_SENDER_ENV, FIRM_SENDER_NAME, FIRM_REPORTS_ADDRESS,
  clientLiaison, domainReady, firmSender, inWorkflowAudience, prospectAddressSender, parseSendFrom, parseWorkflowAudience, resendKeyEnvFor, resultRates,
  resultsBySender, senderForRecipient, splitFrom,
  isProspectKind, isSendableEmail, newsSender, newsletterActivitySubject, normaliseEmail, parseAudience, parseKind,
  prospectSender, renderCampaignEmail, replyToFor, resolveAudience, sendBlockReason, stoppedClientEmails, warmupDailyCap, warmupWeek,
  type AudienceResult, type CampaignKind, type CampaignResults, type LiaisonPerson, type Recipient, type RowSender, type SendFrom,
  type SendResultRow, type SenderChoice, type SenderCompany,
} from '../../src/lib/marketing.js'
import { campaignBodyEmpty } from '../../src/lib/campaignHtml.js'

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
  /** NEWS: ready to send, and what is missing or wrong if not. */
  ready: boolean
  missing: string[]
  /** Set when MARKETING_FROM is present but refused -- not an address, or on the firm's own domain. */
  problem: string | null
  from: string | null
  replyTo: string | null
  /** Whether delivery results can be heard -- RESEND_WEBHOOK_SECRET is set. */
  webhook: boolean
  /** INTRODUCTIONS AND PROSPECT MARKETING: their own domain, their own readiness. */
  prospect: { ready: boolean; missing: string[]; problem: string | null; domain: string | null }
  /** The daily allowance a warmed-up prospect sender reaches. */
  warmupCeiling: number
  /**
   * SENDING FROM THE FIRM'S OWN DOMAIN -- a liaison, reports@, or an extra address there (S13). Needs
   * RESEND_FIRM_API_KEY: the first key is restricted to the news domain and Resend refuses the rest.
   */
  firm: { ready: boolean; missing: string[] }
  /**
   * WHETHER MIGRATION campaign_compose IS ON THIS DATABASE (docs/briefs/S13-migration-campaign-compose.sql):
   * templates, a campaign from an extra address, batches, signatures and any-domain senders. Until it is,
   * the screens offer what works without it and say what is waiting.
   */
  schemaReady: boolean
  /** Domains marked verified by somebody who followed the set-up guide, beyond the firm's two. */
  readyDomains: string[]
}

export function warmupCeiling(): number {
  const n = Math.floor(Number(process.env.MARKETING_WARMUP_CEILING))
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_WARMUP_CEILING
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
  const news = newsSender(process.env.MARKETING_FROM, replyTo)
  const problem = process.env.MARKETING_FROM?.trim() && 'error' in news ? news.error : null
  const prospectMissing = PROSPECT_SENDER_ENV.filter((k) => !process.env[k]?.trim())
  const domain = process.env.MARKETING_PROSPECT_DOMAIN?.trim() || null
  /* The domain alone, checked with a stand-in marketer: which marketer it goes from is per campaign. */
  const probe = domain ? prospectSender(domain, { name: null, email: 'probe@example.org' }) : null
  const prospectProblem = probe && 'error' in probe ? probe.error : null
  return {
    ready: missing.length === 0 && !problem,
    missing,
    problem,
    from: 'from' in news ? news.from : null,
    replyTo,
    webhook: !!process.env.RESEND_WEBHOOK_SECRET?.trim(),
    prospect: { ready: prospectMissing.length === 0 && !prospectProblem, missing: prospectMissing, problem: prospectProblem, domain },
    warmupCeiling: warmupCeiling(),
    firm: process.env[FIRM_SENDER_ENV]?.trim() ? { ready: true, missing: [] } : { ready: false, missing: [FIRM_SENDER_ENV] },
    ...(await schemaState(admin)),
  }
}

/** One cheap read: does the campaign_compose migration's last table exist, and which domains are marked ready. */
async function schemaState(admin: SupabaseClient): Promise<{ schemaReady: boolean; readyDomains: string[] }> {
  /* Any failure reads as "not there yet": the screens then offer only what works without it. */
  try {
    const probe = await admin.from('marketing_templates').select('id').limit(1)
    if (probe.error) return { schemaReady: false, readyDomains: [] }
    const { data } = await admin.from('marketing_senders').select('address').not('domain_ready_at', 'is', null)
    const domains = ((data ?? []) as { address: string }[]).map((r) => r.address.split('@')[1] ?? '').filter(Boolean)
    return { schemaReady: true, readyDomains: [...new Set(domains)] }
  } catch {
    return { schemaReady: false, readyDomains: [] }
  }
}

/**
 * WHY A NEWS CAMPAIGN CANNOT GO FROM WHAT WAS CHOSEN, or null. Liaison and reports@ are on the firm's
 * own domain and need the second key; an extra address needs it only when it is on that domain. Said
 * on the screen in these words, and the queue refuses on the same ones.
 */
export function sendFromNotReady(config: SenderConfig, sendFrom: SendFrom, extraAddress?: string | null): string | null {
  /* An address whose domain nobody has set up would be refused by Resend on the morning it mattered. */
  if (sendFrom === 'address' && extraAddress && !domainReady(extraAddress, config.readyDomains ?? [])) {
    return `${extraAddress.split('@')[1]} is not set up for sending yet. Follow the steps under Email addresses, then mark it verified.`
  }
  const needsFirmKey = sendFrom === 'liaison' || sendFrom === 'reports'
    || (sendFrom === 'address' && !!extraAddress && resendKeyEnvFor(extraAddress) === FIRM_SENDER_ENV)
  if (needsFirmKey && !config.firm.ready) {
    return `Sending from ${sendFrom === 'liaison' ? 'the liaisons' : sendFrom === 'reports' ? 'reports@' : extraAddress} is not set up yet: ${FIRM_SENDER_ENV} must be set in Vercel.`
  }
  if (sendFrom === 'address' && !extraAddress) return 'Choose which address it goes from.'
  return null
}

/** Whether a campaign of this kind can go at all, in words for the screen when it cannot. */
export function kindNotReady(config: SenderConfig, kind: CampaignKind): string | null {
  if (isProspectKind(kind)) {
    if (config.prospect.missing.length) return `Prospect sending is not set up yet: ${config.prospect.missing.join(' and ')} must be set in Vercel.`
    return config.prospect.problem
  }
  if (config.missing.length) return `Sending is not set up yet: ${config.missing.join(' and ')} must be set in Vercel.`
  return config.problem
}

interface MarketerRow { id: string; name: string | null; email: string | null }

/** Who a prospect campaign goes out under: the marketer chosen on it, or whoever wrote it. */
export async function campaignMarketer(admin: SupabaseClient, campaign: Pick<CampaignRow, 'sender_id' | 'created_by'>): Promise<MarketerRow | null> {
  const id = campaign.sender_id ?? campaign.created_by
  if (!id) return null
  const { data } = await admin.from('profiles').select('id, name, email').eq('id', id).maybeSingle()
  return (data as MarketerRow | null) ?? null
}

/** The From and Reply-To for one campaign, or why there are none. */
export async function senderForCampaign(
  admin: SupabaseClient, config: SenderConfig, campaign: Pick<CampaignRow, 'kind' | 'sender_id' | 'created_by'> & { sender_address_id?: string | null },
): Promise<SenderChoice> {
  if (isProspectKind(campaign.kind)) {
    /* A chosen address (29 Oct), or the marketer on the prospect domain as before. Never the firm's own domain. */
    if (campaign.sender_address_id) {
      const extra = await loadExtraSender(admin, campaign.sender_address_id)
      if (!extra || !extra.active) return { error: 'The address this campaign was to go from is no longer available. Choose another.' }
      if (!domainReady(extra.address, config.readyDomains ?? [])) return { error: `${extra.address.split('@')[1]} is not set up for sending yet.` }
      return prospectAddressSender(extra.display_name, extra.address)
    }
    return prospectSender(process.env.MARKETING_PROSPECT_DOMAIN, await campaignMarketer(admin, campaign))
  }
  return newsSender(process.env.MARKETING_FROM, config.replyTo)
}

/** The bare address out of "Name <a@b>" -- what the warm-up counts against. */
export function bareAddress(from: string): string {
  return normaliseEmail(/<([^>]+)>\s*$/.exec(from)?.[1] ?? from)
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

/**
 * THE "YES, KEEP ME INFORMED" TOKEN: the send's own id and a keyed hash over it, the unsubscribe
 * link's construction with its own purpose mixed in, so neither token can be passed off as the other.
 * It names a SEND rather than an address, because consent is recorded on the LEAD that send went to,
 * against the campaign that asked -- and a send id is unguessable without the server's key anyway.
 */
export function optInToken(sendId: string): string {
  return `${Buffer.from(sendId, 'utf8').toString('base64url')}.${keyedHash('marketing-opt-in', sendId).slice(0, 32)}`
}

export function readOptInToken(token: string | null | undefined): string | null {
  const [payload, sig] = (token ?? '').split('.')
  if (!payload || !sig || !/^[0-9a-f]{32}$/.test(sig)) return null
  let id: string
  try { id = Buffer.from(payload, 'base64url').toString('utf8') } catch { return null }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return null
  return sameHex(keyedHash('marketing-opt-in', id).slice(0, 32), sig) ? id : null
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
  kind: CampaignKind
  sender_id: string | null
  status: string
  created_by: string | null
  queued_by: string | null
  send_from: SendFrom
  /** The extra address (marketing_senders) when send_from is 'address'. Absent until migration campaign_compose. */
  sender_address_id?: string | null
  /** Batches (29 Oct): up to batch_size, then wait batch_every_minutes. Absent or null: all at once. */
  batch_size?: number | null
  batch_every_minutes?: number | null
  next_batch_at?: string | null
}

/*
 * EVERY COLUMN, by '*', not a list: `sender_address_id` arrives with migration campaign_sender_address,
 * and a named list would make every campaign unreadable on a database that has not had it yet.
 */
const CAMPAIGN_COLUMNS = '*'

function asCampaign(row: CampaignRow): CampaignRow {
  return { ...row, kind: parseKind(row.kind), send_from: parseSendFrom(row.send_from) }
}

export async function loadCampaign(admin: SupabaseClient, id: string): Promise<CampaignRow | null> {
  const { data } = await admin.from('marketing_campaigns').select(CAMPAIGN_COLUMNS).eq('id', id).maybeSingle()
  const row = data as CampaignRow | null
  return row ? asCampaign(row) : null
}

/* ------------------------------------------------------------------------------------------------
 * Who each row goes from
 * ---------------------------------------------------------------------------------------------- */

/** An extra address, as marketing_senders keeps it. */
export interface ExtraSender { id: string; address: string; display_name: string; active: boolean; signature_html?: string | null }

export async function loadExtraSender(admin: SupabaseClient, id: string | null | undefined): Promise<ExtraSender | null> {
  if (!id) return null
  /* '*': signature_html arrives with migration campaign_compose. */
  const { data } = await admin.from('marketing_senders').select('*').eq('id', id).maybeSingle()
  return (data as ExtraSender | null) ?? null
}

/**
 * THE SIGNATURE AN ADDRESS SIGNS WITH, for {{signature}}: its own (marketing_senders.signature_html, set under
 * Email addresses), or -- for a liaison -- the signature on her own profile, the one her everyday mail already
 * carries, so Nicole's newsletter signs off the way her letters do. None is an empty string, never a guess.
 */
export async function signatureFor(admin: SupabaseClient, address: string): Promise<string> {
  const a = normaliseEmail(address)
  if (!a) return ''
  const { data: own } = await admin.from('marketing_senders').select('*').eq('address', a).maybeSingle()
  const html = (own as { signature_html?: string | null } | null)?.signature_html
  if (html?.trim()) return html
  const { data: person } = await admin.from('profiles')
    .select('email_signature, email_signature_image_url, email_signature_image_width, email_signature_image_align').ilike('email', a).limit(1).maybeSingle()
  const p = person as { email_signature?: string | null; email_signature_image_url?: string | null; email_signature_image_width?: number | null; email_signature_image_align?: string | null } | null
  if (!p || (!p.email_signature?.trim() && !p.email_signature_image_url)) return ''
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const text = (p.email_signature ?? '').trim() ? `<p>${esc(p.email_signature ?? '').replace(/\n/g, '<br>')}</p>` : ''
  const img = p.email_signature_image_url && /^https:\/\//.test(p.email_signature_image_url)
    ? `<p align="${p.email_signature_image_align ?? 'left'}"><img src="${esc(p.email_signature_image_url)}" width="${Math.min(600, p.email_signature_image_width ?? 160)}" alt=""></p>`
    : ''
  return text + img
}

/** Everybody who could be somebody's liaison, keyed by id -- and by address, for crediting a timeline line. */
async function loadPeople(admin: SupabaseClient): Promise<Map<string, LiaisonPerson>> {
  const rows = await fetchAllRows<Record<string, unknown>>(() => admin.from('profiles')
    .select('id, name, email, role, status').order('id'), { table: 'profiles' })
  return new Map(rows.map((p) => [String(p.id), {
    id: String(p.id), name: (p.name as string | null) ?? null, email: (p.email as string | null) ?? null,
    role: String(p.role ?? ''), status: String(p.status ?? ''),
  }]))
}

/**
 * THE SENDER FOR EVERY RECIPIENT, decided when the list is drawn (preview and queue alike) and
 * written onto each row at queue time, so the drain sends each from what the preview showed.
 * Introductions and prospect campaigns are not part of this: their sender is the marketer's.
 */
export function sendersFor(
  recipients: Recipient[], sendFrom: SendFrom, extra: ExtraSender | null,
  companies: Map<string, SenderCompany>, people: Map<string, LiaisonPerson>,
): RowSender[] {
  const news = splitFrom(process.env.MARKETING_FROM)
  const ctx = {
    news, extra: extra ? { name: extra.display_name, address: extra.address } : null,
    liaisonOf: (id: string | null | undefined) => clientLiaison(id, companies, people),
  }
  return recipients.map((r) => senderForRecipient(sendFrom, r, ctx))
}

/**
 * EVERYTHING THE AUDIENCE RULE READS, every row of it: the sales tables are small today, and a list
 * that quietly stopped at PostgREST's thousand would be a newsletter that quietly missed people.
 */
export async function resolveOnServer(
  admin: SupabaseClient, audienceRaw: unknown, kindRaw: unknown,
  from: { sendFrom?: unknown; senderAddressId?: string | null } = {},
): Promise<(AudienceResult & { senders: RowSender[] | null }) | { error: string }> {
  const audience = parseAudience(audienceRaw)
  if (!audience) return { error: 'This campaign has no list chosen.' }
  const kind = parseKind(kindRaw)
  /*
   * THE INTRODUCTION IS THE ONLY FIRST APPROACH THERE IS. A news campaign's old "first approach" box
   * is gone and its stored flag is not read: one route to a stranger's inbox, so "once ever" has one
   * door to guard (and the database's one-first-approach index behind it).
   */
  const firstApproach = kind === 'introduction'
  if (isProspectKind(kind) && !LEAD_AUDIENCES.includes(audience.kind)) {
    return { error: 'A prospect campaign goes to leads only. Choose a list of leads.' }
  }
  try {
    const [companies, contacts, leads, activities, prefs, approached] = await Promise.all([
      fetchAllRows<Record<string, unknown>>(() => admin.from('companies')
        .select('id, name, email, parent_company_id, services, contact_person, news_stopped_at, account_owner_id, liaison_needed')
        .order('id'), { table: 'companies' }),
      fetchAllRows<Record<string, unknown>>(() => admin.from('contacts')
        .select('id, first_name, email, company_id, lead_id').order('id'), { table: 'contacts' }),
      fetchAllRows<Record<string, unknown>>(() => admin.from('leads')
        .select('id, first_name, company_name, email, status, source, created_at, last_contact_at, rejection_reason, status_changed_at, marketing_consent_at, marketing_list_id')
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
    const resolved = resolveAudience({
      audience,
      firstApproach,
      kind,
      companies: companies.map((c) => ({
        id: String(c.id), name: String(c.name ?? ''), email: s(c.email), parentCompanyId: s(c.parent_company_id),
        services: (Array.isArray(c.services) ? c.services : []) as never[], contactPerson: s(c.contact_person),
        newsStoppedAt: s(c.news_stopped_at),
      })),
      contacts: contacts.map((c) => ({
        id: String(c.id), firstName: String(c.first_name ?? ''), email: s(c.email), companyId: s(c.company_id), leadId: s(c.lead_id),
      })),
      leads: leads.map((l) => ({
        id: String(l.id), firstName: String(l.first_name ?? ''), companyName: String(l.company_name ?? ''), email: s(l.email),
        status: l.status as never, source: l.source as never, createdAt: String(l.created_at),
        lastContactAt: s(l.last_contact_at), rejectionReason: l.rejection_reason as never,
        statusChangedAt: s(l.status_changed_at), marketingConsentAt: s(l.marketing_consent_at),
        marketingListId: s(l.marketing_list_id),
      })),
      activities: activities.map((a) => ({
        leadId: s(a.lead_id), activityDate: String(a.activity_date), type: String(a.type), subject: String(a.subject ?? ''),
      })),
      preferences: new Map(prefs.map((p) => [String(p.email), p.status as 'unsubscribed' | 'undeliverable'])),
      approachedLeads: new Set(approached.map((a) => String(a.lead_id))),
      now,
    })
    /* WHO EACH GOES FROM, in the same pass: the split the preview shows is the split that is queued. */
    if (kind !== 'news') return { ...resolved, senders: null }
    const sendFrom = parseSendFrom(from.sendFrom)
    const extra = sendFrom === 'address' ? await loadExtraSender(admin, from.senderAddressId) : null
    if (sendFrom === 'address' && (!extra || !extra.active)) return { error: 'The address this campaign was to go from is no longer available. Choose another.' }
    const people = sendFrom === 'liaison' ? await loadPeople(admin) : new Map<string, LiaisonPerson>()
    const companyMap = new Map(companies.map((c) => [String(c.id), {
      id: String(c.id), parentCompanyId: s(c.parent_company_id) ?? null, accountOwnerId: s(c.account_owner_id) ?? null,
      liaisonNeeded: c.liaison_needed === true,
    }]))
    return { ...resolved, senders: sendersFor(resolved.recipients, sendFrom, extra, companyMap, people) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'The list could not be read.' }
  }
}

/**
 * THE ADDRESSES OF EVERY CLIENT THAT SAID NO NEWS, read fresh. Nothing to read when no client has,
 * which is the usual day: one small query, and the family and contacts only when there is a stop.
 */
async function clientStoppedEmails(admin: SupabaseClient): Promise<Set<string>> {
  const { data: first } = await admin.from('companies').select('id').not('news_stopped_at', 'is', null).limit(1)
  if (!first?.length) return new Set()
  const [companies, contacts] = await Promise.all([
    fetchAllRows<Record<string, unknown>>(() => admin.from('companies')
      .select('id, email, parent_company_id, news_stopped_at').order('id'), { table: 'companies' }),
    fetchAllRows<Record<string, unknown>>(() => admin.from('contacts')
      .select('id, email, company_id').not('company_id', 'is', null).order('id'), { table: 'contacts' }),
  ])
  const s = (v: unknown) => (typeof v === 'string' ? v : undefined)
  return stoppedClientEmails(
    companies.map((c) => ({ id: String(c.id), email: s(c.email), parentCompanyId: s(c.parent_company_id), newsStoppedAt: s(c.news_stopped_at) })),
    contacts.map((c) => ({ email: s(c.email), companyId: s(c.company_id) })),
  )
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
  if (!campaign.subject.trim() || campaignBodyEmpty(campaign.body)) return { error: 'Give it a subject and a body first.', status: 400 }

  if (campaign.kind === 'news') {
    const extra = campaign.send_from === 'address' ? await loadExtraSender(admin, campaign.sender_address_id) : null
    const notReady = sendFromNotReady(await senderConfig(admin), campaign.send_from, extra?.address)
    if (notReady) return { error: notReady, status: 412 }
  }
  const resolved = await resolveOnServer(admin, campaign.audience, campaign.kind,
    { sendFrom: campaign.send_from, senderAddressId: campaign.sender_address_id ?? null })
  if ('error' in resolved) return { error: resolved.error, status: 500 }
  if (resolved.recipients.length === 0) return { error: 'Nobody on this list can be sent to.', status: 400 }

  const { data: claimed } = await admin.from('marketing_campaigns')
    .update({ status: 'sending', queued_at: new Date().toISOString(), queued_by: callerId,
      recipient_count: resolved.recipients.length, updated_at: new Date().toISOString() })
    .eq('id', campaignId).eq('status', 'draft').select('id')
  if (!claimed?.length) return { error: 'This campaign has already been sent.', status: 409 }

  const rows = resolved.recipients.map((r, i) => ({
    campaign_id: campaignId, email: r.email, first_name: r.firstName, company_name: r.companyName,
    company_id: r.companyId ?? null, contact_id: r.contactId ?? null, lead_id: r.leadId ?? null,
    first_approach: r.firstApproach,
    /*
     * THE BARE FROM ADDRESS, decided now (S13): the drain sends each row from it, and the results are
     * split by it. Null for the prospect kinds, whose sender marketing_claim_prospect writes as it
     * counts that marketer's warm-up -- a liaison's or reports@'s address is on the firm's domain and
     * can never be counted against a prospect sender's allowance.
     */
    sender: resolved.senders?.[i]?.address ?? null,
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
  /** The bare From address written at queue time (S13), or null for rows queued before it. */
  sender: string | null
}

interface Result { id: string; state: 'sent' | 'failed' | 'skipped' | 'queued'; resend_id?: string | null; error?: string | null }

/** Where a prospect sender stands today -- the campaign page says it. */
export interface Allowance { sender: string; week: number; cap: number; used: number }

export interface DrainReport {
  sent: number
  failed: number
  skipped: number
  remaining: number
  /** Why it stopped before the list was done, when it did -- said on the screen. */
  stoppedFor: string | null
  /** Rows of prospect campaigns whose sender has used today's allowance: they go tomorrow, on their own. */
  waitingForTomorrow: number
  /** The sender's day, for a prospect campaign drained by itself. */
  allowance: Allowance | null
  /** A campaign sent in batches (29 Oct) that has sent this batch: when the next one goes. The sweep sends it. */
  nextBatchAt?: string | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The most attempts a row gets before it is reported as failed rather than tried again. */
export const MAX_ATTEMPTS = 3

/**
 * SEND WHAT IS QUEUED, A CHUNK AT A TIME, CAMPAIGN BY CAMPAIGN, UNTIL THE BUDGET IS SPENT.
 *
 * Called by the open screen (one campaign, a short budget, again and again) and by the five-minute
 * mail sweep (every campaign, a longer one) -- so a send started on an iPad that is then closed
 * still finishes. The two never send one row twice: the claim functions hand each a different chunk.
 *
 * ONE CAMPAIGN PER CHUNK, because a chunk has one sender: news goes from MARKETING_FROM, a prospect
 * campaign from its marketer on MARKETING_PROSPECT_DOMAIN -- and a prospect chunk is claimed only up
 * to what that sender has left of today's warm-up allowance (marketing_claim_prospect counts it under
 * a lock). A sender at its allowance is skipped until tomorrow; its rows simply stay queued.
 *
 * THE UNSUBSCRIBE AND THE CONSENT ARE READ AGAIN HERE, not only when the list was drawn. Somebody who
 * unsubscribed between the queue and their chunk is skipped; a lead with no consent on record is
 * never sent anything but its one introduction (sendBlockReason).
 */
export async function drainMarketing(
  admin: SupabaseClient,
  opts: { budgetMs: number; campaignId?: string | null; host?: string | null; fetchImpl?: FetchLike },
): Promise<DrainReport> {
  const report: DrainReport = { sent: 0, failed: 0, skipped: 0, remaining: 0, stoppedFor: null, waitingForTomorrow: 0, allowance: null }
  const campaigns = new Map<string, CampaignRow>()
  const senders = new Map<string, SenderChoice>()
  /* Campaigns whose sender is at today's allowance: not tried again in this drain. */
  const waiting = new Set<string>()
  /* Batched campaigns between batches: not tried again in this drain, and not "waiting for tomorrow". */
  const betweenBatches = new Set<string>()
  /* Campaigns that cannot go at all just now (no sender) -- said once, not retried. */
  const blocked = new Set<string>()
  /* Address -> the name it signs with, and -> the liaison's profile for the timeline. */
  const names = new Map<string, string | null>()
  const liaisonIds = new Map<string, string>()
  /* Address -> its signature, for {{signature}}: read once per drain, not once per email. */
  const signatures = new Map<string, string>()
  /* A batched campaign's allowance left in THIS batch (29 Oct). */
  const batchLeft = new Map<string, number>()
  const config = await senderConfig(admin)
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? ''
  const origin = originFor(opts.host)
  if (!apiKey) { report.stoppedFor = 'Not set up: RESEND_API_KEY'; return finish() }
  if (!origin) { report.stoppedFor = 'The site address is not known, so no unsubscribe link can be written.'; return finish() }

  const { data: firmRow } = await admin.from('firm_settings')
    .select('firm_name, email_font, email_size_pt, postal_address, physical_address').eq('id', true).maybeSingle()
  const firm = (firmRow ?? {}) as { firm_name?: string; email_font?: string; email_size_pt?: number; postal_address?: string; physical_address?: string }
  const face = { emailFont: firm.email_font || 'Georgia, "Times New Roman", Times, serif', emailSizePt: Number(firm.email_size_pt) || 11 }
  const firmName = firm.firm_name?.trim() || 'Bredell Ferreira'
  const firmAddress = firm.postal_address?.trim() || firm.physical_address?.trim() || null

  const started = Date.now()
  let lastCall = 0
  let halt: string | null = null

  while (!halt && Date.now() - started < opts.budgetMs) {
    let q = admin.from('marketing_campaigns').select(CAMPAIGN_COLUMNS).eq('status', 'sending')
    if (opts.campaignId) q = q.eq('id', opts.campaignId)
    const { data: live } = await q
    const open = ((live ?? []) as CampaignRow[]).map(asCampaign)
      .filter((c) => !waiting.has(c.id) && !blocked.has(c.id) && !betweenBatches.has(c.id))
    if (!open.length) break
    let progressed = false
    for (const campaign of open) {
      if (halt || Date.now() - started >= opts.budgetMs) break
      campaigns.set(campaign.id, campaign)
      let sender = senders.get(campaign.id)
      if (!sender) { sender = await senderForCampaign(admin, config, campaign); senders.set(campaign.id, sender) }
      if ('error' in sender) { blocked.add(campaign.id); report.stoppedFor = sender.error; continue }
      /*
       * NOT CLAIMED AT ALL while the firm's key is missing: a claim counts an attempt, and a row
       * claimed and put back on every five-minute sweep would be "given up" on within a quarter of an
       * hour. Unclaimed, the rows simply wait for the key.
       */
      if (campaign.kind === 'news' && campaign.send_from !== 'news') {
        const extra = campaign.send_from === 'address' ? await loadExtraSender(admin, campaign.sender_address_id) : null
        const notReady = sendFromNotReady(config, campaign.send_from, extra?.address)
        if (notReady) { blocked.add(campaign.id); report.stoppedFor = notReady; continue }
      }
      /*
       * IN BATCHES, WHEN IT WAS ASKED FOR (Ryno, 29 Oct: "how many emails at a time, the frequency"). Up to
       * batch_size, then nothing until next_batch_at -- which is written the moment a batch is used up, so the
       * open screen, the five-minute sweep and a second tab all read the same clock. A batch is counted in
       * CLAIMED rows: a row skipped for an unsubscribe still took its place, which errs on the slow side.
       */
      const batch = campaign.batch_size && campaign.batch_size > 0 ? campaign.batch_size : null
      if (batch) {
        if (campaign.next_batch_at && new Date(campaign.next_batch_at).getTime() > Date.now()) {
          betweenBatches.add(campaign.id)
          if (opts.campaignId === campaign.id || !report.nextBatchAt) report.nextBatchAt = campaign.next_batch_at
          continue
        }
        if (!batchLeft.has(campaign.id)) batchLeft.set(campaign.id, batch)
      }
      const limit = batch ? Math.max(1, Math.min(RESEND_BATCH_MAX, batchLeft.get(campaign.id) ?? batch)) : RESEND_BATCH_MAX

      let claimed: SendRow[]
      if (isProspectKind(campaign.kind)) {
        const address = bareAddress(sender.from)
        const { data: dayRows } = await admin.rpc('marketing_sender_today', { p_sender: address })
        const day = (Array.isArray(dayRows) ? dayRows[0] : dayRows) as { used?: number; first_sent_at?: string | null } | null
        /* Real time, not the firm's clock: see warmupDailyCap. */
        const now = new Date().toISOString()
        const cap = warmupDailyCap(day?.first_sent_at ?? null, now, config.warmupCeiling)
        const used = Number(day?.used ?? 0)
        if (opts.campaignId === campaign.id || !report.allowance) {
          report.allowance = { sender: address, week: warmupWeek(day?.first_sent_at ?? null, now), cap, used }
        }
        if (used >= cap) { waiting.add(campaign.id); continue }
        const { data, error } = await admin.rpc('marketing_claim_prospect', {
          p_campaign: campaign.id, p_sender: address, p_cap: cap, p_limit: limit,
        })
        if (error) { halt = error.message; break }
        claimed = (data ?? []) as SendRow[]
        if (report.allowance?.sender === address) report.allowance.used = Math.min(cap, used + claimed.length)
        if (!claimed.length) { waiting.add(campaign.id); continue }
      } else {
        const { data, error } = await admin.rpc('marketing_claim_sends', { p_limit: limit, p_campaign: campaign.id })
        if (error) { halt = error.message; break }
        claimed = (data ?? []) as SendRow[]
        if (!claimed.length) continue
      }
      progressed = true
      if (batch) {
        const left = (batchLeft.get(campaign.id) ?? batch) - claimed.length
        batchLeft.set(campaign.id, left)
        if (left <= 0) {
          /* This batch is used: the next one waits its turn, whoever drains it. */
          const next = new Date(Date.now() + (campaign.batch_every_minutes ?? 60) * 60_000).toISOString()
          await admin.from('marketing_campaigns').update({ next_batch_at: next }).eq('id', campaign.id)
          betweenBatches.add(campaign.id)
          report.nextBatchAt = next
        }
      }
      if (campaign.kind !== 'news') { halt = await sendChunk(campaign, sender, claimed, apiKey); continue }
      /*
       * A NEWS CHUNK CAN CARRY SEVERAL SENDERS (S13): Nicole's clients, Ryno's, reports@ for the rest
       * and news@ for leads. Each group goes as its own batch, from the address written on its rows at
       * queue time, with the key its domain needs.
       */
      const newsAddress = bareAddress(sender.from)
      const groups = new Map<string, SendRow[]>()
      for (const r of claimed) {
        const a = r.sender && r.sender !== newsAddress ? r.sender : ''
        groups.set(a, [...(groups.get(a) ?? []), r])
      }
      for (const [address, rows] of groups) {
        if (halt) {
          /* Halted part-way: what was claimed and not tried goes back in the queue untouched. */
          await admin.rpc('marketing_record_results', { p_results: rows.map((r) => ({ id: r.id, state: 'queued', error: null })) })
          continue
        }
        if (!address) { halt = await sendChunk(campaign, sender, rows, apiKey); continue }
        const env = resendKeyEnvFor(address, process.env)
        const key = process.env[env]?.trim() ?? ''
        const from = firmSender(await nameOf(address), address)
        if (!key || 'error' in from) {
          await admin.rpc('marketing_record_results', { p_results: rows.map((r) => ({ id: r.id, state: 'queued', error: null })) })
          halt = 'error' in from
            ? from.error
            : `Sending from ${address} is not set up yet: ${env} must be set in Vercel. Those emails are waiting and go once it is.`
          continue
        }
        halt = await sendChunk(campaign, from, rows, key, true)
      }
    }
    if (!progressed) break
  }
  if (halt) report.stoppedFor = halt
  return finish()

  /* The name an address on the firm's domain signs with: the liaison's own, the extra address's, or the firm's. */
  async function nameOf(address: string): Promise<string | null> {
    if (address === FIRM_REPORTS_ADDRESS) return FIRM_SENDER_NAME
    if (!names.has(address)) {
      const [{ data: person }, { data: extra }] = await Promise.all([
        admin.from('profiles').select('id, name').ilike('email', address).limit(1).maybeSingle(),
        admin.from('marketing_senders').select('display_name').eq('address', address).maybeSingle(),
      ])
      const p = person as { id: string; name: string | null } | null
      if (p) liaisonIds.set(address, p.id)
      names.set(address, (extra as { display_name?: string } | null)?.display_name ?? p?.name ?? null)
    }
    return names.get(address) ?? null
  }

  async function sendChunk(
    campaign: CampaignRow, sender: { from: string; replyTo: string | null }, claimed: SendRow[], key: string, personal = false,
  ): Promise<string | null> {
    const results: Result[] = []
    const { data: prefRows } = await admin.from('marketing_preferences').select('email, status')
      .in('email', claimed.map((r) => r.email)).neq('status', 'subscribed')
    const stopped = new Map(((prefRows ?? []) as { email: string; status: string }[]).map((p) => [p.email, p.status]))
    /*
     * A CLIENT THAT SAID NO NEWS AFTER THE LIST WAS DRAWN (clientNews.ts) is held to it here, as one
     * address's unsubscribe is. Read per chunk: a liaison recording it while a campaign is still
     * going out must stop the rest of it, not the next one.
     */
    const clientStopped = await clientStoppedEmails(admin)
    for (const email of clientStopped) if (!stopped.has(email)) stopped.set(email, 'client unsubscribed')
    /* THE LEAD AS IT STANDS NOW, for the consent rule. */
    const leadIds = [...new Set(claimed.map((r) => r.lead_id).filter((x): x is string => !!x))]
    const { data: leadRows } = leadIds.length
      ? await admin.from('leads').select('id, marketing_consent_at').in('id', leadIds)
      : { data: [] }
    const leads = new Map(((leadRows ?? []) as { id: string; marketing_consent_at: string | null }[])
      .map((l) => [l.id, { marketingConsentAt: l.marketing_consent_at }]))

    const toSend: { row: SendRow; email: OutgoingEmail }[] = []
    /* {{signature}} is the signature of the address these go from -- read once, only if the body asks for it. */
    const from = bareAddress(sender.from)
    if (/\{\{\s*signature\s*\}\}/.test(campaign.body) && !signatures.has(from)) signatures.set(from, await signatureFor(admin, from))
    for (const row of claimed) {
      if (stopped.has(row.email)) {
        const why = stopped.get(row.email)
        results.push({ id: row.id, state: 'skipped', error: why === 'undeliverable' ? 'Undeliverable'
          : why === 'client unsubscribed' ? 'The client unsubscribed from our news' : 'Unsubscribed before it was sent' })
        continue
      }
      const block = sendBlockReason(
        { leadId: row.lead_id, companyId: row.company_id, firstApproach: row.first_approach },
        row.lead_id ? leads.get(row.lead_id) ?? null : null,
      )
      if (block) { results.push({ id: row.id, state: 'skipped', error: block }); continue }
      if (!isSendableEmail(row.email)) { results.push({ id: row.id, state: 'failed', error: 'The address does not look right.' }); continue }
      if (row.attempts > MAX_ATTEMPTS) { results.push({ id: row.id, state: 'failed', error: `Gave up after ${MAX_ATTEMPTS} attempts.` }); continue }
      toSend.push({ row, email: buildEmail(campaign, sender, row, personal, signatures.get(bareAddress(sender.from)) ?? '') })
    }

    let stop: string | null = null
    if (toSend.length) {
      const wait = RESEND_MIN_GAP_MS - (Date.now() - lastCall)
      if (wait > 0) await sleep(wait)
      lastCall = Date.now()
      const outcome = await resendSend(key, toSend.map((t) => t.email), idempotencyKey(toSend.map((t) => t.row.id)), opts.fetchImpl)
      if (outcome.ok) {
        toSend.forEach((t, i) => results.push({ id: t.row.id, state: 'sent', resend_id: outcome.ids[i] || null, error: null }))
      } else if (isValidationFailure(outcome.status) && toSend.length > 1) {
        /* ONE BAD ADDRESS FAILS A WHOLE BATCH at Resend, so the batch is sent again one by one and
           only the email that is actually wrong is reported as failed. */
        for (const t of toSend) {
          const w = RESEND_MIN_GAP_MS - (Date.now() - lastCall)
          if (w > 0) await sleep(w)
          lastCall = Date.now()
          const one = await resendSend(key, [t.email], idempotencyKey([t.row.id]), opts.fetchImpl)
          if (one.ok) results.push({ id: t.row.id, state: 'sent', resend_id: one.ids[0] || null, error: null })
          else if (isValidationFailure(one.status)) results.push({ id: t.row.id, state: 'failed', error: one.message.slice(0, 500) })
          else { results.push({ id: t.row.id, state: 'queued', error: one.message.slice(0, 500) }); stop = haltReason(one) }
        }
      } else if (isValidationFailure(outcome.status)) {
        results.push({ id: toSend[0].row.id, state: 'failed', error: outcome.message.slice(0, 500) })
      } else {
        /* Rate-limited, refused or unreachable: back in the queue untouched, and stop for now. */
        for (const t of toSend) results.push({ id: t.row.id, state: 'queued', error: outcome.message.slice(0, 500) })
        stop = haltReason(outcome)
      }
    }

    await admin.rpc('marketing_record_results', { p_results: results })
    for (const r of results) {
      if (r.state === 'sent') report.sent += 1
      else if (r.state === 'failed') report.failed += 1
      else if (r.state === 'skipped') report.skipped += 1
    }
    /* In liaison mode the line on the client is credited to the liaison it went from (brief 1.1 rule 9). */
    await logOnTimelines(admin, campaigns, claimed, results,
      campaign.send_from === 'liaison' ? (r) => (r.sender ? liaisonIds.get(r.sender) ?? null : null) : undefined)
    return stop
  }

  function buildEmail(campaign: CampaignRow, sender: { from: string; replyTo: string | null }, row: SendRow, personal = false, signatureHtml = ''): OutgoingEmail {
    const token = unsubscribeToken(row.email)
    const introduction = campaign.kind === 'introduction'
    const rendered = renderCampaignEmail(
      { subject: campaign.subject, preheader: campaign.preheader, body: campaign.body, imageUrl: campaign.image_url },
      { firstName: row.first_name, companyName: row.company_name },
      {
        unsubscribeUrl: `${origin}/unsubscribe/${token}`, firmName, face, firmAddress,
        basis: introduction ? 'introduction' : row.lead_id && !row.company_id ? 'lead' : 'client',
        optInUrl: introduction ? `${origin}/opt-in/${optInToken(row.id)}` : null,
        signatureHtml,
      },
    )
    return {
      from: sender.from,
      to: [row.email],
      /* News answers to info@ from a lead and reports@ from a client (replyToFor); a prospect email
         keeps the marketer's own address. */
      ...((() => {
        /* From a liaison, reports@ or an extra address, a reply goes to that same address. */
        const to = campaign.kind === 'news' && !personal
          ? replyToFor(row, {
            leads: process.env.MARKETING_REPLY_TO_LEADS?.trim() || null,
            clients: process.env.MARKETING_REPLY_TO_CLIENTS?.trim() || null,
          }, sender.replyTo)
          : sender.replyTo
        return to ? { reply_to: to } : {}
      })()),
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
    if (waiting.size) {
      const { count: held } = await admin.from('marketing_sends').select('id', { count: 'exact', head: true })
        .in('campaign_id', [...waiting]).eq('state', 'queued')
      report.waitingForTomorrow = held ?? 0
      if (!report.stoppedFor && report.waitingForTomorrow > 0 && report.allowance) {
        report.stoppedFor = `Today’s allowance for ${report.allowance.sender} (${report.allowance.cap}, week ${report.allowance.week} of the warm-up) is used. ${report.waitingForTomorrow} waiting for tomorrow’s allowance.`
      }
    }
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
 * whoever pressed Send -- or, sent from each client's liaison, under the liaison's (`creditTo`), because
 * on the client's record it was her letter. meaningfulActivity.ts keeps these out of every rep's counts.
 */
async function logOnTimelines(
  admin: SupabaseClient, campaigns: Map<string, CampaignRow>, claimed: SendRow[], results: Result[],
  creditTo?: (row: SendRow) => string | null,
): Promise<void> {
  const sent = new Set(results.filter((r) => r.state === 'sent').map((r) => r.id))
  const rows = claimed.filter((r) => sent.has(r.id)).flatMap((r) => {
    const c = campaigns.get(r.campaign_id)
    const userId = creditTo?.(r) ?? c?.queued_by ?? c?.created_by
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

/*
 * THE DAILY RUN FOR FOLLOW-UPS AND RESULTS EMAILS (S14 tables, 28 Oct; the sending, S13 for Ryno).
 *
 * Ryno: "send a campaign, wait a set number of days, then automatically send the next email (for example only
 * to people who didn't open it)" and "a day after a campaign ends, the results go automatically to the
 * marketing team". The database decides WHAT is due (marketing_workflow_steps_due, marketing_results_due --
 * migration marketing_workflows); this asks it every morning at 07:13 (vercel.json, /api/email/marketing-daily),
 * queues each due follow-up and sends each due results email. The five-minute mail sweep then drains the
 * follow-ups exactly as it drains a campaign somebody pressed Send on.
 *
 * NOTHING IS MARKED DONE UNSENT. A step is stamped `run_at` only in the same breath as its list is queued, and a
 * results email's `results_sent_at` is put back if Resend refuses it -- so a morning that fails leaves the work
 * due for the next one rather than quietly skipped.
 */
export interface MarketingDailyResult {
  stepsDue: { step_id: string; workflow_id: string; step_position: number; campaign_id: string; audience: string; previous_campaign_id: string }[]
  resultsDue: { campaign_id: string; name: string; finished_at: string; recipients: string[] }[]
  sent: { steps: number; results: number }
  /** What could not go this morning, and why -- logged and returned to whoever pressed it. */
  problems: string[]
}

export async function marketingDailyTick(admin: SupabaseClient, today: string): Promise<MarketingDailyResult> {
  const [steps, results] = await Promise.all([
    admin.rpc('marketing_workflow_steps_due', { p_today: today }),
    admin.rpc('marketing_results_due'),
  ])
  if (steps.error) throw new Error(steps.error.message)
  if (results.error) throw new Error(results.error.message)
  const out: MarketingDailyResult = {
    stepsDue: (steps.data ?? []) as MarketingDailyResult['stepsDue'],
    resultsDue: (results.data ?? []) as MarketingDailyResult['resultsDue'],
    sent: { steps: 0, results: 0 },
    problems: [],
  }
  const config = await senderConfig(admin)
  for (const step of out.stepsDue) {
    const r = await queueWorkflowStep(admin, config, step)
    if ('error' in r) out.problems.push(r.error)
    else out.sent.steps += 1
  }
  /* The first chunks now; the five-minute sweep finishes them. */
  if (out.sent.steps > 0) await drainMarketing(admin, { budgetMs: 60_000 }).catch(() => null)
  for (const due of out.resultsDue) {
    const r = await sendResultsEmail(admin, due.campaign_id, due.recipients)
    if ('error' in r) out.problems.push(r.error)
    else out.sent.results += 1
  }
  return out
}

/**
 * ONE FOLLOW-UP, QUEUED: the step's own campaign, to whoever on the email before it fits the step's audience.
 *
 * The audience is read off the previous email's SENDS -- they already carry delivered, opened, clicked and
 * unsubscribed for every address -- so there is nothing per client to keep in step. Each row goes from the
 * step campaign's own Send from, decided as a pressed campaign's is.
 */
export async function queueWorkflowStep(
  admin: SupabaseClient, config: SenderConfig, step: MarketingDailyResult['stepsDue'][number],
): Promise<{ queued: number } | { error: string }> {
  const campaign = await loadCampaign(admin, step.campaign_id)
  const label = `Follow-up ${step.step_position}${campaign ? ` (${campaign.name})` : ''}`
  if (!campaign) return { error: `${label}: its email is missing.` }
  if (campaign.kind !== 'news') return { error: `${label}: only News can be a follow-up. Introductions and prospect mail go once, by hand.` }
  if (campaign.status !== 'draft') {
    /* Somebody sent it by hand already: the step is done, not sent twice. */
    await admin.from('marketing_workflow_steps').update({ run_at: new Date().toISOString() }).eq('id', step.step_id).is('run_at', null)
    return { error: `${label}: its email had already been sent by hand, so the workflow did not send it again.` }
  }
  if (!campaign.subject.trim() || campaignBodyEmpty(campaign.body)) return { error: `${label}: it has no subject or no body yet. It goes the first morning it has both.` }
  const extra = campaign.send_from === 'address' ? await loadExtraSender(admin, campaign.sender_address_id) : null
  const notReady = kindNotReady(config, 'news') ?? sendFromNotReady(config, campaign.send_from, extra?.address)
  if (notReady) return { error: `${label}: ${notReady}` }

  const previous = await fetchAllRows<Record<string, unknown>>(() => admin.from('marketing_sends')
    .select('id, email, first_name, company_name, company_id, contact_id, lead_id, state, first_opened_at, first_clicked_at, unsubscribed_at')
    .eq('campaign_id', step.previous_campaign_id).order('id'), { table: 'marketing_sends' })
  const audience = parseWorkflowAudience(step.audience)
  const s = (v: unknown) => (typeof v === 'string' ? v : null)
  const picked = previous.filter((r) => inWorkflowAudience(audience, {
    state: String(r.state), first_opened_at: s(r.first_opened_at), first_clicked_at: s(r.first_clicked_at), unsubscribed_at: s(r.unsubscribed_at),
  }))
  const recipients: Recipient[] = picked.map((r) => ({
    email: String(r.email), firstName: s(r.first_name), companyName: s(r.company_name),
    companyId: s(r.company_id) ?? undefined, contactId: s(r.contact_id) ?? undefined, leadId: s(r.lead_id) ?? undefined,
    firstApproach: false, via: r.lead_id && !r.company_id ? 'lead' : r.contact_id ? 'contact' : 'client',
  }))

  /* STAMPED FIRST, ON CONDITION: two mornings (or a press and the timer) cannot both queue this step. */
  const nowIso = new Date().toISOString()
  const { data: mine } = await admin.from('marketing_workflow_steps').update({ run_at: nowIso })
    .eq('id', step.step_id).is('run_at', null).select('id')
  if (!mine?.length) return { error: `${label}: already sent.` }
  const { data: wf } = await admin.from('marketing_workflows').select('created_by').eq('id', step.workflow_id).maybeSingle()
  const by = (wf as { created_by?: string | null } | null)?.created_by ?? campaign.created_by

  if (!recipients.length) {
    /* NOBODY LEFT TO FOLLOW UP -- everybody opened, say. The email is not sent, and the workflow is over:
       every later step reads its audience off this one, which reached nobody. */
    await admin.from('marketing_campaigns').update({ status: 'cancelled', finished_at: nowIso, recipient_count: 0, updated_at: nowIso })
      .eq('id', campaign.id).eq('status', 'draft')
    await admin.from('marketing_workflows').update({ status: 'finished', updated_at: nowIso }).eq('id', step.workflow_id)
    return { queued: 0 }
  }

  let senders: RowSender[] | null = null
  if (campaign.send_from !== 'news') {
    const [companies, people] = await Promise.all([
      fetchAllRows<Record<string, unknown>>(() => admin.from('companies')
        .select('id, parent_company_id, account_owner_id, liaison_needed').order('id'), { table: 'companies' }),
      campaign.send_from === 'liaison' ? loadPeople(admin) : Promise.resolve(new Map<string, LiaisonPerson>()),
    ])
    const map = new Map(companies.map((c) => [String(c.id), {
      id: String(c.id), parentCompanyId: s(c.parent_company_id), accountOwnerId: s(c.account_owner_id), liaisonNeeded: c.liaison_needed === true,
    }]))
    senders = sendersFor(recipients, campaign.send_from, extra, map, people)
  } else {
    senders = sendersFor(recipients, 'news', null, new Map(), new Map())
  }

  const { data: claimed } = await admin.from('marketing_campaigns')
    .update({ status: 'sending', queued_at: nowIso, queued_by: by, recipient_count: recipients.length, updated_at: nowIso })
    .eq('id', campaign.id).eq('status', 'draft').select('id')
  if (!claimed?.length) {
    await admin.from('marketing_workflow_steps').update({ run_at: null }).eq('id', step.step_id)
    return { error: `${label}: its email changed while it was being queued. It goes tomorrow.` }
  }
  const { error } = await admin.from('marketing_sends').insert(recipients.map((r, i) => ({
    campaign_id: campaign.id, email: r.email, first_name: r.firstName, company_name: r.companyName,
    company_id: r.companyId ?? null, contact_id: r.contactId ?? null, lead_id: r.leadId ?? null,
    first_approach: false, sender: senders?.[i]?.address ?? null,
  })))
  if (error) {
    await admin.from('marketing_campaigns').update({ status: 'draft', queued_at: null, queued_by: null, recipient_count: null }).eq('id', campaign.id)
    await admin.from('marketing_workflow_steps').update({ run_at: null }).eq('id', step.step_id)
    return { error: `${label}: the list could not be saved, so nothing was sent: ${error.message}` }
  }
  /* The last step sent: the workflow is done once its email has gone. */
  const { data: later } = await admin.from('marketing_workflow_steps').select('id')
    .eq('workflow_id', step.workflow_id).gt('position', step.step_position).limit(1)
  if (!later?.length) await admin.from('marketing_workflows').update({ status: 'finished', updated_at: nowIso }).eq('id', step.workflow_id)
  return { queued: recipients.length }
}

/** A campaign's figures, whole and per sender -- what the results email and the screen both say. */
export async function campaignFigures(admin: SupabaseClient, campaignId: string)
  : Promise<{ whole: CampaignResults | null; bySender: ReturnType<typeof resultsBySender> }> {
  const [{ data: all }, rows] = await Promise.all([
    admin.rpc('marketing_campaign_results'),
    fetchAllRows<Record<string, unknown>>(() => admin.from('marketing_sends')
      .select('sender, state, resend_id, delivered_at, delayed_at, first_opened_at, first_clicked_at, unsubscribed_at, opted_in_at')
      .eq('campaign_id', campaignId).order('id'), { table: 'marketing_sends' }),
  ])
  const whole = ((all ?? []) as CampaignResults[]).find((c) => c.campaign_id === campaignId) ?? null
  return { whole, bySender: resultsBySender(rows as unknown as SendResultRow[]) }
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * THE RESULTS EMAIL: "a day after a campaign ends, the results go automatically to the marketing team".
 * From the news address with the news key -- it is the firm writing to itself, and it needs nothing the
 * administrator has not already set up. It says what Raptor knows and no more: opens are approximate, and
 * nobody can say what was deleted unread, so it does not pretend to.
 */
export async function sendResultsEmail(admin: SupabaseClient, campaignId: string, recipients: string[])
  : Promise<{ sent: true } | { error: string }> {
  const to = [...new Set(recipients.map(normaliseEmail).filter(isSendableEmail))]
  if (!to.length) return { error: 'The results email has nobody valid to go to.' }
  const key = process.env.RESEND_API_KEY?.trim()
  const news = newsSender(process.env.MARKETING_FROM, null)
  if (!key || 'error' in news) return { error: 'The results email cannot go: news sending is not set up (RESEND_API_KEY, MARKETING_FROM).' }
  const campaign = await loadCampaign(admin, campaignId)
  if (!campaign) return { error: 'A campaign due its results email is missing.' }

  /* STAMPED FIRST, ON CONDITION, so it can never go twice; put back if Resend refuses it. */
  const { data: mine } = await admin.from('marketing_campaigns').update({ results_sent_at: new Date().toISOString() })
    .eq('id', campaignId).is('results_sent_at', null).select('id')
  if (!mine?.length) return { error: `${campaign.name}: its results email has already gone.` }

  const { whole, bySender } = await campaignFigures(admin, campaignId)
  const origin = originFor(null)
  const r = whole ?? { total: 0, accepted: 0, delivered: 0, bounced: 0, opened: 0, clicked: 0, unsubscribed: 0, complained: 0, opted_in: 0, failed: 0, skipped: 0 } as CampaignResults
  const rates = resultRates(r)
  const pct = (v: number | null) => (v === null ? '' : ` (${v}%)`)
  const lines: [string, string][] = [
    ['On the list', String(r.total)],
    ['Sent', String(r.accepted)],
    ['Delivered', `${r.delivered}${pct(rates.delivered)}`],
    ['Didn’t arrive', `${r.bounced}${pct(rates.bounced)}`],
    ['Opened', `${r.opened}${pct(rates.opened)}`],
    ['Not opened', String(Math.max(0, r.delivered - r.opened))],
    ['Clicked', `${r.clicked}${pct(rates.clicked)}`],
    ['Unsubscribed', `${r.unsubscribed}${pct(rates.unsubscribed)}`],
    ['Marked as spam', String(r.complained)],
  ]
  const senderRows = bySender.length > 1
    ? `<h3 style="font-size:14px;margin:20px 0 6px">By sender</h3><table cellpadding="4" style="border-collapse:collapse;font-size:13px">`
      + `<tr><th align="left">From</th><th align="right">Sent</th><th align="right">Delivered</th><th align="right">Opened</th><th align="right">Clicked</th></tr>`
      + bySender.map((b) => `<tr><td>${esc(b.sender || 'news@')}</td><td align="right">${b.accepted}</td><td align="right">${b.delivered}</td><td align="right">${b.opened}</td><td align="right">${b.clicked}</td></tr>`).join('')
      + '</table>'
    : ''
  const link = origin ? `${origin}/news/${campaignId}` : null
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1e293b;font-size:14px">`
    + `<p>The results of <b>${esc(campaign.name)}</b> (“${esc(campaign.subject)}”).</p>`
    + `<table cellpadding="4" style="border-collapse:collapse;font-size:14px">${lines.map(([k, v]) => `<tr><td>${esc(k)}</td><td align="right"><b>${esc(v)}</b></td></tr>`).join('')}</table>`
    + senderRows
    + `<p style="font-size:12px;color:#64748b;margin-top:16px">Opens are approximate: Apple Mail opens every email for its reader, and mail that blocks pictures is never counted. No mail system reports what was deleted unread.</p>`
    + (link ? `<p><a href="${link}">Open the campaign in Raptor</a></p>` : '')
    + '</div>'
  const text = [`The results of ${campaign.name} ("${campaign.subject}").`, '', ...lines.map(([k, v]) => `${k}: ${v}`),
    ...(bySender.length > 1 ? ['', 'By sender:', ...bySender.map((b) => `${b.sender || 'news@'}: ${b.accepted} sent, ${b.delivered} delivered, ${b.opened} opened, ${b.clicked} clicked`)] : []),
    '', 'Opens are approximate.', ...(link ? ['', link] : [])].join('\n')
  const outcome = await resendSend(key, [{
    from: news.from, to, subject: `Campaign results: ${campaign.name}`, html, text, headers: {},
  }], idempotencyKey([`results-${campaignId}`]))
  if (!outcome.ok) {
    await admin.from('marketing_campaigns').update({ results_sent_at: null }).eq('id', campaignId)
    return { error: `${campaign.name}: the results email did not go (${outcome.message}). It is tried again tomorrow.` }
  }
  return { sent: true }
}
