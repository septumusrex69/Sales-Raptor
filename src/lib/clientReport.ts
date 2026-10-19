/**
 * THE CLIENT REPORT: WHAT HAPPENED TO A CLIENT'S BOOK, AS A DOCUMENT THEY CAN BE SENT (S9, 19 Oct).
 *
 * The firm sent their own Excel "Collection dashboard" PDF "just ... as a reference ... you can fix
 * all of that". Fixing it meant three things the reference got wrong, each held here rather than in
 * the drawing:
 *
 *   - ITS PERCENTAGES DID NOT ADD UP. Slices labelled 298.95% and 100% on one pie: each was a share
 *     of a different whole. Every percentage here is a share of the ONE total printed under its
 *     column, and the shares are apportioned so they add to exactly 100 (`shares`), so a client
 *     ticking the column off by eye gets 100.0%.
 *   - ITS RING HAD NO LABELS. Here nothing is a picture alone: every chart is drawn over a table of
 *     the same figures.
 *   - PAGE 2 WAS BLANK. The document is laid out from what it holds, so there is no page without
 *     something on it.
 *
 * THE SAME FIGURES AS THE CLIENT PAGE, from the same sources: client_account_outcomes for what
 * became of the accounts (withdrawn left out), clientPosition for where the active ones stand,
 * client_money_by_day through collectionMonths for the collections and the rate, client_intake_by_day
 * through intakeMonthBars for the handovers. A report that disagreed with the screen the liaison has
 * open while the client reads it would be worse than no report.
 *
 * NO COMMISSION, NO FEES. It goes to the client; every figure is their money to recover or a count
 * of their accounts -- the same line the company dashboard holds (CLAUDE.md).
 *
 * PURE: everything comes in, nothing is fetched, and the clock is `today`.
 */
import { outcomeRing, type OutcomeRow } from './clientOutcomes.ts'
import { CLIENT_POSITION_ORDER, CLIENT_POSITIONS, clientPosition, type ClientPosition } from './clientPosition.ts'
import { collectionMonths, type CollectionMonth, type MoneyDay } from './clientCollections.ts'
import type { IntakeBar } from './companySnapshot.ts'

export interface ActiveAccount { status: string | null; subStatus: string | null; bucket: string | null; capital: number }

export interface ClientReportInput {
  client: { name: string; code: string | null }
  /** 'YYYY-MM-DD', Johannesburg. */
  today: string
  outcomes: OutcomeRow[]
  active: ActiveAccount[]
  money: MoneyDay[]
  /** The handovers, already cut into sales months by intakeMonthBars. */
  handovers: IntakeBar[]
  /** How many months the two monthly sections cover. Twelve unless the caller says otherwise. */
  months?: number
}

export interface PositionLine { position: ClientPosition; label: string; accounts: number; capital: number; pct: number }

export interface ClientReport {
  client: { name: string; code: string | null }
  issuedOn: string
  /** The first day anything was handed over, where anything was: the report covers from there. */
  since: string | null
  glance: {
    accounts: number
    capital: number
    collected: number
    recovered: number
    active: number
    closed: number
    /** Collected over handed over, in percent to one place; null with nothing handed over. */
    recoveryRate: number | null
  }
  /** What became of every account, as shares of `glance.accounts`. */
  outcomes: { key: 'recovered' | 'active' | 'closed'; label: string; accounts: number; capital: number; collected: number; pct: number }[]
  /** Where the ACTIVE accounts stand, busiest first, as shares of the active total. */
  positions: PositionLine[]
  positionsTotal: { accounts: number; capital: number }
  collections: CollectionMonth[]
  handovers: { label: string; accounts: number; capital: number }[]
}

/**
 * Shares of a whole, in percent to one place, that ADD TO EXACTLY 100.0 -- the largest-remainder
 * method: each gets its floor in tenths, and the tenths left over go to the largest remainders. The
 * reference printed 298.95% beside 100%; this cannot print anything that does not sum.
 */
