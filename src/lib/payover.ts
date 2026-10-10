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
import { allocationOf, type Allocation } from './allocationRules'
import { clockToday } from './clock.ts'
import { firstLineAfter } from './bankStatement.ts'

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
  /** What was decided about this line's overpayment: refund, moved, released, parked, with_client. */
  excessDisposal: string | null
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
  /*
   * HOW MUCH OF `interestBefore` HAS NOT BEEN POSTED YET, and where that period starts.
   *
   * The open period is computed rather than written -- see interestAccrual.ts -- right up until a
   * payment is taken, when `allocate_payment` posts it so the split has something to take from. So
   * the interest a preview quotes is partly a row and partly a figure that will BECOME a row the
   * moment somebody approves. These two say how much and since when, which is what turns "you owe
   * R2 936 interest" into a sentence a collector can read down the telephone.
   *
   * MAPPED HERE OR INVISIBLE FOREVER: CLAUDE.md's own warning about a column present in the
   * function, the type and the select but missing from the hand-written mapper.
   */
  interestOpen: number
  interestOpenFrom: string | null
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
    excessDisposal: s(r.excess_disposal),
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
    interestOpen: n(r.interest_open),
    interestOpenFrom: s(r.interest_open_from),
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

/**
 * APPROVED BEFORE THE CYCLE CLOSES, WITH THE REASON (the firm, 8 Oct: a large PTC where the client
 * owes the firm and the advice is needed now -- "there should be a good reason"). The reason and
 * who gave it are kept on the run; a payment processed later in the cycle goes to the next run.
 */
export async function approveRunEarly(runId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('approve_payover_run_early', { p_run: runId, p_reason: reason })
  if (error) throw new Error(error.message)
}

/** Today in Johannesburg, which is the date the database closes a cycle on. */
export function todaySast(): string {
  return clockToday()
}

/** The cycle has not ended yet, so approving now needs a reason. */
export function cycleStillOpen(periodEnd: string, today: string = todaySast()): boolean {
  return periodEnd >= today
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

/**
 * THE QUEUE BUILDS ITS OWN RUNS (the firm, 8 Oct: "I don't even have to say go and build a run").
 * Every client with processed money in this cycle or the last gets its run built or brought up to
 * date; approved, sent, paid and voided runs are left alone. Returns how many it touched.
 */
export async function refreshRuns(): Promise<number> {
  const { data, error } = await supabase.rpc('refresh_payover_runs')
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

export async function rebuildRun(companyId: string, periodStart: string): Promise<void> {
  const { error } = await supabase.rpc('build_payover_run', {
    p_company: companyId, p_period_start: periodStart,
  })
  if (error) throw new Error(error.message)
}

/* ---------------- building a run, and the test controls around it ---------------- */

/**
 * A CLIENT WITH MONEY IN A CYCLE, AND THE RUN FOR IT IF THERE IS ONE.
 *
 * WHY THIS EXISTS AT ALL: `payover_work_queue` lists runs that have already been BUILT, so until
 * one is, the Payover queue is empty and there is nothing to press. `build_payover_run` was
 * reachable only from the Exceptions screen, as a REBUILD after fixing a commission rate -- so the
 * first run for any client could never be created and the remittance advice was unreachable. The
 * firm found it the obvious way: "where is the payover report?"
 *
 * It answers the question the Build box actually asks: which clients took money in this cycle, how
 * much, and is there a run for it yet.
 */
export interface Buildable {
  companyId: string
  client: string
  clientCode: string | null
  payments: number
  received: number
  runId: string | null
  runStatus: RunStatus | null
  invoiceNumber: string | null
}

export async function fetchBuildable(periodStart: string): Promise<Buildable[]> {
  const { data, error } = await supabase.rpc('payover_buildable', { p_period_start: periodStart })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    companyId: String(r.company_id),
    client: String(r.client ?? ''),
    clientCode: (r.client_code as string | null) ?? null,
    payments: n(r.payments),
    received: n(r.received),
    runId: (r.run_id as string | null) ?? null,
    runStatus: (r.run_status as RunStatus | null) ?? null,
    invoiceNumber: (r.invoice_number as string | null) ?? null,
  }))
}

/** Build (or rebuild) one client's run for one cycle. Returns the run's id. */
export async function buildRun(companyId: string, periodStart: string): Promise<string> {
  const { data, error } = await supabase.rpc('build_payover_run', {
    p_company: companyId, p_period_start: periodStart,
  })
  if (error) throw new Error(error.message)
  return String(data)
}

/**
 * THROW A FINISHED RUN AWAY SO THE SAME CLIENT CAN BE TESTED AGAIN.
 *
 * THE FIRM: "now I'm in a testing mode and I need to test... I'm going to be testing different
 * clients, creating different clients, different scenarios, everything." Approve, email, mark paid
 * -- and the run is frozen for good, which is right for an invoice a client has received and makes
 * the loop a once-per-client-per-cycle affair while they are still testing it.
 *
 * NOT AN EDIT. It removes the run entirely and frees the cycle, so the next build starts from
 * nothing -- the payover's own rule is that a correction is a negative line in the NEXT run, never
 * a change to one that went out.
 *
 * STAGING ONLY, AND THE DATABASE IS WHERE THAT IS DECIDED. `isStagingDeployment` below is for
 * deciding whether to DRAW the button; `reset_payover_run` refuses on its own, reading a row the
 * app cannot write.
 */
export async function resetRun(runId: string): Promise<void> {
  const { error } = await supabase.rpc('reset_payover_run', { p_run: runId })
  if (error) throw new Error(error.message)
}

/**
 * MOVE A PAYMENT INTO ANOTHER CYCLE.
 *
 * A run claims on `account_payments.created_at`, not the received date somebody typed -- so every
 * receipt captured today is in today's cycle whatever date is on it, and a carry-forward, a
 * negative payover and a reversal landing in the next run are all unreachable without this. Worse,
 * backdating the received date LOOKS like it worked, so the test silently proves nothing.
 *
 * Staging only, refused in the database, and refused outright for a payment already on an issued
 * invoice.
 */
