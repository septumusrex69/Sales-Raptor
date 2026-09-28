/**
 * THE FINANCE SECTION'S DATA, AND WHY ALMOST NONE OF IT IS A SELECT.
 *
 * Every screen in this section is an aggregate over the whole book: one row per client, four
 * numbers above it, the exceptions behind those. CLAUDE.md's rule about the two data paths is the
 * whole design here -- `AppStore` holds the sales side because a person edits a few hundred rows,
 * and the collections book is queried in the database because it is hundreds of thousands and a
 * screen that loads it to count it stops working the month it matters.
 *
 * So these are RPCs. Not because PostgREST could not express them, but because the filtering, the
 * ordering and the counting have to happen where the rows are, and because the one next step per
 * row is a ladder that must not be written twice -- once in SQL for the closer and once in TSX
 * for the button.
 *
 * ADMINISTRATOR ONLY, ENFORCED IN THE DATABASE. The firm: "The Finance section is Administrator
 * only. Sales representatives never see the payment split." Each function checks the role itself
 * and returns nothing otherwise, which is what makes the guard real -- a route guard in the
 * browser is a courtesy, not a boundary.
 */
import { supabase } from './supabase'

export type RunStatus = 'needs_review' | 'ready' | 'approved' | 'sent' | 'paid' | 'void'

/** The firm's own ladder, in the firm's own words, in the order the work queue sorts them. */
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  needs_review: 'Needs review',
  ready: 'Ready',
  approved: 'Approved',
  sent: 'Sent',
  paid: 'Paid',
  void: 'Void',
}

/**
 * ONE BUTTON PER ROW, and its words come from the database with the status.
 *
 * The firm asked for exactly one next step per client. Deciding which in the browser would put
 * the ladder in two places -- and the place that went stale would be the one with the button on
 * it, which is the one somebody presses.
 */
export const NEXT_STEP_LABEL: Record<string, string> = {
  fix: 'Fix exceptions',
  approve: 'Approve',
  email: 'Email advice',
  paid: 'Mark paid',
}

export interface Cycle {
  periodStart: string
  periodEnd: string
  daysLeft: number
  today: string
}

export interface WorkQueueRow {
  runId: string
  companyId: string
  client: string
  clientCode: string | null
  invoiceNumber: string
  periodStart: string
  periodEnd: string
  payments: number
  trustCapital: number
  ptcSetOff: number
  netPayover: number
  exceptions: number
  status: RunStatus
  nextStep: string
  approvedAt: string | null
  sentAt: string | null
  paidAt: string | null
  eftReference: string | null
}

export interface CycleTiles {
  moneyReceived: number
  dueToClients: number
  unmatchedCount: number
  unmatchedAmount: number
  waitingCount: number
  needsReviewCount: number
  readyCount: number
}

export interface RunPayment {
  lineId: string
  allocationId: string | null
  paymentId: string | null
  accountId: string | null
  caseNumber: string | null
  clientReference: string | null
  debtor: string
  lineKind: 'trust' | 'ptc' | 'reversal' | 'carried'
  paidToClient: boolean
  receivedAt: string | null
  capturedAt: string | null
  paymentAmount: number
  receiptFee: number
  toInterest: number
  toCosts: number
  toCapital: number
  commission: number
  commissionVat: number
  toClient: number
  dueToBf: number
  excessCredit: number
  needsRate: boolean
  capitalAfter: number
  carriedAmount: number
  lateCapture: boolean
  accountStatus: string | null
  handoverDate: string | null
  capitalHandedOver: number
  /* DERIVED, NEVER THE STATUS COLUMN. The old FileFish report printed "Paid in Full" beside
     R5 635.80 still outstanding; paid in full here means the capital is nought and nothing else. */
  paidInFull: boolean
}

export interface ExceptionJob {
  allocationId: string | null
  accountId: string
  companyId: string
  client: string
  caseNumber: string | null
  debtor: string
  kind: 'needs_rate' | 'excess_credit' | 'closed_account'
  problem: string
  amount: number | null
  action: string
  runId: string | null
  runStatus: RunStatus | null
  occurredAt: string | null
}

export interface MoneyPosition {
  accountId: string
  companyId: string
  caseNumber: string | null
  accountNumber: string | null
  status: string
  capitalHandedOver: number
  capitalOutstanding: number
  capitalTaken: number
  interestCharged: number
  interestTaken: number
  interestLeft: number
  interestCantTake: number
  costsCharged: number
  costsTaken: number
  costsLeft: number
  costsCantTake: number
  receiptFeesCharged: number
  receiptFeesTaken: number
  receiptFeesLeft: number
  receiptFeesCantTake: number
  commissionEarned: number
  commissionPotential: number
  commissionRate: number | null
  costCap: number
  costCapUsed: number
  costCapHeadroom: number
  inDuplum: boolean
  inDuplumCeiling: number
  excessCredit: number
  paymentsAllocated: number
  bfLeftToTake: number
}

