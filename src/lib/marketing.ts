/**
 * NEWS & CAMPAIGNS: WHO A NEWSLETTER GOES TO, AND WHAT THEY READ.
 *
 * THE FIRM, 21 OCT: "bulk communication to our clients ... if we send out a blog or a new blog or a
 * newsletter, we should be able to send it out from the system to all of their email addresses. It
 * should be able to unsubscribe or subscribe ... only for specific news ... not for reports. Then as
 * well for leads ... email marketing for leads, keeping in touch with them ... specifically ... to try
 * to reactivate them, leads that are dormant."
 *
 * THE SALES SIDE ONLY. Nothing here reads or writes a debtor account, and nothing raises a fee:
 * Annexure B is charged on ACCOUNTS only, and a newsletter is not correspondence about one. Reports
 * (statements, client reports, remittance advices) never go through this and an unsubscribe here
 * never stops them -- the firm: "only for specific news ... not for reports".
 *
 * PURE, and imported by both halves. The screen asks the server for the preview, and the server
 * answers it with exactly the function it sends with -- so the count somebody approves is the count
 * that goes, and `check-marketing` can hold the rules without a database.
 *
 * ------------------------------------------------------------------------------------------------
 * POPIA s69 -- DIRECT MARKETING BY ELECTRONIC COMMUNICATION -- IS THE RULE THIS FILE CARRIES
 * ------------------------------------------------------------------------------------------------
 *
 *   s69(3): an existing CUSTOMER may be sent marketing of the firm's own similar services, provided
 *     every message gives them a way to object. So CLIENTS (a company, and the contacts on it) are
 *     IN BY DEFAULT and opt out.
 *   s69(1)-(2): anybody else needs CONSENT, and may be approached for it ONCE, and only if they have
 *     not already withheld it. So a LEAD goes only where `marketingConsentAt` is recorded, or as the
 *     one-and-only FIRST APPROACH -- a campaign flagged so, which a lead can receive once ever.
 *   An objection holds until the person withdraws it. `marketing_preferences` is per ADDRESS, read
 *     when the list is drawn AND again by the server the moment each chunk is sent.
 */
import type { Company, Contact, Lead, LeadSource, LeadStatus, ProductService } from '../types.js'
import { emailBodyHtml, emailBodyStyle, type EmailFace } from './emailStyle.js'
import { NEWSLETTER_SUBJECT_PREFIX } from './meaningfulActivity.js'

/* ------------------------------------------------------------------------------------------------
 * Addresses
 * ---------------------------------------------------------------------------------------------- */

/** One address, one way of writing it -- what the de-duplication and the unsubscribe both key on. */
export function normaliseEmail(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase()
}

/**
 * A SHAPE CHECK, NOT A PROMISE. One bad address in a batch of a hundred makes Resend refuse all
 * hundred, so the obvious typos ("name@", "name at firm.co.za", two addresses in one box) are kept
 * off the list here and counted, rather than found by the send.
 */
export function isSendableEmail(email: string): boolean {
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i.test(email)
}

/* ------------------------------------------------------------------------------------------------
 * Audiences -- always a RULE over Raptor's own records, never a typed list
 * ---------------------------------------------------------------------------------------------- */

export const ACTIVE_LEAD_STATUSES: LeadStatus[] = ['No Contact Yet', 'Interested', 'Hot Lead']

/** How long without a touch makes a lead dormant, until somebody chooses otherwise on the screen. */
export const DEFAULT_DORMANT_DAYS = 90

export type Audience =
  | { kind: 'all_clients' }
  | { kind: 'clients_by_service'; services: ProductService[] }
  | { kind: 'active_leads' }
  | { kind: 'dormant_leads'; days: number; includeLost: boolean }
  | { kind: 'leads_by'; statuses: LeadStatus[]; sources: LeadSource[] }
  | { kind: 'manual'; picks: { type: 'company' | 'contact' | 'lead'; id: string }[] }