export async function movePaymentToCycle(paymentId: string, periodStart: string): Promise<void> {
  const { error } = await supabase.rpc('move_payment_to_cycle', {
    p_payment: paymentId, p_period_start: periodStart,
  })
  if (error) throw new Error(error.message)
}

/**
 * IS THIS THE STAGING DATABASE?
 *
 * ONLY TO DECIDE WHETHER TO DRAW A BUTTON. Every test control asks the database again and refuses
 * on its own, which is the lock that matters -- this one is so the browser never offers something
 * the server would refuse, and so a refusal is a missing button rather than an error message.
 * Defaults to NO on any failure, the direction an unknown has to fail in.
 */
export async function isStagingDeployment(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_staging_database')
  if (error) return false
  return data === true
}

/** Replay one account after a rate is set or a payment reversed, then rebuild its draft run. */
export async function reallocateAccount(accountId: string): Promise<void> {
  const { error } = await supabase.rpc('reallocate_account', { p_account_id: accountId })
  if (error) throw new Error(error.message)
}

/* ---------------- what the promises are worth ---------------- */

export interface ExpectedPromise {
  accountId: string
  companyId: string
  client: string
  caseNumber: string | null
  debtor: string
  promises: number
  promised: number
  bfShare: number
  clientShare: number
  vat: number
  firstDue: string | null
  lastDue: string | null
}

/**
 * EVERY PROMISE DUE BEFORE THE CUT-OFF, RUN THROUGH THE ENGINE AS A DRY RUN.
 *
 * It assumes every promise is kept, in full and on time -- which the firm's own broken-promise
 * rung says is not what happens. It answers "what is this cycle worth if the book behaves", which
 * is the question somebody asks on the 3rd, and it is an estimate on purpose.
 */
export async function fetchExpectedFromPromises(): Promise<ExpectedPromise[]> {
  const { data, error } = await supabase.rpc('expected_from_promises', {
    p_from: null, p_to: null,
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    accountId: String(r.account_id),
    companyId: String(r.company_id),
    client: String(r.client),
    caseNumber: s(r.case_number),
    debtor: String(r.debtor),
    promises: n(r.promises),
    promised: n(r.promised),
    bfShare: n(r.bf_share),
    clientShare: n(r.client_share),
    vat: n(r.vat),
    firstDue: s(r.first_due),
    lastDue: s(r.last_due),
  }))
}

/* ---------------- one account, line by line ---------------- */

export interface LedgerLine {
  paymentId: string
  receivedAt: string | null
  capturedAt: string | null
  reversed: boolean
  reversalReason: string | null
  paidToClient: boolean
  amount: number
  receiptFee: number
  toInterest: number
  toCosts: number
  toCapital: number
  excessCredit: number
  commission: number
  commissionVat: number
  toClient: number
  dueToBf: number
  needsRate: boolean
  capitalAfter: number
  interestAfter: number
  costsAfter: number
  runInvoice: string | null
  runStatus: RunStatus | null
  runId: string | null
}

export async function fetchAccountLedger(accountId: string): Promise<LedgerLine[]> {
  const { data, error } = await supabase.rpc('account_ledger', { p_account: accountId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    paymentId: String(r.payment_id),
    receivedAt: s(r.received_at),
    capturedAt: s(r.captured_at),
    reversed: Boolean(r.reversed),
    reversalReason: s(r.reversal_reason),
    paidToClient: Boolean(r.paid_to_client),
    amount: n(r.amount),
    receiptFee: n(r.receipt_fee),
    toInterest: n(r.to_interest),
    toCosts: n(r.to_costs),
    toCapital: n(r.to_capital),
    excessCredit: n(r.excess_credit),
    commission: n(r.commission),
    commissionVat: n(r.commission_vat),
    toClient: n(r.to_client),
    dueToBf: n(r.due_to_bf),
    needsRate: Boolean(r.needs_rate),
    capitalAfter: n(r.capital_after),
    interestAfter: n(r.interest_after),
    costsAfter: n(r.costs_after),
    runInvoice: s(r.run_invoice),
    runStatus: s(r.run_status) as RunStatus | null,
    runId: s(r.run_id),
  }))
}

/* ---------------- and a record of who changed a rate ---------------- */

export interface SettingChange {
  id: string
  changedAt: string
  changedBy: string | null
  setting: string
  companyId: string | null
  scope: string | null
  oldValue: string | null
  newValue: string | null
  reason: string | null
}

/**
 * WRITTEN IN THE SAME BREATH AS THE CHANGE, and never instead of it.
 *
 * If the log fails the change still stands -- the alternative is a screen that refuses to save a
 * VAT rate because an audit row would not insert, which trades a real problem for a worse one.
 * What it must not do is succeed silently while the change did not, which is why it is called
 * after the update rather than before.
 */
export async function logSettingChange(entry: {
  setting: string
  companyId?: string | null
  scope?: string | null
  oldValue?: string | null
  newValue?: string | null
  reason?: string | null
}): Promise<void> {
  const { data: me } = await supabase.auth.getUser()
  await supabase.from('finance_setting_changes').insert({
    setting: entry.setting,
    company_id: entry.companyId ?? null,
    scope: entry.scope ?? null,
    old_value: entry.oldValue ?? null,
    new_value: entry.newValue ?? null,
    reason: entry.reason ?? null,
    changed_by: me.user?.id ?? null,
  })
}

export async function fetchSettingChanges(limit = 50): Promise<SettingChange[]> {
  const { data, error } = await supabase
    .from('finance_setting_changes')
    .select('*, profiles(name)')
    .order('changed_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    changedAt: String(r.changed_at),
    changedBy: (r.profiles as { name?: string } | null)?.name ?? null,
    setting: String(r.setting),
    companyId: s(r.company_id),
    scope: s(r.scope),
    oldValue: s(r.old_value),
    newValue: s(r.new_value),
    reason: s(r.reason),
  }))
}

/* ---------------------------------------------------------------- the bank statement */

