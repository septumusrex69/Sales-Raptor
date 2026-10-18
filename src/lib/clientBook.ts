/**
 * THE SALES AND COMMUNICATIONS DASHBOARDS, REBUILT AROUND THE DEBT-COLLECTION WORK (S8, 18 Oct).
 *
 * The firm, of the sales dashboard: "I think we should focus more on the debt collection side. And
 * then secondary, the additional revenue one." And of Communications: handovers received, the top
 * clients, recovery rate, who has gone quiet, how many clients were touched -- and profitability as a
 * HIGH / MEDIUM / LOW band, not a rand figure.
 *
 * Pure: the pages fetch (client_book_summary, company_intake_by_day; leads, deals and activities are
 * already in AppStore) and this arranges. No figure here is the firm's income -- the value band is
 * decided in the database and only the word leaves it.
 */
import { dealKind } from './dealKind.ts'
import { getPreviousSalesMonth, isWithinPeriod, type SalesMonthPeriod } from './salesMonth.ts'
import type { Activity, Deal, Lead } from '../types'
import type { IntakeRow } from './companySnapshot.ts'

/** One client's book, as client_book_summary returns it. */
export interface ClientBook {
  companyId: string
  name: string
  ownerId: string | null
  mandateSignedAt: string | null
  firstHandover: string | null
  lastHandover: string | null
  accounts: number
  capital: number
  collected: number
  periodAccounts: number
  periodCapital: number
  valueBand: 'High' | 'Medium' | 'Low' | null
}

export function toClientBook(r: Record<string, unknown>): ClientBook {
  const n = (v: unknown) => Number(v ?? 0)
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
  const band = s(r.value_band)
  return {
    companyId: String(r.company_id), name: String(r.name ?? ''), ownerId: s(r.account_owner_id),
    mandateSignedAt: s(r.mandate_signed_at), firstHandover: s(r.first_handover)?.slice(0, 10) ?? null,
    lastHandover: s(r.last_handover)?.slice(0, 10) ?? null,
    accounts: n(r.accounts), capital: n(r.capital), collected: n(r.collected),
    periodAccounts: n(r.period_accounts), periodCapital: n(r.period_capital),
    valueBand: band === 'High' || band === 'Medium' || band === 'Low' ? band : null,
  }
}

/** Collected as a share of capital handed over, a whole percent; null with nothing handed over. */
export function recoveryRate(c: Pick<ClientBook, 'capital' | 'collected'>): number | null {
  return c.capital > 0 ? Math.round((c.collected / c.capital) * 100) : null
}

/* ------------------------------------------------------------------ the months, side by side */

