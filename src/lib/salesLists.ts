/**
 * THE SALES LISTS THE FIRM KEEPS: deal stages, lead sources, rejection reasons (Raptor H19).
 *
 * Until H19 the Settings tabs for these held what was typed in React state and the app read hard-coded lists
 * (DEAL_STAGES, mockData's leadSources, REJECTION_REASONS). Now they are rows in `sales_list_items`, written only
 * through the database's sales_list_* functions, and every screen that offers one of these lists reads it here.
 *
 * Stephan, 9 Nov: the Administrators and the Sales Manager change them; a value still on leads or deals is MOVED,
 * never orphaned (removing one in use asks where its rows go; a rename renames it on every row).
 *
 * THE OLD CONSTANTS ARE THE FALLBACK: before the lists have loaded, if they fail to load, or if a list comes back
 * empty, every screen gets exactly the list it had before H19. A pick list is never empty.
 *
 * BUILT-IN values are the ones Raptor's own code writes or reasons about by name (the five stages, the sources
 * Raptor stamps itself, the reason 'Other'): never renamed or removed. The database refuses it as well.
 */
import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { listValues, openStages, salesListsNow, setSalesListsCache, toItem, type SalesList, type SalesListItem, type SalesListRow } from './salesListValues'

export * from './salesListValues'

/* ------------------------------------------------------------------ loading (one fetch, shared) */

let inflight: Promise<SalesListItem[] | null> | null = null
const listeners = new Set<(items: SalesListItem[] | null) => void>()

/** NEVER THROWS: a failed load gives null, and listValues then gives the shipped lists. */
export async function fetchSalesLists(): Promise<SalesListItem[] | null> {
  const { data, error } = await supabase.from('sales_list_items')
    .select('list, value, position, probability, built_in, removed_at')
    .is('removed_at', null)
  if (error || !data) return null
  return (data as SalesListRow[]).map(toItem)
}

export function loadSalesLists(force = false): Promise<SalesListItem[] | null> {
  const cached = salesListsNow()
  if (cached && !force) return Promise.resolve(cached)
  if (inflight && !force) return inflight
  inflight = fetchSalesLists().then((items) => {
    if (items) setSalesListsCache(items)
    inflight = null
    for (const l of listeners) l(salesListsNow())
    return salesListsNow()
  })
  return inflight
}

export interface SalesLists {
  items: SalesListItem[] | null
  stages: string[]
  openStages: string[]
  sources: string[]
  reasons: string[]
}

export function salesListsFrom(items: SalesListItem[] | null): SalesLists {
  const stages = listValues(items, 'deal_stage')
  return {
    items,
    stages,
    openStages: openStages(stages),
    sources: listValues(items, 'lead_source'),
    reasons: listValues(items, 'rejection_reason'),
  }
}

/** The lists for a component. Starts on whatever is loaded (the shipped lists before that) and follows changes. */
export function useSalesLists(): SalesLists {
  const [items, setItems] = useState<SalesListItem[] | null>(salesListsNow)
  useEffect(() => {
    listeners.add(setItems)
    void loadSalesLists()
    return () => { listeners.delete(setItems) }
  }, [])
  return useMemo(() => salesListsFrom(items), [items])
}

/* ------------------------------------------------------------------ changing them (Settings) */

async function call(fn: string, args: Record<string, unknown>): Promise<number> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  await loadSalesLists(true)
  return typeof data === 'number' ? data : 0
}

export const addListValue = (list: SalesList, value: string, probability?: number) =>
  call('sales_list_add', { p_list: list, p_value: value, p_probability: probability ?? null })
/** Returns how many leads and deals were renamed with it. */
export const renameListValue = (list: SalesList, from: string, to: string) =>
  call('sales_list_rename', { p_list: list, p_old: from, p_new: to })
/** Refused while rows use it unless `moveTo` is given; returns how many rows were moved. */
export const removeListValue = (list: SalesList, value: string, moveTo?: string) =>
  call('sales_list_remove', { p_list: list, p_value: value, p_move_to: moveTo ?? null })
export const reorderList = (list: SalesList, values: string[]) =>
  call('sales_list_reorder', { p_list: list, p_values: values })
export const setStageProbability = (stage: string, probability: number) =>
  call('sales_list_set_probability', { p_value: stage, p_probability: probability })

/** How many leads and deals use each value (what the tab shows, and what a removal would move). */
export async function fetchListUsage(list: SalesList): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('sales_list_usage', { p_list: list })
  if (error || !data) return {}
  return Object.fromEntries((data as { value: string; uses: number }[]).map((r) => [r.value, Number(r.uses)]))
}

/** Who may change them -- the screen's half of sales_list_editor() (Stephan, 9 Nov). */
export function mayEditSalesLists(role: string | undefined): boolean {
  return role === 'Administrator' || role === 'Sales Manager'
}
