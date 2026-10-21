/**
 * A CLIENT'S BOOK AT A GLANCE, AS TWO RINGS (S8, 18 Oct). The firm: "two pie charts. The pie chart
 * would show recovered, active, and closed ... withdrawn accounts [not] shown and taken into account
 * ... percentages ... and then shows us the recovery rate. A second ... all of the accounts per
 * status ... payment arrangement, negotiating ... only the active accounts."
 *
 * Pure. The outcomes come from client_account_outcomes (withdrawn already out); the positions are
 * clientPosition over each active account's own fields, the coarse reading the hand-out screen uses
 * -- status, sub-status and Swordfish's bucket -- so the ring and every other screen name an account
 * the same way.
 */
import { CLIENT_POSITION_ORDER, CLIENT_POSITIONS, clientPosition, type ClientPosition } from './clientPosition.ts'

export interface OutcomeRow { outcome: string; accounts: number; capital: number; collected: number }
export interface OutcomeSlice { key: 'recovered' | 'active' | 'closed'; label: string; accounts: number; pct: number }

/*
 * THE MONEY TRAVELS WITH THE COUNTS (19 Oct): `capital` and `collected` over the same accounts, so the
 * recovery rate can be drawn as what it is -- rands against rands -- beside a ring that counts
 * ACCOUNTS. It sat in the ring's centre, where "27%" over a ring that was all one colour read as a
 * chart that had gone wrong.
 */
export function outcomeRing(rows: OutcomeRow[]): {
  slices: OutcomeSlice[]; total: number; recoveryRate: number | null; capital: number; collected: number
} {
  const of = (k: string) => rows.filter((r) => r.outcome === k)
  const n = (k: string) => of(k).reduce((t, r) => t + r.accounts, 0)
  const total = rows.reduce((t, r) => t + r.accounts, 0)
  const capital = rows.reduce((t, r) => t + r.capital, 0)
  const collected = rows.reduce((t, r) => t + r.collected, 0)
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0)
  const slices = ([['recovered', 'Recovered'], ['active', 'Active'], ['closed', 'Closed']] as const)
    .map(([key, label]) => ({ key, label, accounts: n(key), pct: pct(n(key)) }))
  return { slices, total, recoveryRate: capital > 0 ? Math.round((collected / capital) * 100) : null, capital, collected }
}

export interface PositionSlice { position: ClientPosition; label: string; accounts: number; pct: number }

/** The ACTIVE accounts by where they stand, busiest first, in the firm's own words. */
export function positionRing(accounts: { status?: string | null; subStatus?: string | null; bucket?: string | null }[]): PositionSlice[] {
  const counts = new Map<ClientPosition, number>()
  for (const a of accounts) {
    const p = clientPosition({ closed: false, status: a.status, subStatus: a.subStatus, bucket: a.bucket })
    counts.set(p, (counts.get(p) ?? 0) + 1)
  }
  const total = accounts.length
  return [...counts]
    .map(([position, n]) => ({ position, label: CLIENT_POSITIONS[position].label, accounts: n, pct: total ? Math.round((n / total) * 100) : 0 }))
    .sort((a, b) => b.accounts - a.accounts || CLIENT_POSITION_ORDER.indexOf(a.position) - CLIENT_POSITION_ORDER.indexOf(b.position))
}
