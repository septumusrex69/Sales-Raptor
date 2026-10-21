/**
 * "NOT ACCOUNTED FOR", ONE ITEM AT A TIME (S7).
 *
 * The firm, 12 Oct, of the Trust overview's R14 258.64: "If I click on that, it should show me
 * everything ... the whole list of ... the things that are not allocated ... because now you're going
 * to like 50 different places to allocate things." The figure was a single number with a sentence
 * under it, and the jobs behind it lived on Exceptions, Payments in, Payments to make and the runs.
 *
 * What makes the bank differ from what has an owner, each as its own line, SIGNED BY ITS EFFECT on
 * "not accounted for" (bank less accounted) so the lines add up to the figure:
 *
 *   - a statement line nobody has allocated: a receipt to place (+), money out to explain (-);
 *   - money in the bank, placed on a debtor, waiting for approval (+);
 *   - a payment out MARKED PAID by hand -- a payover, a refund, a drawing -- whose debit is not on an
 *     imported statement yet (+). The books say it left; the bank, as far as Raptor has been told,
 *     still holds it. On staging on 12 Oct this was the WHOLE R14 258.64 (three payovers R11 333.17,
 *     two refunds R2 925.47), and the overview called it "In the bank, not yet in the books" --
 *     backwards. Its job is to import the statement it went out on.
 *
 * Whatever those do not explain is one line of its own, never spread over the others.
 *
 * Pure: the page fetches, this arranges. Every reader already exists (bank_lines_to_allocate,
 * trust_awaiting_approval, payments_out_paid); nothing here decides anything about money.
 */
import type { StatementLine } from './bankLineAllocation'
import { lineNature, unexplainedDebitAction } from './bankLineAllocation.ts'
import type { PaidOut } from './paymentsOut'
import type { TrustCashCycle } from './trust'

export type UnaccountedGroup = 'to_match' | 'paid_out' | 'statement' | 'awaiting' | 'unexplained'

export interface UnaccountedItem {
  key: string
  group: UnaccountedGroup
  date: string | null
  title: string
  detail: string
  /** Its effect on "not accounted for": positive is money the bank holds that has no owner yet. */
  amount: number
  action: { label: string; to: string } | null
}

export interface Unaccounted {
  items: UnaccountedItem[]
  /** The items, added up. */
  explained: number
  /** What none of them explains. Nil when the list is the whole answer. */
  remainder: number
}

export const GROUP_TITLE: Record<UnaccountedGroup, string> = {
  to_match: 'On the statement, just needs matching',
  paid_out: 'Marked paid, not yet on a statement',
  statement: 'Statement lines to place or allocate',
  awaiting: 'In the bank, waiting for approval',
  unexplained: 'Not explained by anything above',
}

export const GROUP_HELP: Record<UnaccountedGroup, string> = {
  to_match: 'Recorded here AND on the imported statement, so no money is missing: the statement line only has to be ticked off against it.',
  paid_out: 'Paid at the bank and recorded here, but the statement it went out on has not been imported. Import it and each one matches itself.',
  statement: 'On an imported statement with no owner yet: a receipt to place on an account, or money out to say what it was.',
  awaiting: 'Placed on a debtor’s account and waiting on Payments in to be approved and split.',
  unexplained: 'What the items above do not add up to.',
}

const r2 = (v: number): number => Math.round(v * 100) / 100
/* Plain, so this file stays importable by a check (money.ts formats with Intl the same way). */
const rand2 = (v: number): string => `R ${Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`

