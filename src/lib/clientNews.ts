import type { Company, User } from '../types.js'

/**
 * A CLIENT THAT HAS ASKED FOR NO NEWS AT ALL (S12).
 *
 * THE FIRM (26 Oct), on the proposal to keep dormant clients out of campaigns: "The client can be
 * dormant but still receive information ... like a client that ... doesn't even want to receive any
 * information from us. I wouldn't really call them dormant ... We need to find a name for people
 * that don't want to receive information. Like unsubscribes." So DORMANT (clientDormant.ts) is about
 * the WORK and stops nothing; UNSUBSCRIBED is about our NEWS and is its own fact.
 *
 * Unsubscribing already existed per ADDRESS (`marketing_preferences`, the News card, the link in
 * every newsletter). This is the same objection made once for the whole CLIENT: the client's own
 * address, every contact on it, and every sub-account under it -- including contacts added after
 * the day it was recorded, which is why it lives on the client (`companies.news_stopped_at`) and
 * is not written out as one preference row per address. A sub-account follows its parent, as the
 * liaison and dormancy do.
 *
 * NEWS ONLY. Statements, reports, remittance advices, the welcome and every notice about an account
 * still go: the firm, of news when it was built, "only for specific news ... not for reports".
 *
 * A RE-SUBSCRIPTION SAYS WHY. Overriding an objection POPIA s69 protects is the one write here that
 * needs a reason on the record, exactly as it is for one address (marketing_preferences_
 * resubscribe_says_why); the database refuses one without (companies_news_resumed_says_why).
 */

export type NewsCompany = Pick<Company, 'id' | 'parentCompanyId' | 'newsStoppedAt'>

/** Who may record it: the companies_update policy, said in the browser -- the dormancy rule's people. */
export function mayChangeClientNews(
  user: Pick<User, 'id' | 'role'> | null | undefined,
  client: Pick<Company, 'accountOwnerId'> | null | undefined,
): boolean {
  if (!user || !client) return false
  return ['Administrator', 'Sales Manager', 'Liaison Manager'].includes(user.role) || client.accountOwnerId === user.id
}

/**
 * THE CLIENT WHOSE OBJECTION COVERS THIS ONE: itself, or the nearest parent that recorded it. Null
 * when nothing up the family has. Ten levels at most, so a parent loop in the data cannot hang it.
 */
export function newsStoppedBy<C extends NewsCompany>(companyId: string | null | undefined, companies: C[] | Map<string, C>): C | null {
  const byId = companies instanceof Map ? companies : new Map(companies.map((c) => [c.id, c]))
  let c = companyId ? byId.get(companyId) : undefined
  for (let i = 0; c && i < 10; i += 1) {
    if (c.newsStoppedAt) return c
    c = c.parentCompanyId ? byId.get(c.parentCompanyId) : undefined
  }
  return null
}

/** The columns recording it. A reason is optional: somebody asking us to stop owes us none. */
export function newsStopPatch(reason: string, byId: string | null, at: string) {
  return { news_stopped_at: at, news_stopped_reason: reason.trim() || null, news_stopped_by: byId }
}

/** And undoing it, which must say why -- the caller refuses an empty reason before it gets here. */
export function newsResumePatch(reason: string, byId: string | null, at: string) {
  return {
    news_stopped_at: null, news_stopped_reason: null, news_stopped_by: null,
    news_resumed_at: at, news_resumed_reason: reason.trim(), news_resumed_by: byId,
  }
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })

/** The line a client page or a contact's News card shows. */
export function newsStoppedLine(
  c: Pick<Company, 'name' | 'newsStoppedAt' | 'newsStoppedReason'>, byName: string | null, own: boolean,
): string {
  if (!c.newsStoppedAt) return ''
  const who = own ? 'This client' : c.name
  return `${who} unsubscribed from our news on ${day(c.newsStoppedAt)}${byName ? `, recorded by ${byName}` : ''}`
    + `${c.newsStoppedReason ? ` — ${c.newsStoppedReason}` : ''}. No newsletter or campaign goes to any of its people.`
}