/**
 * IMPORTING A BANK STATEMENT, WHICH IS WHERE MONEY ENTERS THE FIRM.
 *
 * Everything above this line spends money the firm has already received. Until now nothing could
 * record it arriving: the allocation engine, the payover runs and the remittance advice were all
 * built and had no front door, and the only thing that could write a payment was the Swordfish
 * migration. The firm asked where to import payments and the honest answer was nowhere.
 *
 * THE PARSING IS NOT HERE. `bankStatement.ts` reads the file and imports nothing from Supabase,
 * so a check can exercise the whole of it in a second -- which matters more than usual, because
 * what it gets wrong is which debtor is credited with somebody's money.
 */

/** What an upload did, counted the way the preview counts it. */
export interface ImportOutcome {
  inserted: number
  /** Lines already present, skipped on `line_key`. A second upload of one month is all of these. */
  duplicates: number
  allocated: number
  unallocated: number
  debits: number
  notes: number
  /** A reference naming more than one account. Left for a person rather than guessed between. */
  ambiguous: number
}

/** A receipt in the trust account that nobody has placed against a debtor yet. */
export interface UnallocatedReceipt {
  id: string
  txnDate: string
  amount: number
  description: string
  reference: string | null
  bankAccount: string
  importedAt: string
  /**
   * Whether the bank line carried a reference at all.
   *
   * TWO DIFFERENT PROBLEMS WEARING ONE LABEL. No reference means somebody has to recognise a
   * depositor's name. A reference that IS here and still unplaced means it matched more than one
   * account -- and that one is the more dangerous to hurry, because both candidates look right.
   */
  hadReference: boolean
}

/** Money that left the trust account and has not been tied to a payover run. */
export interface UnreconciledPayout {
  id: string
  txnDate: string
  amount: number
  description: string
  /** A run whose net payover already equals this amount exactly. Offered, never applied. */
  candidateRun: string | null
  candidateInvoice: string | null
  candidateClient: string | null
}

export interface BankImportHistory {
  bankAccount: string
  bankAccountLabel: string | null
  firstTxn: string | null
  lastTxn: string | null
  lines: number
  allocated: number
  unallocated: number
  debits: number
  received: number
  paidOut: number
  lastImport: string | null
}

/**
 * Send a parsed statement to the database.
 *
 * THE WHOLE FILE IN ONE CALL, because the duplicate protection is a unique index and the counts
 * have to be one answer. Split into batches, two uploads of the same month could interleave and
 * the totals a person reads would describe neither.
 */
export async function importBankLines(input: {
  bankAccount: string
  bankAccountLabel: string | null
  lines: {
    key: string; date: string; amount: number; balance: number | null
    description: string; direction: string; reference: string | null
  }[]
}): Promise<ImportOutcome> {
  /* "Dated after today" -- refused whole, before anything is sent (bankStatement.firstLineAfter). */
  const late = firstLineAfter(input.lines, clockToday())
  if (late) {
    throw new Error(`That statement has a line dated ${late.date}, after today (${clockToday()}). `
      + 'A statement cannot be dated after today.')
  }
  const { data, error } = await supabase.rpc('import_bank_lines', {
    p_account: input.bankAccount,
    p_label: input.bankAccountLabel,
    /* Amounts as strings: the database column is numeric and JSON numbers are doubles, which is
       the one place a cent could go missing between the file and the ledger. */
    p_lines: input.lines.map((l) => ({
      key: l.key,
      date: l.date,
      amount: l.amount.toFixed(2),
      balance: l.balance === null ? '' : l.balance.toFixed(2),
      description: l.description,
      direction: l.direction,
      reference: l.reference ?? '',
    })),
  })
  if (error) throw new Error(error.message)
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, number> | null
  return {
    inserted: Number(r?.inserted ?? 0),
    duplicates: Number(r?.duplicates ?? 0),
    allocated: Number(r?.allocated ?? 0),
    unallocated: Number(r?.unallocated ?? 0),
    debits: Number(r?.debits ?? 0),
    notes: Number(r?.notes ?? 0),
    ambiguous: Number(r?.ambiguous ?? 0),
  }
}

export async function fetchUnallocatedReceipts(): Promise<UnallocatedReceipt[]> {
  const { data, error } = await supabase.rpc('unallocated_receipts')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    txnDate: String(r.txn_date),
    amount: Number(r.amount),
    description: String(r.description),
    reference: s(r.reference),
    bankAccount: String(r.bank_account),
    importedAt: String(r.imported_at),
    hadReference: !!r.had_reference,
  }))
}

export async function fetchUnreconciledPayouts(): Promise<UnreconciledPayout[]> {
  const { data, error } = await supabase.rpc('unreconciled_payouts')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    txnDate: String(r.txn_date),
    amount: Number(r.amount),
    description: String(r.description),
    candidateRun: s(r.candidate_run),
    candidateInvoice: s(r.candidate_invoice),
    candidateClient: s(r.candidate_client),
  }))
}

export async function fetchBankImportHistory(): Promise<BankImportHistory[]> {
  const { data, error } = await supabase.rpc('bank_import_history')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    bankAccount: String(r.bank_account),
    bankAccountLabel: s(r.bank_account_label),
    firstTxn: s(r.first_txn),
    lastTxn: s(r.last_txn),
    lines: Number(r.lines),
    allocated: Number(r.allocated),
    unallocated: Number(r.unallocated),
    debits: Number(r.debits),
    received: Number(r.received),
    paidOut: Number(r.paid_out),
    lastImport: s(r.last_import),
  }))
}

/** Place an unmatched receipt against an account. This is what creates the payment. */
export async function placeBankLine(lineId: string, accountId: string): Promise<string> {
  const { data, error } = await supabase.rpc('place_bank_line', {
    p_line: lineId, p_account: accountId,
  })
  if (error) throw new Error(error.message)
  return String(data)
}

