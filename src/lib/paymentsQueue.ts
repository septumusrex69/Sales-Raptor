/**
 * THE APPROVAL QUEUE, READ THE WAY THE FIRM READS IT: ONE ROW A PAYMENT, ONE ANSWER A COLUMN.
 *
 * THE FIRM, REDESIGNING PAYMENTS IN: about three thousand payments a month, so a row is a line of
 * figures and not a card -- "Payments in is only for processing current payments." Every figure
 * here is the ENGINE'S (`preview_allocation`, through payments_awaiting_approval). Nothing below
 * re-splits a payment: it names, sums and checks what the engine already said. A screen that
 * recomputed the split would be a second engine, and the two would disagree on exactly the payment
 * somebody was querying.
 *
 * ------------------------------------------------------------------------------------------------
 * THE ONE CORRECTION: A PTC's "DUE TO BF" INCLUDES THE VAT ON COMMISSION
 * ------------------------------------------------------------------------------------------------
 *
 * Where the debtor paid the CLIENT, the client owes the firm the fees side and the commission.
 * `allocate_payment` writes `due_to_bf = to_interest + to_costs + commission` -- the VAT left out --
 * while the ledger trigger `trust_creditors_on_allocation` books the client as owing
 * `to_interest + to_costs + commission + commission_vat`. The firm confirmed the ledger is right:
 * the VAT on commission is charged to the client whichever bank account the debtor paid into. So
 * the screen shows the ledger's figure, `ptcDueToBf`, built from its parts. The allocation and the
 * ledger are UNCHANGED -- this is the display catching up with what is booked -- and no VAT is
 * added to costs, which are VAT-inclusive already.
 *
 * PURE, no Supabase, so check-payments-queue can hold every figure to the firm's worked examples.
 */
import { CENT, checkAllocation, type Allocation, type Violation } from './allocationRules.ts'
import { amount } from './money.ts'

/** Cents, so a column of a thousand sums the way the bank does. */
const r2 = (n: number) => Math.round(n * 100) / 100
const near = (a: number, b: number) => Math.abs(a - b) <= CENT

/** What the queue row carries, as `fetchAwaitingApproval` maps it. Structural, so this file can
 *  stay free of payover.ts and its Supabase client. */
export interface QueueInput {
  paymentId: string
  client: string | null
  receivedOn: string
  amount: number
  paidToClient: boolean
  toInterest: number
  toCosts: number
  toReceiptFees: number
  toFees: number
  receiptFee: number
  receiptFeeVat: number
  toCapital: number
  capitalBefore: number
  capitalAfter: number
  excess: number
  commission: number
  commissionVat: number
  commissionRate: number | null
  toClient: number
  dueToBf: number
  hasRate: boolean
  interestCant: number
  rfCant: number
  feesCant: number
  cameBackFrom: string | null
}

export type Route = 'direct' | 'ptc'

/** One payment's figures, in the order the columns draw them. */
export interface QueueFigures {
  route: Route
  amount: number
  /* ---- interest and fees: the half A side ---- */
  interestPaid: number
  /** Item 9, VAT-inclusive -- what the debtor is charged and what the split spends. */
  receiptFeePaid: number
  /** Every other Annexure B fee raised before this payment, VAT-inclusive. */
  earlierFeesPaid: number
  /** Interest + both fee lines: what the fees side took. */
  feesSide: number
  /** round(payment / 2) -- the half the fees side is given. */
  halfA: number
  /** What half A could not spend, rolled to capital. Nought where the fees side took it all. */
  halfAUnused: number
  /* ---- capital ---- */
  capitalBefore: number
  capitalPaid: number
  capitalAfter: number
  /* ---- commission ---- */
  commissionRate: number | null
  commission: number
  commissionVat: number
  /* ---- the final split ---- */
  /** The client's share of THIS payment: capital less commission and its VAT, whoever holds it. */
  clientShare: number
  /** What the firm pays the client out of trust. On a PTC nought -- the client has it already. */
  toClient: number
  /** The firm's share, VAT included: fees side + commission + VAT on commission. */
  bfShare: number
  /** Paid more than the account owed; held for the debtor, never paid over. */
  credit: number
  /** The client owes the firm this on a PTC, as the ledger books it. Null on a direct receipt. */
  ptcDueToBf: number | null
}

/**
 * THE LEDGER'S FIGURE FOR WHAT A CLIENT OWES ON A PTC -- interest + costs + commission + VAT on
 * commission, which is exactly what trust_creditors_on_allocation books. Costs carry their VAT
 * already; it is not added a second time.
 */
