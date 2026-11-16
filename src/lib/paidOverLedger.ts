/**
 * THE CLIENT LEDGER: every payover that has left the trust account, filed by client (S21 · Raptor H19).
 *
 * Stephan, 9 Nov: "The moment that a pay overrun has been approved and paid, then it should go into the client ledger
 * ... you click on it and it'll show you the list of the clients. Then you can search a client or search a payment ...
 * Then you click on the client ... all the historical payovers. If you click on the historical payover, then it shows
 * you all the payments ... You should also be able to preview the payover report that was sent." And the rule he gave
 * for where a payment is: not allocated; allocated and waiting for a payover (Payover runs); paid over (here).
 *
 * ONE RULE FOR "FINISHED", shared with the Payover runs page (FinanceWorkQueue reads isPaidOver too), so a run is never
 * in both places or in neither: paid; or nothing to pay (nil or below) and the advice gone out, or approved with the
 * shortfall already settled by the client. That is the History tab's old rule, moved, not a new one.
 *
 * PURE: a check holds it.
 */
import type { WorkQueueRow } from './payover'

export function isPaidOver(r: Pick<WorkQueueRow, 'runId' | 'status' | 'netPayover'>, settled: Set<string>): boolean {
  return r.status === 'paid'
    || (r.netPayover <= 0 && (r.status === 'sent' || (r.status === 'approved' && settled.has(r.runId))))
}

export interface LedgerClient {
  companyId: string
  client: string
  clientCode: string | null
  payovers: number
  /** What the payovers carried to the client, below-nil runs included as they stood. */
  paidOver: number
  /** The latest payover's paid day (or the day its advice went, for one with nothing to pay). */
  lastPaid: string | null
}

const r2 = (v: number): number => Math.round(v * 100) / 100
/* THE FIRM'S DAY, NOT UTC'S: a run marked paid at 00:30 on 12 Sep is paid on the 12th in Johannesburg, where the UTC
   timestamp still reads the 11th (the History tab this replaces said so too). */
const JHB_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' })
const dayOf = (r: Pick<WorkQueueRow, 'paidAt' | 'sentAt' | 'approvedAt'>): string | null => {
  const at = r.paidAt ?? r.sentAt ?? r.approvedAt
  return at ? JHB_DAY.format(new Date(at)) : null
}

/** The finished runs, one row per client, the most recently paid first. */
export function ledgerClients(rows: WorkQueueRow[], settled: Set<string>): LedgerClient[] {
  const by = new Map<string, LedgerClient>()
  for (const r of rows) {
    if (!isPaidOver(r, settled)) continue
    const c = by.get(r.companyId) ?? { companyId: r.companyId, client: r.client, clientCode: r.clientCode, payovers: 0, paidOver: 0, lastPaid: null }
    c.payovers += 1
    c.paidOver = r2(c.paidOver + r.netPayover)
    const d = dayOf(r)
    if (d && (!c.lastPaid || d > c.lastPaid)) c.lastPaid = d
    by.set(r.companyId, c)
  }
  return [...by.values()].sort((a, b) => (b.lastPaid ?? '').localeCompare(a.lastPaid ?? '') || a.client.localeCompare(b.client))
}

/** One client's finished payovers, newest cycle first. */
export function clientPayovers(rows: WorkQueueRow[], settled: Set<string>, companyId: string): WorkQueueRow[] {
  return rows.filter((r) => r.companyId === companyId && isPaidOver(r, settled))
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
}

/** A client found by what somebody types: the name or the code, anywhere in it. */
export function matchesClient(c: Pick<LedgerClient, 'client' | 'clientCode'>, q: string): boolean {
  const t = q.trim().toLowerCase()
  if (!t) return true
  return c.client.toLowerCase().includes(t) || (c.clientCode ?? '').toLowerCase().includes(t)
}

export { dayOf as payoverDay }