/** Tie a payment out to the run it settles, which marks the run paid. */
export async function reconcileBankDebit(lineId: string, runId: string): Promise<void> {
  const { error } = await supabase.rpc('reconcile_bank_debit', {
    p_line: lineId, p_run: runId,
  })
  if (error) throw new Error(error.message)
}

/* ---------------------------------------------------------------- the day's payments */

/**
 * A PAYMENT WAITING TO BE APPROVED, with what it WOULD do.
 *
 * THE FIRM: "when a payment comes in, it goes into this payment state, where it automatically
 * calculates everything that is necessary... this is what we will see on a daily basis."
 *
 * THE FIGURES ARE A PREVIEW, NOT A RECORD. Nothing has been committed: the balance has not
 * moved, no fee has been raised and no payover run can see it. Approving is what makes it real.
 */
export interface AwaitingPayment {
  paymentId: string
  accountId: string
  caseNumber: string | null
  accountNumber: string | null
  debtor: string | null
  client: string | null
  receivedOn: string
  amount: number
  paidToClient: boolean
  method: string | null
  reference: string | null
  details: string | null
  source: string | null
  receiptFee: number
  receiptFeeVat: number
  toInterest: number
  toCosts: number
  toCapital: number
  excess: number
  commission: number
  commissionVat: number
  toClient: number
  dueToBf: number
  /** False where no commission rate could be found -- the firm's own cut is the one unknown. */
  hasRate: boolean
  capitalBefore: number
  capitalAfter: number
  /** The bank line it came from, so a wrong reference can be traced to what the debtor typed. */
  bankLineId: string | null
  bankDescription: string | null
  /*
   * WHY THIS ONE IS BACK.
   *
   * Null on an ordinary new receipt. Set where it is the fresh copy of something reversed, and
   * without it the row is indistinguishable from any other -- which means it gets approved again
   * exactly as it was, straight back onto the debtor it should never have been on.
   */
  cameBackFrom: string | null
  cameBackReason: string | null
  cameBackOn: string | null
  /*
   * THE INTEREST EITHER SIDE OF WHAT THIS PAYMENT TAKES.
   *
   * THE FIRM, OF SWORDFISH'S OWN GRID: "all of these fields don't appear in your ready state for
   * the payments to be allocated." Retained interest was already on the screen -- and read R 0,00
   * on every row, because nothing anywhere had any interest for it to come out of. Now that it
   * does, the figure it comes OUT OF was still missing, so a real retained figure would have
   * appeared with nothing on the row to explain it.
   *
   * `interestToDate` is what the account owes in interest as at the day the money arrived, the
   * unposted open period included. `interestAfter` is what is left once this payment has taken its
   * share. `interestOpen` is how much of the first figure has not been written down yet -- it
   * becomes a real ledger row at the moment of approval and not before.
   */
  interestToDate: number
  interestAfter: number
  interestOpen: number
  interestOpenFrom: string | null
  /*
   * THE FEES SIDE, BROKEN INTO THE THREE THINGS IT PAYS, EACH WITH THE FIRM'S FOUR FIGURES.
   *
   * THE FIRM: "the fees you need to split up into three sections. First is the interest... Then
   * the receipt fee, which is the 10% excluding VAT. Then the fees, which is the Annexure B fees.
   * Now for every single one... the total interest, the interest already retained, the interest
   * that is available, the interest we are taking now, and the interest after."
   *
   * FOUR AND NOT FIVE, because `available` and `after` are SUBTRACTIONS and the screen does them
   * through allocationRules.ts -- that is how a figure here can be found to be wrong. A function
   * that handed over the answers as well as the inputs could only ever agree with itself.
   */
  interestTotal: number
  interestCant: number
  interestRetained: number
  rfTotal: number
  rfCant: number
  rfRetained: number
  toReceiptFees: number
  feesTotal: number
  feesCant: number
  feesRetained: number
  toFees: number
  /* The pool the receipt fee and the Annexure B fees are a derived split of -- see Allocation. */
  costsBefore: number
  costsAfter: number
  /** Null on a client with sliding bands: there is no one rate the commission can be checked on. */
  commissionRate: number | null
  vatRate: number
}

/**
 * ONE ROW AS THE RULES WANT IT.
 *
 * The screen and check-allocation-rules both go through this, so a figure the rules pass and the
 * screen draws cannot be two different figures. THE RECEIPT FEE IS JOINED HERE: `receiptFee` is
 * the 10% EXCLUDING VAT and `receiptFeeVat` is the VAT on it, and what the split actually spends
 * -- and what the firm asked to see -- is the two added together.
 */
export function awaitingAllocation(r: AwaitingPayment): Allocation {
  return allocationOf({
    payment: r.amount,
    interestTotal: r.interestTotal,
    interestCant: r.interestCant,
    interestRetained: r.interestRetained,
    interestBefore: r.interestToDate,
    toInterest: r.toInterest,
    interestAfter: r.interestAfter,
    rfTotal: r.rfTotal,
    rfCant: r.rfCant,
    rfRetained: r.rfRetained,
    toReceiptFees: r.toReceiptFees,
    feesTotal: r.feesTotal,
    feesCant: r.feesCant,
    feesRetained: r.feesRetained,
    toFees: r.toFees,
    costsBefore: r.costsBefore,
    costsAfter: r.costsAfter,
    receiptFeeRaised: r.receiptFee + r.receiptFeeVat,
    capitalBefore: r.capitalBefore,
    toCapital: r.toCapital,
    capitalAfter: r.capitalAfter,
    commission: r.commission,
    commissionVat: r.commissionVat,
    toClient: r.toClient,
    dueToBf: r.dueToBf,
    excess: r.excess,
    paidToClient: r.paidToClient,
    commissionRate: r.commissionRate,
    vatRate: r.vatRate,
  })
}

