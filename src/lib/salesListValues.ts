/**
 * THE SALES LISTS, PURE (Raptor H19): no Supabase client and no React, so the import code and the checks can use
 * them in node. The loading and the Settings writes are in salesLists.ts, which re-exports all of this.
 */
import { leadSources as SHIPPED_LEAD_SOURCES } from '../data/mockData.ts'
import { REJECTION_REASONS } from './rejection.ts'
import { DEAL_STAGE_PROBABILITY, DEAL_STAGES, type DealStage } from '../types.ts'

export type SalesList = 'deal_stage' | 'lead_source' | 'rejection_reason'

export interface SalesListItem {
  list: SalesList
  value: string
  position: number
  /** A stage the firm added: its chance of closing. Built-in stages use DEAL_STAGE_PROBABILITY. */
  probability: number | null
  builtIn: boolean
}

/** What every screen had before H19, and still has whenever the saved lists are not there. */
export const FALLBACK_LISTS: Record<SalesList, readonly string[]> = {
  deal_stage: DEAL_STAGES,
  lead_source: SHIPPED_LEAD_SOURCES,
  rejection_reason: REJECTION_REASONS,
}

/** The values Raptor's code uses by name. Mirrors `built_in` in the H19 migration's seed. */
export const BUILT_IN: Record<SalesList, readonly string[]> = {
  deal_stage: DEAL_STAGES,
  lead_source: ['Website', 'Direct', 'Email', 'Imported list', 'Other'],
  rejection_reason: ['Other'],
}

/** The two stages a deal ENDS in. They always come last and are never offered as somewhere to move deals to. */
export const CLOSED_STAGES: readonly string[] = ['Won', 'Rejected']

export type SalesListRow = { list: SalesList; value: string; position: number; probability: number | null; built_in: boolean; removed_at: string | null }

export function toItem(r: SalesListRow): SalesListItem {
  return { list: r.list, value: r.value, position: r.position, probability: r.probability, builtIn: r.built_in }
}

/**
 * One list, in order. Pure: the screens and the checks call the same thing. Removed rows never reach here
 * (the fetch leaves them out). Deal stages always end Won, Rejected -- even if a saved list somehow lacks them,
 * because the deals board, the forecast and the mandate trigger all need them.
 */
export function listValues(items: readonly SalesListItem[] | null, list: SalesList): string[] {
  const mine = (items ?? []).filter((i) => i.list === list)
  if (mine.length === 0) return [...FALLBACK_LISTS[list]]
  const values = [...mine].sort((a, b) => a.position - b.position || a.value.localeCompare(b.value)).map((i) => i.value)
  if (list !== 'deal_stage') return values
  return [...values.filter((v) => !CLOSED_STAGES.includes(v)), ...CLOSED_STAGES]
}

/** The stages a deal is still being worked in: everything but Won and Rejected. */
export function openStages(stages: readonly string[]): string[] {
  return stages.filter((s) => !CLOSED_STAGES.includes(s))
}

/** A stage's chance of closing: the built-in figure, the firm's own for a stage it added, else 40. */
export function stageProbability(stage: DealStage, items: readonly SalesListItem[] | null = cached): number {
  const builtIn = (DEAL_STAGE_PROBABILITY as Record<string, number>)[stage]
  if (builtIn !== undefined) return builtIn
  const saved = (items ?? []).find((i) => i.list === 'deal_stage' && i.value === stage)?.probability
  return saved ?? 40
}

/**
 * A value worked out by an import (sourceFor, rejectionFor) that the firm has since removed from its list becomes
 * 'Other' -- otherwise every re-import would put the removed value back on rows.
 */
export function onListOr(value: string, values: readonly string[], fallback = 'Other'): string {
  return values.includes(value) ? value : fallback
}

/* The saved items as last loaded (null before the first load): salesLists.ts sets it, code that is not a component
   reads it (stageProbability's default, the lead import). */
let cached: SalesListItem[] | null = null
export function salesListsNow(): SalesListItem[] | null { return cached }
export function setSalesListsCache(items: SalesListItem[] | null): void { cached = items }
