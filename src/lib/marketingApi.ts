import { supabase } from './supabase'
import type {
  Audience, CampaignKind, CampaignResults, ExclusionReason, SendFrom, SendResultRow, SenderShare, WorkflowAudience,
} from './marketing.ts'
import { resultsBySender } from './marketing.ts'
import { fetchAllRows } from './fetchAll.ts'
import { clockNow } from './clock'
import type { ProspectOutcome, ProspectRow } from './prospectImport.ts'

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
  kind: CampaignKind
  /** Whose name a prospect campaign goes out under; the creator until somebody chooses. */
  sender_id: string | null
  status: 'draft' | 'sending' | 'sent' | 'cancelled'
  recipient_count: number | null
  created_by: string | null
  created_at: string
  updated_at: string
  queued_at: string | null
  queued_by: string | null
  finished_at: string | null
  /** Who a News campaign comes from (S13). 'news' on every campaign written before it. */
  send_from: SendFrom
  /**
   * The extra address for send_from 'address'. UNDEFINED -- not null -- on a database that has not had
   * migration campaign_sender_address yet; the screen reads that as "extra addresses cannot be chosen yet".
   */
  sender_address_id?: string | null
  /** When the results email went (S14). */
  results_sent_at?: string | null
  /** Batches (29 Oct); absent until migration campaign_compose. Null size: all at once. */
  batch_size?: number | null
  batch_every_minutes?: number | null
  next_batch_at?: string | null
  template_id?: string | null
}

export type { CampaignResults }

export interface SenderConfig {
  ready: boolean
  missing: string[]
  problem?: string | null
  from: string | null
  replyTo: string | null
  webhook: boolean
  keyProblem: string | null
  prospect?: { ready: boolean; missing: string[]; problem: string | null; domain: string | null }
  warmupCeiling?: number
  /** Sending from the firm's own domain (liaisons, reports@): needs RESEND_FIRM_API_KEY. */
  firm?: { ready: boolean; missing: string[] }
  /** Migration campaign_compose is on this database: templates, extra-address campaigns, batches, signatures. */
  schemaReady?: boolean
  /** Domains marked verified, beyond the firm's two. */
  readyDomains?: string[]
}

export interface AudiencePreview {
  kind?: CampaignKind
  count: number
  firstApproaches: number
  sample: { email: string; firstName: string | null; companyName: string | null; via: 'client' | 'contact' | 'lead'; firstApproach: boolean }[]
  excluded: Partial<Record<ExclusionReason, number>>
  /** Who it goes from, counted in the same pass -- null for the introduction and prospect kinds. */
  senders?: SenderShare[] | null
}

export interface Allowance { sender: string; week: number; cap: number; used: number }
export interface DrainReport {
  sent: number; failed: number; skipped: number; remaining: number; stoppedFor: string | null
  waitingForTomorrow?: number; allowance?: Allowance | null
  /** Sent in batches: when the next batch goes (the sweep sends it, whether or not this page is open). */
  nextBatchAt?: string | null
}

/*
 * EVERY COLUMN: `sender_address_id` arrives with migration campaign_sender_address, and naming it would
 * make the whole campaigns page fail on a database that has not had it yet. Its absence is the signal.
 */
const CAMPAIGN_COLUMNS = '*'
const asRow = (r: Record<string, unknown>): CampaignRow => ({ ...(r as unknown as CampaignRow), send_from: (r.send_from as SendFrom) ?? 'news' })

export async function listCampaigns(): Promise<{ campaigns: CampaignRow[]; counts: Map<string, CampaignResults> }> {
  const [{ data, error }, { data: counts }] = await Promise.all([
    supabase.from('marketing_campaigns').select(CAMPAIGN_COLUMNS).order('created_at', { ascending: false }).limit(200),
    supabase.rpc('marketing_campaign_results'),
  ])
  if (error) throw new Error(error.message)
  return {
    campaigns: ((data ?? []) as Record<string, unknown>[]).map(asRow),
    counts: new Map(((counts ?? []) as CampaignResults[]).map((c) => [c.campaign_id, c])),
  }
}

/** One campaign's results -- the same function the list reads, so the two never disagree. */
export async function campaignResults(id: string): Promise<CampaignResults | null> {
  const { data, error } = await supabase.rpc('marketing_campaign_results')
  if (error) throw new Error(error.message)
  return ((data ?? []) as CampaignResults[]).find((c) => c.campaign_id === id) ?? null
}