export const AUDIENCE_LABELS: Record<Audience['kind'], string> = {
  all_clients: 'All clients',
  clients_by_service: 'Clients by service',
  active_leads: 'Active leads',
  dormant_leads: 'Dormant leads',
  leads_by: 'Leads by status or source',
  manual: 'Pick people',
}

/** What an audience is, in a sentence for the campaign list. */
export function describeAudience(a: Audience): string {
  switch (a.kind) {
    case 'all_clients': return 'All clients and their contacts'
    case 'clients_by_service': return `Clients using ${a.services.join(', ') || 'no service chosen'}`
    case 'active_leads': return 'Active leads'
    case 'dormant_leads': return `Leads untouched for ${a.days} days${a.includeLost ? ', lost ones included' : ''}`
    case 'leads_by': return `Leads${a.statuses.length ? ` · ${a.statuses.join(', ')}` : ''}${a.sources.length ? ` · from ${a.sources.join(', ')}` : ''}`
    case 'manual': return `${a.picks.length} picked by hand`
  }
}

/** A stored audience, read defensively: it is a jsonb column and a bad one must not send to everybody. */
export function parseAudience(raw: unknown): Audience | null {
  const a = raw as Record<string, unknown> | null
  if (!a || typeof a !== 'object') return null
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  switch (a.kind) {
    case 'all_clients': return { kind: 'all_clients' }
    case 'active_leads': return { kind: 'active_leads' }
    case 'clients_by_service': return { kind: 'clients_by_service', services: list(a.services) as ProductService[] }
    case 'dormant_leads': {
      const days = Math.round(Number(a.days))
      return { kind: 'dormant_leads', days: days >= 1 ? days : DEFAULT_DORMANT_DAYS, includeLost: a.includeLost !== false }
    }
    case 'leads_by': return { kind: 'leads_by', statuses: list(a.statuses) as LeadStatus[], sources: list(a.sources) as LeadSource[] }
    case 'manual': {
      const picks = Array.isArray(a.picks) ? a.picks.filter((p): p is { type: 'company' | 'contact' | 'lead'; id: string } =>
        !!p && typeof p === 'object' && ['company', 'contact', 'lead'].includes((p as { type?: string }).type ?? '')
        && typeof (p as { id?: unknown }).id === 'string') : []
      return { kind: 'manual', picks }
    }
    default: return null
  }
}

/* ------------------------------------------------------------------------------------------------
 * Dormancy
 * ---------------------------------------------------------------------------------------------- */

/** The activity fields dormancy needs, so the server can read only those. */
export interface TouchActivity { leadId?: string; activityDate: string; type: string; subject: string }

/** A newsletter we sent is not the lead doing anything -- see leadLastTouch. */
export function isNewsletterSubject(subject: string | null | undefined): boolean {
  return (subject ?? '').startsWith(NEWSLETTER_SUBJECT_PREFIX)
}

/**
 * WHEN THIS LEAD LAST MOVED: the latest of its creation, its last contact, its last status change
 * and its last activity.
 *
 * NOT updated_at. Every edit moves it -- recording the lead's consent to news included -- so reading
 * it as "the lead moved" would take a dormant lead off the dormant list at the very moment somebody
 * got its yes. The status keeps its own date (leads.status_changed_at, stamped by the database).
 *
 * AND NOT OUR OWN NEWSLETTERS. They are logged on the timeline as an Email activity; counted here, a
 * re-engagement campaign would make every lead it went to "active" for the next ninety days whether
 * or not anybody answered.
 */
export function leadLastTouch(
  lead: Pick<Lead, 'createdAt' | 'lastContactAt'> & { statusChangedAt?: string },
  activities: TouchActivity[],
): string {
  let latest = lead.createdAt
  const consider = (d: string | undefined | null) => { if (d && d > latest) latest = d }
  consider(lead.lastContactAt)
  consider(lead.statusChangedAt)
  for (const a of activities) if (!isNewsletterSubject(a.subject)) consider(a.activityDate)
  return latest
}

/** Whole days between two instants, floored -- "90 days" means ninety full days have passed. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000)
}

/* ------------------------------------------------------------------------------------------------
 * Resolving an audience into people
 * ---------------------------------------------------------------------------------------------- */

