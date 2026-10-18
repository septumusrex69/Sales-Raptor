/**
 * THE FIRM IN NUMBERS, for the one screen everybody in the firm opens.
 *
 * THE FIRM ASKED FOR ONE COMPANY DASHBOARD, and said why: "it's important for the whole company
 * to have transparency, to see how many contracts are coming in, how many handovers there are,
 * so everybody can support each other ... it's important for everybody in the company to
 * understand that we are a collective."
 *
 * WHAT IS DELIBERATELY NOT HERE IS THE FIRM'S OWN INCOME. No commission, no Annexure B revenue,
 * no remittance figure — the firm's instruction when the dashboard was agreed: "we're not going
 * to be disclosing commission and income from the Annexure B fees. We'll do that on another
 * place, which is not even for an administrator." Everything on this screen is either the
 * client's money to recover or a count of work, and a number added here later that is the firm's
 * earnings would break a promise made to the people who land on it.
 *
 * TWO HALVES, TWO DATA PATHS, exactly as CLAUDE.md describes them. The book is hundreds of
 * thousands of rows and is counted in the database (`company_snapshot`, called from
 * companySnapshotData.ts); the sales side is a few hundred rows that AppStore already holds, so
 * it is counted here.
 *
 * THIS FILE TOUCHES NOTHING, which is why the fetch lives next door — the same split as
 * handOut/handOutData and accountStanding/accountStandingData. A QA check cannot import a module
 * that pulls in the Supabase client, and the arithmetic that decides whether a signed mandate
 * reads as revenue is exactly the thing that has to be checkable without a browser.
 */
import { dealKind } from './dealKind.ts'
import { isActiveLead } from './leadStatus.ts'
import { isWithinPeriod, type SalesMonthPeriod } from './salesMonth.ts'
import type { Deal, Lead } from '../types'

/** What the book looks like, counted in the database. Every figure is accounts, never earnings. */
export interface BookSnapshot {
  /** Accounts handed to us inside the period being read, and what they were worth at handover. */
  intakeAccounts: number
  intakeClients: number
  intakeCapital: number
  /** The whole book, on the same expression the account list's summary uses. */
  bookAccounts: number
  bookCapital: number
  bookClients: number
  /** The part of it still being worked, and what is still owed on it. */
  activeAccounts: number
  activeCapital: number
  activeClients: number
  /** Live, and on nobody's desk. */
  unallocatedActive: number
  /**
   * Live, actioned at some point, and not since the quiet window.
   *
   * SEPARATE FROM `neverActioned` ON PURPOSE — see the function's own comment in schema.sql.
   * Most of the imported book has no recorded action at all, because `last_action_at` was only
   * ever written by the Swordfish import until Raptor started stamping it. Added together the two
   * read as a firm that has abandoned eighteen thousand accounts, which is not what happened.
   */
  quietAccounts: number
  neverActioned: number
}

/**
 * Where the next work comes from: the sales side in six figures.
 *
 * A MANDATE IS NOT A DEAL VALUE, and keeping them apart is the whole reason this is a function
 * rather than four `.filter()` calls on a page. A handover deal's `value` is deliberately zero —
 * a signed book earns nothing at signature, see dealKind.ts — so summing `value` across a mixed
 * pipeline reports every mandate the firm has ever signed as worth nothing. The book signed is
 * `handoverAmount`, and it is the client's money to recover, not revenue.
 */
export interface SalesSnapshot {
  openLeads: number
  leadsAdded: number
  /** Handover deals won inside the period, and the book they brought with them. */
  mandatesSigned: number
  mandateBook: number
  /** Service deals still in play, and what they are worth. */
  dealsOpen: number
  dealsOpenValue: number
  /** Service deals won inside the period. */
  dealsWonValue: number
}