/** One sales month on the track record. */
export interface MonthTrack {
  key: string
  label: string
  /** Short axis label: "Oct", or "Oct 25" across a year end. */
  short: string
  leads: number
  mandates: number
  /** Mandates signed as a share of leads created that month, a whole percent; null with no leads. */
  closingRate: number | null
  newAccounts: number
  newCapital: number
  existingAccounts: number
  existingCapital: number
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * THE TRACK RECORD (the firm: "January ... there was 100 leads ... 50 mandates have been signed ... two
 * colors in the same staff ... for a year or 6 months ... interchangeable"). One row a sales month,
 * oldest first, ending with `current`: leads created, mandates signed (handover deals WON in the month),
 * the closing rate, and the handovers that arrived from new and from existing clients.
 *
 * CLOSING RATE IS MANDATES OVER LEADS IN THE SAME MONTH -- the firm's own words ("how many mandates
 * have been signed ... the closing rate"). A mandate signed in March from a January lead counts in
 * March; over a run of months the two even out, and a per-cohort rate is already on the page (Deal
 * outcomes). `owners`, when given, keeps leads and deals to those reps; the handovers are the firm's.
 */
export function monthTrack(input: {
  current: SalesMonthPeriod
  months: number
  leads: Pick<Lead, 'createdAt' | 'ownerId'>[]
  deals: Pick<Deal, 'stage' | 'wonAt' | 'kind' | 'service' | 'ownerId'>[]
  intake: IntakeRow[]
  owners?: Set<string>
}): MonthTrack[] {
  const periods: SalesMonthPeriod[] = []
  let p = input.current
  for (let i = 0; i < input.months; i++) { periods.unshift(p); p = getPreviousSalesMonth(p) }
  const mine = <T extends { ownerId: string }>(x: T) => !input.owners || input.owners.has(x.ownerId)
  const leads = input.leads.filter(mine)
  const mandates = input.deals.filter((d) => mine(d) && d.stage === 'Won' && d.wonAt && dealKind(d) === 'Handover')
  const spans = new Set(periods.map((x) => x.end.getFullYear())).size > 1
  return periods.map((period) => {
    const l = leads.filter((x) => isWithinPeriod(x.createdAt, period)).length
    const m = mandates.filter((x) => isWithinPeriod(x.wonAt, period)).length
    const rows = input.intake.filter((r) => isWithinPeriod(`${r.day.slice(0, 10)}T12:00:00`, period))
    const sum = (f: (r: IntakeRow) => number) => rows.reduce((t, r) => t + f(r), 0)
    const newAccounts = sum((r) => r.newAccounts ?? 0)
    const newCapital = sum((r) => r.newCapital ?? 0)
    const month = period.end.getMonth()
    return {
      key: period.key, label: period.label,
      short: spans ? `${MON[month]} ${String(period.end.getFullYear()).slice(2)}` : MON[month],
      leads: l, mandates: m, closingRate: l > 0 ? Math.round((m / l) * 100) : null,
      newAccounts, newCapital,
      existingAccounts: sum((r) => r.accounts) - newAccounts,
      existingCapital: sum((r) => r.capital ?? 0) - newCapital,
    }
  })
}

/* ------------------------------------------------------------------ clients */

/**
 * GONE QUIET (the firm: "the clients that's gone quiet, who hasn't handed over in 60 or 90 days").
 * Clients that HAVE handed over and whose last handover is older than `days`, the longest silent
 * first. A client that never handed over is the other list (signed, nothing handed over yet).
 */
export function goneQuiet(books: ClientBook[], todayIso: string, days: number): (ClientBook & { silentDays: number })[] {
  const day = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / 86_400_000 }
  return books
    .filter((b) => b.lastHandover)
    .map((b) => ({ ...b, silentDays: day(todayIso) - day(b.lastHandover as string) }))
    .filter((b) => b.silentDays > days)
    .sort((a, b) => b.silentDays - a.silentDays)
}

export type ClientSort = 'period' | 'capital' | 'recovery'

/**
 * THE TOP CLIENTS, by what the person reading wants to rank on: handed over this period, capital
 * handed over in all, or recovery rate (only clients with something handed over, so a client with
 * one paid R500 account does not top a list of serious books at 100%: at least five accounts).
 */
export function topClients(books: ClientBook[], by: ClientSort, n = 10): ClientBook[] {
  const list = by === 'period' ? books.filter((b) => b.periodAccounts > 0)
    : by === 'recovery' ? books.filter((b) => b.accounts >= 5 && b.capital > 0) : books.filter((b) => b.accounts > 0)
  const key = (b: ClientBook) => by === 'period' ? b.periodCapital : by === 'capital' ? b.capital : (recoveryRate(b) ?? -1)
  return [...list].sort((a, b) => key(b) - key(a) || b.capital - a.capital).slice(0, n)
}

/**
 * CLIENTS TOUCHED (the firm: "how many clients have they touched ... how many unique clients ... and if a
 * courtesy call was logged on a client"). Unique clients with any logged activity in the period, and
 * of those, how many had a courtesy call -- read off activities, so a sub-account rolls up through
 * `topOf` to the client the clerk looks after.
 */
export function clientsTouched(
  activities: Pick<Activity, 'companyId' | 'type' | 'activityDate' | 'userId'>[],
  period: SalesMonthPeriod,
  people: Set<string>,
  topOf: (companyId: string) => string,
): { touched: number; courtesy: number; touchedIds: Set<string> } {
  const touchedIds = new Set<string>()
  const courtesyIds = new Set<string>()
  for (const a of activities) {
    if (!a.companyId || !people.has(a.userId) || !isWithinPeriod(a.activityDate, period)) continue
    const top = topOf(a.companyId)
    touchedIds.add(top)
    if (a.type === 'Courtesy Call') courtesyIds.add(top)
  }
  return { touched: touchedIds.size, courtesy: courtesyIds.size, touchedIds }
}

/**
 * DAYS FROM MANDATE TO FIRST HANDOVER, per rep -- whether a rep signs clients that actually send work.
 * A won handover deal on a client, and that client's first account: the gap in days, averaged per rep.
 * A mandate still waiting is not averaged in (it would read as fast); it is counted as waiting.
 */
export function mandateToHandover(
  deals: Pick<Deal, 'stage' | 'wonAt' | 'kind' | 'service' | 'ownerId' | 'companyId'>[],
  firstHandoverOf: (companyId: string) => string | null,
  span?: Pick<SalesMonthPeriod, 'start' | 'end'>,
): Map<string, { avgDays: number | null; handedOver: number; waiting: number }> {
  const out = new Map<string, { total: number; handedOver: number; waiting: number }>()
  const day = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / 86_400_000 }
  for (const d of deals) {
    if (d.stage !== 'Won' || !d.wonAt || dealKind(d) !== 'Handover' || !d.companyId) continue
    if (span && (new Date(d.wonAt) < span.start || new Date(d.wonAt) > span.end)) continue
    const row = out.get(d.ownerId) ?? { total: 0, handedOver: 0, waiting: 0 }
    const first = firstHandoverOf(d.companyId)
    if (first && first >= d.wonAt.slice(0, 10)) { row.total += day(first) - day(d.wonAt); row.handedOver += 1 }
    else if (!first) row.waiting += 1
    out.set(d.ownerId, row)
  }
  return new Map([...out].map(([k, v]) => [k, { avgDays: v.handedOver ? Math.round(v.total / v.handedOver) : null, handedOver: v.handedOver, waiting: v.waiting }]))
}