export interface Recipient {
  email: string
  firstName: string | null
  companyName: string | null
  companyId?: string
  contactId?: string
  leadId?: string
  /** A lead with no consent recorded, approached under s69(2)'s once-only allowance. */
  firstApproach: boolean
  /** Which kind of record put them on the list -- the screen's sample says so. */
  via: 'client' | 'contact' | 'lead'
}

export type ExclusionReason =
  | 'no address' | 'address does not look right' | 'unsubscribed' | 'undeliverable'
  | 'no consent recorded' | 'already approached once' | 'on the list twice'

export interface AudienceInput {
  audience: Audience
  firstApproach: boolean
  companies: Pick<Company, 'id' | 'name' | 'email' | 'parentCompanyId' | 'services' | 'contactPerson'>[]
  contacts: Pick<Contact, 'id' | 'firstName' | 'email' | 'companyId' | 'leadId'>[]
  leads: (Pick<Lead, 'id' | 'firstName' | 'companyName' | 'email' | 'status' | 'source' | 'createdAt'
    | 'lastContactAt' | 'rejectionReason'> & { statusChangedAt?: string; marketingConsentAt?: string })[]
  /** Leads' activities, for dormancy. Only those with a leadId matter. */
  activities: TouchActivity[]
  /** marketing_preferences, keyed by normalised address. Only 'subscribed' rows are absent or harmless. */
  preferences: Map<string, 'subscribed' | 'unsubscribed' | 'undeliverable'>
  /** Leads that have already had their one first approach. */
  approachedLeads: Set<string>
  /** "Now", passed in so the rule has no clock. */
  now: string
}

export interface AudienceResult {
  recipients: Recipient[]
  excluded: Partial<Record<ExclusionReason, number>>
}

const firstWord = (s: string | null | undefined) => (s ?? '').trim().split(/\s+/)[0] || null

/**
 * WHO A CAMPAIGN GOES TO, de-duplicated by address and with every exclusion counted.
 *
 * CLIENTS BEFORE LEADS when one address is both, because the client basis (s69(3), opt-out) is the
 * stronger one and the lead basis would only ever exclude them. The first record to claim an address
 * is the one its timeline line lands on.
 */
