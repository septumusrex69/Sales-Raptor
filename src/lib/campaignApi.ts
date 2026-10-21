/**
 * The browser's side of a campaign: ask the server, read the list. No rule lives here -- who is
 * skipped, what it costs, who may run one on which desks are all decided by campaigns.ts on the
 * server (api/_lib/campaign), and this only carries the question and the answer.
 */
import { supabase } from './supabase'
import type { CampaignChannel, FeeEstimate, SkipTally } from './campaigns.ts'
import { resolveIds, type Selection } from './accountAllocation'

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
  channel: CampaignChannel
  status: 'sending' | 'finished' | 'stopped'
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
export async function fetchCampaigns(): Promise<CampaignRow[]> {
  const { data, error } = await supabase.from('campaigns')
    .select('id, name, channel, status, created_at, created_by, created_by_name, team_id, selected, to_send, fee_estimate, note')
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
    channel: r.channel as CampaignChannel,
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
