/**
 * THE TRUST OVERVIEW: ONLY MONEY IN THE TRUST ACCOUNT NOW, AND WHAT NEEDS DOING (S7).
 *
 * The firm, 13 Oct, at "Earlier collections 11 May - 10 Jun ... R12 167.54" on an overview whose
 * trust account held R26 750: "It shows historical ... payover runs, which is not applicable to any
 * money that's currently in the trust. This viewpoint ... is only applicable for all money that is
 * currently in the trust." The old card listed every cycle's GROSS firm share and then took the
 * firm's drawings off on a line of their own ("Interest, charges and transfers -R40 982.05"), so a
 * cycle paid out months ago still read as R12 167.54 sitting in trust. Now:
 *   - a cycle appears only while CLIENTS' money from it is still in the account (its payover not yet
 *     paid), one line each;
 *   - the firm's share is ONE line, net of what it has already drawn and paid in charges -- what is
 *     actually still in the account for Bredell Ferreira -- with what may be drawn now beside it;
 *   - debtors' money (overpayments) one line.
 * They add up to the same "accounted for" as before (accountedFromCash): the money is regrouped,
 * never recalculated.
 *
 * AND THE RECONCILIATION CARD IS GONE. The firm: "the ownership reconciliation, is that really
 * necessary ... isn't there anything better". It repeated the headline's three figures and then
 * explained a different calculation ("the bank holds R287.50 more") beside them. In its place: what
 * needs doing, each with where it is done -- todoItems.
 *
 * Pure, so a check can hold it.
 */
import type { TrustCashCycle } from './trust'

export interface Holding {
  key: string
  who: string
  what: string
  amount: number
  to?: string
}

const r2 = (v: number): number => Math.round(v * 100) / 100

export function currentHoldings(input: {
  cash: TrustCashCycle[]
  /** firm_trust_split: what may be drawn now and what waits for its clients. */
  firm: { drawable: number; waiting: number } | null
  kept: number
  label: (c: TrustCashCycle) => string
  payDay: (iso: string) => string
}): Holding[] {
  const out: Holding[] = []
  for (const c of input.cash) {
    if (r2(c.forClients) === 0) continue
    out.push({
      key: `clients-${c.periodStart}`,
      who: c.isOpen ? 'Clients · this month' : 'Clients · to be paid over',
      what: `${input.label(c)} · paid over ${input.payDay(c.paysOn)}`,
      amount: r2(c.forClients),
      to: '/trust/payover',
    })
  }
  const firm = r2(input.cash.reduce((t, c) => t + c.forFirm + c.firmOther, 0))
  if (firm !== 0) {
    const f = input.firm
    out.push({
      key: 'firm', who: 'Bredell Ferreira',
      what: f
        ? `Fees, interest and commission not yet transferred, less bank charges · ${randPlain(f.drawable)} may be drawn now${f.waiting > 0.004 ? `, ${randPlain(f.waiting)} waits for its clients` : ''}`
        : 'Fees, interest and commission not yet transferred, less bank charges',
      amount: firm, to: '/trust/payments-out',
    })
  }
  const debtors = r2(input.cash.reduce((t, c) => t + c.forDebtors, 0))
  if (r2(debtors - input.kept) !== 0) {
    out.push({ key: 'debtors', who: 'Debtors', what: 'Overpaid, to be refunded or decided', amount: r2(debtors - input.kept), to: '/trust/exceptions#overpayments' })
  }
  if (input.kept > 0.004) {
    out.push({ key: 'kept', who: 'Debtors · overpayments kept', what: 'Too small to refund; the debtor’s until taken', amount: r2(input.kept), to: '/trust/exceptions#overpayments' })
  }
  return out
}

export interface TodoItem {
  key: string
  label: string
  detail: string
  to: string
  tone: 'bad' | 'warn' | 'info'
}

export function todoItems(input: {
  notAccounted: number
  suspense: { count: number; amount: number }
  linesToAllocate: number
  overpaymentsToDecide: number
  overduePayovers: { label: string; amount: number }[]
  paymentsOut: { ready: number; readyAmount: number; pending: number }
  clientsOwe: { count: number; total: number }
  firmDrawable: number
}): TodoItem[] {
  const out: TodoItem[] = []
  if (r2(input.notAccounted) !== 0) {
    out.push({ key: 'unaccounted', tone: input.notAccounted < 0 ? 'bad' : 'warn', to: '/trust/unaccounted',
      label: `${randPlain(Math.abs(input.notAccounted))} not accounted for`,
      detail: input.notAccounted < 0 ? 'The bank holds less than the books say. See every item.' : 'In the bank with no owner yet. See every item.' })
  }
  for (const o of input.overduePayovers) {
    out.push({ key: `overdue-${o.label}`, tone: 'bad', to: '/trust/payover', label: `Payover overdue: ${o.label}`, detail: `${randPlain(o.amount)} for clients, past its payout day.` })
  }
  if (input.suspense.count > 0) {
    out.push({ key: 'suspense', tone: 'warn', to: '/trust/exceptions#suspense',
      label: `${input.suspense.count} ${input.suspense.count === 1 ? 'receipt' : 'receipts'} in suspense`,
      detail: `${randPlain(input.suspense.amount)} nobody has placed on an account yet.` })
  }
  if (input.linesToAllocate > 0) {
    out.push({ key: 'lines', tone: 'warn', to: '/trust/exceptions#lines',
      label: `${input.linesToAllocate} statement ${input.linesToAllocate === 1 ? 'line' : 'lines'} to allocate`, detail: 'Money out, or in, not yet said what it was.' })
  }
  if (input.overpaymentsToDecide > 0) {
    out.push({ key: 'overpay', tone: 'warn', to: '/trust/exceptions#overpayments',
      label: `${input.overpaymentsToDecide} ${input.overpaymentsToDecide === 1 ? 'overpayment' : 'overpayments'} to decide`, detail: 'Refund, move, release or park.' })
  }
  if (input.paymentsOut.ready > 0 || input.paymentsOut.pending > 0) {
    out.push({ key: 'payout', tone: 'info', to: '/trust/payments-out',
      label: `${input.paymentsOut.ready} ${input.paymentsOut.ready === 1 ? 'payment' : 'payments'} ready to go out`,
      detail: `${randPlain(input.paymentsOut.readyAmount)} in the bank file${input.paymentsOut.pending ? ` · ${input.paymentsOut.pending} pending` : ''}.` })
  }
  if (input.firmDrawable > 0.004) {
    out.push({ key: 'draw', tone: 'info', to: '/trust/payments-out?draw=1',
      label: `${randPlain(input.firmDrawable)} of the firm’s share can be drawn`, detail: 'Its clients have been paid.' })
  }
  if (input.clientsOwe.count > 0) {
    out.push({ key: 'owe', tone: 'info', to: '/trust/clients',
      label: `Clients owe us ${randPlain(input.clientsOwe.total)}`, detail: `${input.clientsOwe.count} ${input.clientsOwe.count === 1 ? 'client' : 'clients'}.` })
  }
  return out
}

/* Plain, so this file stays importable by a check (money.ts formats with Intl the same way). */
function randPlain(v: number): string {
  return `R ${Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`
}
