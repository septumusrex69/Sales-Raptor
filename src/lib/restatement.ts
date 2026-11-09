/**
 * PAYMENTS FOUND LATE -- the pure half (Raptor H19 / S20): the shapes the database hands back, which correction is
 * drawn beside a payment, and `correctionOf`, the browser's copy of how one payment's correction is read off its old
 * and new split. Apart from backdatedPayments.ts so a check can import it (that file pulls in the Supabase client).
 */
export interface BackdatedPayment {
  paymentId: string
  accountId: string
  caseNumber: string | null
  debtor: string | null
  client: string | null
  receivedOn: string
  capturedOn: string | null
  approvedOn: string | null
  amount: number
  paidToClient: boolean
  capturedBy: string | null
  laterAllocated: number
  laterInvoiced: number
}

export interface SplitFigures {
  to_interest: number
  to_costs: number
  to_capital: number
  commission: number
  commission_vat: number
  to_client: number
  due_to_bf?: number
  excess_credit?: number
}

export interface RestatementLine {
  payment_id: string
  day: string
  amount: number
  ptc: boolean
  backdated: boolean
  /** False on the backdated payment while it still waits: approving the correction approves it, date-order split. */
  was_split: boolean
  /** The payover run (invoice) that already carried it, if one did. */
  run: string | null
  changed: boolean
  old: Partial<SplitFigures>
  new: SplitFigures
  delta: SplitFigures & Record<string, number>
}

export interface RestatementFigures {
  lines: RestatementLine[]
  interest_correction: number
  recoverable_correction: number
  interest_before: number
  interest_after: number
  capital_before: number
  capital_after: number
  capital_correction: number
  client_correction: number
  firm_correction: number
  /** S20 review: what the ENGINE posts for the client (to_client, or -due_to_bf for a PTC), summed. Approval is
   *  refused unless it equals client_correction -- older proposals do not carry it. */
  client_engine?: number
  blocked: string | null
}

export interface Restatement {
  id: string
  paymentId: string
  accountId: string
  status: 'proposed' | 'posted' | 'cancelled'
  blockedReason: string | null
  figures: RestatementFigures
  clientCorrection: number
  firmCorrection: number
  interestCorrection: number
  proposedAt: string
  proposedByName: string | null
  postedAt: string | null
  postedByName: string | null
  cancelledAt: string | null
  cancelReason: string | null
}

/** The latest correction for each payment -- what the list draws beside it. */
export function latestByPayment(list: Restatement[]): Map<string, Restatement> {
  const out = new Map<string, Restatement>()
  for (const r of list) {
    const had = out.get(r.paymentId)
    if (!had || r.proposedAt > had.proposedAt) out.set(r.paymentId, r)
  }
  return out
}

const cents = (x: number) => Math.round(x * 100) / 100

/**
 * ONE PAYMENT'S CORRECTION, read off what was paid over and what it should have been -- the browser's copy of
 * restatement_figures' arithmetic for one line. Into trust: the client is owed capital less commission and VAT,
 * the firm interest, fees, commission and VAT. A PTC turns it round: the client already holds the money and owes
 * the firm its share. The two always add to nil: the payment does not change, only who it belongs to.
 */
export function correctionOf(old: SplitFigures, next: SplitFigures, ptc = false): {
  interest: number; fees: number; capital: number; commission: number; client: number; firm: number
} {
  const d = (k: keyof SplitFigures) => cents(Number(next[k] ?? 0) - Number(old[k] ?? 0))
  const commission = cents(d('commission') + d('commission_vat'))
  const firm = cents(d('to_interest') + d('to_costs') + commission)
  const client = ptc ? cents(-firm) : cents(d('to_capital') - commission)
  return { interest: d('to_interest'), fees: d('to_costs'), capital: d('to_capital'), commission, client, firm }
}
