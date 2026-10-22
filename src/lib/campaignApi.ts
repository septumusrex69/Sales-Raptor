/**
 * The browser's side of a campaign: ask the server, read the list. No rule lives here -- who is
 * skipped, what it costs, who may run one on which desks are all decided by campaigns.ts on the
 * server (api/_lib/campaign), and this only carries the question and the answer.
 */
import { supabase } from './supabase'
import type { CampaignChannel, FeeEstimate, SkipTally } from './campaigns.ts'
import { resolveIds, type Selection } from './accountAllocation'
import type { CallKind, CallMode } from './callCampaign.ts'

export interface CampaignDraft {
  channel: CampaignChannel
  templateId: string | null
  subject: string | null
  body: string
}

export interface CampaignPreview {
  selected: number
  found: number
  outOfScope: number
  sending: number
  skipped: number
  skips: SkipTally[]
  sample: null | {
    accountId: string; caseNumber: string | null; debtor: string | null
    text: string; subject: string | null; html: string | null
    segments: number | null; encoding: string | null; missing: string[]
  }
  estimate: FeeEstimate
  estimateWords: string
  atMonthlyLimit: number
  mailbox: string | null
  hoursProblem: string | null
  wordingProblem: string | null
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('You are signed out. Sign in again and retry.')
  const res = await fetch('/api/workflow/campaign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const out = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string }
  if (!res.ok || !out.ok) throw new Error(out.error ?? 'The campaign could not be reached.')
  return out
}

/**
 * THE ACCOUNTS A SELECTION MEANS, through the hand-out's own resolver -- applyAccountFilters for
 * "all N matching", counted and then fetched, refusing if the two disagree. So the campaign goes to
 * exactly the accounts the list showed, by the same clauses, and never to a page of them.
 */
export async function campaignAccountIds(selection: Selection): Promise<string[]> {
  return resolveIds(selection)
}

export function previewCampaign(draft: CampaignDraft, accountIds: string[]): Promise<CampaignPreview> {
  return call<CampaignPreview>({ op: 'preview', ...draft, accountIds })
}

export function createCampaign(
  draft: CampaignDraft, accountIds: string[], name: string, selection: Selection,
): Promise<{ campaignId: string; sending: number; skipped: number }> {
  /* The selection is stored as the record of what was asked; the ids are what the server checks. */
  const snapshot = selection.kind === 'matching' ? { kind: 'matching', query: selection.query } : { kind: 'ids', count: accountIds.length }
  return call({ op: 'create', ...draft, accountIds, name, selection: snapshot })
}

/* ---------- a call campaign: onto the diaries, not out of a mailbox ---------- */

export interface CallDraft {
  mode: CallMode; rank: number; endsOn: string | null; script: string
  /* 22 Oct: what the campaign asks for, who works it, which write-off reasons, which book. */
  kind: CallKind
  collectorIds: string[]
  reasons: string[]
  traceTarget: 'live' | 'closed'
}

export interface CallPreview {
  kind: CallKind
  badCollectors: number
  /** A trace campaign's estimate: one credit bureau search per account, item 4(c). Null otherwise. */
  traceEstimate: { item: string; perSearch: number; total: number; citation: string } | null
  selected: number
  found: number
  outOfScope: number
  placing: number
  unplaced: number
  skipped: number
  skips: SkipTally[]
  collectors: { name: string; calls: number; unplaced: number; over: number }[]
  overCollectors: number
  today: string
  endsOn: string
  dateProblem: string | null
}

export function previewCallCampaign(draft: CallDraft, accountIds: string[]): Promise<CallPreview> {
  return call<CallPreview>({ op: 'call-preview', ...draft, accountIds })
}

export function createCallCampaign(
  draft: CallDraft, accountIds: string[], name: string, selection: Selection,
): Promise<{ campaignId: string; placing: number; skipped: number; unplaced: number }> {
  const snapshot = selection.kind === 'matching' ? { kind: 'matching', query: selection.query } : { kind: 'ids', count: accountIds.length }
  return call({ op: 'call-create', ...draft, accountIds, name, selection: snapshot })
}

export interface SendPass {
  outsideHours: string | null
  sent: number; skipped: number; failed: number; returned: number
  campaigns: { id: string; status: string; note: string | null }[]
}

export function sendCampaignPass(campaignId: string): Promise<SendPass> {
  return call<SendPass>({ op: 'send', campaignId })
}

export function stopCampaign(campaignId: string): Promise<{ cancelled: number }> {
  return call({ op: 'stop', campaignId })
}

export interface CampaignRow {
  id: string
  name: string
  channel: CampaignChannel | 'call'
  status: 'sending' | 'finished' | 'stopped'
  /* A call campaign's shape; null on a message campaign. */
  callKind: CallKind | null
  callMode: CallMode | null
  callRank: number | null
  endsOn: string | null
  unplaced: number
  createdAt: string
  createdBy: string | null
  createdByName: string | null
  teamId: string | null
  selected: number
  toSend: number
  feeEstimate: number | null
  note: string | null
  counts: { pending: number; sending: number; sent: number; skipped: number; failed: number; cancelled: number; fees: number }
}

const NO_COUNTS = { pending: 0, sending: 0, sent: 0, skipped: 0, failed: 0, cancelled: 0, fees: 0 }

/** The campaigns this person may see (RLS decides), newest first, with their live counts. */
/** A call campaign's calls by collector: worked, waiting, missed. RLS lets anybody read the diary. */
export async function fetchCallProgress(campaignId: string): Promise<{ ownerId: string | null; ownerName: string; worked: number; waiting: number; missed: number }[]> {
  const { data, error } = await supabase.from('diary_entries')
    .select('owner_id, state, profiles!diary_entries_owner_id_fkey(name)')
    .eq('campaign_id', campaignId).limit(5000)
  if (error) throw new Error(error.message)
  const by = new Map<string, { ownerId: string | null; ownerName: string; worked: number; waiting: number; missed: number }>()
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const key = (r.owner_id as string) ?? ''
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
    const row = by.get(key) ?? { ownerId: (r.owner_id as string) ?? null, ownerName: ((p as { name?: string } | null)?.name) ?? 'Nobody', worked: 0, waiting: 0, missed: 0 }
    /* A MOVED call is one handed to the next collector with the account; theirs is the one that is
       worked or missed, so the moved one is not counted at all (campaign_counts does the same). */
    if (r.state === 'moved') continue
    if (r.state === 'done') row.worked += 1
    else if (r.state === 'open') row.waiting += 1
    else row.missed += 1
    by.set(key, row)
  }
  return [...by.values()].sort((a, b) => a.ownerName.localeCompare(b.ownerName))
}