export function ptcDueToBf(r: Pick<QueueInput, 'toInterest' | 'toCosts' | 'commission' | 'commissionVat'>): number {
  return r2(r.toInterest + r.toCosts + r.commission + r.commissionVat)
}

export function queueFigures(r: QueueInput): QueueFigures {
  const ptc = r.paidToClient
  const feesSide = r2(r.toInterest + r.toReceiptFees + r.toFees)
  const halfA = r2(r.amount / 2)
  const clientShare = r2(r.toCapital - r.commission - r.commissionVat)
  return {
    route: ptc ? 'ptc' : 'direct',
    amount: r.amount,
    interestPaid: r.toInterest,
    receiptFeePaid: r.toReceiptFees,
    earlierFeesPaid: r.toFees,
    feesSide,
    halfA,
    /* NEVER NEGATIVE. Past capital the fees side may take more than half -- what is left over pays
       the interest and costs still standing -- and then nothing of half A rolled anywhere. */
    halfAUnused: r2(Math.max(0, halfA - feesSide)),
    capitalBefore: r.capitalBefore,
    capitalPaid: r.toCapital,
    capitalAfter: r.capitalAfter,
    commissionRate: r.hasRate ? r.commissionRate : null,
    commission: r.commission,
    commissionVat: r.commissionVat,
    clientShare,
    /* THE ENGINE'S FIGURE on a direct receipt, never this file's subtraction: the badge below is
       what says when the two differ. */
    toClient: ptc ? 0 : r.toClient,
    bfShare: r2(feesSide + r.commission + r.commissionVat),
    credit: r.excess,
    ptcDueToBf: ptc ? ptcDueToBf(r) : null,
  }
}

/* ============================================================================================== */
/* EXCEPTIONS                                                                                     */
/* ============================================================================================== */

export type ExceptionKey =
  | 'credit' | 'capital_paid_off' | 'ptc' | 'came_back' | 'in_duplum' | 'needs_rate'
  | 'before_handover' | 'allocation_mismatch' | 'ptc_mismatch' | 'closed_account'

/** How an account was closed, for the "Account closed" badge: ended_as and ended_on. */
export interface ClosedAs { as: string; on: string | null }

const CLOSED_WORDS: Record<string, string> = {
  paid_up: 'paid up', settled: 'settled', written_off: 'written off', withdrawn: 'withdrawn by the client',
}

export interface QueueException {
  key: ExceptionKey
  label: string
  /** Said on hover and in the drawer. */
  detail: string
  /** Something to check before approving, not merely something to know. */
  warn: boolean
}

/**
 * WHAT IS UNUSUAL ABOUT A PAYMENT, NAMED.
 *
 * TWO THINGS IT NEVER SAYS. "Capital paid off" is not "settled" -- interest and fees may still
 * stand, and a debtor told they are settled stops paying. And there is no "within the items 1-7
 * limit" badge, because the engine does not report per payment what that cap held back; a badge
 * claiming the limit was respected would be a guess dressed as a check.
 *
 * `handoverDate` is the account's, read separately; null where it is not known, and then the
 * badge is simply not drawn rather than drawn as a pass.
 */