export function salesSnapshot(leads: Lead[], deals: Deal[], period: SalesMonthPeriod): SalesSnapshot {
  const won = deals.filter((d) => d.stage === 'Won' && isWithinPeriod(d.wonAt, period))
  const mandates = won.filter((d) => dealKind(d) === 'Handover')
  /* "Open" is everything that has not ended one way or the other, which is how the board draws
     it — a deal sitting at Mandate Sent is open work, not a closed loss. */
  const open = deals.filter((d) => d.stage !== 'Won' && d.stage !== 'Rejected')
  const service = open.filter((d) => dealKind(d) === 'Service')
  return {
    openLeads: leads.filter(isActiveLead).length,
    leadsAdded: leads.filter((l) => isWithinPeriod(l.createdAt, period)).length,
    mandatesSigned: mandates.length,
    mandateBook: mandates.reduce((t, d) => t + (d.handoverAmount ?? 0), 0),
    dealsOpen: service.length,
    dealsOpenValue: service.reduce((t, d) => t + (d.value ?? 0), 0),
    dealsWonValue: won.filter((d) => dealKind(d) === 'Service').reduce((t, d) => t + (d.value ?? 0), 0),
  }
}

/* ---------------------------------------------------------------- the firm's layout, 18 Oct */

/** One day's bar on "Work coming in". */
export interface IntakeBar {
  /** 'YYYY-MM-DD' */
  day: string
  /** The day of the month, as the axis prints it. */
  label: string
  accounts: number
  /** Capital at handover that day -- the client's money to recover, never the firm's. */
  capital: number
  /**
   * OF THOSE, FROM A NEW CLIENT: one inside its first three months of handovers, counted from its
   * first account (company_intake_by_day; the firm, 18 Oct). The rest is from existing clients.
   */
  newAccounts: number
  newCapital: number
  /** The same day of LAST period (the nth day of it), drawn faintly behind; null past its end. */
  priorAccounts: number | null
  priorCapital: number | null
  /** Saturday or Sunday: drawn grey, because a handover is a working-day event and a weekend bar
      that is short reads as a slow day when it is simply a closed one. */
  weekend: boolean
  /** After the as-at day: drawn as an empty slot, never as nought -- a day that has not happened
      did not bring nothing in. */
  future: boolean
}

export interface IntakeRow { day: string; accounts: number; capital?: number; newAccounts?: number; newCapital?: number }

/** Every day from one ISO date to another, inclusive, in UTC so no local clock moves a day. */
function daysOf(fromIso: string, toIso: string): Date[] {
  const out: Date[] = []
  const [y, m, d] = fromIso.split('-').map(Number)
  for (let i = 0; i < 400; i++) {
    const at = new Date(Date.UTC(y, m - 1, d + i))
    if (at.toISOString().slice(0, 10) > toIso) break
    out.push(at)
  }
  return out
}

/**
 * EVERY DAY OF THE PERIOD, IN ORDER, with the database's counts placed on it.
 *
 * THE DATABASE RETURNS ONLY DAYS THAT HAD A HANDOVER (company_intake_by_day groups by the date), so
 * the gaps are filled here: a chart that skipped empty days would put 11 Sep beside 14 Sep and read as
 * three busy days in a row. A day the database counted outside the period is ignored rather than
 * tacked on.
 *
 * LAST PERIOD IS LAID DAY FOR DAY: the first day beside the first day (the firm, 18 Oct, agreeing "is
 * work coming in growing or drying up" as the question). Periods differ in length by a day or three,
 * so the comparison is by position, and a slot past the end of the shorter one has no prior figure
 * rather than a nought.
 */
