/**
 * WHAT THE TRUST ACCOUNT IS MADE OF, IN FOUR PARTS, AND WHAT IS READY TO GO (S21 · Raptor H19).
 *
 * Stephan, 9 Nov, on a layout he liked: "what's in the account ... it's client portion, our portion, then the firm
 * share ... And then if you scroll down, for example, it shows you the client share, which would be the payover for
 * example the last 2 months, which you can break up. And then our share, which you can break up, and then at the
 * bottom all the other discrepancies that needs doing."
 *
 * NOTHING NEW IS COUNTED. Every figure is read off trust_cash_by_cycle (one row per payover cycle, every creditor
 * entry in exactly one), the overpayments kept and the Swordfish holding -- the same inputs currentHoldings draws the
 * owner list from -- so the bar, the two breakdowns and the list under them cannot disagree with "Accounted for".
 *
 * PURE: a check holds it.
 */
import type { TrustCashCycle } from './trust'

export interface TrustComposition {
  /** Owed to clients, every cycle: what the payovers will carry. */
  clientFunds: number
  /** Bredell Ferreira's: earned on receipts plus bank interest, less charges and drawings. */
  firmShare: number
  /** Debtors' overpayments, kept ones included. */
  debtorCredits: number
  /** Held for Swordfish payovers -- money with no client's name on it yet. */
  otherHoldings: number
  /** The four added: what has an owner. Equals accountedFromCash for the same inputs. */
  total: number
}

const r2 = (v: number): number => Math.round(v * 100) / 100

export function trustComposition(cash: TrustCashCycle[], swordfishLeft: number): TrustComposition {
  const clientFunds = r2(cash.reduce((t, c) => t + c.forClients, 0))
  const firmShare = r2(cash.reduce((t, c) => t + c.forFirm + c.firmOther, 0))
  const debtorCredits = r2(cash.reduce((t, c) => t + c.forDebtors, 0))
  const otherHoldings = r2(swordfishLeft)
  return { clientFunds, firmShare, debtorCredits, otherHoldings, total: r2(clientFunds + firmShare + debtorCredits + otherHoldings) }
}

/**
 * READY FOR PAYOVER: the clients' money in CLOSED cycles -- collected, the cycle over, waiting for its pay day or
 * overdue. The open cycle is still collecting and is not ready for anybody.
 */
export function readyForPayover(cash: TrustCashCycle[]): number {
  return r2(cash.filter((c) => !c.isOpen).reduce((t, c) => t + c.forClients, 0))
}

export interface ShareRow {
  key: string
  periodStart: string
  periodEnd: string
  paysOn: string
  isOpen: boolean
  amount: number
}

/**
 * THE CLIENT SHARE, CYCLE BY CYCLE, newest first: on any day after the 11th the account holds a closed cycle waiting
 * for its day and the open one filling up -- "the payover for the last 2 months". A cycle with nothing for clients is
 * left out rather than drawn as R0.
 */
export function clientShareByCycle(cash: TrustCashCycle[]): ShareRow[] {
  return cash.filter((c) => r2(c.forClients) !== 0)
    .map((c) => ({ key: `c-${c.periodStart}`, periodStart: c.periodStart, periodEnd: c.periodEnd, paysOn: c.paysOn, isOpen: c.isOpen, amount: r2(c.forClients) }))
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
}

export interface FirmShareRow extends ShareRow {
  /** Earned on receipts in this cycle (fees, interest, commission, VAT). */
  earned: number
  /** Bank interest, charges, drawings and transfers dated in it. */
  other: number
}

/** OUR SHARE, the same way: what was earned in each cycle and what else touched it. */
export function firmShareByCycle(cash: TrustCashCycle[]): FirmShareRow[] {
  return cash.filter((c) => r2(c.forFirm + c.firmOther) !== 0)
    .map((c) => ({
      key: `f-${c.periodStart}`, periodStart: c.periodStart, periodEnd: c.periodEnd, paysOn: c.paysOn, isOpen: c.isOpen,
      amount: r2(c.forFirm + c.firmOther), earned: r2(c.forFirm), other: r2(c.firmOther),
    }))
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
}

/** Each part's share of the bar, in whole percent; a negative part (a firm short after charges) draws as nothing. */
export function compositionWidths(c: TrustComposition): { clients: number; firm: number; debtors: number; other: number } {
  const parts = [c.clientFunds, c.firmShare, c.debtorCredits, c.otherHoldings].map((v) => Math.max(0, v))
  const sum = parts.reduce((t, v) => t + v, 0)
  if (sum <= 0) return { clients: 0, firm: 0, debtors: 0, other: 0 }
  const [clients, firm, debtors, other] = parts.map((v) => Math.round((v / sum) * 1000) / 10)
  return { clients, firm, debtors, other }
}