export async function fetchCampaigns(): Promise<CampaignRow[]> {
  const { data, error } = await supabase.from('campaigns')
    .select('id, name, channel, status, created_at, created_by, created_by_name, team_id, selected, to_send, fee_estimate, note, call_kind, call_mode, call_rank, ends_on, unplaced')
    .order('created_at', { ascending: false }).limit(200)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as Record<string, unknown>[]
  const ids = rows.map((r) => r.id as string)
  const counts = new Map<string, CampaignRow['counts']>()
  if (ids.length > 0) {
    const { data: c, error: ce } = await supabase.rpc('campaign_counts', { p_ids: ids })
    if (ce) throw new Error(ce.message)
    for (const r of (c ?? []) as Record<string, unknown>[]) {
      counts.set(r.campaign_id as string, {
        pending: Number(r.pending ?? 0), sending: Number(r.sending ?? 0), sent: Number(r.sent ?? 0),
        skipped: Number(r.skipped ?? 0), failed: Number(r.failed ?? 0), cancelled: Number(r.cancelled ?? 0),
        fees: Number(r.fees ?? 0),
      })
    }
  }
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    channel: r.channel as CampaignRow['channel'],
    callKind: (r.call_kind as CallKind) ?? null,
    callMode: (r.call_mode as CallMode) ?? null,
    callRank: r.call_rank === null || r.call_rank === undefined ? null : Number(r.call_rank),
    endsOn: (r.ends_on as string) ?? null,
    unplaced: Number(r.unplaced ?? 0),
    status: r.status as CampaignRow['status'],
    createdAt: r.created_at as string,
    createdBy: (r.created_by as string) ?? null,
    createdByName: (r.created_by_name as string) ?? null,
    teamId: (r.team_id as string) ?? null,
    selected: Number(r.selected ?? 0),
    toSend: Number(r.to_send ?? 0),
    /* numeric comes back from PostgREST as a string -- CLAUDE.md's silent trap. */
    feeEstimate: r.fee_estimate === null || r.fee_estimate === undefined ? null : Number(r.fee_estimate),
    note: (r.note as string) ?? null,
    counts: counts.get(r.id as string) ?? NO_COUNTS,
  }))
}

/* ---------- the closed book, the results, and the one press that wins an account back (22 Oct) ---------- */

/** One write-off reason in a selection, with how many accounts a recovery could take for it. */
export interface ReasonCount { key: string; source: 'raptor' | 'imported' | 'none'; label: string; accounts: number }

/**
 * THE WRITE-OFF REASONS IN THESE ACCOUNTS, counted in the database (recovery_reasons) over the ids
 * the box already resolved -- never by loading the book into the browser.
 */
export async function fetchRecoveryReasons(accountIds: string[]): Promise<ReasonCount[]> {
  if (accountIds.length === 0) return []
  const { data, error } = await supabase.rpc('recovery_reasons', { p_ids: accountIds })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    key: String(r.reason_key), source: (r.source as ReasonCount['source']) ?? 'none',
    label: String(r.label ?? ''), accounts: Number(r.accounts ?? 0),
  }))
}