export interface Preview {
  receiptFeeExcl: number
  receiptFeeVat: number
  toInterest: number
  toCosts: number
  toCapital: number
  excessCredit: number
  commission: number
  commissionVat: number
  toClient: number
  dueToBf: number
  bfTakes: number
  interestBefore: number
  costsBefore: number
  capitalBefore: number
  interestAfter: number
  costsAfter: number
  capitalAfter: number
  hasRate: boolean
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

export async function fetchCycle(): Promise<Cycle | null> {
  const { data, error } = await supabase.rpc('payover_cycle_now')
  if (error || !data || !data[0]) return null
  const r = data[0] as Record<string, unknown>
  return {
    periodStart: String(r.period_start),
    periodEnd: String(r.period_end),
    daysLeft: n(r.days_left),
    today: String(r.today),
  }
}

export async function fetchWorkQueue(periodStart?: string | null): Promise<WorkQueueRow[]> {
  const { data, error } = await supabase.rpc('payover_work_queue', {
    p_period_start: periodStart ?? null,
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    runId: String(r.run_id),
    companyId: String(r.company_id),
    client: String(r.client),
    clientCode: s(r.client_code),
    invoiceNumber: String(r.invoice_number),
    periodStart: String(r.period_start),
    periodEnd: String(r.period_end),
    payments: n(r.payments),
    trustCapital: n(r.trust_capital),
    ptcSetOff: n(r.ptc_set_off),
    netPayover: n(r.net_payover),
    exceptions: n(r.exceptions),
    status: String(r.status) as RunStatus,
    nextStep: String(r.next_step ?? ''),
    approvedAt: s(r.approved_at),
    sentAt: s(r.sent_at),
    paidAt: s(r.paid_at),
    eftReference: s(r.eft_reference),
  }))
}

export async function fetchTiles(periodStart?: string | null): Promise<CycleTiles> {
  const { data, error } = await supabase.rpc('payover_cycle_tiles', {
    p_period_start: periodStart ?? null,
  })
  if (error) throw new Error(error.message)
  const r = (data?.[0] ?? {}) as Record<string, unknown>
  return {
    moneyReceived: n(r.money_received),
    dueToClients: n(r.due_to_clients),
    unmatchedCount: n(r.unmatched_count),
    unmatchedAmount: n(r.unmatched_amount),
    waitingCount: n(r.waiting_count),
    needsReviewCount: n(r.needs_review_count),
    readyCount: n(r.ready_count),
  }
}

export async function fetchRunPayments(runId: string): Promise<RunPayment[]> {
  const { data, error } = await supabase.rpc('payover_run_payments', { p_run: runId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    lineId: String(r.line_id),
    allocationId: s(r.allocation_id),
    paymentId: s(r.payment_id),
    accountId: s(r.account_id),
    caseNumber: s(r.case_number),
    clientReference: s(r.client_reference),
    debtor: String(r.debtor),
    lineKind: String(r.line_kind) as RunPayment['lineKind'],
    paidToClient: Boolean(r.paid_to_client),
    receivedAt: s(r.received_at),
    capturedAt: s(r.captured_at),
    paymentAmount: n(r.payment_amount),
    receiptFee: n(r.receipt_fee),
    toInterest: n(r.to_interest),
    toCosts: n(r.to_costs),
    toCapital: n(r.to_capital),
    commission: n(r.commission),
    commissionVat: n(r.commission_vat),
    toClient: n(r.to_client),
    dueToBf: n(r.due_to_bf),
    excessCredit: n(r.excess_credit),
    needsRate: Boolean(r.needs_rate),
    capitalAfter: n(r.capital_after),
    carriedAmount: n(r.carried_amount),
    lateCapture: Boolean(r.late_capture),
    accountStatus: s(r.account_status),
    handoverDate: s(r.handover_date),
    capitalHandedOver: n(r.capital_handed_over),
    paidInFull: Boolean(r.paid_in_full),
  }))
}

export async function fetchExceptions(): Promise<ExceptionJob[]> {
  const { data, error } = await supabase.rpc('finance_exception_jobs')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    allocationId: s(r.allocation_id),
    accountId: String(r.account_id),
    companyId: String(r.company_id),
    client: String(r.client),
    caseNumber: s(r.case_number),
    debtor: String(r.debtor),
    kind: String(r.kind) as ExceptionJob['kind'],
    problem: String(r.problem),
    amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
    action: String(r.action),
    runId: s(r.run_id),
    runStatus: (s(r.run_status) as RunStatus | null),
    occurredAt: s(r.occurred_at),
  }))
}