export function exceptionsOf(
  r: QueueInput, problems: Violation[], handoverDate: string | null = null, closed: ClosedAs | null = null,
): QueueException[] {
  const f = queueFigures(r)
  const out: QueueException[] = []
  /*
   * A PTC OVERPAYMENT IS NOT A CREDIT THE FIRM HOLDS. The firm, 7 October: "When the debtor pays the
   * client directly and overpays the client directly, we only process the amount that is due. The
   * client should sort that out." The engine marks it `with_client`; the badge says so.
   */
  if (f.credit > CENT) {
    out.push(r.paidToClient
      ? { key: 'credit', label: `Overpaid client ${amount(f.credit)}`, warn: false,
          detail: 'The debtor paid the client more than was owed. Only the amount due is processed; '
            + 'the client sorts the rest out with the debtor.' }
      : { key: 'credit', label: `Credit ${amount(f.credit)}`, warn: false,
          detail: 'Paid more than the account owed. Held for the debtor, never paid over.' })
  }
  if (r.capitalBefore > CENT && r.capitalAfter <= CENT) {
    out.push({ key: 'capital_paid_off', label: 'Capital paid off', warn: false,
      detail: 'Capital is nought after this payment. That is not the same as settled — interest '
        + 'and fees may still stand.' })
  }
  if (r.paidToClient) {
    out.push({ key: 'ptc', label: 'PTC', warn: false,
      detail: 'Paid straight to the client. Nothing is paid over; the client owes the firm its share.' })
  }
  if (r.cameBackFrom) {
    out.push({ key: 'came_back', label: 'Came back', warn: true,
      detail: 'A reversed payment, back to be placed again. Check the debtor before approving.' })
  }
  const clipped = r2(r.interestCant + r.rfCant + r.feesCant)
  if (clipped > CENT) {
    out.push({ key: 'in_duplum', label: 'In duplum', warn: false,
      detail: `${amount(clipped)} of interest and fees can't be recovered: the in duplum `
        + 'ceiling (NCA s103(5)) refuses it.' })
  }
  if (!r.hasRate) {
    out.push({ key: 'needs_rate', label: 'Needs commission rate', warn: true,
      detail: 'No commission rate could be found for this account. Approving marks it needs_rate.' })
  }
  if (handoverDate && r.receivedOn < handoverDate) {
    out.push({ key: 'before_handover', label: 'Before handover', warn: true,
      detail: `Received ${r.receivedOn}, before the account was handed over on ${handoverDate}.` })
  }
  /*
   * MONEY ON A CLOSED ACCOUNT (prompt 10's third cycle: "a payment arrives on a closed account
   * (flagged)"). The debtor paid after the file was settled, written off or withdrawn -- usually the
   * wrong reference, sometimes a debtor who did not know, and on a withdrawn file it is the client's
   * money to hand back. Held out of Approve all (splitForBatch) and approved alone once somebody has
   * looked, exactly like a payment that breaks a formula: the money has arrived either way.
   */
  if (closed) {
    out.push({ key: 'closed_account', label: 'Account closed', warn: true,
      detail: `The account was ${CLOSED_WORDS[closed.as] ?? closed.as}${closed.on ? ` on ${closed.on}` : ''}. `
        + 'Check it is the right account before approving.' })
  }
  /* THE SPLIT MUST ADD BACK TO THE PAYMENT, as well as obey the firm's formulas. */
  const unbalanced = !near(f.clientShare + f.bfShare + f.credit, r.amount)
  if (problems.length > 0 || unbalanced) {
    out.push({ key: 'allocation_mismatch', label: 'Allocation mismatch', warn: true,
      detail: problems.length > 0
        ? `${problems[0].rule}: ${problems[0].detail}`
        : `Client ${amount(f.clientShare)} + BF ${amount(f.bfShare)} + credit ${amount(f.credit)} `
          + `is not the payment ${amount(r.amount)}.` })
  }
  /*
   * AND THE CORRECTION ITSELF IS WATCHED. The ledger books the engine's due_to_bf plus the VAT on
   * commission; the screen builds the figure from its parts. If those ever part company -- the
   * engine starts including the VAT, say -- the screen and the ledger disagree, and this says so
   * on the row rather than at month end.
   */
  if (f.ptcDueToBf !== null && !near(f.ptcDueToBf, r2(r.dueToBf + r.commissionVat))) {
    out.push({ key: 'ptc_mismatch', label: 'PTC figure mismatch', warn: true,
      detail: `Shown ${amount(f.ptcDueToBf)}; the ledger will book `
        + `${amount(r2(r.dueToBf + r.commissionVat))}.` })
  }
  return out
}

/** Every row checked once: the figures, the formulas and the badges. */
export function checkedRow<T extends QueueInput>(
  r: T, a: Allocation, handoverDate: string | null = null, closed: ClosedAs | null = null,
): { row: T; a: Allocation; f: QueueFigures; problems: Violation[]; exceptions: QueueException[] } {
  const problems = checkAllocation(a)
  return { row: r, a, f: queueFigures(r), problems, exceptions: exceptionsOf(r, problems, handoverDate, closed) }
}

/* ============================================================================================== */
/* THE BATCH                                                                                      */
/* ============================================================================================== */

export interface BatchTotals {
  count: number
  total: number
  direct: { count: number; amount: number; toClient: number; bfShare: number; credit: number }
  ptc: { count: number; amount: number; clientShareHeld: number; dueToBf: number; credit: number }
  /** Paid over out of trust: direct receipts only. */
  toClients: number
  /** The firm's whole share, VAT included, BOTH routes -- the PTC due is inside it, not on top. */
  bfShare: number
  credit: number
  /** The client's share of every payment, whoever holds it. */
  clientShare: number
}