export async function fetchAwaitingApproval(): Promise<AwaitingPayment[]> {
  const { data, error } = await supabase.rpc('payments_awaiting_approval')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    paymentId: String(r.payment_id),
    accountId: String(r.account_id),
    caseNumber: s(r.case_number),
    accountNumber: s(r.account_number),
    debtor: s(r.debtor),
    client: s(r.client),
    receivedOn: String(r.received_on),
    amount: Number(r.amount),
    paidToClient: !!r.paid_to_client,
    method: s(r.method),
    reference: s(r.reference),
    details: s(r.details),
    source: s(r.source),
    receiptFee: Number(r.receipt_fee ?? 0),
    receiptFeeVat: Number(r.receipt_fee_vat ?? 0),
    toInterest: Number(r.to_interest ?? 0),
    toCosts: Number(r.to_costs ?? 0),
    toCapital: Number(r.to_capital ?? 0),
    excess: Number(r.excess ?? 0),
    commission: Number(r.commission ?? 0),
    commissionVat: Number(r.commission_vat ?? 0),
    toClient: Number(r.to_client ?? 0),
    dueToBf: Number(r.due_to_bf ?? 0),
    hasRate: r.has_rate !== false,
    capitalBefore: Number(r.capital_before ?? 0),
    capitalAfter: Number(r.capital_after ?? 0),
    bankLineId: s(r.bank_line_id),
    bankDescription: s(r.bank_description),
    /* CLAUDE.md's own warning: a column in the function, the type and the select but missing from
       the hand-written mapper reads as undefined for ever and nothing fails. */
    cameBackFrom: s(r.came_back_from),
    cameBackReason: s(r.came_back_reason),
    cameBackOn: s(r.came_back_on),
    interestToDate: Number(r.interest_to_date ?? 0),
    interestAfter: Number(r.interest_after ?? 0),
    interestOpen: Number(r.interest_open ?? 0),
    interestOpenFrom: s(r.interest_open_from),
    interestTotal: Number(r.interest_total ?? 0),
    interestCant: Number(r.interest_cant ?? 0),
    interestRetained: Number(r.interest_retained ?? 0),
    rfTotal: Number(r.rf_total ?? 0),
    rfCant: Number(r.rf_cant ?? 0),
    rfRetained: Number(r.rf_retained ?? 0),
    toReceiptFees: Number(r.to_receipt_fees ?? 0),
    feesTotal: Number(r.fees_total ?? 0),
    feesCant: Number(r.fees_cant ?? 0),
    feesRetained: Number(r.fees_retained ?? 0),
    toFees: Number(r.to_fees ?? 0),
    costsBefore: Number(r.costs_before ?? 0),
    costsAfter: Number(r.costs_after ?? 0),
    /* NULL AND NOT NOUGHT where the client has bands: nought is a rate somebody chose. */
    commissionRate: r.commission_rate == null ? null : Number(r.commission_rate),
    vatRate: Number(r.vat_rate ?? 0.15),
  }))
}

/**
 * A RECEIPT THAT HAS ALREADY BEEN POSTED, WITH ENOUGH ON IT TO BE CHECKED AGAIN.
 *
 * THE FIRM: "you can add whatever you need for the administrator to ensure that we can double
 * check every single thing that comes in."
 *
 * THE APPROVAL QUEUE CHECKS THE PREVIEW AND THEN THE PAYMENT LEAVES IT. Once approved, the
 * allocation is written and the client is paid on it, and nothing looks at it again -- so the one
 * figure the firm could never revisit was the one that mattered. These rows are the allocation as
 * the ENGINE WROTE IT, which is what makes running the formulas over them a real check rather than
 * a restatement of a forecast.
 */
export interface PostedPayment {
  paymentId: string
  allocationId: string
  accountId: string
  caseNumber: string | null
  accountNumber: string | null
  debtor: string | null
  client: string | null
  receivedOn: string
  approvedOn: string | null
  approvedByName: string | null
  amount: number
  paidToClient: boolean
  method: string | null
  reference: string | null
  bankDescription: string | null
  source: string | null
  /** `allocated`, `needs_rate` or `reversed` -- the allocation's own state, not the payment's. */
  status: string | null
  /*
   * WHICH ENGINE WROTE IT, and it decides what the screen may claim about the row.
   *
   * `v1-5050` allocations have nought in the two fee-split columns and nothing in the thirteen
   * before-figures, because neither existed when they were written. A screen that could not tell
   * the two apart would draw an older payment as one that paid nothing towards its own receipt
   * fee, which is a different and much worse statement than "this was written before we recorded
   * that".
   */
  engineVersion: string | null
  computedAt: string | null
  runInvoice: string | null
  runStatus: string | null
  runPaidOn: string | null
  reversedOn: string | null
  reversalReason: string | null
  receiptFee: number
  receiptFeeVat: number
  toInterest: number
  toReceiptFees: number
  toFees: number
  toCosts: number
  toCapital: number
  excess: number
  commission: number
  commissionVat: number
  toClient: number
  dueToBf: number
  commissionRate: number | null
  vatRate: number
  interestTotal: number
  interestCant: number
  interestRetained: number
  interestBefore: number
  interestAfter: number
  rfTotal: number
  rfCant: number
  rfRetained: number
  feesTotal: number
  feesCant: number
  feesRetained: number
  costsBefore: number
  costsAfter: number
  capitalBefore: number
  capitalAfter: number
  /*
   * AND WHAT THE ACCOUNT'S OWN ROWS ADD UP TO TODAY, which is a different question from everything
   * above it. An allocation can be internally perfect and still sit on an account whose ledger
   * says something else -- that is what a reversal that half-ran looks like, and it is invisible
   * to any check that only reads the allocation.
   */
  feesRaised: number
  interestPosted: number
  paymentsBanked: number
  /** True where this allocation predates the columns the five figures need. */
  beforeTheRecord: boolean
}

