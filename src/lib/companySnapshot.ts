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
  /** Saturday or Sunday: drawn grey, because a handover is a working-day event and a weekend bar
      that is short reads as a slow day when it is simply a closed one. */
  weekend: boolean
  /** After the as-at day: drawn as an empty slot, never as nought -- a day that has not happened
      did not bring nothing in. */
  future: boolean
}

/**
 * EVERY DAY OF THE PERIOD, IN ORDER, with the database's counts placed on it.
 *
 * THE DATABASE RETURNS ONLY DAYS THAT HAD A HANDOVER (company_intake_by_day groups by the date), so
 * the gaps are filled here: a chart that skipped empty days would put 11 Sep beside 14 Sep and read as
 * three busy days in a row. UTC arithmetic on 'YYYY-MM-DD' strings only, so no local clock moves a
 * day. A day the database counted outside the period is ignored rather than tacked on.
 */
export function intakeBars(fromIso: string, toIso: string, rows: { day: string; accounts: number }[], todayIso: string): IntakeBar[] {
  const counts = new Map(rows.map((r) => [r.day.slice(0, 10), r.accounts]))
  const out: IntakeBar[] = []
  const [y, m, d] = fromIso.split('-').map(Number)
  for (let i = 0; i < 400; i++) {
    const at = new Date(Date.UTC(y, m - 1, d + i))
    const iso = at.toISOString().slice(0, 10)
    if (iso > toIso) break
    const dow = at.getUTCDay()
    out.push({
      day: iso, label: String(at.getUTCDate()), accounts: counts.get(iso) ?? 0,
      weekend: dow === 0 || dow === 6, future: iso > todayIso,
    })
  }
  return out
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