/** What happened to each person on a campaign, for its page. */
export interface RecipientRow {
  id: string
  email: string
  first_name: string | null
  company_name: string | null
  state: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped' | 'bounced' | 'complained'
  error: string | null
  sent_at: string | null
  delivered_at: string | null
  delayed_at: string | null
  first_opened_at: string | null
  open_count: number
  first_clicked_at: string | null
  click_count: number
  unsubscribed_at: string | null
  opted_in_at: string | null
}

/** The most rows the page draws; the counts above it are always the whole campaign. */
export const RECIPIENT_PAGE = 500

export async function campaignRecipients(id: string): Promise<RecipientRow[]> {
  const { data, error } = await supabase.from('marketing_sends')
    .select('id, email, first_name, company_name, state, error, sent_at, delivered_at, delayed_at, first_opened_at, open_count, '
      + 'first_clicked_at, click_count, unsubscribed_at, opted_in_at')
    .eq('campaign_id', id).order('email').limit(RECIPIENT_PAGE)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as RecipientRow[]
}

/* ---------------------------------- imported prospect lists ---------------------------------- */

export interface MarketingList {
  id: string
  name: string
  file_name: string | null
  uploaded_by: string | null
  uploaded_at: string
  counts: Partial<Record<ProspectOutcome, number>>
  lead_count: number
}

export async function listLists(): Promise<MarketingList[]> {
  const { data, error } = await supabase.from('marketing_lists')
    .select('id, name, file_name, uploaded_by, uploaded_at, counts, lead_count').order('uploaded_at', { ascending: false }).limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as MarketingList[]
}

export interface ImportPreview {
  counts: Record<ProspectOutcome, number>
  examples: Record<ProspectOutcome, string[]>
  sample: { email: string; name: string; company: string }[]
}

export async function getCampaign(id: string): Promise<CampaignRow | null> {
  const { data, error } = await supabase.from('marketing_campaigns').select(CAMPAIGN_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? asRow(data as Record<string, unknown>) : null
}

export async function createCampaign(name: string, kind: CampaignKind = 'news'): Promise<CampaignRow> {
  const { data, error } = await supabase.from('marketing_campaigns')
    .insert({ name, kind, first_approach: kind === 'introduction' }).select(CAMPAIGN_COLUMNS).single()
  if (error) throw new Error(error.message)
  return asRow(data as Record<string, unknown>)
}

export type CampaignDraft = Pick<CampaignRow, 'name' | 'subject' | 'preheader' | 'body' | 'image_url' | 'audience' | 'first_approach' | 'kind'
  | 'sender_id' | 'send_from' | 'sender_address_id' | 'batch_size' | 'batch_every_minutes'>

export async function saveCampaign(id: string, draft: CampaignDraft): Promise<void> {
  /*
   * The columns of migration campaign_compose are written only where they exist -- undefined means the row came
   * back without them (see CAMPAIGN_COLUMNS). An introduction or prospect campaign may name an address too.
   */
  const { sender_address_id: addressId, batch_size: batchSize, batch_every_minutes: every, ...rest } = draft
  const keepAddress = draft.send_from === 'address' || draft.kind !== 'news'
  const { error } = await supabase.from('marketing_campaigns')
    .update({
      ...rest, image_url: draft.image_url?.trim() || null,
      ...(addressId !== undefined ? { sender_address_id: keepAddress ? addressId : null } : {}),
      ...(batchSize !== undefined ? { batch_size: batchSize ?? null, batch_every_minutes: batchSize ? every ?? 60 : null } : {}),
    })
    .eq('id', id).select('id').single()
  if (error) throw new Error(error.message)
}

/* ------------------------------- results, split by who sent them ------------------------------- */

export type SenderResults = ReturnType<typeof resultsBySender>[number]

/** One campaign's figures per From address, read off its sends and counted as the database counts. */
export async function campaignResultsBySender(id: string): Promise<SenderResults[]> {
  const rows = await fetchAllRows<SendResultRow>(() => supabase.from('marketing_sends')
    .select('sender, state, resend_id, delivered_at, delayed_at, first_opened_at, first_clicked_at, unsubscribed_at, opted_in_at')
    .eq('campaign_id', id).order('id'), { table: 'marketing_sends' })
  return resultsBySender(rows)
}

/* --------------------------------------- extra senders --------------------------------------- */

export interface ExtraSender {
  id: string; address: string; display_name: string; active: boolean; created_at: string
  /** Migration campaign_compose: when somebody marked the domain verified, and the address's signature. */
  domain_ready_at?: string | null
  signature_html?: string | null
}

export async function listSenders(): Promise<ExtraSender[]> {
  /* '*': the two columns of migration campaign_compose may not be there yet. */
  const { data, error } = await supabase.from('marketing_senders').select('*').order('address')
  if (error) throw new Error(error.message)
  return (data ?? []) as ExtraSender[]
}

export async function addSender(address: string, displayName: string): Promise<ExtraSender> {
  const { data, error } = await supabase.from('marketing_senders')
    .insert({ address: address.trim().toLowerCase(), display_name: displayName.trim() })
    .select('*').single()
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('That address is already on the list.')
    /* The 28 Oct check (two domains only) is still on a database without migration campaign_compose. */
    if (/check constraint/i.test(error.message)) throw new Error('Addresses on other domains can be added once the database change campaign_compose is applied. Until then only bfnews.co.za and bredellferreira.co.za.')
    throw new Error(error.message)
  }
  return data as ExtraSender
}