export async function fetchPostedPayments(from?: string, to?: string): Promise<PostedPayment[]> {
  const { data, error } = await supabase.rpc('payments_posted', {
    p_from: from ?? null, p_to: to ?? null,
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    paymentId: String(r.payment_id),
    allocationId: String(r.allocation_id),
    accountId: String(r.account_id),
    caseNumber: s(r.case_number),
    accountNumber: s(r.account_number),
    debtor: s(r.debtor),
    client: s(r.client),
    receivedOn: String(r.received_on),
    approvedOn: s(r.approved_on),
    approvedByName: s(r.approved_by_name),
    amount: Number(r.amount ?? 0),
    paidToClient: !!r.paid_to_client,
    method: s(r.method),
    reference: s(r.reference),
    bankDescription: s(r.bank_description),
    source: s(r.source),
    status: s(r.status),
    engineVersion: s(r.engine_version),
    computedAt: s(r.computed_at),
    runInvoice: s(r.run_invoice),
    runStatus: s(r.run_status),
    runPaidOn: s(r.run_paid_on),
    reversedOn: s(r.reversed_on),
    reversalReason: s(r.reversal_reason),
    receiptFee: Number(r.receipt_fee_excl ?? 0),
    receiptFeeVat: Number(r.receipt_fee_vat ?? 0),
    toInterest: Number(r.to_interest ?? 0),
    toReceiptFees: Number(r.to_receipt_fees ?? 0),
    toFees: Number(r.to_fees ?? 0),
    toCosts: Number(r.to_costs ?? 0),
    toCapital: Number(r.to_capital ?? 0),
    excess: Number(r.excess ?? 0),
    commission: Number(r.commission ?? 0),
    commissionVat: Number(r.commission_vat ?? 0),
    toClient: Number(r.to_client ?? 0),
    dueToBf: Number(r.due_to_bf ?? 0),
    /* NULL AND NOT NOUGHT where the client has bands: nought is a rate somebody chose. */
    commissionRate: r.commission_rate == null ? null : Number(r.commission_rate),
    vatRate: Number(r.vat_rate ?? 0.15),
    interestTotal: Number(r.interest_total ?? 0),
    interestCant: Number(r.interest_cant ?? 0),
    interestRetained: Number(r.interest_retained ?? 0),
    interestBefore: Number(r.interest_before ?? 0),
    interestAfter: Number(r.interest_after ?? 0),
    rfTotal: Number(r.rf_total ?? 0),
    rfCant: Number(r.rf_cant ?? 0),
    rfRetained: Number(r.rf_retained ?? 0),
    feesTotal: Number(r.fees_total ?? 0),
    feesCant: Number(r.fees_cant ?? 0),
    feesRetained: Number(r.fees_retained ?? 0),
    costsBefore: Number(r.costs_before ?? 0),
    costsAfter: Number(r.costs_after ?? 0),
    capitalBefore: Number(r.capital_before ?? 0),
    capitalAfter: Number(r.capital_after ?? 0),
    feesRaised: Number(r.fees_raised ?? 0),
    interestPosted: Number(r.interest_posted ?? 0),
    paymentsBanked: Number(r.payments_banked ?? 0),
    /*
     * READ OFF A COLUMN BEING NULL RATHER THAN OFF THE ENGINE VERSION STRING.
     *
     * The version says which code wrote the row; this says whether the row has the figures. They
     * agree today and the day somebody backfills one without bumping the other they would not --
     * and the thing the screen needs to know is whether there is anything to draw.
     */
    beforeTheRecord: r.costs_before == null || r.interest_before == null,
  }))
}

/**
 * ONE POSTED ROW AS THE RULES WANT IT.
 *
 * THE INTEREST LINE TAKES THE STORED `interest_before` AND `interest_after`, which is what makes
 * the firm's first formula a real comparison here too: those two were written by the engine at the
 * moment of posting, arrived at a completely different way from `total - ceiling - retained`.
 */
export function postedAllocation(r: PostedPayment): Allocation {
  return allocationOf({
    payment: r.amount,
    interestTotal: r.interestTotal,
    interestCant: r.interestCant,
    interestRetained: r.interestRetained,
    interestBefore: r.interestBefore,
    toInterest: r.toInterest,
    interestAfter: r.interestAfter,
    rfTotal: r.rfTotal,
    rfCant: r.rfCant,
    rfRetained: r.rfRetained,
    toReceiptFees: r.toReceiptFees,
    feesTotal: r.feesTotal,
    feesCant: r.feesCant,
    feesRetained: r.feesRetained,
    toFees: r.toFees,
    costsBefore: r.costsBefore,
    costsAfter: r.costsAfter,
    receiptFeeRaised: r.receiptFee + r.receiptFeeVat,
    capitalBefore: r.capitalBefore,
    toCapital: r.toCapital,
    capitalAfter: r.capitalAfter,
    commission: r.commission,
    commissionVat: r.commissionVat,
    toClient: r.toClient,
    dueToBf: r.dueToBf,
    excess: r.excess,
    paidToClient: r.paidToClient,
    commissionRate: r.commissionRate,
    vatRate: r.vatRate,
  })
}

export interface ApprovalOutcome {
  approved: number
  skipped: number
  /** One sentence per payment that could not be approved, as the database wrote it. */
  problems: string[]
}

/**
 * Approve some payments.
 *
 * ONE CALL FOR ANY NUMBER, because the firm works a morning's list: "approve every payment
 * singly, or approve all payments, or highlight certain ones and approve them." The database
 * approves them one at a time inside it -- each allocation reads balances the one before it
 * moved -- and a payment that cannot go through names itself while the rest still do.
 */
export async function approvePayments(paymentIds: string[]): Promise<ApprovalOutcome> {
  const { data, error } = await supabase.rpc('approve_payments', { p_payments: paymentIds })
  if (error) throw new Error(error.message)
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  return {
    approved: Number(r?.approved ?? 0),
    skipped: Number(r?.skipped ?? 0),
    problems: (r?.problems as string[] | null) ?? [],
  }
}

