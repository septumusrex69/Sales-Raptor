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
import { newsStoppedBy, type NewsCompany } from './clientNews.js'
import { emailHtmlToText, isHtmlBody, sanitiseCampaignHtml, withEmailParagraphs } from './campaignHtml.js'

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
  /* The leads one or more uploaded prospect lists brought in (S10, 22 Oct) -- see prospectImport.ts. */
  | { kind: 'imported_list'; listIds: string[] }

export const AUDIENCE_LABELS: Record<Audience['kind'], string> = {
  all_clients: 'All clients',
  clients_by_service: 'Clients by service',
  active_leads: 'Active leads',
  dormant_leads: 'Dormant leads',
  leads_by: 'Leads by status or source',
  manual: 'Pick people',
  imported_list: 'An imported list',
}

/** The audiences made only of leads -- the only ones a prospect campaign may use. */
export const LEAD_AUDIENCES: Audience['kind'][] = ['active_leads', 'dormant_leads', 'leads_by', 'imported_list', 'manual']

/* ------------------------------------------------------------------------------------------------
 * What kind of campaign -- and so who it may go to, and whose name it goes out under
 * ---------------------------------------------------------------------------------------------- */

/**
 * THREE KINDS, BECAUSE THE FIRM HAS THREE THINGS TO SAY TO THREE KINDS OF PEOPLE (Stephan, 22 Oct).
 *
 *   news           the newsletter: clients (in by default, s69(3)) and leads who have said yes.
 *                  From the NEWS sender, MARKETING_FROM, on a news domain of its own.
 *   introduction   "everyone gets one introduction email to opt in, 'Yes, keep me informed'
 *                  button." The once-only approach s69(2) allows to somebody who is not a customer:
 *                  ONLY leads with no consent and no earlier approach. Carries the opt-in button.
 *   prospect       later marketing to prospects -- ONLY leads who pressed that button (or whose
 *                  yes a person recorded).
 *
 * The two prospect kinds go from a SEPARATE domain, personally, in the name of the marketer who runs
 * the campaign -- see prospectSender -- and are held to the warm-up allowance; news is neither.
 */
export type CampaignKind = 'news' | 'introduction' | 'prospect'

export const CAMPAIGN_KIND_LABELS: Record<CampaignKind, string> = {
  news: 'News',
  introduction: 'Introduction to prospects',
  prospect: 'Prospect marketing',
}

export const isProspectKind = (k: CampaignKind | string | null | undefined) => k === 'introduction' || k === 'prospect'