export function intakeBars(
  fromIso: string, toIso: string, rows: IntakeRow[], todayIso: string,
  prior?: { fromIso: string; toIso: string; rows: IntakeRow[] },
): IntakeBar[] {
  const counts = new Map(rows.map((r) => [r.day.slice(0, 10), r]))
  const priorDays = prior ? daysOf(prior.fromIso, prior.toIso).map((d) => d.toISOString().slice(0, 10)) : []
  const priorBy = new Map((prior?.rows ?? []).map((r) => [r.day.slice(0, 10), r]))
  return daysOf(fromIso, toIso).map((at, i) => {
    const iso = at.toISOString().slice(0, 10)
    const dow = at.getUTCDay()
    const r = counts.get(iso)
    const pDay = prior && i < priorDays.length ? priorDays[i] : null
    const p = pDay ? priorBy.get(pDay) : undefined
    return {
      day: iso, label: String(at.getUTCDate()),
      accounts: r?.accounts ?? 0, capital: r?.capital ?? 0,
      newAccounts: r?.newAccounts ?? 0, newCapital: r?.newCapital ?? 0,
      priorAccounts: pDay ? (p?.accounts ?? 0) : null,
      priorCapital: pDay ? (p?.capital ?? 0) : null,
      weekend: dow === 0 || dow === 6, future: iso > todayIso,
    }
  })
}

/**
 * "UP FROM 6 LAST MONTH", in words, comparing like with like: last period only up to the same day
 * of it as this one has reached, so the 7th of this month is not set against the whole of last.
 * Null where there is nothing to compare (no prior period, or a fresh period with nothing in yet).
 */
export function intakeComparison(bars: IntakeBar[]): { now: number; then: number; words: string } | null {
  const past = bars.filter((b) => !b.future)
  if (!bars.some((b) => b.priorAccounts !== null)) return null
  const now = past.reduce((t, b) => t + b.accounts, 0)
  const then = past.reduce((t, b) => t + (b.priorAccounts ?? 0), 0)
  if (now === 0 && then === 0) return null
  const sameDay = past.length < bars.length ? ' by the same day' : ''
  const words = now === then ? `the same as last month${sameDay}`
    : now > then ? `up from ${then.toLocaleString('en-ZA')} last month${sameDay}`
      : `down from ${then.toLocaleString('en-ZA')} last month${sameDay}`
  return { now, then, words }
}

/** A slice of "The book" ring, and the line in its legend. */
export interface BookSlice {
  key: 'worked' | 'unallocated' | 'not_worked'
  label: string
  value: number
}

/**
 * THE BOOK AS A RING THAT ADDS UP.
 *
 * The firm's mock-up put four things round one ring -- being worked, not yet allocated, clients with
 * live accounts, gone quiet. Only some of those are parts of the book: "clients" counts companies,
 * not accounts, and "gone quiet" is a SUBSET of being worked, so a ring drawn from all four would
 * add clients to accounts and count the quiet ones twice, and the arc lengths would mean nothing.
 *
 * So the ring is a partition of the accounts on the book -- every account in exactly one slice:
 *   - being worked: live, on somebody's desk;
 *   - not yet allocated: live, on nobody's desk;
 *   - not being worked: everything else on the book (closed, on hold, written off, frozen).
 * They sum to the centre figure by construction. Clients and gone quiet stay in the legend, as
 * plain lines under the slices, because they are worth seeing and are not slices of anything.
 */
export function bookSlices(b: Pick<BookSnapshot, 'bookAccounts' | 'activeAccounts' | 'unallocatedActive'>): BookSlice[] {
  const unallocated = Math.max(0, Math.min(b.unallocatedActive, b.activeAccounts))
  const worked = Math.max(0, b.activeAccounts - unallocated)
  const notWorked = Math.max(0, b.bookAccounts - b.activeAccounts)
  return [
    { key: 'worked', label: 'Being worked', value: worked },
    { key: 'unallocated', label: 'Not yet allocated', value: unallocated },
    { key: 'not_worked', label: 'Not being worked', value: notWorked },
  ]
}