/**
 * REVERSING ONE RECEIPT.
 *
 * THE FIRM: "so you can't reverse a payment." Two faults, and the second was the dangerous one.
 * The confirm was drawn in a colour that did not exist, so it was white on white and could not be
 * seen -- and underneath it the modal was PATCHing `account_payments` directly. That table is one
 * of the four ledgers that carry no update policy on purpose, so RLS matched no rows: PostgREST
 * answered 204, the error was null, the box closed and the list reloaded with the payment exactly
 * as it was. A reversal that reads as done and did nothing leaves the account credited for money
 * that came back.
 *
 * IT LIVES HERE RATHER THAN IN THE SCREEN for the reason every other finance write does: an RPC
 * called from `payover.ts` is one `check-finance-is-administrator-only` reads off the source, so
 * it is held to the Administrator rule and to the revoke list automatically. Called straight from
 * a page it would have escaped both, which is the whole point of having one library.
 *
 * Everything that FOLLOWS a reversal -- the receipt fee cancelled, the invoiced capital given
 * back, the later payments re-split -- is `reverse_payment_allocation`, the trigger on
 * `reversed_at`, and is unchanged.
 */
export async function reversePayment(paymentId: string, reason: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('reverse_payment', {
    p_payment: paymentId,
    p_reason: reason,
  })
  if (error) throw new Error(error.message)
  /*
   * THE COPY'S ID, OR NULL. An APPROVED receipt comes back as a fresh unapproved one in the day's
   * queue -- the firm: a reversal "goes back into a state ready for approval". One that was still
   * waiting simply leaves the queue, which is also how a cheque that turned out to have bounced
   * is got rid of, and there is nothing to return.
   */
  return typeof data === 'string' ? data : null
}

/**
 * REVERSE TO "NEEDS AN ACCOUNT" (the firm, 10 Oct: a payment on the wrong reference). The receipt
 * is reversed and its statement line goes back on the unplaced list, to be put on the right
 * debtor; no copy waits in the queue. Only for a receipt that came off a statement --
 * `reverse_payment_to_unplaced` refuses one recorded by hand, saying what to do instead.
 */
export async function reversePaymentToUnplaced(paymentId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('reverse_payment_to_unplaced', { p_payment: paymentId, p_reason: reason })
  if (error) throw new Error(error.message)
}

/**
 * PUTTING AN UNAPPROVED RECEIPT ON THE RIGHT DEBTOR.
 *
 * The firm, asked what the approval queue may change: the account only. Which debtor it goes on is
 * what was wrong; the amount and the date are what the bank said, and nobody may quietly turn
 * R 5 000 into R 500.
 *
 * It is not an edit to a financial record, and the function's guards are what make that true: an
 * unapproved payment has nothing split, no fee raised and no remittance run against it, which is
 * the whole reason the approval gate exists. Approved, it refuses and says to reverse instead.
 */
export async function setPaymentAccount(paymentId: string, accountId: string): Promise<void> {
  const { error } = await supabase.rpc('set_payment_account', {
    p_payment: paymentId,
    p_account: accountId,
  })
  if (error) throw new Error(error.message)
}

/* ---------------- rejecting one, which is neither a reversal nor a suspense ---------------- */

/**
 * A RECEIPT SOMEBODY TOOK OFF THE QUEUE WITHOUT APPROVING IT.
 *
 * THE FIRM: "there are no way to reject payments that are imported. From an import sheet... there's
 * some ones waiting in the queue to be approved, but I don't want to approve them."
 *
 * THREE WORDS FOR THREE DIFFERENT THINGS, and the screen had only two of them:
 *
 *   MOVE      — I know whose this is, and it is not this debtor's.
 *   SUSPENSE  — I do not know whose this is yet. Park it; somebody will place it.
 *   REJECT    — this should not become a payment at all.
 *
 * AND IT IS NOT A REVERSAL. A reversal undoes a payment that was approved and POSTED: it writes
 * contra entries through the ledger, because a balance moved and a client may already have been
 * paid on it. A rejected receipt never reached allocate_payment, so there is nothing to reverse --
 * and calling it a reversal would put it on reports as money that came back.
 *
 * NOTHING IS DELETED. The money arrived in the trust account whatever anybody decided about it, so
 * the payment row stands with its reason and the statement line goes back on the unallocated list
 * to be placed properly. A receipt that vanished from every screen is one nobody can reconcile
 * against the bank.
 */
export interface RejectedPayment {
  paymentId: string
  accountId: string
  caseNumber: string | null
  accountNumber: string | null
  debtor: string | null
  client: string | null
  receivedOn: string
  amount: number
  reference: string | null
  bankDescription: string | null
  source: string | null
  rejectedOn: string
  rejectedAt: string
  rejectedByName: string | null
  rejectionReason: string | null
  /** Where the statement line went: back on the unallocated list, or marked as not a receipt. */
  lineStatus: string | null
  bankLineId: string | null
}

export async function fetchRejectedPayments(since?: string): Promise<RejectedPayment[]> {
  const { data, error } = await supabase.rpc('payments_rejected', { p_since: since ?? null })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    paymentId: String(r.payment_id),
    accountId: String(r.account_id),
    caseNumber: s(r.case_number),
    accountNumber: s(r.account_number),
    debtor: s(r.debtor),
    client: s(r.client),
    receivedOn: String(r.received_on),
    amount: Number(r.amount ?? 0),
    reference: s(r.reference),
    bankDescription: s(r.bank_description),
    source: s(r.source),
    rejectedOn: String(r.rejected_on),
    rejectedAt: String(r.rejected_at),
    rejectedByName: s(r.rejected_by_name),
    rejectionReason: s(r.rejection_reason),
    lineStatus: s(r.line_status),
    bankLineId: s(r.bank_line_id),
  }))
}

/** What a batch of rejections did, in the shape `approvePayments` returns. */
export interface RejectionOutcome {
  rejected: number
  skipped: number
  problems: string[]
}

/**
 * Reject some.
 *
 * ONE CALL FOR ANY NUMBER AND ONE REASON BETWEEN THEM, because the firm clears a morning's list:
 * the receipts being thrown out together are being thrown out for the same reason, and asking
 * eight times is how somebody starts typing "x".
 *
 * `notAReceipt` DECIDES WHERE THE STATEMENT LINE GOES, and the two answers are genuinely
 * different. False -- the default -- puts it back on the unallocated list, because the money
 * arrived and still has to be placed; it is this PAYMENT that is wrong. True marks the line
 * excluded, for a line that is not a debtor receipt at all: an interbank transfer, a bank error,
 * something the importer misread. Putting one of those back on the unallocated list is work the
 * firm would do again every morning.
 */
