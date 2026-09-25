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