/**
 * EACH DEPARTMENT'S HEADLINE (the firm, 18 Oct). The section has always said "Everybody sees
 * everybody's headline" and the cards carried a headcount. One figure each, chosen as the work that
 * department is there to do, and NONE of them the firm's income (the condition the whole screen was
 * agreed under):
 *   - Call centre: collected this period -- the client's money recovered, the hero's own figure;
 *   - Sales: accounts handed over by NEW clients (first three months; the firm, 18 Oct);
 *   - Communications: accounts handed over by EXISTING clients (they look after the relationship);
 *   - Administration: accounts loaded onto the book this period.
 * Null while the figure is still being counted: a card reads "…" rather than a wrong nought.
 */
export function departmentHeadline(
  id: string,
  input: { collected: number | null; mandates: number; intakeClients: number | null; intakeAccounts: number | null
    fromNew?: number | null; fromExisting?: number | null },
  money: (v: number) => string,
): { value: string; label: string } | null {
  const n = (v: number | null) => (v === null ? '…' : v.toLocaleString('en-ZA'))
  switch (id) {
    case 'Call centre': return { value: input.collected === null ? '…' : money(input.collected), label: 'collected this month' }
    /* The work each side brought in (18 Oct): new clients are Sales', existing ones Communications'. */
    case 'Sales': return input.fromNew === undefined
      ? { value: n(input.mandates), label: input.mandates === 1 ? 'mandate signed' : 'mandates signed' }
      : { value: n(input.fromNew), label: input.fromNew === 1 ? 'account from new clients' : 'accounts from new clients' }
    case 'Communications': return input.fromExisting === undefined
      ? { value: n(input.intakeClients), label: input.intakeClients === 1 ? 'client sent work' : 'clients sent work' }
      : { value: n(input.fromExisting), label: input.fromExisting === 1 ? 'account from existing clients' : 'accounts from existing clients' }
    case 'Administration': return { value: n(input.intakeAccounts), label: input.intakeAccounts === 1 ? 'account loaded' : 'accounts loaded' }
    default: return null
  }
}

/**
 * TOTAL, EXISTING CLIENTS, NEW CLIENTS -- the firm's three figures for work coming in (18 Oct): "there's
 * a total one, and then there's one that comes in from existing clients, which comes from the
 * communication department, and then there's ones that come in from new clients" (Sales). Summed from
 * the same bars the chart draws, so the three and the chart cannot disagree; existing is the total
 * less new, so the two always add up.
 */
export function intakeSplit(bars: IntakeBar[]): {
  total: { accounts: number; capital: number }
  existing: { accounts: number; capital: number }
  fresh: { accounts: number; capital: number }
} {
  const total = { accounts: 0, capital: 0 }
  const fresh = { accounts: 0, capital: 0 }
  for (const b of bars) {
    total.accounts += b.accounts; total.capital += b.capital
    fresh.accounts += b.newAccounts; fresh.capital += b.newCapital
  }
  return { total, fresh, existing: { accounts: total.accounts - fresh.accounts, capital: total.capital - fresh.capital } }
}

/** A client signed and waiting for its first handover, and how long it has waited. */
export interface AwaitingClient { companyId: string; name: string; signedOn: string; ownerId: string | null; days: number }

/**
 * SIGNED, NOTHING HANDED OVER YET (the firm, 18 Oct), oldest first: the longer a signed client sends
 * nothing, the likelier the relationship has gone cold -- which is exactly what the clerk is there to
 * catch. Days counted on 'YYYY-MM-DD' strings in UTC, so no clock moves a day.
 */
export function awaitingFirstHandover(
  rows: { company_id: string; name: string; mandate_signed_at: string; account_owner_id: string | null }[],
  todayIso: string,
): AwaitingClient[] {
  const day = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / 86_400_000 }
  return rows
    .map((r) => ({ companyId: r.company_id, name: r.name, signedOn: r.mandate_signed_at.slice(0, 10), ownerId: r.account_owner_id,
      days: Math.max(0, day(todayIso) - day(r.mandate_signed_at)) }))
    .sort((a, b) => b.days - a.days)
}