export async function rejectPayments(
  paymentIds: string[], reason: string, notAReceipt = false,
): Promise<RejectionOutcome> {
  const { data, error } = await supabase.rpc('reject_payments', {
    p_payments: paymentIds,
    p_reason: reason,
    p_not_a_receipt: notAReceipt,
  })
  if (error) throw new Error(error.message)
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  return {
    rejected: Number(r?.rejected ?? 0),
    skipped: Number(r?.skipped ?? 0),
    problems: (r?.problems as string[] | null) ?? [],
  }
}

/**
 * BACK ON THE QUEUE, for one rejected by mistake.
 *
 * Rejecting is done at speed down a morning's list, which is exactly when the wrong row gets
 * pressed -- so the undo sits beside the mistake rather than in a screen somebody has to find.
 * Refused by the database where the statement line has since been placed on another payment,
 * because then putting this one back would claim money that is already somewhere else.
 */
export async function unrejectPayment(paymentId: string): Promise<void> {
  const { error } = await supabase.rpc('unreject_payment', { p_payment: paymentId })
  if (error) throw new Error(error.message)
}

/* ---------------- suspense, the half that is a PAYMENT rather than a bank line ---------------- */

/**
 * A RECEIPT SOMEBODY PARKED FROM THE APPROVAL QUEUE.
 *
 * THE FIRM: "when something is in that state of approval, it should also give you an option to put
 * it into suspense... Otherwise you have to go and look for it in suspense and allocate it later."
 *
 * NOT THE SAME AS AN UNPLACED BANK LINE, and the two lists stay apart on purpose. A line in
 * `unallocated_receipts` has never been attributed to anybody -- "CAPITEC L SOLOMONS" with no
 * reference. One of these WAS attributed, usually by a reversal putting it back in the queue, and
 * the person looking at it knows the account is wrong without yet knowing the right one.
 */
export interface SuspendedPayment {
  paymentId: string
  /** The account it is sitting on, which is wrong -- and the only clue to where it came from. */
  accountId: string
  caseNumber: string | null
  debtor: string | null
  receivedOn: string
  amount: number
  reference: string | null
  details: string | null
  source: string | null
  suspendedOn: string
  /** Why it was parked, in the words of whoever parked it. */
  reason: string | null
  /** Where a reversal put it here, the reversed receipt and the reason given then. */
  cameBackFrom: string | null
  cameBackReason: string | null
}

export async function fetchSuspendedPayments(): Promise<SuspendedPayment[]> {
  const { data, error } = await supabase.rpc('suspended_payments')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    paymentId: String(r.payment_id),
    accountId: String(r.account_id),
    caseNumber: s(r.case_number),
    debtor: s(r.debtor),
    receivedOn: String(r.received_on),
    amount: Number(r.amount),
    reference: s(r.reference),
    details: s(r.details),
    source: s(r.source),
    suspendedOn: String(r.suspended_on),
    reason: s(r.reason),
    cameBackFrom: s(r.came_back_from),
    cameBackReason: s(r.came_back_reason),
  }))
}

/**
 * PARK IT, WITH A REASON.
 *
 * The reason is required by the function and not only by the box: a receipt in suspense with no
 * words is one nobody can place without going to ask who parked it. It is the whole of what the
 * next person has to work from.
 *
 * REFUSED ONCE IT IS APPROVED, which is the same line `setPaymentAccount` draws: past that point
 * it has been split, a fee has been raised and it may be on a remittance, so the only way back is
 * a reversal.
 */
export async function suspendPayment(paymentId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('suspend_payment', {
    p_payment: paymentId,
    p_reason: reason,
  })
  if (error) throw new Error(error.message)
}

/**
 * BACK INTO THE QUEUE, for one parked by mistake.
 *
 * THE OTHER WAY OUT IS `setPaymentAccount`, which clears the parking itself -- giving a receipt
 * the account it belongs to IS taking it out of suspense, and a second button to say so is a
 * second chance to leave it there.
 */
export async function releasePaymentFromSuspense(paymentId: string): Promise<void> {
  const { error } = await supabase.rpc('release_payment_from_suspense', { p_payment: paymentId })
  if (error) throw new Error(error.message)
}

/**
 * EACH ACCOUNT'S HANDOVER DAY, for the "before handover" badge on the approval queue.
 *
 * Read separately rather than added to payments_awaiting_approval, whose OUT columns would have to
 * be dropped and re-made to grow. IN CHUNKS: a morning of three thousand receipts is three thousand
 * ids, and one `in.(...)` that long is a URL the gateway refuses. A failure here only loses a badge,
 * so it is the caller's to swallow -- the badge is then absent, never drawn as a pass.
 */
export async function fetchHandoverDates(accountIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(accountIds)]
  const out = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from('debtor_accounts')
      .select('id, handover_date').in('id', ids.slice(i, i + 150))
    if (error) throw new Error(error.message)
    for (const r of (data ?? []) as { id: string; handover_date: string | null }[]) {
      if (r.handover_date) out.set(r.id, r.handover_date)
    }
  }
  return out
}

/** What Payments in has already processed between two days -- see payments_in_month. */
export interface ProcessedMonth { trustCount: number; trustAmount: number; ptcCount: number; ptcAmount: number }

export async function fetchProcessedMonth(from: string, to: string): Promise<ProcessedMonth> {
  const { data, error } = await supabase.rpc('payments_in_month', { p_from: from, p_to: to })
  if (error) throw new Error(error.message)
  const r = ((data ?? []) as Record<string, unknown>[])[0] ?? {}
  return {
    trustCount: Number(r.trust_count ?? 0), trustAmount: Number(r.trust_amount ?? 0),
    ptcCount: Number(r.ptc_count ?? 0), ptcAmount: Number(r.ptc_amount ?? 0),
  }
}
