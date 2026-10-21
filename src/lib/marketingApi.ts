import { supabase } from './supabase'
import type { Audience, ExclusionReason } from './marketing.ts'

/**
 * The browser's half of News & campaigns: the rows it may read itself (RLS: marketing.send), and the
 * calls to /api/email/marketing for everything that draws a list or sends. The list is never drawn
 * in the browser -- the server answers the preview with the very function it sends with.
 */

export interface CampaignRow {
  id: string
  name: string
  subject: string
  preheader: string
  body: string
  image_url: string | null
  audience: Audience
  first_approach: boolean
  status: 'draft' | 'sending' | 'sent' | 'cancelled'
  recipient_count: number | null
  created_by: string | null
  created_at: string
  updated_at: string
  queued_at: string | null
  queued_by: string | null
  finished_at: string | null
}

export interface CampaignCounts {
  campaign_id: string
  total: number
  queued: number
  sent: number
  failed: number
  skipped: number
  bounced: number
  complained: number
}

export interface SenderConfig {
  ready: boolean
  missing: string[]
  from: string | null
  replyTo: string | null
  webhook: boolean
  keyProblem: string | null
}

export interface AudiencePreview {
  count: number
  firstApproaches: number
  sample: { email: string; firstName: string | null; companyName: string | null; via: 'client' | 'contact' | 'lead'; firstApproach: boolean }[]
  excluded: Partial<Record<ExclusionReason, number>>
}

export interface DrainReport { sent: number; failed: number; skipped: number; remaining: number; stoppedFor: string | null }

const CAMPAIGN_COLUMNS = 'id, name, subject, preheader, body, image_url, audience, first_approach, status, recipient_count, '
  + 'created_by, created_at, updated_at, queued_at, queued_by, finished_at'

export async function listCampaigns(): Promise<{ campaigns: CampaignRow[]; counts: Map<string, CampaignCounts> }> {
  const [{ data, error }, { data: counts }] = await Promise.all([
    supabase.from('marketing_campaigns').select(CAMPAIGN_COLUMNS).order('created_at', { ascending: false }).limit(200),
    supabase.rpc('marketing_campaign_counts'),
  ])
  if (error) throw new Error(error.message)
  return {
    campaigns: (data ?? []) as unknown as CampaignRow[],
    counts: new Map(((counts ?? []) as CampaignCounts[]).map((c) => [c.campaign_id, c])),
  }
}

export async function getCampaign(id: string): Promise<CampaignRow | null> {
  const { data, error } = await supabase.from('marketing_campaigns').select(CAMPAIGN_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as CampaignRow | null) ?? null
}

export async function createCampaign(name: string): Promise<CampaignRow> {
  const { data, error } = await supabase.from('marketing_campaigns').insert({ name }).select(CAMPAIGN_COLUMNS).single()
  if (error) throw new Error(error.message)
  return data as unknown as CampaignRow
}

export type CampaignDraft = Pick<CampaignRow, 'name' | 'subject' | 'preheader' | 'body' | 'image_url' | 'audience' | 'first_approach'>

export async function saveCampaign(id: string, draft: CampaignDraft): Promise<void> {
  const { error } = await supabase.from('marketing_campaigns')
    .update({ ...draft, image_url: draft.image_url?.trim() || null })
    .eq('id', id).select('id').single()
  if (error) throw new Error(error.message)
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Your session has expired. Sign in again.')
  const res = await fetch('/api/email/marketing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const out = await res.json().catch(() => ({})) as T & { error?: string }
  if (!res.ok) throw new Error(out.error ?? `The server answered ${res.status}.`)
  return out
}

export const senderConfig = () => call<SenderConfig>({ step: 'config' })
export const previewAudience = (audience: Audience, firstApproach: boolean) =>
  call<AudiencePreview>({ step: 'preview', audience, firstApproach })
export const sendTest = (campaignId: string) => call<{ sentTo: string }>({ step: 'test', campaignId })
export const queueCampaign = (campaignId: string) =>
  call<DrainReport & { queued: number }>({ step: 'queue', campaignId })
export const drainCampaign = (campaignId: string) => call<DrainReport>({ step: 'drain', campaignId })
export const cancelCampaign = (campaignId: string) => call<{ cancelled: boolean }>({ step: 'cancel', campaignId })

/* ---------------------------------- preferences on a record ---------------------------------- */

export interface PreferenceRow {
  email: string
  status: 'subscribed' | 'unsubscribed' | 'undeliverable'
  how: string
  reason: string | null
  changed_at: string
}

export async function preferencesFor(emails: string[]): Promise<Map<string, PreferenceRow>> {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
  if (!list.length) return new Map()
  const { data, error } = await supabase.from('marketing_preferences')
    .select('email, status, how, reason, changed_at').in('email', list)
  if (error) throw new Error(error.message)
  return new Map(((data ?? []) as PreferenceRow[]).map((p) => [p.email, p]))
}

/** What a person said on the telephone or in an email, recorded as staff -- with a reason to re-subscribe. */
export async function recordPreference(email: string, subscribed: boolean, reason: string): Promise<void> {
  const { error } = await supabase.from('marketing_preferences').upsert({
    email: email.trim().toLowerCase(), status: subscribed ? 'subscribed' : 'unsubscribed',
    how: 'recorded by staff', reason: reason.trim() || null,
  }, { onConflict: 'email' })
  if (error) throw new Error(error.message)
}

/* ---------------------------------- the public page ---------------------------------- */

export interface UnsubscribeState { email: string; status: 'subscribed' | 'unsubscribed' | 'undeliverable'; changedAt: string | null }

export async function unsubscribeStep(token: string, step: 'status' | 'unsubscribe' | 'resubscribe'): Promise<UnsubscribeState> {
  const res = await fetch('/api/email/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, step }),
  })
  const out = await res.json().catch(() => ({})) as UnsubscribeState & { error?: string }
  if (!res.ok) throw new Error(out.error ?? `The server answered ${res.status}.`)
  return out
}