export function batchTotals(rows: QueueInput[]): BatchTotals {
  const t: BatchTotals = {
    count: 0, total: 0,
    direct: { count: 0, amount: 0, toClient: 0, bfShare: 0, credit: 0 },
    ptc: { count: 0, amount: 0, clientShareHeld: 0, dueToBf: 0, credit: 0 },
    toClients: 0, bfShare: 0, credit: 0, clientShare: 0,
  }
  for (const r of rows) {
    const f = queueFigures(r)
    t.count += 1; t.total += f.amount
    t.bfShare += f.bfShare; t.credit += f.credit; t.clientShare += f.clientShare
    if (f.route === 'direct') {
      t.direct.count += 1; t.direct.amount += f.amount; t.direct.toClient += f.toClient
      t.direct.bfShare += f.bfShare; t.direct.credit += f.credit
      t.toClients += f.toClient
    } else {
      t.ptc.count += 1; t.ptc.amount += f.amount; t.ptc.clientShareHeld += f.clientShare
      t.ptc.dueToBf += f.ptcDueToBf ?? 0; t.ptc.credit += f.credit
    }
  }
  /* ROUNDED ONCE, AT THE END, from cent-exact parts -- not per addition, which drifts. */
  const fix = (o: Record<string, number>) => { for (const k of Object.keys(o)) o[k] = r2(o[k]) }
  fix(t.direct as unknown as Record<string, number>)
  fix(t.ptc as unknown as Record<string, number>)
  t.total = r2(t.total); t.toClients = r2(t.toClients); t.bfShare = r2(t.bfShare)
  t.credit = r2(t.credit); t.clientShare = r2(t.clientShare)
  return t
}

export interface Reconciliation {
  label: string
  left: number
  right: number
  holds: boolean
}

/**
 * THE THREE SUMS THE BATCH MUST CLOSE ON, as the firm wrote them. Each is two different routes to
 * one number; where one fails, the summary says which.
 */
export function batchReconciliation(t: BatchTotals): Reconciliation[] {
  const rec = (label: string, left: number, right: number): Reconciliation =>
    ({ label, left: r2(left), right: r2(right), holds: near(r2(left), r2(right)) })
  return [
    rec('Into trust + paid to clients = total', t.direct.amount + t.ptc.amount, t.total),
    rec('Client share + BF share + credit = total', t.clientShare + t.bfShare + t.credit, t.total),
    rec('Trust: payovers + BF share + credit = received into trust',
      t.direct.toClient + t.direct.bfShare + t.direct.credit, t.direct.amount),
  ]
}

export interface ClientTotals extends BatchTotals { client: string }

/** The same totals, one client at a time, biggest first. */
export function totalsByClient(rows: QueueInput[]): ClientTotals[] {
  const groups = new Map<string, QueueInput[]>()
  for (const r of rows) {
    const k = r.client || 'No client'
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  return [...groups.entries()]
    .map(([client, rs]) => ({ client, ...batchTotals(rs) }))
    .sort((a, b) => b.total - a.total)
}

/**
 * THE CHECK HAPPENS BEFORE THE APPROVAL, NOT AFTER IT.
 *
 * The firm, 8 Oct: "the check should happen before the payment is done." The queue always ran the
 * same formulas as Check, but only to MARK a row -- Approve all posted a payment that broke one
 * along with everything else, and the first time anybody looked properly was on Check, after the
 * money had moved. Now a payment whose figures break a formula is HELD OUT of every batch approval
 * and can be approved only on its own, from its breakdown, by somebody saying they checked it.
 *
 * HELD, NOT REFUSED. The money has arrived either way; a payment nobody could approve would sit in
 * the queue for ever with the client never paid. One deliberate press, after reading it, is the
 * check -- the batch is what can no longer carry it through unread.
 */
export function splitForBatch<T extends {
  row: { paymentId: string }; problems: Violation[]; exceptions?: QueueException[]
}>(
  items: T[],
): { clean: string[]; held: string[] } {
  const clean: string[] = []; const held: string[] = []
  for (const c of items) {
    /* A broken formula, or money on a closed account -- both are looked at before approving. */
    const hold = c.problems.length > 0 || (c.exceptions ?? []).some((e) => e.key === 'closed_account')
    ;(hold ? held : clean).push(c.row.paymentId)
  }
  return { clean, held }
}