/* ------------------------------------------------------------------ where mandates come from */

export interface SourceRow {
  source: string
  leads: number
  mandates: number
  /** Mandates as a share of leads from that source, a whole percent; null with no leads. */
  rate: number | null
}

/**
 * WHICH LEAD SOURCES TURN INTO MANDATES (the firm, 18 Oct: "which lead sources ... you can continue
 * with that"). Over a span of months, per source: leads created, and debt-collection mandates signed.
 *
 * A mandate's source is its LEAD's when the deal came from one, the deal's own otherwise -- a deal
 * opened by hand carries a source of its own, and a converted lead's source is the true one (the
 * deal copies it, but a rep can change it). Counted like the closing rate: by the month each thing
 * HAPPENED, so a source can sign more than it brought in over a short span. Most mandates first,
 * and on a tie the better rate: the source that signs as many from fewer leads is the better one.
 */
export function leadSources(input: {
  span: Pick<SalesMonthPeriod, 'start' | 'end'>
  leads: Pick<Lead, 'id' | 'createdAt' | 'ownerId' | 'source'>[]
  deals: Pick<Deal, 'stage' | 'wonAt' | 'kind' | 'service' | 'ownerId' | 'source' | 'leadId'>[]
  owners?: Set<string>
}): SourceRow[] {
  const within = (iso: string | undefined) => !!iso && new Date(iso) >= input.span.start && new Date(iso) <= input.span.end
  const mine = (ownerId: string) => !input.owners || input.owners.has(ownerId)
  const leadSource = new Map(input.leads.map((l) => [l.id, l.source as string]))
  const rows = new Map<string, { leads: number; mandates: number }>()
  const row = (s: string) => { const r = rows.get(s) ?? { leads: 0, mandates: 0 }; rows.set(s, r); return r }
  for (const l of input.leads) if (mine(l.ownerId) && within(l.createdAt)) row(l.source || 'Unknown').leads += 1
  for (const d of input.deals) {
    if (!mine(d.ownerId) || d.stage !== 'Won' || !within(d.wonAt) || dealKind(d) !== 'Handover') continue
    row((d.leadId && leadSource.get(d.leadId)) || d.source || 'Unknown').mandates += 1
  }
  return [...rows].map(([source, r]) => ({ source, ...r, rate: r.leads > 0 ? Math.round((r.mandates / r.leads) * 100) : null }))
    .sort((a, b) => b.mandates - a.mandates || (b.rate ?? -1) - (a.rate ?? -1) || b.leads - a.leads || a.source.localeCompare(b.source))
}
