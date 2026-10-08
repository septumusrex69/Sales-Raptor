/**
 * PAYMENTS TO MAKE OUT OF TRUST, AND THE REFERENCE EACH ONE GOES OUT ON.
 *
 * THE FIRM, 8 Oct: a refund "should go to a place for payments that we have to make"; a payover
 * "should go out with a client unique reference. For example, BF for Bredell Ferreira"; a refund
 * "should be matched to a payment going out ... with the debtor's reference number".
 *
 * THE REFERENCE IS 'BF ' + SOMETHING ALREADY UNIQUE: a run's number (client code and month, e.g.
 * PO-LVM-2610) or a debtor's case number (RAP-124059). Written once in the database
 * (payment_out_reference) and once here; check-payments-out holds the two together, because the
 * reference typed at the bank and the reference Raptor looks for on the statement must be the same
 * string or the match it exists for never happens.
 *
 * PURE, no Supabase, so a check can import it.
 */

export interface PaymentToMake {
  kind: 'payover' | 'refund'
  id: string
  payee: string
  amount: number
  reference: string | null
  /** For a run: approved or sent. For a refund: due. */
  status: string
  /** The 11th a run falls due on. A refund has no fixed day. */
  dueOn: string | null
  since: string | null
  /** The client's banking details for a run; the reason for a refund. */
  detail: string | null
  companyId: string | null
  accountId: string | null
  caseNumber: string | null
}

/** 'BF ' + the code, upper-cased; null where there is no code. Mirrors payment_out_reference. */
export function paymentReference(code: string | null | undefined): string | null {
  const c = (code ?? '').trim()
  return c ? `BF ${c.toUpperCase()}` : null
}

/**
 * DOES THIS STATEMENT LINE CARRY THAT REFERENCE? Banks drop spaces and punctuation and run the
 * reference into the beneficiary's name ("PAYOVER POLVM2610 LOWVELD"), and may cut the "BF". So
 * the CODE is looked for, letters and digits only. A code shorter than five characters is not
 * trusted to mean anything.
 */
export function referenceIn(description: string | null | undefined, reference: string | null | undefined): boolean {
  if (!description || !reference) return false
  const squash = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const code = squash(reference.replace(/^\s*BF\s+/i, ''))
  return code.length >= 5 && squash(description).includes(code)
}

export function toPaymentToMake(r: Record<string, unknown>): PaymentToMake {
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
  return {
    kind: r.kind === 'refund' ? 'refund' : 'payover',
    id: String(r.id),
    payee: String(r.payee ?? ''),
    amount: Number(r.amount ?? 0),
    reference: s(r.reference),
    status: String(r.status ?? ''),
    dueOn: s(r.due_on),
    since: s(r.since),
    detail: s(r.detail),
    companyId: s(r.company_id),
    accountId: s(r.account_id),
    caseNumber: s(r.case_number),
  }
}

/** The total to pay, in cents so a long list cannot drift a cent. */
export function totalToPay(list: PaymentToMake[]): number {
  return list.reduce((t, p) => t + Math.round(p.amount * 100), 0) / 100
}

/** Something that has gone out of trust, and whether the bank statement has confirmed it yet. */
export interface PaidOut {
  kind: 'payover' | 'refund' | 'business_transfer'
  id: string
  payee: string
  amount: number
  reference: string | null
  paidAt: string | null
  /** The reference it was marked paid with, or the statement's description. */
  paidReference: string | null
  /** The statement has a line tied to it. Until then it is "paid, waiting for the statement". */
  confirmed: boolean
  statementDate: string | null
  accountId: string | null
  caseNumber: string | null
}

export function toPaidOut(r: Record<string, unknown>): PaidOut {
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
  return {
    kind: r.kind === 'refund' ? 'refund' : r.kind === 'business_transfer' ? 'business_transfer' : 'payover',
    id: String(r.id),
    payee: String(r.payee ?? ''),
    amount: Number(r.amount ?? 0),
    reference: s(r.reference),
    paidAt: s(r.paid_at),
    paidReference: s(r.paid_reference),
    confirmed: Boolean(r.confirmed),
    statementDate: s(r.statement_date),
    accountId: s(r.account_id),
    caseNumber: s(r.case_number),
  }
}

/**
 * THE FIRM'S OWN TRANSFER TO ITS BUSINESS ACCOUNT, referenced like every other payment out: 'BF
 * FEES-' + the year and month it is drawn in ('BF FEES-2610'). One a month is the usual rhythm; a
 * second in the same month is the firm's to tell apart, and the box stays editable for that.
 */
export function transferReference(todayIso: string): string {
  return `BF FEES-${todayIso.slice(2, 4)}${todayIso.slice(5, 7)}`
}