export function resolveAudience(input: AudienceInput): AudienceResult {
  const { audience: a } = input
  const out: Recipient[] = []
  const seen = new Set<string>()
  const excluded: Partial<Record<ExclusionReason, number>> = {}
  const skip = (why: ExclusionReason) => { excluded[why] = (excluded[why] ?? 0) + 1 }

  const offer = (raw: string | undefined, r: Omit<Recipient, 'email'>) => {
    const email = normaliseEmail(raw)
    if (!email) { skip('no address'); return }
    if (!isSendableEmail(email)) { skip('address does not look right'); return }
    if (seen.has(email)) { skip('on the list twice'); return }
    const pref = input.preferences.get(email)
    if (pref === 'unsubscribed') { seen.add(email); skip('unsubscribed'); return }
    if (pref === 'undeliverable') { seen.add(email); skip('undeliverable'); return }
    seen.add(email)
    out.push({ email, ...r })
  }

  const companyById = new Map(input.companies.map((c) => [c.id, c]))
  /* The top of a client's family: a sub-account belongs to its parent's client. */
  const topOf = (id: string | undefined): string | undefined => {
    let c = id ? companyById.get(id) : undefined
    for (let i = 0; c?.parentCompanyId && i < 10; i += 1) c = companyById.get(c.parentCompanyId) ?? c
    return c?.id
  }

  const clientFamilies = (keep: (topId: string) => boolean) => {
    const tops = input.companies.filter((c) => !c.parentCompanyId && keep(c.id))
    const topIds = new Set(tops.map((c) => c.id))
    for (const c of tops) {
      offer(c.email, { firstName: firstWord(c.contactPerson), companyName: c.name, companyId: c.id, firstApproach: false, via: 'client' })
    }
    for (const p of input.contacts) {
      const top = topOf(p.companyId)
      if (!top || !topIds.has(top)) continue
      offer(p.email, {
        firstName: firstWord(p.firstName), companyName: companyById.get(top)?.name ?? null,
        companyId: p.companyId, contactId: p.id, firstApproach: false, via: 'contact',
      })
    }
  }

  /*
   * A LEAD GOES ONLY WITH CONSENT, OR AS ITS ONE FIRST APPROACH -- POPIA s69. A converted lead is a
   * client now and is reached as one, so lead audiences leave it out. "We declined them" is never
   * re-engaged: that was our decision, not theirs going quiet.
   */
  const offerLead = (l: AudienceInput['leads'][number]) => {
    const consented = !!l.marketingConsentAt
    if (!consented) {
      if (!input.firstApproach) { skip('no consent recorded'); return }
      if (input.approachedLeads.has(l.id)) { skip('already approached once'); return }
    }
    offer(l.email, {
      firstName: firstWord(l.firstName), companyName: l.companyName || null, leadId: l.id,
      firstApproach: !consented, via: 'lead',
    })
  }
  const reachable = (l: AudienceInput['leads'][number]) =>
    l.status !== 'Converted' && l.rejectionReason !== 'We declined them'

  switch (a.kind) {
    case 'all_clients':
      clientFamilies(() => true)
      break
    case 'clients_by_service': {
      const want = new Set(a.services)
      /* A family uses a service if the client or any sub-account has signed for it. */
      const uses = new Map<string, boolean>()
      for (const c of input.companies) {
        const top = topOf(c.id)
        if (top && (c.services ?? []).some((s) => want.has(s))) uses.set(top, true)
      }
      clientFamilies((id) => uses.get(id) === true)
      break
    }
    case 'active_leads':
      for (const l of input.leads) if (ACTIVE_LEAD_STATUSES.includes(l.status) && reachable(l)) offerLead(l)
      break
    case 'dormant_leads': {
      const byLead = new Map<string, TouchActivity[]>()
      for (const act of input.activities) {
        if (!act.leadId) continue
        const list = byLead.get(act.leadId) ?? []
        list.push(act)
        byLead.set(act.leadId, list)
      }
      for (const l of input.leads) {
        if (!reachable(l)) continue
        if (l.status === 'Rejected' && !a.includeLost) continue
        if (daysBetween(leadLastTouch(l, byLead.get(l.id) ?? []), input.now) < a.days) continue
        offerLead(l)
      }
      break
    }
    case 'leads_by':
      for (const l of input.leads) {
        if (!reachable(l)) continue
        if (a.statuses.length && !a.statuses.includes(l.status)) continue
        if (a.sources.length && !a.sources.includes(l.source)) continue
        offerLead(l)
      }
      break
    case 'manual': {
      const leadById = new Map(input.leads.map((l) => [l.id, l]))
      const contactById = new Map(input.contacts.map((c) => [c.id, c]))
      for (const p of a.picks) {
        if (p.type === 'company') {
          const c = companyById.get(p.id)
          if (c) offer(c.email, { firstName: firstWord(c.contactPerson), companyName: c.name, companyId: c.id, firstApproach: false, via: 'client' })
        } else if (p.type === 'contact') {
          const c = contactById.get(p.id)
          if (!c) continue
          /* A contact captured against a lead, with no client yet, is a lead's person: consent rules. */
          if (!c.companyId && c.leadId) {
            const l = leadById.get(c.leadId)
            if (!l) continue
            offerLead({ ...l, email: c.email, firstName: c.firstName })
            continue
          }
          offer(c.email, {
            firstName: firstWord(c.firstName), companyName: (c.companyId && companyById.get(c.companyId)?.name) || null,
            companyId: c.companyId, contactId: c.id, firstApproach: false, via: 'contact',
          })
        } else {
          const l = leadById.get(p.id)
          if (l) offerLead(l)
        }
      }
      break
    }
  }
  return { recipients: out, excluded }
}

/* ------------------------------------------------------------------------------------------------
 * The message
 * ---------------------------------------------------------------------------------------------- */

