/**
 * Minimal URL-param plumbing for dashboard drill-down links. Deliberately
 * not a generic filter-sync framework — just link-building on the
 * dashboard side and one-time initial-value reads on the list-page side.
 * See LeadsList/DealsBoard/ActivitiesPage/TasksPage for the read side.
 */

export const SALES_MONTH_PARAM = 'salesMonth'

export function buildDrilldownUrl(basePath: string, params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams()
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== '') usp.set(key, val)
  }
  const qs = usp.toString()
  return qs ? `${basePath}?${qs}` : basePath
}

export function readParam(searchParams: URLSearchParams, key: string): string | undefined {
  return searchParams.get(key) ?? undefined
}