/** A stored kind, read defensively: anything unknown is news, the kind with the narrowest reach to strangers. */
export function parseKind(raw: unknown): CampaignKind {
  return raw === 'introduction' || raw === 'prospect' ? raw : 'news'
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
    case 'imported_list': return a.listIds.length === 1 ? 'One imported list' : `${a.listIds.length} imported lists`
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
    case 'imported_list': return { kind: 'imported_list', listIds: list(a.listIds) }
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
  | 'already a client' | 'already said yes' | 'client unsubscribed'

export interface AudienceInput {
  audience: Audience
  /**
   * Whether leads with no consent may be included as their one first approach. The SERVER passes
   * `kind === 'introduction'` and nothing else: the introduction is the only first approach there is.
   */
  firstApproach: boolean
  /** News when absent. A prospect kind never reaches a client and has its own rule for leads. */
  kind?: CampaignKind
  companies: Pick<Company, 'id' | 'name' | 'email' | 'parentCompanyId' | 'services' | 'contactPerson' | 'newsStoppedAt'>[]
  contacts: Pick<Contact, 'id' | 'firstName' | 'email' | 'companyId' | 'leadId'>[]
  leads: (Pick<Lead, 'id' | 'firstName' | 'companyName' | 'email' | 'status' | 'source' | 'createdAt'
    | 'lastContactAt' | 'rejectionReason'> & { statusChangedAt?: string; marketingConsentAt?: string; marketingListId?: string })[]
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
  const kind = input.kind ?? 'news'
  const prospectOnly = isProspectKind(kind)
  const out: Recipient[] = []
  const seen = new Set<string>()
  const excluded: Partial<Record<ExclusionReason, number>> = {}
  const skip = (why: ExclusionReason) => { excluded[why] = (excluded[why] ?? 0) + 1 }
  const clientStopped = stoppedClientEmails(input.companies, input.contacts)

  const offer = (raw: string | undefined, r: Omit<Recipient, 'email'>) => {
    const email = normaliseEmail(raw)
    if (!email) { skip('no address'); return }
    if (!isSendableEmail(email)) { skip('address does not look right'); return }
    if (seen.has(email)) { skip('on the list twice'); return }
    /* THE CLIENT SAID NO NEWS (clientNews.ts) -- for every address it covers, however it was reached. */
    if (clientStopped.has(email)) { seen.add(email); skip('client unsubscribed'); return }
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

  /*
   * EVERY ADDRESS THAT IS A CLIENT'S, for the prospect kinds. "An existing client is not a prospect":
   * an introduction asking a client whether they would like to hear from us is the wrong letter, and
   * prospect marketing in a stranger's voice from another domain is worse. A lead typed in by hand
   * with a client's address is caught here too, not only at import.
   */
  const clientEmails = new Set<string>()
  if (prospectOnly) {
    for (const c of input.companies) if (c.email) clientEmails.add(normaliseEmail(c.email))
    for (const p of input.contacts) if (p.companyId && p.email) clientEmails.add(normaliseEmail(p.email))
  }

  const clientFamilies = (keep: (topId: string) => boolean) => {
    if (prospectOnly) { skip('already a client'); return }
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
    if (prospectOnly && clientEmails.has(normaliseEmail(l.email))) { skip('already a client'); return }
    /* The introduction asks a question; somebody who has already answered yes is not asked again. */
    if (kind === 'introduction' && consented) { skip('already said yes'); return }
    if (kind === 'prospect' && !consented) { skip('no consent recorded'); return }
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
          if (prospectOnly) { skip('already a client'); continue }
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
          if (prospectOnly) { skip('already a client'); continue }
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
    case 'imported_list': {
      const want = new Set(a.listIds)
      for (const l of input.leads) if (l.marketingListId && want.has(l.marketingListId) && reachable(l)) offerLead(l)
      break
    }
  }
  return { recipients: out, excluded }
}

/**
 * EVERY ADDRESS A CLIENT-WIDE UNSUBSCRIBE COVERS (clientNews.ts): the client's own and its
 * sub-accounts', and every contact on any of them. Keyed by ADDRESS because that is what a campaign
 * de-duplicates on -- so the same person reached through a lead record, or picked by hand, is still
 * not sent our news. The list is drawn with it and the drain reads it again before each send.
 */
export function stoppedClientEmails(
  companies: (NewsCompany & Pick<Company, 'email'>)[],
  contacts: Pick<Contact, 'email' | 'companyId'>[],
): Set<string> {
  const byId = new Map(companies.map((c) => [c.id, c]))
  const out = new Set<string>()
  for (const c of companies) if (c.email && newsStoppedBy(c.id, byId)) out.add(normaliseEmail(c.email))
  for (const p of contacts) if (p.email && p.companyId && newsStoppedBy(p.companyId, byId)) out.add(normaliseEmail(p.email))
  out.delete('')
  return out
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

/*
 * {{signature}} (S13, 29 Oct): the signature of whichever address THIS email goes from -- so a liaison
 * campaign signs Nicole's clients' copies with Nicole's and Ryno's with Ryno's. An address with no signature
 * fills it with nothing.
 */
export const MERGE_FIELDS = ['first_name', 'company', 'signature'] as const

const escapeHtml = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** {{first_name}} and {{company}}, filled; anything else in braces is left as typed so the preview shows it. */
export function mergeText(text: string, r: Pick<Recipient, 'firstName' | 'companyName'>, signature = ''): string {
  return text.replace(/\{\{\s*(first_name|company|signature)\s*\}\}/g, (_, f: string) =>
    f === 'first_name' ? (r.firstName?.trim() || MERGE_FALLBACK.first_name)
      : f === 'company' ? (r.companyName?.trim() || MERGE_FALLBACK.company) : signature)
}

/**
 * THE SAME FIELDS INTO AN HTML BODY: a name is ESCAPED on the way in ("Smit & Seun" is not markup), and the
 * signature -- already HTML -- goes through the same closed set as the body.
 */
export function mergeHtml(html: string, r: Pick<Recipient, 'firstName' | 'companyName'>, signatureHtml = ''): string {
  return html.replace(/\{\{\s*(first_name|company|signature)\s*\}\}/g, (_, f: string) =>
    f === 'signature' ? sanitiseCampaignHtml(signatureHtml) : escapeHtml(mergeText(`{{${f}}}`, r)))
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
  /** Why they are getting it, in a sentence -- different for a client, a lead, and a stranger asked once. */
  basis: 'client' | 'lead' | 'introduction'
  /**
   * THE "YES, KEEP ME INFORMED" BUTTON -- an introduction's whole purpose. A signed link to this
   * recipient's own send (see optInToken on the server); absent on every other kind.
   */
  optInUrl?: string | null
  /** The sending address's own signature (HTML), for {{signature}}. */
  signatureHtml?: string | null
}

/** The words on the button; the page it opens says the rest. The firm's own wording, 22 Oct. */
export const OPT_IN_LABEL = 'Yes, keep me informed'

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
  /*
   * TWO KINDS OF BODY (S13): the plain text every campaign before 29 Oct was written in, and the HTML the
   * Outlook-style editor writes (campaignHtml.ts). The HTML goes through the closed set HERE, at render, as
   * well as when it was saved -- the server sends what this returns, so this is the last word on it.
   */
  const htmlBody = isHtmlBody(content.body)
  const signatureText = opts.signatureHtml ? emailHtmlToText(opts.signatureHtml) : ''
  const body = htmlBody ? '' : mergeText(content.body, recipient, signatureText)
  const bodyHtml = htmlBody
    ? withEmailParagraphs(sanitiseCampaignHtml(mergeHtml(sanitiseCampaignHtml(content.body), recipient, opts.signatureHtml ?? '')))
    : linkify(emailBodyHtml(body))
  const preheader = mergeText(content.preheader, recipient).trim()
  const image = content.imageUrl && /^https:\/\/[^\s"<>]+$/.test(content.imageUrl.trim())
    ? `<p style="margin:0 0 16px"><img src="${escapeHtml(content.imageUrl.trim())}" alt="" style="max-width:100%;height:auto;border:0"></p>`
    : ''
  /*
   * THE INTRODUCTION SAYS WHAT IT IS, in the footer every message carries: one email, asking once,
   * and nothing more without a yes. That is the s69(2) bargain, and saying so is what makes the one
   * approach an honest one rather than the first of many.
   */
  const why = opts.basis === 'client'
    ? `You are receiving this because you are a client of ${opts.firmName}.`
    : opts.basis === 'introduction'
      ? `We are writing once to ask whether you would like to hear from ${opts.firmName}. Unless you press “${OPT_IN_LABEL}”, this is the only marketing email we will send you.`
      : `You are receiving this because you have been in touch with ${opts.firmName}.`
  const unsub = escapeHtml(opts.unsubscribeUrl)
  const optIn = opts.optInUrl ? escapeHtml(opts.optInUrl) : ''
  /*
   * A TABLE, NOT A STYLED LINK ALONE: Outlook draws neither padding nor a background on an <a>, and a
   * button that renders as a bare underlined line in half the inboxes is a button half the people
   * never see. The cell carries the colour; the link fills it.
   */
  const button = optIn
    ? '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0"><tr><td style="background:#1e3a5f;border-radius:6px">'
      + `<a href="${optIn}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:bold" data-opt-in="1">${escapeHtml(OPT_IN_LABEL)}</a>`
      + '</td></tr></table>'
    : ''
  const html = [
    '<!doctype html><html><body style="margin:0;padding:0;background:#ffffff">',
    /* The preheader: the line an inbox shows after the subject, hidden in the message itself. */
    preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>` : '',
    `<div style="${emailBodyStyle(opts.face)};max-width:640px;margin:0 auto;padding:16px">`,
    image,
    `<div>${bodyHtml}</div>`,
    button,
    '<div style="margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:9pt;color:#6b7280;line-height:1.5">',
    `${escapeHtml(opts.firmName)}${opts.firmAddress ? `<br>${escapeHtml(opts.firmAddress).replace(/\n/g, '<br>')}` : ''}<br>`,
    /* A stranger has no matters with us, so the reports sentence is for clients and leads only. */
    `${escapeHtml(why)}${opts.basis === 'introduction' ? '' : ' This is our news only: statements and reports about your matters are not affected.'}<br>`,
    `<a href="${unsub}" style="color:#6b7280">Unsubscribe from our news</a>`,
    '</div></div></body></html>',
  ].join('')
  const text = [
    htmlBody ? emailHtmlToText(bodyHtml) : bodyText(body), ...(opts.optInUrl ? ['', `${OPT_IN_LABEL}: ${opts.optInUrl}`] : []), '', '--', opts.firmName, ...(opts.firmAddress ? [opts.firmAddress] : []),
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
  'Add the NEWS domain in Resend (Domains → Add domain). It is a domain of its own, separate from bredellferreira.co.za (the firm is choosing the name): with some 3 000 clients and 10 000 leads on the list, a newsletter is bulk mail, and bulk mail never goes from the domain the firm’s everyday mail goes from. Put the DNS records Resend shows (the SPF and DKIM TXT records, and the MX record for bounces) at that domain’s DNS host, and wait until Resend marks it Verified.',
  'On that domain in Resend, switch ON open tracking and click tracking. Without them Raptor can say what was delivered but not what was opened or clicked.',
  'Create an API key in Resend with sending access.',
  'In Vercel, add RESEND_API_KEY (the key) and MARKETING_FROM (for example Bredell Ferreira <news@ the news domain>, never an address on bredellferreira.co.za) to the project’s environment variables, then redeploy.',
  'Optional: MARKETING_REPLY_TO, if replies to news should go somewhere other than the firm’s general address in Library → The firm.',
  'A new news domain has no reputation yet. Send the first newsletters to a few hundred clients at a time over the first weeks (pick people, or clients by service) before sending to everybody at once. Raptor holds prospect mail to a daily allowance; news it leaves to you.',
  'For delivery results: in Resend add a webhook to https://<the site>/api/email/resend-webhook for email.sent, email.delivered, email.delivery_delayed, email.bounced, email.complained, email.opened and email.clicked, and put its signing secret in Vercel as RESEND_WEBHOOK_SECRET.',
] as const

/**
 * AND FOR INTRODUCTIONS AND PROSPECT MARKETING, which go from a SEPARATE domain (the firm's plan, 22
 * Oct): a cold list's complaints and bounces land on that domain's reputation, never on the news
 * domain clients rely on, and never on the firm's own mail.
 */
export const PROSPECT_SETUP_STEPS = [
  'Register the separate marketing domain (the firm is confirming the name) and add it in Resend (Domains → Add domain). Put its SPF, DKIM and MX records at its DNS host and wait until Resend marks it Verified.',
  'On that domain in Resend, switch ON open tracking and click tracking.',
  'In Vercel, add MARKETING_PROSPECT_DOMAIN with just the domain name, then redeploy. Each prospect campaign goes from the marketer who runs it: somebody whose address is reino@bredellferreira.co.za sends as “Reino …” <reino@ the marketing domain>, and replies go back to reino@bredellferreira.co.za.',
  'The same webhook covers this domain: Resend reports every domain on the account to it.',
  'A new domain starts slowly. Raptor sends each marketer at most 30 a day in the first week, 60 in the second, 120 in the third and 250 in the fourth, then up to MARKETING_WARMUP_CEILING a day (500 unless set). The rest wait for the next day’s allowance and go on their own.',
] as const

/** The env vars the news sender reads, by name -- the server reports which are missing. */
export const SENDER_ENV = ['RESEND_API_KEY', 'MARKETING_FROM'] as const
/** ...and the prospect kinds'. MARKETING_FROM is not needed for them: they never go from the news address. */
export const PROSPECT_SENDER_ENV = ['RESEND_API_KEY', 'MARKETING_PROSPECT_DOMAIN'] as const

/**
 * THE FIRM'S OWN MAIL DOMAIN, WHICH NO BULK MAIL -- NEWS OR PROSPECT -- MAY EVER GO FROM. Everybody's
 * everyday mail goes from it: section 129s, letters to clients, replies to debtors. A newsletter to
 * some 3 000 clients and 10 000 leads is bulk mail, and its spam reports and bounces on this domain
 * would put those letters in junk folders. The firm weighed sending news from it and decided
 * against it (22 Oct). So there are THREE domains: this one (everyday mail, never bulk), the news
 * domain (MARKETING_FROM) and the prospect domain (MARKETING_PROSPECT_DOMAIN), each verified in
 * Resend with its own SPF and DKIM. Neither of the last two may be this domain or a subdomain of it:
 * the mailbox providers weigh a subdomain partly on its parent.
 *
 * ONE DELIBERATE DOOR, 26 OCT. The firm then chose to send News from each client's own liaison
 * ("the client is for Nicole, it goes out from Nicole") or from reports@ -- both on THIS domain --
 * knowing the reputation risk above, because a newsletter from the person who looks after a client
 * reads as a letter, not a list. That door is `firmSender` below and nothing else: MARKETING_FROM and
 * the prospect domain are still refused here, because COLD mail must never reach this domain, and a
 * client newsletter from a person is a different thing from a stranger's inbox being asked.
 */
export const FIRM_MAIN_MAIL_DOMAIN = 'bredellferreira.co.za'

/** The domain an address -- bare, or "Name <a@b>" -- is on, lower-cased. */
export function mailDomainOf(address: string | null | undefined): string {
  const raw = (address ?? '').trim()
  const inner = /<([^>]+)>\s*$/.exec(raw)?.[1] ?? raw
  return (inner.split('@')[1] ?? '').trim().toLowerCase().replace(/\.$/, '')
}

/** On the firm's own mail domain, or any subdomain of it. */
export function isFirmMainDomain(address: string | null | undefined): boolean {
  const d = mailDomainOf(address)
  return d === FIRM_MAIN_MAIL_DOMAIN || d.endsWith(`.${FIRM_MAIN_MAIL_DOMAIN}`)
}

export type SenderChoice = { from: string; replyTo: string | null } | { error: string }

/**
 * WHERE A REPLY TO NEWS GOES, BY WHO IT WENT TO (22 Oct). The firm: "If leads respond, it should go
 * to info@ ... If a current client responds, it should go to reports@." A recipient on a client's
 * record (a company or one of its contacts) is a client; a lead with no company is a lead. Each
 * falls back to the campaign's own reply-to, so an unset address never means "no reply possible".
 * Only NEWS uses this: a prospect email is personal, and its replies go to the marketer who sent it.
 */
export function replyToFor(
  row: { lead_id: string | null; company_id: string | null; contact_id: string | null },
  addresses: { leads: string | null; clients: string | null },
  fallback: string | null,
): string | null {
  const isClient = !!row.company_id || !!row.contact_id
  const chosen = isClient ? addresses.clients : row.lead_id ? addresses.leads : null
  return (chosen ?? '').trim() || fallback
}

/** The news sender: MARKETING_FROM, refused if it is unset, not an address, or on the firm's own mail domain. */
export function newsSender(marketingFrom: string | null | undefined, replyTo: string | null | undefined): SenderChoice {
  const from = (marketingFrom ?? '').trim()
  if (!from) return { error: 'MARKETING_FROM is not set.' }
  if (!mailDomainOf(from).includes('.')) return { error: `MARKETING_FROM (${from}) is not an email address.` }
  if (isFirmMainDomain(from)) {
    return { error: `MARKETING_FROM is on ${mailDomainOf(from)}, the firm’s own mail domain. News is bulk mail and must go from the separate news domain, never ${FIRM_MAIN_MAIL_DOMAIN} or a subdomain of it.` }
  }
  return { from, replyTo: (replyTo ?? '').trim() || null }
}

/**
 * A PROSPECT CAMPAIGN GOES FROM ITS MARKETER, PERSONALLY. The firm: from e.g. reino@<the marketing
 * domain>, under the marketer's own name, with replies going to the marketer's real address so they
 * land in their own inbox. A person writing to a prospect reads as a person; "news@" to somebody
 * who never asked for news reads as a list.
 *
 * The local part is the marketer's main-address local part -- reino@bredellferreira.co.za sends as
 * reino@<domain>. The domain is MARKETING_PROSPECT_DOMAIN and is never written into the code: the
 * firm is still confirming it. It may not be the firm's own domain, for the reason above.
 */
export function prospectSender(
  domain: string | null | undefined,
  marketer: { name: string | null; email: string | null } | null,
): SenderChoice {
  const d = (domain ?? '').trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '')
  if (!d) return { error: 'MARKETING_PROSPECT_DOMAIN is not set.' }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return { error: `MARKETING_PROSPECT_DOMAIN (${d}) is not a domain.` }
  if (isFirmMainDomain(`x@${d}`)) {
    return { error: `MARKETING_PROSPECT_DOMAIN is ${d}, which is the firm’s own mail domain. Prospect mail must go from the separate marketing domain, never ${FIRM_MAIN_MAIL_DOMAIN} or a subdomain of it.` }
  }
  const real = normaliseEmail(marketer?.email)
  const local = real.split('@')[0]
  if (!real || !local || !isSendableEmail(real)) {
    return { error: `${marketer?.name?.trim() || 'The marketer'} has no email address on their profile, so there is nobody for it to come from or for replies to reach.` }
  }
  /* The display name sits inside quotes; a quote or angle bracket typed into a name would break the header. */
  const name = (marketer?.name ?? '').replace(/["<>\\\r\n]/g, '').trim()
  const address = `${local}@${d}`
  /* The second lock, on the address actually built rather than on the setting. */
  if (isFirmMainDomain(address)) return { error: 'A prospect email may never go from the firm’s own mail domain.' }
  return { from: name ? `"${name}" <${address}>` : address, replyTo: real }
}

/* ------------------------------------------------------------------------------------------------
 * Send from: who a NEWS campaign comes from (S13, the firm's words 26 Oct)
 * ---------------------------------------------------------------------------------------------- */

/**
 * FOUR CHOICES, ON NEWS ONLY. The firm: "an option to send bulk communication from
 * reports@bredellferreira.co.za, or ... from each liaison individually ... if the client is assigned
 * to nobody, it just goes out from" reports@ -- "the only one at BF News is news at BF News", and
 * "forget about team@". `address` is one of the extra addresses Ryno adds himself
 * (marketing_senders, 28 Oct): marketing@, info@ and the like. The introduction and prospect
 * campaigns keep their marketer (`prospectSender`) and are never offered this.
 */
export type SendFrom = 'news' | 'liaison' | 'reports' | 'address'

export const SEND_FROM_LABELS: Record<SendFrom, string> = {
  news: 'BF News',
  liaison: 'Each client’s liaison',
  reports: 'Reports',
  address: 'Another address',
}

export function parseSendFrom(raw: unknown): SendFrom {
  return raw === 'liaison' || raw === 'reports' || raw === 'address' ? raw : 'news'
}

export const FIRM_REPORTS_ADDRESS = `reports@${FIRM_MAIN_MAIL_DOMAIN}`
/** The name reports@ signs with: the firm, not a department. */
export const FIRM_SENDER_NAME = 'Bredell Ferreira'
/**
 * THE SECOND RESEND KEY. The first (RESEND_API_KEY) is restricted to the news domain, so Resend
 * refuses anything from bredellferreira.co.za sent with it. The administrator adds this one, allowed
 * to send from the firm's own domain; rows from a liaison or reports@ go with it, news rows with
 * the first. Never asked for in chat.
 */
export const FIRM_SENDER_ENV = 'RESEND_FIRM_API_KEY'
/** The two domains Resend can send from -- the same list marketing_senders' check holds. */
export const NEWS_MAIL_DOMAIN = 'bfnews.co.za'
export const SENDER_ADDRESS_DOMAINS = [FIRM_MAIN_MAIL_DOMAIN, NEWS_MAIL_DOMAIN] as const

/**
 * THE VERCEL SETTING A DOMAIN'S OWN KEY LIVES IN: RESEND_KEY_ and the domain in capitals, dots as underscores
 * -- RESEND_KEY_BFMARKETING_CO_ZA. A Resend key can be restricted to one domain (both of the firm's are), so a
 * third domain usually needs a key of its own; the set-up guide says to add it under this name.
 */
export function domainKeyEnv(domain: string): string {
  return `RESEND_KEY_${domain.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
}

/**
 * WHICH KEY A FROM ADDRESS IS SENT WITH: the firm's own domain the second key; a domain with a key of its own
 * that one (`env` is consulted, so the choice is the server's); everything else the first key.
 */
export function resendKeyEnvFor(address: string, env: Record<string, string | undefined> = {}): string {
  if (isFirmMainDomain(address)) return FIRM_SENDER_ENV
  const own = domainKeyEnv(mailDomainOf(address))
  return env[own]?.trim() ? own : 'RESEND_API_KEY'
}

/*
 * A DOMAIN NOBODY CAN VERIFY. Resend sends only from a domain whose DNS the sender controls; nobody at the firm
 * controls gmail.com, so an address there could never send, however long it waited "for setting up".
 */
const PUBLIC_MAIL_DOMAINS = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com',
  'me.com', 'msn.com', 'aol.com', 'mweb.co.za', 'telkomsa.net', 'webmail.co.za', 'vodamail.co.za', 'protonmail.com', 'proton.me']

/**
 * WHY AN ADDRESS CANNOT BE ADDED AS A SENDER, or null if it can (29 Oct: "the ability to add any addresses that
 * I want"). No mailbox and no password: Resend sends from ANY address on a domain verified with it, so an address
 * on any domain the firm owns may be added. One that is not set up yet is saved as needing setting up -- that is
 * `domainReady`, not a refusal.
 */
export function senderAddressProblem(raw: string | null | undefined): string | null {
  const address = normaliseEmail(raw)
  if (!address) return 'Type the address.'
  if (!isSendableEmail(address)) return `${address} is not an email address.`
  const domain = mailDomainOf(address)
  if (PUBLIC_MAIL_DOMAINS.includes(domain)) {
    return `${domain} belongs to a public mail service, so it can never be set up to send through Raptor. Use an address on a domain the firm owns.`
  }
  return null
}

/**
 * IS THIS ADDRESS'S DOMAIN SET UP TO SEND? The two the firm verified always are; another once somebody who
 * followed the set-up guide has marked it so (marketing_senders.domain_ready_at). A subdomain is its own domain
 * to Resend, so it is matched exactly.
 */
export function domainReady(address: string, readyDomains: readonly string[]): boolean {
  const d = mailDomainOf(address)
  return (SENDER_ADDRESS_DOMAINS as readonly string[]).includes(d) || readyDomains.includes(d)
}

/** The steps that set a new domain up -- the screen shows them beside an address that needs them. */
export function domainSetupSteps(domain: string): string[] {
  return [
    `Sign in at resend.com with the firm's account, open Domains and press Add domain. Type ${domain}.`,
    `Resend shows three or four DNS records: an SPF record (TXT), a DKIM record (TXT, named resend._domainkey), and an MX record for bounces. Copy each one exactly.`,
    `Sign in where ${domain}'s DNS is managed (the company the domain was bought from, or Cloudflare if it is on Cloudflare) and add each record as Resend shows it: the same type, name and value.`,
    'Back in Resend, press Verify. It usually takes a few minutes and can take up to a day. Wait until the domain says Verified.',
    `On the same domain in Resend, switch ON open tracking (and click tracking if you want clicks counted).`,
    `In Resend, open API keys, create a key with sending access for ${domain}, and give it to Stephan to add in Vercel as ${domainKeyEnv(domain)}. Never paste a key into a chat or an email.`,
    'Come back here and press “The domain is verified”. Campaigns can then be sent from every address on it.',
  ]
}

/** "Name <a@b>" or a bare address, taken apart. */
export function splitFrom(from: string | null | undefined): { name: string | null; address: string } {
  const raw = (from ?? '').trim()
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw)
  return m ? { name: m[1].trim() || null, address: normaliseEmail(m[2]) } : { name: null, address: normaliseEmail(raw) }
}

/** A From header, with nothing in the name that could break it. */
export function fromHeader(name: string | null | undefined, address: string): string {
  const clean = (name ?? '').replace(/["<>\\\r\n]/g, '').trim()
  return clean ? `"${clean}" <${address}>` : address
}

/**
 * THE DELIBERATE DOOR ONTO THE FIRM'S OWN DOMAIN (see FIRM_MAIN_MAIL_DOMAIN): a liaison, reports@ or
 * an extra address. Replies go to the same address -- a client answering Nicole's newsletter is
 * answering Nicole.
 */
export function firmSender(name: string | null | undefined, rawAddress: string | null | undefined): SenderChoice {
  const address = normaliseEmail(rawAddress)
  const problem = senderAddressProblem(address)
  if (problem) return { error: problem }
  return { from: fromHeader(name, address), replyTo: address }
}

/**
 * AN INTRODUCTION OR PROSPECT CAMPAIGN FROM A CHOSEN ADDRESS (29 Oct) -- but never one on the firm's own domain.
 * That half of the 22 Oct lock the firm did not lift: cold mail's complaints land on the domain it came from,
 * and bredellferreira.co.za carries every section 129 the firm sends.
 */
export function prospectAddressSender(name: string | null | undefined, rawAddress: string | null | undefined): SenderChoice {
  if (isFirmMainDomain(rawAddress)) {
    return { error: `An introduction or prospect campaign may never go from ${FIRM_MAIN_MAIL_DOMAIN}: cold mail would put the firm's own letters in junk folders. Choose an address on another domain.` }
  }
  return firmSender(name, rawAddress)
}

/** A person who might be a client's liaison, as the profiles table has them. */
export interface LiaisonPerson { id: string; name: string | null; email: string | null; role: string; status: string }
/** The client columns the liaison rule reads. */
export interface SenderCompany { id: string; parentCompanyId?: string | null; accountOwnerId?: string | null; liaisonNeeded?: boolean | null }

/** Liaison or Liaison Manager -- `canBeClientLiaison` in permissions.ts, which this must agree with. */
export const LIAISON_ROLES = ['Liaison', 'Liaison Manager'] as const

/**
 * WHO LOOKS AFTER THIS CLIENT, for the From line -- or nobody. The client's `account_owner_id`, ONLY
 * if that person is Active and may be a liaison: the rule the welcome email and assign-liaison use.
 * A sub-account belongs to its PARENT's client, so the parent's liaison. A client still waiting for
 * one (`liaison_needed`) has none. `companies.liaison` is Swordfish's typed name and is NOT the rule.
 * And the liaison's own address must be on the firm's domain: Resend can send from nothing else, so
 * a liaison with a private address is "nobody" here and the client gets reports@.
 */
export function clientLiaison(
  companyId: string | null | undefined,
  companies: Map<string, SenderCompany>,
  people: Map<string, LiaisonPerson>,
): LiaisonPerson | null {
  let c = companyId ? companies.get(companyId) : undefined
  for (let i = 0; c?.parentCompanyId && i < 10; i += 1) c = companies.get(c.parentCompanyId) ?? c
  if (!c || c.liaisonNeeded || !c.accountOwnerId) return null
  const p = people.get(c.accountOwnerId)
  if (!p || p.status !== 'Active' || !(LIAISON_ROLES as readonly string[]).includes(p.role)) return null
  if (!isFirmMainDomain(p.email) || !isSendableEmail(normaliseEmail(p.email))) return null
  return p
}

/** Who ONE row goes from: the bare address, the name, whose it is, and how the preview names it. */
export interface RowSender {
  address: string
  name: string | null
  kind: 'news' | 'liaison' | 'reports' | 'address'
  /** The liaison's profile, so the timeline line is credited to her. */
  liaisonId: string | null
  label: string
}

export interface SenderContext {
  /** MARKETING_FROM taken apart. */
  news: { name: string | null; address: string }
  /** The chosen extra address, for `address`. */
  extra?: { name: string | null; address: string } | null
  liaisonOf: (companyId: string | null | undefined) => LiaisonPerson | null
}

/**
 * THE SENDER FOR ONE RECIPIENT. A LEAD ALWAYS GOES FROM news@ whatever was chosen: a lead has no
 * liaison, and the firm said only news lives on BF News -- the firm's own domain is for clients. A
 * client or contact goes from the choice, and in `liaison` mode from its client's liaison, or
 * reports@ when there is none.
 */
export function senderForRecipient(sendFrom: SendFrom, r: { companyId?: string | null; leadId?: string | null }, ctx: SenderContext): RowSender {
  const news: RowSender = { address: ctx.news.address, name: ctx.news.name, kind: 'news', liaisonId: null, label: sendFrom === 'news' ? 'news@' : 'news@ (leads)' }
  const reports: RowSender = { address: FIRM_REPORTS_ADDRESS, name: FIRM_SENDER_NAME, kind: 'reports', liaisonId: null, label: 'reports@' }
  if (sendFrom === 'news' || !r.companyId) return news
  if (sendFrom === 'reports') return reports
  if (sendFrom === 'address') {
    const x = ctx.extra
    return x ? { address: x.address, name: x.name, kind: 'address', liaisonId: null, label: x.name || x.address } : reports
  }
  const l = ctx.liaisonOf(r.companyId)
  if (!l) return reports
  return { address: normaliseEmail(l.email), name: l.name, kind: 'liaison', liaisonId: l.id, label: (l.name ?? '').trim() || normaliseEmail(l.email) }
}

export interface SenderShare { label: string; address: string; kind: RowSender['kind']; count: number }

/**
 * THE SPLIT THE PREVIEW SHOWS BEFORE SEND: people by name, biggest first, then reports@, then the
 * leads on news@ -- "From Nicole Loder 42 · Ryno 31 · reports@ 9 · news@ (leads) 12".
 */
export function senderSplit(rows: RowSender[]): SenderShare[] {
  const by = new Map<string, SenderShare>()
  for (const r of rows) {
    const s = by.get(r.address) ?? { label: r.label, address: r.address, kind: r.kind, count: 0 }
    s.count += 1
    by.set(r.address, s)
  }
  const rank = (k: RowSender['kind']) => (k === 'liaison' || k === 'address' ? 0 : k === 'reports' ? 1 : 2)
  return [...by.values()].sort((a, b) => rank(a.kind) - rank(b.kind) || b.count - a.count || a.label.localeCompare(b.label))
}

export function describeSplit(split: SenderShare[]): string {
  return split.length ? `From ${split.map((s) => `${s.label} ${s.count}`).join(' · ')}` : ''
}

/* ------------------------------------------------------------------------------------------------
 * Results, by sender -- the same counting as marketing_campaign_results(), per From address
 * ---------------------------------------------------------------------------------------------- */

/** The marketing_sends columns a results row is counted from. */
export interface SendResultRow {
  sender: string | null
  state: string
  resend_id: string | null
  delivered_at: string | null
  delayed_at?: string | null
  first_opened_at: string | null
  first_clicked_at: string | null
  unsubscribed_at: string | null
  opted_in_at?: string | null
}

/**
 * ONE ROW PER SENDER, counted exactly as the database's results function counts a campaign (each
 * filter below is its filter), so the per-sender rows always add up to the campaign's own figures.
 */
export function resultsBySender(rows: SendResultRow[]): (Omit<CampaignResults, 'campaign_id'> & { sender: string })[] {
  const by = new Map<string, Omit<CampaignResults, 'campaign_id'> & { sender: string }>()
  for (const s of rows) {
    const key = s.sender ?? ''
    const r = by.get(key) ?? { sender: key, total: 0, queued: 0, accepted: 0, failed: 0, skipped: 0, delivered: 0, delayed: 0, bounced: 0, complained: 0, opened: 0, clicked: 0, unsubscribed: 0, opted_in: 0 }
    r.total += 1
    if (s.state === 'queued' || s.state === 'sending') r.queued += 1
    if (s.resend_id && ['sent', 'bounced', 'complained'].includes(s.state)) r.accepted += 1
    if (s.state === 'failed') r.failed += 1
    if (s.state === 'skipped') r.skipped += 1
    if (s.delivered_at && s.state !== 'bounced') r.delivered += 1
    if (s.delayed_at && !s.delivered_at && s.state === 'sent') r.delayed += 1
    if (s.state === 'bounced') r.bounced += 1
    if (s.state === 'complained') r.complained += 1
    if (s.first_opened_at) r.opened += 1
    if (s.first_clicked_at) r.clicked += 1
    if (s.unsubscribed_at) r.unsubscribed += 1
    if (s.opted_in_at) r.opted_in += 1
    by.set(key, r)
  }
  return [...by.values()].sort((a, b) => b.total - a.total)
}

/* ------------------------------------------------------------------------------------------------
 * Workflows: a follow-up goes to who did (or did not) do something with the email before it
 * ---------------------------------------------------------------------------------------------- */

export type WorkflowAudience = 'everyone' | 'not_opened' | 'not_clicked' | 'opened' | 'clicked'

export const WORKFLOW_AUDIENCE_LABELS: Record<WorkflowAudience, string> = {
  everyone: 'Everybody it reached',
  not_opened: 'Those who did not open it',
  not_clicked: 'Those who did not click',
  opened: 'Those who opened it',
  clicked: 'Those who clicked',
}

export function parseWorkflowAudience(raw: unknown): WorkflowAudience {
  return raw === 'everyone' || raw === 'not_clicked' || raw === 'opened' || raw === 'clicked' ? raw : 'not_opened'
}

/**
 * WHO A FOLLOW-UP GOES TO, off the email before it. Only somebody it actually REACHED: a send that
 * failed, was skipped, bounced or was marked as spam is never followed up, and somebody who
 * unsubscribed from that very email is never written to again. (The drain reads the unsubscribes
 * once more as it sends, so somebody who said stop since is held too.) "Did not open" includes
 * people whose mail blocks pictures -- opens are approximate, and the screen says so.
 */
export function inWorkflowAudience(audience: WorkflowAudience, s: Pick<SendResultRow, 'state' | 'first_opened_at' | 'first_clicked_at' | 'unsubscribed_at'>): boolean {
  if (s.state !== 'sent' || s.unsubscribed_at) return false
  switch (audience) {
    case 'everyone': return true
    case 'not_opened': return !s.first_opened_at
    case 'opened': return !!s.first_opened_at
    case 'not_clicked': return !s.first_clicked_at
    case 'clicked': return !!s.first_clicked_at
  }
}

/** The day a follow-up is due: `waitDays` after the email before it FINISHED going out, Johannesburg's day. */
export function followUpDueOn(previousFinishedAt: string | null | undefined, waitDays: number): string | null {
  if (!previousFinishedAt) return null
  const day = new Date(new Date(previousFinishedAt).getTime() + 2 * 3600_000).toISOString().slice(0, 10)
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + waitDays)
  return d.toISOString().slice(0, 10)
}

/* ------------------------------------------------------------------------------------------------
 * The sheet: one row per address, a column per email of the workflow -- "Sent 1", "Sent 2", ...
 * ---------------------------------------------------------------------------------------------- */

/** What one email did for one address, in the firm's words. */
export type SheetMark = 'Clicked' | 'Opened' | 'Delivered' | 'Sent' | 'Didn’t arrive' | 'Marked as spam' | 'Unsubscribed' | 'Not sent' | 'Waiting' | ''

export interface SheetSendRow {
  campaign_id: string; email: string; first_name: string | null; company_name: string | null; state: string
  sent_at: string | null; delivered_at: string | null; first_opened_at: string | null; first_clicked_at: string | null; unsubscribed_at: string | null
}

export interface SheetRow { email: string; name: string; company: string; cells: { mark: SheetMark; at: string | null }[] }

/** The strongest thing that happened, because one word fits in a cell: an unsubscribe outranks an open. */
export function sheetMark(s: SheetSendRow | undefined): { mark: SheetMark; at: string | null } {
  if (!s) return { mark: '', at: null }
  if (s.unsubscribed_at) return { mark: 'Unsubscribed', at: s.unsubscribed_at }
  if (s.state === 'complained') return { mark: 'Marked as spam', at: s.sent_at }
  if (s.state === 'bounced') return { mark: 'Didn’t arrive', at: s.sent_at }
  if (s.state === 'failed' || s.state === 'skipped') return { mark: 'Not sent', at: null }
  if (s.state === 'queued' || s.state === 'sending') return { mark: 'Waiting', at: null }
  if (s.first_clicked_at) return { mark: 'Clicked', at: s.first_clicked_at }
  if (s.first_opened_at) return { mark: 'Opened', at: s.first_opened_at }
  if (s.delivered_at) return { mark: 'Delivered', at: s.delivered_at }
  return { mark: 'Sent', at: s.sent_at }
}

/**
 * RYNO'S SHEET (29 Oct): "email addresses in column one, and then in column two ... 'Sent One', column three
 * 'Sent Two' ... each time the campaign processes, it marks down, okay, email one has been sent." Built from the
 * sends Raptor already keeps, never typed and never stored, so it cannot disagree with them. A row per address the
 * FIRST email went to, in that order; a follow-up that did not go to somebody is an empty cell, which is the
 * answer ("they opened the first, so the reminder skipped them").
 */
export function workflowSheet(campaignIds: string[], sends: SheetSendRow[]): SheetRow[] {
  const by = new Map<string, Map<string, SheetSendRow>>()
  for (const s of sends) {
    const m = by.get(s.campaign_id) ?? new Map<string, SheetSendRow>()
    m.set(normaliseEmail(s.email), s)
    by.set(s.campaign_id, m)
  }
  const order: string[] = []
  const seen = new Set<string>()
  const who = new Map<string, SheetSendRow>()
  for (const id of campaignIds) {
    for (const s of sends.filter((x) => x.campaign_id === id)) {
      const e = normaliseEmail(s.email)
      if (!seen.has(e)) { seen.add(e); order.push(e); who.set(e, s) }
    }
  }
  return order.map((e) => ({
    email: e, name: who.get(e)?.first_name ?? '', company: who.get(e)?.company_name ?? '',
    cells: campaignIds.map((id) => sheetMark(by.get(id)?.get(e))),
  }))
}

/* ------------------------------------------------------------------------------------------------
 * Warm-up: a new sending domain starts slowly
 * ---------------------------------------------------------------------------------------------- */

/**
 * PER SENDER, PER DAY, RISING BY THE WEEK. A domain nobody has heard of that sends five hundred
 * emails on its first morning is what a spammer looks like, and the mailbox providers remember it
 * for months. So each prospect sender (reino@<domain> is one, thabo@<domain> another) gets 30 a day
 * in its first week, counted from its first prospect send, then 60, 120, 250, and from the fifth
 * week the ceiling the firm sets. News is not held to this: it goes to people who know the firm,
 * from its own domain with clients' engagement behind it (though a new news domain should be
 * ramped up by hand over its first weeks too -- see HANDOFF).
 *
 * Weeks are counted in REAL days, not on the firm's business clock: a mailbox provider's memory runs
 * on the calendar, and a staging clock moved a month on has not warmed anything up.
 */
export const WARMUP_SCHEDULE = [30, 60, 120, 250] as const
export const DEFAULT_WARMUP_CEILING = 500

/** Which week of its warm-up a sender is in, 1-based: week 1 until seven full days after the first send. */
export function warmupWeek(firstSentAt: string | null | undefined, nowIso: string): number {
  if (!firstSentAt) return 1
  return Math.max(0, Math.floor(daysBetween(firstSentAt, nowIso) / 7)) + 1
}

export function warmupDailyCap(firstSentAt: string | null | undefined, nowIso: string, ceiling: number = DEFAULT_WARMUP_CEILING): number {
  const top = Number.isFinite(ceiling) && ceiling >= 1 ? Math.floor(ceiling) : DEFAULT_WARMUP_CEILING
  const week = warmupWeek(firstSentAt, nowIso)
  return week <= WARMUP_SCHEDULE.length ? Math.min(WARMUP_SCHEDULE[week - 1], top) : top
}

/* ------------------------------------------------------------------------------------------------
 * The rule again at the moment of sending
 * ---------------------------------------------------------------------------------------------- */

/**
 * WHETHER THIS ROW MAY STILL GO, read against the lead as it stands when its chunk is sent -- not as
 * it stood when the list was drawn. The queue already applied resolveAudience; this is the second
 * lock on the same door, because a list queued on Monday and drained on Thursday (the warm-up makes
 * that normal) must not reach somebody whose answer changed in between.
 *
 *   a lead-basis row that is NOT a first approach goes only if the lead's consent is on record --
 *     an imported prospect who did not press the button is never sent anything after the
 *     introduction, whatever list somebody later puts them on;
 *   a first approach (the introduction) is not sent to somebody who has already said yes;
 *   a lead that is gone is not written to.
 * A client or contact row is not a lead's and passes: the unsubscribe check covers those.
 */
export function sendBlockReason(
  row: { leadId: string | null; companyId: string | null; firstApproach: boolean },
  lead: { marketingConsentAt: string | null } | null | undefined,
): string | null {
  if (!row.leadId || row.companyId) return null
  if (!lead) return 'The lead is gone'
  if (row.firstApproach) return lead.marketingConsentAt ? 'Already said yes, so not asked again' : null
  return lead.marketingConsentAt ? null : 'No consent recorded, so never sent marketing'
}

/**
 * RESEND'S LIMITS, AND HOW THIS STAYS INSIDE THEM. The batch endpoint takes a hundred emails a call
 * and an account is allowed two calls a second by default. A drain sends one batch, waits, and
 * sends the next -- and stops well inside the function's time, leaving the rest queued for the next
 * call from the open screen or the five-minute sweep.
 */
export const RESEND_BATCH_MAX = 100
export const RESEND_MIN_GAP_MS = 600

/* ------------------------------------------------------------------------------------------------
 * Delivery results
 * ---------------------------------------------------------------------------------------------- */

/**
 * WHAT HAPPENED TO A CAMPAIGN AFTER IT LEFT -- the firm: "see also the success of what's been
 * delivered, what was undelivered, what was opened." One row of marketing_campaign_results().
 * `accepted` is what Resend took from us; everything after it is what Resend's webhook reported.
 */
export interface CampaignResults {
  campaign_id: string
  total: number
  queued: number
  accepted: number
  failed: number
  skipped: number
  delivered: number
  delayed: number
  bounced: number
  complained: number
  opened: number
  clicked: number
  unsubscribed: number
  opted_in: number
}

export interface ResultRates {
  delivered: number | null
  bounced: number | null
  opened: number | null
  clicked: number | null
  unsubscribed: number | null
  complained: number | null
  optedIn: number | null
}

/**
 * THE RATES, EACH OVER WHAT COULD HAVE DONE IT. Delivery and bounces are out of what Resend
 * accepted; opens, clicks, unsubscribes, spam reports and opt-ins are out of what was DELIVERED,
 * because an email that never arrived could do none of them. Null, never 0%, when nothing could --
 * "0% opened" on a campaign still sending is a figure that is not true yet.
 */
export function resultRates(r: Pick<CampaignResults, 'accepted' | 'delivered' | 'bounced' | 'opened' | 'clicked' | 'unsubscribed' | 'complained' | 'opted_in'>): ResultRates {
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null)
  return {
    delivered: pct(r.delivered, r.accepted),
    bounced: pct(r.bounced, r.accepted),
    opened: pct(r.opened, r.delivered),
    clicked: pct(r.clicked, r.delivered),
    unsubscribed: pct(r.unsubscribed, r.delivered),
    complained: pct(r.complained, r.delivered),
    optedIn: pct(r.opted_in, r.delivered),
  }
}

/** Said beside every open figure, because it is the truth about them. */
export const OPENS_ARE_APPROXIMATE = 'Opens are approximate. Apple Mail opens every email it receives on the reader’s behalf, which counts as opened, and a reader whose mail blocks pictures is never counted. Clicks are the firmer figure.'