export function unaccountedItems(input: {
  notAccounted: number
  lines: StatementLine[]
  awaiting: { amount: number; payments: number } | null
  paidOut: PaidOut[]
  /** No opening balance captured: the likeliest reason for a remainder, said on its line. */
  openingSet: boolean
}): Unaccounted {
  const items: UnaccountedItem[] = []

  /*
   * RECORDED AND ON THE STATEMENT, NOT YET TICKED OFF (the firm, 13 Oct, at R12 543.05 under "Statement
   * lines not yet allocated" while the overview showed only -R1 000: "it shows that it's matched ...
   * it doesn't show ... 12,000 Rand not allocated"). A payment marked paid here and a debit of exactly
   * that amount on an imported statement are the SAME money, seen twice: +R12 543.05 still "in the
   * bank" one way and -R12 543.05 "unexplained" the other. Listed apart they cancel and look like a
   * puzzle; paired they are one line that moves nothing and says the only job left is the tick. The
   * pair is found by amount, the line that quotes the reference first; a debit is used once.
   */
  const used = new Set<string>()
  const paired = new Set<string>()
  for (const p of input.paidOut) {
    if (p.confirmed || p.amount === 0) continue
    const cents = Math.round(p.amount * 100)
    const same = input.lines.filter((l) => !used.has(l.id) && l.amount < 0 && Math.round(-l.amount * 100) === cents)
    const ref = (p.paidReference ?? p.reference ?? '').toUpperCase()
    const line = same.find((l) => ref && (l.description ?? '').toUpperCase().includes(ref.replace(/^BF\s+/, ''))) ?? (same.length === 1 ? same[0] : undefined)
    if (!line) continue
    used.add(line.id); paired.add(`${p.kind}-${p.id}`)
    items.push({
      key: `match-${p.id}`, group: 'to_match', date: line.txnDate,
      title: p.kind === 'payover' && p.caseNumber ? `${p.payee} · ${p.caseNumber}` : p.payee,
      detail: `${rand2(p.amount)} recorded here, and on the statement as "${line.description ?? ''}"`,
      amount: 0,
      action: { label: 'Match it', to: '/trust/exceptions' },
    })
  }

  for (const p of input.paidOut) {
    if (p.confirmed || p.amount === 0 || paired.has(`${p.kind}-${p.id}`)) continue
    const what = p.kind === 'payover' ? 'Payover' : p.kind === 'refund' ? 'Refund to a debtor' : 'Transfer to the business account'
    items.push({
      key: `out-${p.kind}-${p.id}`, group: 'paid_out', /* the stamp as stored; the page shows it on the firm's day */ date: p.paidAt,
      title: p.kind === 'payover' && p.caseNumber ? `${p.payee} · ${p.caseNumber}` : p.payee,
      detail: `${what}, marked paid${p.paidReference ? ` on ${p.paidReference}` : ''}`,
      amount: r2(p.amount),
      action: p.kind === 'payover' ? { label: 'Open the run', to: `/trust/runs/${p.id}` }
        : p.kind === 'refund' ? { label: 'Payments out', to: '/trust/payments-out' }
          : { label: 'Drawings', to: '/business/drawings' },
    })
  }

  for (const l of input.lines) {
    if (l.amount === 0 || used.has(l.id)) continue
    const debit = l.amount < 0
    const returned = debit && lineNature(l.description, 'debit') === 'returned_debit'
    items.push({
      key: `line-${l.id}`, group: 'statement', date: l.txnDate,
      title: l.description || (debit ? 'Money out, no description' : 'Money in, no description'),
      detail: returned ? 'A debtor\u2019s payment the bank returned unpaid: reverse the receipt it took back'
        : debit ? 'Money out on the statement, not yet said what it was'
          : 'Money in on the statement, not yet placed on an account',
      /* A receipt nobody owns raises the figure; a debit nobody explains lowers it. */
      amount: r2(l.amount),
      action: returned ? { label: 'Find the receipt that bounced', to: '/trust/payments' }
        : debit ? unexplainedDebitAction(l.description, null) : { label: 'Place it', to: '/trust/exceptions' },
    })
  }

  if (input.awaiting && input.awaiting.amount !== 0) {
    items.push({
      key: 'awaiting', group: 'awaiting', date: null,
      title: `${input.awaiting.payments} ${input.awaiting.payments === 1 ? 'payment' : 'payments'} not yet approved`,
      detail: 'In the bank and placed on a debtor, not yet split',
      amount: r2(input.awaiting.amount),
      action: { label: 'Approve on Payments in', to: '/trust/payments' },
    })
  }

  const explained = r2(items.reduce((t, i) => t + i.amount, 0))
  const remainder = r2(input.notAccounted - explained)
  if (remainder !== 0) {
    items.push({
      key: 'remainder', group: 'unexplained', date: null,
      title: remainder > 0 ? 'The bank holds more than the items explain' : 'The bank holds less than the items explain',
      detail: !input.openingSet
        ? 'No opening balance is captured, so the bank figure is only the statements imported so far'
        : remainder > 0 ? 'Money in the account that no record here gives an owner'
          : 'Money gone from the account with nothing recorded against it',
      amount: remainder,
      action: !input.openingSet ? { label: 'Capture the opening balance', to: '/trust/settings' } : { label: 'Open the trust ledger', to: '/trust/ledger' },
    })
  }

  /* What is really missing first -- lines to place, payments not yet on a statement, approvals, the
     rest -- and last the ticks that move nothing. Inside a group, the biggest first. */
  const order: UnaccountedGroup[] = ['statement', 'paid_out', 'awaiting', 'unexplained', 'to_match']
  items.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || Math.abs(b.amount) - Math.abs(a.amount))
  return { items, explained, remainder }
}

/**
 * WHAT IS ACCOUNTED FOR, read the one way: each cycle's money for clients and for the firm, plus the
 * firm's interest and charges, plus the debtors' -- trust_cash_by_cycle, PTCs left out (they never
 * came in). The overview and this list both take it from here, so the two cannot disagree about
 * the figure the list is meant to add up to.
 *
 * PLUS WHAT IS LEFT HELD FOR SWORDFISH PAYOVERS (S10, swordfishHolding.ts). That money is on no
 * ledger -- Swordfish cannot say whose it is -- so the cycles cannot see it; it is still owned, by the
 * payovers Swordfish has yet to make, and trust_position's owed_out counts it the same way. Without
 * it here the overview and Not accounted for would read the bucket as money nobody owns.
 */
export function accountedFromCash(
  cash: Pick<TrustCashCycle, 'forClients' | 'forFirm' | 'firmOther' | 'forDebtors'>[],
  swordfishLeft = 0,
): number {
  return r2(cash.reduce((t, c) => t + c.forClients + c.forFirm + c.firmOther + c.forDebtors, 0) + swordfishLeft)
}