export function shares(values: number[]): number[] {
  const total = values.reduce((t, v) => t + v, 0)
  if (total <= 0) return values.map(() => 0)
  const exact = values.map((v) => (v / total) * 1000)
  const floors = exact.map(Math.floor)
  let left = 1000 - floors.reduce((t, v) => t + v, 0)
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    floors[i] += 1
    left -= 1
  }
  return floors.map((f) => f / 10)
}

const cents = (n: number) => Math.round(n * 100) / 100

export function buildClientReport(input: ClientReportInput): ClientReport {
  const months = input.months ?? 12
  const ring = outcomeRing(input.outcomes)
  const of = (k: string) => input.outcomes.filter((r) => r.outcome === k)
  const sum = (rows: OutcomeRow[], f: (r: OutcomeRow) => number) => rows.reduce((t, r) => t + f(r), 0)

  const outcomeKeys = [['recovered', 'Recovered'], ['active', 'Active'], ['closed', 'Closed']] as const
  const outcomePct = shares(outcomeKeys.map(([k]) => sum(of(k), (r) => r.accounts)))
  const outcomes = outcomeKeys.map(([key, label], i) => ({
    key, label,
    accounts: sum(of(key), (r) => r.accounts),
    capital: cents(sum(of(key), (r) => r.capital)),
    collected: cents(sum(of(key), (r) => r.collected)),
    pct: outcomePct[i],
  }))

  /* WHERE THE ACTIVE ONES STAND, in the firm's own words -- the same reading the ring on the client
     page makes, with the capital carried beside each count because the reference showed rands. */
  const byPosition = new Map<ClientPosition, { accounts: number; capital: number }>()
  for (const a of input.active) {
    const p = clientPosition({ closed: false, status: a.status, subStatus: a.subStatus, bucket: a.bucket })
    const cur = byPosition.get(p) ?? { accounts: 0, capital: 0 }
    cur.accounts += 1
    cur.capital += a.capital
    byPosition.set(p, cur)
  }
  const ordered = [...byPosition]
    .sort((a, b) => b[1].accounts - a[1].accounts || CLIENT_POSITION_ORDER.indexOf(a[0]) - CLIENT_POSITION_ORDER.indexOf(b[0]))
  const posPct = shares(ordered.map(([, v]) => v.accounts))
  const positions = ordered.map(([position, v], i) => ({
    position, label: CLIENT_POSITIONS[position].label, accounts: v.accounts, capital: cents(v.capital), pct: posPct[i],
  }))

  const firstDay = [...input.money].filter((m) => m.capital > 0).map((m) => m.day).sort()[0] ?? null

  return {
    client: input.client,
    issuedOn: input.today,
    since: firstDay,
    glance: {
      accounts: ring.total,
      capital: cents(ring.capital),
      collected: cents(ring.collected),
      recovered: outcomes[0].accounts,
      active: outcomes[1].accounts,
      closed: outcomes[2].accounts,
      /* To one place, where the page's ring rounds to a whole number: a document is read slowly. */
      recoveryRate: ring.capital > 0 ? Math.round((ring.collected / ring.capital) * 1000) / 10 : null,
    },
    outcomes,
    positions,
    positionsTotal: {
      accounts: positions.reduce((t, p) => t + p.accounts, 0),
      capital: cents(positions.reduce((t, p) => t + p.capital, 0)),
    },
    collections: collectionMonths(input.money, input.today, months),
    handovers: input.handovers.slice(-months).map((b) => ({ label: b.label, accounts: b.accounts, capital: cents(b.capital) })),
  }
}

/** "Rinda Roo collection report 19 Oct 2026.pdf" -- the client's name first, so a folder of them sorts by client. */
export function clientReportFilename(clientName: string, today: string): string {
  const [y, m, d] = today.split('-').map(Number)
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const clean = clientName.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `${clean} collection report ${d} ${MON[m - 1]} ${y}.pdf`
}