export interface CampaignContent {
  subject: string
  preheader: string
  body: string
  imageUrl?: string | null
}

/**
 * WHAT A MERGE FIELD SAYS WHEN THE RECORD HAS NOTHING TO SAY. A newsletter is not a notice: nothing
 * here is a fact about a debt, so a missing name has a polite stand-in rather than a held send.
 * "Dear Sir/Madam" is how the firm writes to somebody it cannot name.
 */
export const MERGE_FALLBACK = { first_name: 'Sir/Madam', company: 'your business' } as const

export const MERGE_FIELDS = ['first_name', 'company'] as const

const escapeHtml = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** {{first_name}} and {{company}}, filled; anything else in braces is left as typed so the preview shows it. */
export function mergeText(text: string, r: Pick<Recipient, 'firstName' | 'companyName'>): string {
  return text.replace(/\{\{\s*(first_name|company)\s*\}\}/g, (_, f: string) =>
    f === 'first_name' ? (r.firstName?.trim() || MERGE_FALLBACK.first_name) : (r.companyName?.trim() || MERGE_FALLBACK.company))
}

/** Merge fields the editor does not know, so the screen can say so before anybody sends them. */
export function unknownMergeFields(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
    if (!(MERGE_FIELDS as readonly string[]).includes(m[1])) out.add(m[1])
  }
  return [...out]
}

/**
 * LINKS, ON TOP OF THE HOUSE'S OWN PARAGRAPH RULE. `emailBodyHtml` already does the two things
 * every outgoing email here must -- a blank line is a paragraph, and nothing typed becomes markup --
 * so the body goes through it unchanged and this only turns two shapes into anchors afterwards:
 * `[words](https://...)` and a bare https:// address. Applied to ESCAPED text, so a link cannot
 * smuggle an attribute in; only http(s), so a `javascript:` URL stays words.
 */
export function linkify(escapedHtml: string): string {
  return escapedHtml.replace(
    /\[([^\]<>\n]+)\]\((https?:\/\/[^\s)<>"]+)\)|(https?:\/\/[^\s<>"]+)/g,
    (_m, label: string | undefined, href: string | undefined, bare: string | undefined) => {
      if (label && href) return `<a href="${href}" style="color:#1d4ed8">${label}</a>`
      const url = bare ?? ''
      /* A sentence's full stop is not part of the address it ends on. */
      const trail = /[.,;:!?)]+$/.exec(url)?.[0] ?? ''
      const clean = url.slice(0, url.length - trail.length)
      return `<a href="${clean}" style="color:#1d4ed8">${clean}</a>${trail}`
    },
  )
}

/** The plain-text twin of a body: links written out, bold markers gone. */
function bodyText(text: string): string {
  return text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)').replace(/\*\*([^*\n]+)\*\*/g, '$1').trim()
}

export interface RenderedEmail { subject: string; html: string; text: string }

export interface RenderOptions {
  unsubscribeUrl: string
  firmName: string
  face: EmailFace
  /** Shown under the sign-off; the firm's postal address, where it has one. */
  firmAddress?: string | null
  /** Why they are getting it, in a sentence -- different for a client and a lead. */
  basis: 'client' | 'lead'
}

/**
 * ONE RECIPIENT'S EMAIL.
 *
 * SET IN THE FIRM'S OWN FACE, inline on a wrapper, exactly as every other email Raptor sends (see
 * emailStyle.ts and CHARTER_EMAIL_STACK -- Charter asked for, Georgia drawn). THE UNSUBSCRIBE LINK
 * IS IN EVERY MESSAGE, whoever it is to: POPIA s69(4)(b) requires "the details of the identity of
 * the sender" and "an address ... to which the recipient may send a request that such
 * communications cease" in each one, not in the first.
 */
