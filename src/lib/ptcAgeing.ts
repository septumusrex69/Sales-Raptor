import type { PtcAgeing } from './trust'

/**
 * THE AGE ANALYSIS (the firm, 10 Oct: "an age analysis that goes from 30, 60 ... days plus"). Aged
 * from the payover date that invoiced the PTC -- a PTC captured on 15 October is invoiced on the
 * 11 November remittance advice and is current from then. Before that day it is not yet invoiced,
 * which is its own column rather than "current", because nothing has been sent to the client.
 */
export type AgeBucket = 'not_yet' | 'current' | 'd31' | 'd61' | 'd91'

export const AGE_LABEL: Record<AgeBucket, string> = {
  not_yet: 'Not yet invoiced',
  current: 'Current (0–30)',
  d31: '31–60 days',
  d61: '61–90 days',
  d91: '90+ days',
}

export const AGE_ORDER: AgeBucket[] = ['not_yet', 'current', 'd31', 'd61', 'd91']

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  return Math.round((b - a) / 86400000)
}

export function ageBucket(since: string, today: string): AgeBucket {
  if (since > today) return 'not_yet'
  const d = daysBetween(since, today)
  return d <= 30 ? 'current' : d <= 60 ? 'd31' : d <= 90 ? 'd61' : 'd91'
}

export interface AgeRow { companyId: string; client: string; total: number; buckets: Record<AgeBucket, number> }

/** One row a client, their debts spread across the buckets; and the column totals. */
export function ageAnalysis(items: PtcAgeing[], today: string): { rows: AgeRow[]; totals: Record<AgeBucket, number>; total: number } {
  const empty = (): Record<AgeBucket, number> => ({ not_yet: 0, current: 0, d31: 0, d61: 0, d91: 0 })
  const by = new Map<string, AgeRow>()
  const totals = empty()
  for (const it of items) {
    const row = by.get(it.companyId) ?? { companyId: it.companyId, client: it.client, total: 0, buckets: empty() }
    const b = ageBucket(it.since, today)
    row.buckets[b] = Math.round((row.buckets[b] + it.owed) * 100) / 100
    row.total = Math.round((row.total + it.owed) * 100) / 100
    totals[b] = Math.round((totals[b] + it.owed) * 100) / 100
    by.set(it.companyId, row)
  }
  const rows = [...by.values()].sort((a, b) => b.total - a.total || a.client.localeCompare(b.client))
  return { rows, totals, total: Math.round(rows.reduce((s, r) => s + r.total, 0) * 100) / 100 }
}