export async function fetchPaymentAudit(paymentId: string): Promise<{ at: string; what: string; who: string }[]> {
  const { data, error } = await supabase.rpc('payment_audit', { p_payment: paymentId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[])
    .filter((r) => r.at)
    .map((r) => ({ at: String(r.at), what: String(r.what), who: String(r.who ?? '—') }))
}

export async function fetchMoneyPosition(accountId?: string): Promise<MoneyPosition[]> {
  const { data, error } = await supabase.rpc('money_position', { p_account: accountId ?? null })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    accountId: String(r.account_id),
    companyId: String(r.company_id),
    caseNumber: s(r.case_number),
    accountNumber: s(r.account_number),
    status: String(r.status ?? ''),
    capitalHandedOver: n(r.capital_handed_over),
    capitalOutstanding: n(r.capital_outstanding),
    capitalTaken: n(r.capital_taken),
    interestCharged: n(r.interest_charged),
    interestTaken: n(r.interest_taken),
    interestLeft: n(r.interest_left),
    interestCantTake: n(r.interest_cant_take),
    costsCharged: n(r.costs_charged),
    costsTaken: n(r.costs_taken),
    costsLeft: n(r.costs_left),
    costsCantTake: n(r.costs_cant_take),
    receiptFeesCharged: n(r.receipt_fees_charged),
    receiptFeesTaken: n(r.receipt_fees_taken),
    receiptFeesLeft: n(r.receipt_fees_left),
    receiptFeesCantTake: n(r.receipt_fees_cant_take),
    commissionEarned: n(r.commission_earned),
    commissionPotential: n(r.commission_potential),
    commissionRate: r.commission_rate === null || r.commission_rate === undefined ? null : Number(r.commission_rate),
    costCap: n(r.cost_cap),
    costCapUsed: n(r.cost_cap_used),
    costCapHeadroom: n(r.cost_cap_headroom),
    inDuplum: Boolean(r.in_duplum),
    inDuplumCeiling: n(r.in_duplum_ceiling),
    excessCredit: n(r.excess_credit),
    paymentsAllocated: n(r.payments_allocated),
    bfLeftToTake: n(r.bf_left_to_take),
  }))
}

/**
 * WHAT A PAYMENT WOULD DO, before anybody agrees to it.
 *
 * The same arithmetic as a payment that has happened -- same balances, same split, same
 * commission -- because it is literally the same two functions in the database. Writes nothing.
 */
export async function previewPayment(
  accountId: string, amount: number, paidToClient = false,
): Promise<Preview | null> {
  const { data, error } = await supabase.rpc('preview_allocation', {
    p_account: accountId, p_amount: amount, p_paid_to_client: paidToClient,
  })
  if (error) throw new Error(error.message)
  const r = data?.[0] as Record<string, unknown> | undefined
  if (!r) return null
  return {
    receiptFeeExcl: n(r.receipt_fee_excl),
    receiptFeeVat: n(r.receipt_fee_vat),
    toInterest: n(r.to_interest),
    toCosts: n(r.to_costs),
    toCapital: n(r.to_capital),
    excessCredit: n(r.excess_credit),
    commission: n(r.commission),
    commissionVat: n(r.commission_vat),
    toClient: n(r.to_client),
    dueToBf: n(r.due_to_bf),
    bfTakes: n(r.bf_takes),
    interestBefore: n(r.interest_before),
    costsBefore: n(r.costs_before),
    capitalBefore: n(r.capital_before),
    interestAfter: n(r.interest_after),
    costsAfter: n(r.costs_after),
    capitalAfter: n(r.capital_after),
    hasRate: Boolean(r.has_rate),
  }
}

/* ---------------- the four presses ---------------- */

/*
 * EVERY ONE OF THESE IS A DATABASE FUNCTION AND NOT AN UPDATE. Approving refuses while an
 * exception is open, marking paid refuses without an EFT reference, and an approved run refuses
 * to be edited at all -- and the sentences those refusals carry are written to be read by the
 * person who pressed the button. Doing any of it with a `.update()` here would move those rules
 * into the browser, where the next screen that needs them would write its own.
 */
export async function approveRun(runId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_payover_run', { p_run: runId })
  if (error) throw new Error(error.message)
}

export async function markRunSent(runId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_payover_run_sent', { p_run: runId })
  if (error) throw new Error(error.message)
}

export async function markRunPaid(runId: string, reference: string, paidAt: string): Promise<void> {
  const { error } = await supabase.rpc('mark_payover_run_paid', {
    p_run: runId, p_reference: reference, p_paid_at: paidAt,
  })
  if (error) throw new Error(error.message)
}

export async function rebuildRun(companyId: string, periodStart: string): Promise<void> {
  const { error } = await supabase.rpc('build_payover_run', {
    p_company: companyId, p_period_start: periodStart,
  })
  if (error) throw new Error(error.message)
}

/** Replay one account after a rate is set or a payment reversed, then rebuild its draft run. */
export async function reallocateAccount(accountId: string): Promise<void> {
  const { error } = await supabase.rpc('reallocate_account', { p_account_id: accountId })
  if (error) throw new Error(error.message)
}
