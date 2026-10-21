/**
 * The browser's side of a campaign: ask the server, read the list. No rule lives here -- who is
 * skipped, what it costs, who may run one on which desks are all decided by campaigns.ts on the
 * server (api/_lib/campaign), and this only carries the question and the answer.
 */
import { supabase } from './supabase'
import type { CampaignChannel, FeeEstimate, SkipTally } from './campaigns.ts'
import { resolveIds, type Selection } from './accountAllocation'
import type { CallMode } from './callCampaign.ts'

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

export interface CallDraft { mode: CallMode; rank: number; endsOn: string | null; script: string }

export interface CallPreview {
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
    if (r.state === 'done') row.worked += 1
    else if (r.state === 'open') row.waiting += 1
    else row.missed += 1
    by.set(key, row)
  }
  return [...by.values()].sort((a, b) => a.ownerName.localeCompare(b.ownerName))
}

export async function fetchCampaigns(): Promise<CampaignRow[]> {
  const { data, error } = await supabase.from('campaigns')
    .select('id, name, channel, status, created_at, created_by, created_by_name, team_id, selected, to_send, fee_estimate, note, call_mode, call_rank, ends_on, unplaced')
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