/** Every address on the domain is ready once one is marked: verification is the DOMAIN's, in Resend. */
export async function markDomainReady(domain: string, userId: string | null): Promise<void> {
  const { error } = await supabase.from('marketing_senders')
    .update({ domain_ready_at: clockNow().toISOString(), domain_ready_by: userId }).like('address', `%@${domain}`)
  if (error) throw new Error(error.message)
}

/**
 * AN ADDRESS'S SIGNATURE. For news@ or reports@, which are not on the list until somebody gives them one, the
 * row is made then -- an upsert on the address.
 */
export async function saveSenderSignature(address: string, displayName: string, signatureHtml: string): Promise<void> {
  const { error } = await supabase.from('marketing_senders')
    .upsert({ address: address.trim().toLowerCase(), display_name: displayName.trim() || address, signature_html: signatureHtml }, { onConflict: 'address' })
  if (error) throw new Error(error.message)
}

/**
 * A PICTURE FOR AN EMAIL, uploaded to the public 'email-signatures' bucket under the person's own folder -- the
 * place every signature picture already goes, whose policy already lets a person write there. Public because an
 * inbox fetches it with no sign-in; the name is random, so nobody finds one they were not sent.
 */
export async function uploadEmailPicture(userId: string, file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|gif)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or GIF picture.')
  if (file.size > 3 * 1024 * 1024) throw new Error('That picture is larger than 3 MB. A smaller one loads faster in an inbox.')
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/gif' ? 'gif' : 'jpg'
  const path = `${userId}/campaigns/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('email-signatures').upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw new Error(error.message)
  return supabase.storage.from('email-signatures').getPublicUrl(path).data.publicUrl
}

/* ----------------------------------------- templates ----------------------------------------- */

export interface TemplateRow {
  id: string
  name: string
  kind: CampaignKind
  subject: string
  preheader: string
  body: string
  image_url: string | null
  send_from: SendFrom
  sender_address_id: string | null
  archived_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export async function listTemplates(): Promise<TemplateRow[]> {
  const { data, error } = await supabase.from('marketing_templates').select('*').is('archived_at', null).order('name')
  if (error) throw new Error(error.message)
  return (data ?? []) as TemplateRow[]
}

/** A campaign's words, design and sender, kept to start the next one from. */
export async function saveAsTemplate(name: string, d: CampaignDraft): Promise<TemplateRow> {
  const { data, error } = await supabase.from('marketing_templates').insert({
    name: name.trim(), kind: d.kind, subject: d.subject, preheader: d.preheader, body: d.body, image_url: d.image_url?.trim() || null,
    send_from: d.send_from, sender_address_id: d.sender_address_id ?? null,
  }).select('*').single()
  if (error) throw new Error(error.message)
  return data as TemplateRow
}

export async function updateTemplate(id: string, patch: Partial<Pick<TemplateRow, 'name' | 'subject' | 'preheader' | 'body' | 'image_url' | 'send_from' | 'sender_address_id' | 'archived_at'>>): Promise<void> {
  const { error } = await supabase.from('marketing_templates').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

/** A new draft, filled from a template -- its words, design and sender -- and saying which template it came from. */
export async function campaignFromTemplate(t: TemplateRow, name: string): Promise<CampaignRow> {
  const { data, error } = await supabase.from('marketing_campaigns').insert({
    name, kind: t.kind, first_approach: t.kind === 'introduction', subject: t.subject, preheader: t.preheader, body: t.body,
    image_url: t.image_url, send_from: t.kind === 'news' ? t.send_from : 'news', sender_address_id: t.sender_address_id, template_id: t.id,
    ...(t.kind === 'news' ? {} : { audience: { kind: 'imported_list', listIds: [] } }),
  }).select('*').single()
  if (error) throw new Error(error.message)
  return asRow(data as Record<string, unknown>)
}

/** A new draft from a chosen address (the Email addresses drop-down). */
export async function campaignFrom(sendFrom: SendFrom, senderAddressId: string | null, name: string): Promise<CampaignRow> {
  const { data, error } = await supabase.from('marketing_campaigns').insert({
    name, kind: 'news', first_approach: false, send_from: sendFrom, ...(senderAddressId ? { sender_address_id: senderAddressId } : {}),
  }).select('*').single()
  if (error) throw new Error(error.message)
  return asRow(data as Record<string, unknown>)
}

/* ------------------------------- the sheet: Sent 1, Sent 2, ... ------------------------------- */

export interface SheetSend {
  campaign_id: string; email: string; first_name: string | null; company_name: string | null; state: string
  sent_at: string | null; delivered_at: string | null; first_opened_at: string | null; first_clicked_at: string | null; unsubscribed_at: string | null
}

/** Every send of these campaigns, each campaign read whole (paged), for the workflow's sheet. */
export async function sendsOf(campaignIds: string[]): Promise<SheetSend[]> {
  const all = await Promise.all(campaignIds.map((id) => fetchAllRows<SheetSend>(() => supabase.from('marketing_sends')
    .select('campaign_id, email, first_name, company_name, state, sent_at, delivered_at, first_opened_at, first_clicked_at, unsubscribed_at')
    .eq('campaign_id', id).order('id'), { table: 'marketing_sends' })))
  return all.flat()
}

/** Switched off, never deleted: a campaign that went from it keeps saying who it came from. */
export async function setSenderActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('marketing_senders').update({ active }).eq('id', id)
  if (error) throw new Error(error.message)
}

/* ----------------------------------------- workflows ----------------------------------------- */

export interface WorkflowRow {
  id: string
  name: string
  first_campaign_id: string
  status: 'draft' | 'active' | 'paused' | 'finished'
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface WorkflowStepRow {
  id: string
  workflow_id: string
  position: number
  campaign_id: string
  wait_days: number
  audience: WorkflowAudience
  run_at: string | null
}

export async function listWorkflows(): Promise<{ workflows: WorkflowRow[]; steps: WorkflowStepRow[] }> {
  const [w, s] = await Promise.all([
    supabase.from('marketing_workflows').select('id, name, first_campaign_id, status, created_by, created_at, updated_at').order('created_at', { ascending: false }),
    supabase.from('marketing_workflow_steps').select('id, workflow_id, position, campaign_id, wait_days, audience, run_at').order('position'),
  ])
  if (w.error) throw new Error(w.error.message)
  if (s.error) throw new Error(s.error.message)
  return { workflows: (w.data ?? []) as WorkflowRow[], steps: (s.data ?? []) as WorkflowStepRow[] }
}

export async function createWorkflow(name: string, firstCampaignId: string): Promise<WorkflowRow> {
  const { data, error } = await supabase.from('marketing_workflows').insert({ name: name.trim(), first_campaign_id: firstCampaignId })
    .select('id, name, first_campaign_id, status, created_by, created_at, updated_at').single()
  if (error) throw new Error(error.message)
  return data as WorkflowRow
}

export async function updateWorkflow(id: string, patch: Partial<Pick<WorkflowRow, 'name' | 'status' | 'first_campaign_id'>>): Promise<void> {
  const { error } = await supabase.from('marketing_workflows').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * A FOLLOW-UP IS ITS OWN NEWS CAMPAIGN, written in the ordinary editor: the step only says when it goes
 * and to whom. Its list is never drawn by hand -- the morning run fills it from the email before.
 */
export async function addWorkflowStep(workflow: WorkflowRow, position: number, sendFrom: SendFrom): Promise<WorkflowStepRow> {
  const { data: c, error: ce } = await supabase.from('marketing_campaigns')
    .insert({ name: `${workflow.name} · follow-up ${position}`, kind: 'news', first_approach: false, send_from: sendFrom, audience: { kind: 'all_clients' } })
    .select('id').single()
  if (ce) throw new Error(ce.message)
  const { data, error } = await supabase.from('marketing_workflow_steps')
    .insert({ workflow_id: workflow.id, position, campaign_id: (c as { id: string }).id, wait_days: 7, audience: 'not_opened' })
    .select('id, workflow_id, position, campaign_id, wait_days, audience, run_at').single()
  if (error) throw new Error(error.message)
  return data as WorkflowStepRow
}

export async function updateWorkflowStep(id: string, patch: Partial<Pick<WorkflowStepRow, 'wait_days' | 'audience'>>): Promise<void> {
  const { error } = await supabase.from('marketing_workflow_steps').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function removeWorkflowStep(id: string): Promise<void> {
  const { error } = await supabase.from('marketing_workflow_steps').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** The step a campaign is, if it is one -- the editor then says so instead of offering Send. */
export async function stepOfCampaign(campaignId: string): Promise<(WorkflowStepRow & { workflow: WorkflowRow | null }) | null> {
  const { data } = await supabase.from('marketing_workflow_steps')
    .select('id, workflow_id, position, campaign_id, wait_days, audience, run_at').eq('campaign_id', campaignId).maybeSingle()
  if (!data) return null
  const step = data as WorkflowStepRow
  const { data: w } = await supabase.from('marketing_workflows')
    .select('id, name, first_campaign_id, status, created_by, created_at, updated_at').eq('id', step.workflow_id).maybeSingle()
  return { ...step, workflow: (w as WorkflowRow | null) ?? null }
}

/* -------------------------------------- the results email -------------------------------------- */

export interface ResultsSettings { enabled: boolean; recipients: string[]; after_hours: number }

export async function getResultsSettings(): Promise<ResultsSettings | null> {
  const { data, error } = await supabase.from('marketing_results_settings').select('enabled, recipients, after_hours').eq('id', true).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ResultsSettings | null) ?? null
}

export async function saveResultsSettings(s: ResultsSettings): Promise<void> {
  const { error } = await supabase.from('marketing_results_settings')
    .update(s).eq('id', true).select('id').single()
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
export const previewAudience = (audience: Audience, kind: CampaignKind, sendFrom: SendFrom = 'news', senderAddressId: string | null = null) =>
  call<AudiencePreview>({ step: 'preview', audience, kind, sendFrom, senderAddressId })
export const previewImport = (rows: ProspectRow[]) => call<ImportPreview>({ step: 'import-preview', rows })
export const importList = (rows: ProspectRow[], name: string, fileName: string | null) =>
  call<{ listId: string; written: number; preview: ImportPreview }>({ step: 'import', rows, name, fileName })
export const sendTest = (campaignId: string) => call<{ sentTo: string; from?: string }>({ step: 'test', campaignId })
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

/* ---------------------------------- the opt-in page ---------------------------------- */

export interface OptInState { email: string; optedIn: boolean; status: string }

export async function optInStep(token: string, step: 'status' | 'yes' | 'withdraw'): Promise<OptInState> {
  const res = await fetch('/api/email/opt-in', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, step }),
  })
  const out = await res.json().catch(() => ({})) as OptInState & { error?: string }
  if (!res.ok) throw new Error(out.error ?? `The server answered ${res.status}.`)
  return out
}

/** A follow-up's email, filled from a template: its words, design and picture (the sender stays the workflow's). */
export async function fillCampaignFromTemplate(campaignId: string, t: TemplateRow): Promise<void> {
  const { error } = await supabase.from('marketing_campaigns')
    .update({ subject: t.subject, preheader: t.preheader, body: t.body, image_url: t.image_url, template_id: t.id })
    .eq('id', campaignId).eq('status', 'draft')
  if (error) throw new Error(error.message)
}
