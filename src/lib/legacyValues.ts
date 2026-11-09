import { DEAL_STAGES } from '../types.ts'
import { LEAD_STATUSES } from './leadStatus.ts'
import type { Deal, DealStage, Lead, LeadStatus } from '../types'

/**
 * Old values that rows may still carry, from before a vocabulary was simplified.
 *
 * These matter more than they look. A row holding a stage no longer in the list renders in no
 * column at all — it doesn't fall to the end, it disappears — and a deal you can't see is
 * worse than one filed under the wrong heading. Rows can also arrive from a browser tab still
 * running the previous build, so this can't be treated as a one-off migration that's now done.
 */
const LEGACY_DEAL_STAGES: Record<string, DealStage> = {
  'New Lead': 'New Deal',
  Contacted: 'New Deal',
  Qualified: 'New Deal',
  'Proposal Sent': 'Quotation Sent',
  Negotiation: 'Quotation Sent',
  'Invoice Sent': 'Quotation Sent',
  // Before mandates had a stage of their own, a handover awaiting one sat here.
  'Quotation / Mandate Sent': 'Quotation Sent',
  Lost: 'Rejected',
}

const LEGACY_LEAD_STATUSES: Record<string, LeadStatus> = {
  New: 'No Contact Yet',
  'Attempting Contact': 'No Contact Yet',
  Contacted: 'Interested',
  Qualified: 'Hot Lead',
  'Proposal Required': 'Hot Lead',
  Unqualified: 'Rejected',
  Lost: 'Rejected',
}

/**
 * `stages` is the firm's saved pipeline (Settings -> Pipelines, Raptor H19): a stage the firm added is a real stage,
 * never a retired one -- even when it is spelled like one ("Negotiation"). Without it, the shipped five.
 */
export function normalizeDeal(deal: Deal, stages: readonly string[] = DEAL_STAGES): Deal {
  if ((DEAL_STAGES as string[]).includes(deal.stage) || stages.includes(deal.stage)) return deal
  // A stage that is neither the firm's nor a retired one is kept as it is (the board gives it a column of its own):
  // since H19 that is a stage the firm added whose list did not load, and renaming it here would hide it.
  const stage = LEGACY_DEAL_STAGES[deal.stage as string]
  if (!stage) return deal
  console.warn(`[AppStore] deal ${deal.id} has unknown stage "${deal.stage}" — showing it as "${stage}"`)
  return { ...deal, stage }
}

export function normalizeLead(lead: Lead): Lead {
  if ((LEAD_STATUSES as string[]).includes(lead.status)) return lead
  const status = LEGACY_LEAD_STATUSES[lead.status as string] ?? 'No Contact Yet'
  console.warn(`[AppStore] lead ${lead.id} has unknown status "${lead.status}" — showing it as "${status}"`)
  return { ...lead, status }
}