/**
 * "DEBTOR AGREED TO PAY -- RE-OPEN AND KEEP IT." The collector's own press on a recovery call; the
 * database refuses it to anybody without an open recovery call on the account (recovery_reopen).
 */
export async function recoveryReopen(accountId: string): Promise<void> {
  const { error } = await supabase.rpc('recovery_reopen', { p_account: accountId })
  if (error) throw new Error(error.message)
}

/** One campaign's results, as everybody may read them: no fees, no estimate (campaign_results). */
export interface CampaignResult {
  id: string
  name: string
  channel: 'sms' | 'email' | 'call'
  callKind: CallKind | null
  callMode: CallMode | null
  status: 'sending' | 'finished' | 'stopped'
  createdByName: string | null
  createdAt: string
  startsOn: string | null
  endsOn: string | null
  selected: number
  skipped: number
  sent: number
  failed: number
  worked: number
  waiting: number
  missed: number
  unplaced: number
  ptps: number
  ptpAmount: number
  reopened: number
}

export async function fetchCampaignResults(): Promise<CampaignResult[]> {
  const { data, error } = await supabase.rpc('campaign_results')
  if (error) throw new Error(error.message)
  const n = (v: unknown) => Number(v ?? 0)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.campaign_id), name: String(r.name ?? ''), channel: r.channel as CampaignResult['channel'],
    callKind: (r.call_kind as CallKind) ?? null, callMode: (r.call_mode as CallMode) ?? null,
    status: r.status as CampaignResult['status'], createdByName: (r.created_by_name as string) ?? null,
    createdAt: String(r.created_at), startsOn: (r.starts_on as string) ?? null, endsOn: (r.ends_on as string) ?? null,
    selected: n(r.selected), skipped: n(r.skipped), sent: n(r.sent), failed: n(r.failed),
    worked: n(r.worked), waiting: n(r.waiting), missed: n(r.missed), unplaced: n(r.unplaced),
    /* numeric arrives as a string from PostgREST -- CLAUDE.md's silent trap. */
    ptps: n(r.ptps), ptpAmount: n(r.ptp_amount), reopened: n(r.reopened),
  }))
}

export interface CollectorResult {
  ownerId: string | null; ownerName: string; worked: number; waiting: number; missed: number
  ptps: number; ptpAmount: number; reopened: number
}

export async function fetchResultsByCollector(campaignId: string): Promise<CollectorResult[]> {
  const { data, error } = await supabase.rpc('campaign_results_by_collector', { p_campaign: campaignId })
  if (error) throw new Error(error.message)
  const n = (v: unknown) => Number(v ?? 0)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ownerId: (r.owner_id as string) ?? null, ownerName: String(r.owner_name ?? 'Nobody'),
    worked: n(r.worked), waiting: n(r.waiting), missed: n(r.missed),
    ptps: n(r.ptps), ptpAmount: n(r.ptp_amount), reopened: n(r.reopened),
  }))
}

/** One account in a trace campaign, and how far the trace has got it (trace_campaign_funnel). */
export interface TraceFunnelRow {
  accountId: string; caseNumber: string | null; debtor: string | null
  referredAt: string; searchedAt: string | null; detailsAt: string | null; contactAt: string | null
  promisedAt: string | null; promised: number; paid: number
}

export async function fetchTraceFunnel(campaignId: string): Promise<TraceFunnelRow[]> {
  const { data, error } = await supabase.rpc('trace_campaign_funnel', { p_campaign: campaignId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    accountId: String(r.account_id), caseNumber: (r.case_number as string) ?? null, debtor: (r.debtor as string) ?? null,
    referredAt: String(r.referred_at), searchedAt: (r.searched_at as string) ?? null,
    detailsAt: (r.details_at as string) ?? null, contactAt: (r.contact_at as string) ?? null,
    promisedAt: (r.promised_at as string) ?? null, promised: Number(r.promised ?? 0), paid: Number(r.paid ?? 0),
  }))
}

/**
 * THIS PERSON'S OPEN RECOVERY CALL ON AN ACCOUNT, or null -- what decides whether the account page
 * offers "Debtor agreed to pay". The database asks the same question again when it is pressed.
 */
export async function fetchMyRecoveryCall(accountId: string, userId: string): Promise<{
  entryId: string; campaignName: string; running: boolean
} | null> {
  const { data, error } = await supabase.from('diary_entries')
    .select('id, campaigns!diary_entries_campaign_id_fkey ( name, call_kind, status )')
    .eq('account_id', accountId).eq('state', 'open').eq('kind', 'campaign').eq('owner_id', userId)
    .limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  const c = (data as { id: string; campaigns: { name: string; call_kind: string | null; status: string } | null } | null)
  if (!c?.campaigns || c.campaigns.call_kind !== 'recovery') return null
  return { entryId: c.id, campaignName: c.campaigns.name, running: c.campaigns.status === 'sending' }
}