export function renderCampaignEmail(
  content: CampaignContent,
  recipient: Pick<Recipient, 'firstName' | 'companyName'>,
  opts: RenderOptions,
): RenderedEmail {
  const subject = mergeText(content.subject, recipient).replace(/\s+/g, ' ').trim()
  const body = mergeText(content.body, recipient)
  const preheader = mergeText(content.preheader, recipient).trim()
  const image = content.imageUrl && /^https:\/\/[^\s"<>]+$/.test(content.imageUrl.trim())
    ? `<p style="margin:0 0 16px"><img src="${escapeHtml(content.imageUrl.trim())}" alt="" style="max-width:100%;height:auto;border:0"></p>`
    : ''
  const why = opts.basis === 'client'
    ? `You are receiving this because you are a client of ${opts.firmName}.`
    : `You are receiving this because you have been in touch with ${opts.firmName}.`
  const unsub = escapeHtml(opts.unsubscribeUrl)
  const html = [
    '<!doctype html><html><body style="margin:0;padding:0;background:#ffffff">',
    /* The preheader: the line an inbox shows after the subject, hidden in the message itself. */
    preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>` : '',
    `<div style="${emailBodyStyle(opts.face)};max-width:640px;margin:0 auto;padding:16px">`,
    image,
    `<div>${linkify(emailBodyHtml(body))}</div>`,
    '<div style="margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:9pt;color:#6b7280;line-height:1.5">',
    `${escapeHtml(opts.firmName)}${opts.firmAddress ? `<br>${escapeHtml(opts.firmAddress).replace(/\n/g, '<br>')}` : ''}<br>`,
    `${escapeHtml(why)} This is our news only: statements and reports about your matters are not affected.<br>`,
    `<a href="${unsub}" style="color:#6b7280">Unsubscribe from our news</a>`,
    '</div></div></body></html>',
  ].join('')
  const text = [
    bodyText(body), '', '--', opts.firmName, ...(opts.firmAddress ? [opts.firmAddress] : []),
    why, `Unsubscribe from our news: ${opts.unsubscribeUrl}`,
  ].join('\n')
  return { subject, html, text }
}

/** The one-line timeline entry a send leaves on the client, contact or lead. */
export function newsletterActivitySubject(subject: string): string {
  return `${NEWSLETTER_SUBJECT_PREFIX}${subject}`.slice(0, 300)
}

/* ------------------------------------------------------------------------------------------------
 * The sender
 * ---------------------------------------------------------------------------------------------- */

/**
 * WHAT THE FIRM MUST SET UP BEFORE ANYTHING SENDS, as the screen says it. Nothing pretends to send
 * without it: the server refuses to queue, and the screen draws this instead of the Send button.
 */
export const SENDER_SETUP_STEPS = [
  'Open an account at resend.com.',
  'Add the firm’s sending domain in Resend (Domains → Add domain) and put the DNS records Resend shows — the SPF and DKIM TXT records, and the MX record for bounces — on the domain at its DNS host. Wait until Resend marks the domain Verified.',
  'Create an API key in Resend with sending access.',
  'In Vercel, add RESEND_API_KEY (the key) and MARKETING_FROM (for example Bredell Ferreira <news@bredellferreira.co.za>, on the verified domain) to the project’s environment variables, then redeploy.',
  'Optional: MARKETING_REPLY_TO, if replies should go somewhere other than the firm’s general address in Library → The firm.',
  'Optional, for bounces and complaints: in Resend add a webhook to https://<the site>/api/email/resend-webhook for email.bounced and email.complained, and put its signing secret in Vercel as RESEND_WEBHOOK_SECRET.',
] as const

/** The env vars the sender reads, by name -- the server reports which are missing. */
export const SENDER_ENV = ['RESEND_API_KEY', 'MARKETING_FROM'] as const

/**
 * RESEND'S LIMITS, AND HOW THIS STAYS INSIDE THEM. The batch endpoint takes a hundred emails a call
 * and an account is allowed two calls a second by default. A drain sends one batch, waits, and
 * sends the next -- and stops well inside the function's time, leaving the rest queued for the next
 * call from the open screen or the five-minute sweep.
 */
export const RESEND_BATCH_MAX = 100
export const RESEND_MIN_GAP_MS = 600
