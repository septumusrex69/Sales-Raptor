import { departmentOf } from './departments.ts'
import { isWorkingDay } from './workingDays.ts'
import type { UserRole } from '../types'

/**
 * THE CLERKS' COLLECTION COMMISSION, AND THE PAY STATEMENT IT LANDS ON (22 Oct 2026).
 *
 * THE FIRM (Stephan): "the commissions for the clerks, they work on a 4,000 rand basic, plus then
 * there's a variation in collection commission for all of them. So for example, if a client is on 30
 * or 25%, they get 3%. If anything less than that, it is proportionately lowered ... a client on 20%,
 * they get 2%. Or client on 15%, they get 1.5%."
 *
 * PURE, so check-clerk-commission can hold every rule here without a database. The database only
 * GATHERS (clerk_commission_lines: one row a payment, with who held the account that day, the rate
 * the client was charged, the overrides in force and the payover run it rode; clerk_commission_runs:
 * each client's payover runs as recompute_payover_run left them). Everything decided is decided in
 * this file, once.
 *
 * NOTHING HERE IS STORED. A statement is worked out every time it is opened, from the payments as
 * they stand. That is safe only because every input is itself fixed by date -- the payment day, the
 * desk on that day, the override in force on that day, a run only once it is an approved invoice and
 * only from the pay day after its approval -- so a month
 * already paid reads the same next year, and a reversal arrives as a NEW line in its own month rather
 * than by changing an old one.
 *
 * ------------------------------------------------------------------------------------------
 * THE PERIOD IS THE FIRM'S COLLECTIONS MONTH, THE 11TH TO THE 10TH
 * ------------------------------------------------------------------------------------------
 * The floor's "collected this month" is that month (salesMonth.ts), and so is the client's payover
 * cycle. Pay on calendar months would put two different "October" figures in front of a clerk -- the
 * floor's and their pay slip's -- for the same money. Named after the month it ends in, like the floor.
 */

/* ------------------------------------------------------------------------------------------------
 * The rate
 * ---------------------------------------------------------------------------------------------- */

/** Where a payment's rate came from. Shown beside every line, because a rate nobody can explain is
 *  an argument at month end. */
export type RateSource = 'rule' | 'client' | 'account' | 'none'

export const RATE_SOURCE_LABEL: Record<RateSource, string> = {
  rule: 'Rule',
  client: 'Client exception',
  account: 'Account exception',
  none: 'No client rate',
}

/** The client's rate at or above which a clerk earns the full 3%. */
export const FULL_RATE_FROM = 0.25
/** The full rate. */
export const FULL_CLERK_RATE = 0.03

/** Rates to six places: 24% / 10 is 0.024 and must not print as 0.024000000000000004. */
const six = (n: number) => Math.round(n * 1e6) / 1e6

/**
 * THE RULE: a client on 25% or more pays the clerk 3%; below that, a tenth of the client's rate.
 * Fractions throughout, as the database stores them (0.25 is 25%). A client with no rate gives no
 * rule -- null, not nought, so the screen can say WHY there is no commission rather than show R0.00
 * as if it were earned and worth nothing.
 */
export function rateForClient(clientRate: number | null | undefined): number | null {
  if (clientRate === null || clientRate === undefined || !Number.isFinite(clientRate)) return null
  if (clientRate <= 0) return 0
  if (clientRate >= FULL_RATE_FROM) return FULL_CLERK_RATE
  return six(clientRate / 10)
}

/**
 * THE EXCEPTIONS: "we should be able to lower or higher the specific commission percentage on a
 * specific client ... or on a specific account." The ACCOUNT beats the CLIENT beats the rule -- the
 * narrower decision is the more deliberate one. Each override passed in is already the one in force
 * on the payment day (the database reads it by effective date); null means none.
 *
 * NEVER ABOVE 3% (the firm, 23 Oct, of these exceptions: "anything below 3%"). The database refuses
 * a higher one (clerk_commission_overrides_rate_upto_3) and so does the screen.
 */
export const EXCEPTION_MAX = 0.03

export function exceptionRateOk(rate: number): boolean {
  return Number.isFinite(rate) && rate >= 0 && rate <= EXCEPTION_MAX + 1e-12
}

export function resolveRate(input: {
  clientRate: number | null
  clientOverride: number | null
  accountOverride: number | null
}): { rate: number | null; source: RateSource } {
  if (input.accountOverride !== null && input.accountOverride !== undefined) {
    return { rate: input.accountOverride, source: 'account' }
  }
  if (input.clientOverride !== null && input.clientOverride !== undefined) {
    return { rate: input.clientOverride, source: 'client' }
  }
  const rule = rateForClient(input.clientRate)
  return rule === null ? { rate: null, source: 'none' } : { rate: rule, source: 'rule' }
}

/**
 * TO THE CENT, A LINE AT A TIME, half away from zero -- so a reversal is exactly the negative of the
 * line it reverses, and the total is the sum of what is printed rather than a figure nobody can add up
 * from the page. Confirmed by the firm, 23 Oct: to the cent per payment, totals the sum of the lines.
 */
export function cents(n: number): number {
  const sign = n < 0 ? -1 : 1
  return (sign * Math.round(Math.abs(n) * 100 + 1e-9)) / 100
}

/** "Debtor pays R10 000 on a 30% client -> clerk earns R300": a percentage of the MONEY COLLECTED. */
export function commissionOn(amount: number, rate: number | null): number {
  if (rate === null) return 0
  return cents(amount * rate)
}

/* ------------------------------------------------------------------------------------------------
 * The period
 * ---------------------------------------------------------------------------------------------- */

export interface PayPeriod {
  /** 'YYYY-MM', the month it ends in. */
  key: string
  /** First day, inclusive: the 11th of the month before. */
  start: string
  /** Last day, inclusive: the 10th. */
  end: string
}

const pad = (n: number) => String(n).padStart(2, '0')

export function periodForKey(key: string): PayPeriod {
  const [y, m] = key.split('-').map(Number)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  return { key, start: `${py}-${pad(pm)}-11`, end: `${y}-${pad(m)}-10` }
}

/** The period a day falls in: on or after the 11th, the one ending next month. */
export function periodKeyOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  if (d <= 10) return `${y}-${pad(m)}`
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`
}

export function shiftPeriod(key: string, by: number): string {
  const [y, m] = key.split('-').map(Number)
  const i = y * 12 + (m - 1) + by
  return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December']
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function periodLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

export function shortDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return `${d} ${SHORT[m - 1]} ${y}`
}

export function periodRange(key: string): string {
  const p = periodForKey(key)
  return `${shortDay(p.start)} – ${shortDay(p.end)}`
}

/* ------------------------------------------------------------------------------------------------
 * Payday, and the salary month
 * ---------------------------------------------------------------------------------------------- */

/**
 * PAID ON THE 25TH (the firm, 23 Oct). Commission is earned over the collections month, the 11th to
 * the 10th, and paid on the 25th of the month that period ends in: 11 Sep - 10 Oct is paid 25 Oct.
 * The basic is paid the same day for the SALARY month, the 26th to the 25th: 26 Sep - 25 Oct is paid
 * 25 Oct. So one key ('2026-10') names one pay day and both of the months it pays for.
 *
 * The 25th as written, even on a weekend: the firm said the 25th, and moving a pay day is theirs to
 * decide (HANDOFF §4).
 */
export const PAYDAY = 25

export function paydayOf(key: string): string {
  return `${key}-${pad(PAYDAY)}`
}

/**
 * THE FIRST PAY DAY ON OR AFTER A DAY, as its key. A run approved on the 11th of October is known
 * before the 25th and its PTC commission goes out on 25 October; one approved on the 27th waits for
 * 25 November. This is what turns "the payover showed nothing outstanding" into a pay day.
 */
export function payKeyOn(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  if (d <= PAYDAY) return `${y}-${pad(m)}`
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`
}

/** The salary month a pay day pays the basic for: the 26th of the month before to the 25th. */
export function salaryMonth(key: string): { start: string; end: string } {
  const [y, m] = key.split('-').map(Number)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  return { start: `${py}-${pad(pm)}-${pad(PAYDAY + 1)}`, end: paydayOf(key) }
}

const nextDay = (day: string): string => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Working days from `from` to `to`, BOTH INCLUSIVE -- Monday to Friday, not a public holiday. */
export function workingDaysIn(from: string, to: string): number {
  let n = 0
  for (let d = from; d <= to; d = nextDay(d)) if (isWorkingDay(d)) n += 1
  return n
}

export interface BasicPay {
  /** What is paid this pay day. */
  amount: number
  /** The full monthly basic it is a share of. */
  full: number
  /** Set when only part of the salary month was worked: which days, and of how many. */
  prorata: { from: string; to: string; days: number; of: number } | null
  /** Why nothing is paid, where nothing is: not started by the 25th, or left before the 26th. */
  none: 'not_started' | 'left' | null
}

/**
 * THE BASIC FOR ONE PAY DAY, PRO RATA FOR A STARTER OR A LEAVER.
 *
 * THE FIRM: someone "starting on Monday the 23rd is paid on the 25th for Monday, Tuesday and
 * Wednesday ... from the 26th they are on the full monthly basic." So:
 *
 *   basic x (working days worked in the salary month, both ends counted)
 *         / (working days in that whole salary month, 26th to 25th)
 *
 * WORKING DAYS, NOT CALENDAR DAYS -- the firm's own example counts Monday to Wednesday, and a
 * calendar share would pay a Friday starter for the weekend. The divisor (working days in the whole
 * month, SA public holidays out, workingDays.ts) is this file's reading and the one assumption the
 * firm is asked to confirm (HANDOFF §4). Rounded to the cent like every other line.
 *
 * A leaver is the same in the other direction: paid to the end date, nothing after.
 */
export function basicFor(basic: number | null, key: string, startedOn: string | null, endedOn: string | null): BasicPay {
  const full = cents(basic ?? 0)
  const month = salaryMonth(key)
  const from = startedOn && startedOn > month.start ? startedOn : month.start
  const to = endedOn && endedOn < month.end ? endedOn : month.end
  if (from > to) {
    return { amount: 0, full, prorata: null, none: startedOn && startedOn > month.end ? 'not_started' : 'left' }
  }
  if (from === month.start && to === month.end) return { amount: full, full, prorata: null, none: null }
  const days = workingDaysIn(from, to)
  const of = workingDaysIn(month.start, month.end)
  return { amount: of > 0 ? cents((full * days) / of) : 0, full, prorata: { from, to, days, of }, none: null }
}

/* ------------------------------------------------------------------------------------------------
 * The payments
 * ---------------------------------------------------------------------------------------------- */

/** One payment, as clerk_commission_lines gathers it. Every field by hand: see peopleApi.ts. */
export interface CommissionPayment {
  paymentId: string
  accountId: string
  caseNumber: string | null
  debtor: string | null
  companyId: string | null
  client: string | null
  receivedOn: string
  approvedOn: string | null
  reversedOn: string | null
  /** What the payment record says about why it was reversed, if anything. */
  reversalReason: string | null
  amount: number
  /** Paid straight to the client (a PTC) rather than into trust. */
  paidToClient: boolean
  /** Who held the account on the payment day. Null: nobody -- the firm's, and nobody's commission. */
  holderId: string | null
  /**
   * How that is known. 'backfill' is the reconstruction made when the desk history began: the holder
   * then was assumed to have held the account since handover. Said on the screen beside the payment.
   */
  holderSource: string | null
  /** The client's commission rate as charged on this receipt (fraction). */
  clientRate: number | null
  /** 'receipt' when read off the receipt's own split; 'account' when not split yet. */
  clientRateSource: string | null
  accountOverride: number | null
  accountOverrideReason: string | null
  clientOverride: number | null
  clientOverrideReason: string | null
  /** The payover run this payment rode (a PTC's commission is released by it). Null: not on one yet. */
  payoverRunId: string | null
}

/**
 * CARRIED-OVER PTC COMMISSION: what the old system still owed a clerk at the clean cut, entered by
 * hand or from a sheet. A fixed amount -- its arithmetic was done in the old system -- that waits and
 * is released exactly like a PTC. A reversing entry is folded onto the one it reverses.
 */
export interface CarriedEntry {
  id: string
  userId: string
  companyId: string
  client: string | null
  amount: number
  note: string | null
  source: string
  createdOn: string
  reversedOn: string | null
  reversalReason: string | null
}

/** Why a PTC (or a carried-over entry) is still waiting, in the statement's own words. */
export type WaitReason = 'runs_unread' | 'not_on_run' | 'no_run_yet' | 'run_not_approved' | 'client_owes'

export interface Waiting {
  reason: WaitReason
  /** The run it is waiting on (not approved yet), or the one that left the client short. */
  run: PayoverRun | null
  /** What that run left the client owing the firm. */
  outstanding: number | null
  /** The FIRST run, in this unbroken stretch, that left the client owing. */
  since: PayoverRun | null
}

export interface StatementLine {
  payment: CommissionPayment
  kind: 'receipt' | 'reversal' | 'ptc_reversal'
  /** The day this line belongs to: received, or reversed. */
  on: string
  amount: number
  rate: number | null
  source: RateSource
  reason: string | null
  commission: number
  /** A reversal line: the pay day (key) the commission it takes back was paid on. */
  paidIn: string | null
  /** A carried-over entry, where this line is one rather than a payment. */
  carried: CarriedEntry | null
  /** A released PTC: the run that released it. */
  releasedBy: PayoverRun | null
  /** A waiting PTC: why. */
  waiting: Waiting | null
}

function lineFor(p: CommissionPayment, kind: StatementLine['kind']): StatementLine {
  const { rate, source } = resolveRate(p)
  const sign = kind === 'receipt' ? 1 : -1
  const reason = source === 'account' ? p.accountOverrideReason : source === 'client' ? p.clientOverrideReason : null
  return {
    payment: p, kind,
    on: kind === 'receipt' ? p.receivedOn : (p.reversedOn as string),
    amount: sign * p.amount,
    rate, source, reason,
    /* The reversal is the exact negative of the receipt's line, not a fresh rounding of -amount. */
    commission: sign * commissionOn(p.amount, rate),
    paidIn: null, carried: null, releasedBy: null, waiting: null,
  }
}

/** A carried-over entry drawn as a line: no account, no rate, the amount the old system owed. */
function lineForCarried(c: CarriedEntry, kind: 'receipt' | 'ptc_reversal'): StatementLine {
  const sign = kind === 'receipt' ? 1 : -1
  const payment: CommissionPayment = {
    paymentId: `carried-${c.id}`, accountId: '', caseNumber: null, debtor: null, companyId: c.companyId, client: c.client,
    receivedOn: c.createdOn, approvedOn: c.createdOn, reversedOn: c.reversedOn, reversalReason: c.reversalReason,
    amount: 0, paidToClient: true, holderId: c.userId, holderSource: null, clientRate: null, clientRateSource: null,
    accountOverride: null, accountOverrideReason: null, clientOverride: null, clientOverrideReason: null, payoverRunId: null,
  }
  return {
    payment, kind, on: kind === 'receipt' ? c.createdOn : (c.reversedOn as string), amount: 0,
    rate: null, source: 'none', reason: null, commission: sign * cents(c.amount),
    paidIn: null, carried: c, releasedBy: null, waiting: null,
  }
}

/* ------------------------------------------------------------------------------------------------
 * The PTC release: by the payover run
 * ---------------------------------------------------------------------------------------------- */

/** One client's payover run, as clerk_commission_runs hands it over. Nothing here is recomputed. */
export interface PayoverRun {
  id: string
  companyId: string
  periodStart: string
  periodEnd: string
  status: string
  invoiceNumber: string
  /** The run's own net: below nil is "Client owes us", carried into the next run. */
  net: number
  carriedIn: number
  approvedOn: string | null
  /** The day a below-nil run's shortfall was paid into the business account, if it was. */
  settledOn: string | null
}

/** Half a cent: a balance this close to nought IS nought. */
const NIL = 0.005
/** A run that has become an invoice. Before that its figures can still move. */
const INVOICED = new Set(['approved', 'sent', 'paid'])

/** The pay day on which a run's verdict is first known: the first 25th on or after its approval. */
function decidedKey(r: PayoverRun): string {
  const own = periodKeyOf(r.periodEnd)
  const at = payKeyOn(r.approvedOn ?? r.periodEnd)
  return at > own ? at : own
}

const maxKey = (...ks: string[]) => ks.reduce((a, b) => (b > a ? b : a))

/**
 * WHEN A PTC'S COMMISSION IS RELEASED: BY THE PAYOVER RUN, NOT THE LEDGER (the firm, 23 Oct).
 *
 * THE FIRM: "PTCs ... there's going to be a set off immediately because we know that the ... trust
 * payments are more than the PTC, so we will definitely recover our money, so then we pay out the
 * commission. ... payment runs on the 11th, ... commissions paid out are for previous months ... if
 * the previous month's 11th payover report didn't show anything outstanding for a specific client, we
 * can pay it out ... to the clerks. ... if it shows that there's something outstanding ... then we
 * can't pay out the commission of those PTCs."
 *
 * PRECISELY, starting at the run the PTC rode (`payoverRunId`) -- or, for a carried-over entry, the
 * first run for the client whose cycle ends on or after the commission start date:
 *   * a run not yet APPROVED decides nothing: the commission waits ("still waiting");
 *   * an approved run whose net is nil or better shows nothing outstanding after set-off: RELEASED,
 *     on the first pay day (25th) on or after its approval, never before the PTC's own;
 *   * an approved run below nil left the client owing ("Client owes us"): the commission waits for
 *     the first LATER run for that client that shows nothing outstanding (the shortfall carried in
 *     and recovered) -- or for the day the client paid that shortfall into the business account,
 *     which the payover already treats as settled.
 *
 * THE RUN'S OWN FIGURES, never a second copy of the payover arithmetic: recompute_payover_run
 * decided net_payover, the carry and the settlement; this only reads them.
 *
 * `asOf` is the pay day being drawn: a run approved after it is not yet known, so a month already
 * paid reads the same next year. Runs unreadable (null) hold everything -- failing closed under-pays
 * on a screen, failing open pays out money the firm has not got.
 */
export function releaseOf(input: {
  runId?: string | null
  /** A carried-over entry: start at the first run whose cycle ends on or after this day. */
  fromDay?: string
  ownKey: string
  runs: PayoverRun[] | null
  asOf: string
}): { key: string | null; by: PayoverRun | null; waiting: Waiting | null } {
  const wait = (reason: WaitReason, run: PayoverRun | null = null, outstanding: number | null = null, since: PayoverRun | null = null) =>
    ({ key: null, by: null, waiting: { reason, run, outstanding, since } })
  if (input.runs === null) return wait('runs_unread')
  const runs = [...input.runs].sort((a, b) => a.periodStart.localeCompare(b.periodStart))
  let i: number
  if (input.fromDay !== undefined) {
    i = runs.findIndex((r) => r.periodEnd >= (input.fromDay as string))
    if (i < 0) return wait('no_run_yet')
  } else {
    i = input.runId ? runs.findIndex((r) => r.id === input.runId) : -1
    if (i < 0) return wait('not_on_run')
  }
  let since: PayoverRun | null = null
  let short: PayoverRun | null = null
  for (; i < runs.length; i += 1) {
    const r = runs[i]
    if (!INVOICED.has(r.status) || decidedKey(r) > input.asOf) {
      return wait('run_not_approved', r, short ? cents(-short.net) : null, since)
    }
    if (r.net >= -NIL) {
      const key = maxKey(input.ownKey, decidedKey(r))
      return key <= input.asOf ? { key, by: r, waiting: null } : wait('run_not_approved', r, null, since)
    }
    if (r.settledOn) {
      const key = maxKey(input.ownKey, decidedKey(r), payKeyOn(r.settledOn))
      if (key <= input.asOf) return { key, by: r, waiting: null }
    }
    since = since ?? r
    short = r
  }
  return short ? wait('client_owes', short, cents(-short.net), since) : wait('no_run_yet')
}

/* ------------------------------------------------------------------------------------------------
 * The statement
 * ---------------------------------------------------------------------------------------------- */

export type PayBasis = 'collections' | 'sales' | 'communications' | 'other'

export const PAY_BASIS_LABEL: Record<PayBasis, string> = {
  collections: 'Collections (basic plus collection commission)',
  sales: 'Sales',
  communications: 'Communications',
  other: 'Other',
}

/**
 * The pay basis a role starts on, read from its DEPARTMENT (departments.ts), never its team: the
 * call centre collects, sales sells, communications looks after clients. A profile can say otherwise.
 */
export function defaultPayBasis(role: UserRole | undefined): PayBasis {
  const d = departmentOf(role)
  return d === 'Call centre' ? 'collections' : d === 'Sales' ? 'sales' : d === 'Communications' ? 'communications' : 'other'
}

/** Only collections has a commission scheme. Sales and communications are "later" (the firm). */
export function hasCommissionScheme(basis: PayBasis): boolean {
  return basis === 'collections'
}

export interface PtcGroup {
  companyId: string | null
  client: string
  lines: StatementLine[]
  commission: number
  /** Pending only: what the client's latest run left it owing, and since which run. */
  owed: number | null
  owedSince: PayoverRun | null
  /** Pending only: the run that left that figure outstanding (the latest one read). */
  owedRun: PayoverRun | null
  /** Pending only: why it is still waiting, in the firm's words. */
  waiting: string | null
}

export interface PayStatement {
  period: PayPeriod
  /** The 25th this statement is paid on. */
  payday: string
  basis: PayBasis
  scheme: boolean
  /** The basic actually paid this pay day (pro rata for a starter or a leaver). */
  basic: number
  basicPay: BasicPay
  /** (a) Every payment into trust in the period, and every reversal, with its commission. */
  payments: StatementLine[]
  paymentsTotal: number
  /** (b) PTC commission released this period, by client. */
  released: PtcGroup[]
  releasedTotal: number
  /** (c) PTC commission still waiting, by client. NEVER in the payable total. */
  pending: PtcGroup[]
  pendingTotal: number
  /** Basic + (a) + (b). */
  payable: number
  /** True when the payover runs could not be read: every PTC is held, and the page says why. */
  runsUnread: boolean
  /** Payments whose holder was reconstructed when the desk history began rather than observed. */
  reconstructed: number
  /** The clean cut: payments before it earn nothing here. Null: not set. */
  commissionStart: string | null
}

function group(lines: StatementLine[]): Map<string, StatementLine[]> {
  const by = new Map<string, StatementLine[]>()
  for (const l of lines) {
    const k = l.payment.companyId ?? ''
    by.set(k, [...(by.get(k) ?? []), l])
  }
  return by
}

const sum = (xs: number[]) => cents(xs.reduce((s, x) => s + x, 0))

const WAITING_WORDS: Record<WaitReason, string> = {
  runs_unread: 'The payover runs could not be read, so this stays held.',
  not_on_run: 'Not on a payover run yet.',
  no_run_yet: 'Waiting for the client’s first payover run.',
  run_not_approved: 'Waiting for the payover run to be approved.',
  client_owes: 'The payover left the client owing the firm.',
}

export function waitingWords(w: Waiting): string {
  return WAITING_WORDS[w.reason]
}

/**
 * ONE PERSON'S PAY FOR ONE PAY DAY.
 *
 * `payments` are the payments on accounts this person held on the payment day (the database filters
 * by holder). `runs` is every relevant client's payover runs, or null when they could not be read.
 * `carried` is this person's carried-over entries.
 *
 * THE SECTIONS, IN THE FIRM'S ORDER: "in a pay slip, there will be all payments made, and the
 * commission for every single payment, and then there will be a section that says PTCs paid out ...
 * and then PTCs not paid out, or like pending or waiting."
 *
 * A REVERSAL IS A NEGATIVE LINE IN THE PERIOD IT IS REVERSED, never a change to the period the money
 * came in: that period may already have been paid. It says which pay day the commission went out on.
 * A PTC reversed before it was released simply leaves the pending list -- nothing was paid on it.
 *
 * THE CLEAN CUT: a payment received before `commissionStart` earns nothing here -- the old system paid
 * it -- and so its reversal takes nothing back either.
 */
export function buildStatement(input: {
  periodKey: string
  basis: PayBasis
  basic: number | null
  startedOn?: string | null
  endedOn?: string | null
  payments: CommissionPayment[]
  runs: Map<string, PayoverRun[]> | null
  carried?: CarriedEntry[]
  commissionStart?: string | null
}): PayStatement {
  const period = periodForKey(input.periodKey)
  const start = input.commissionStart ?? null
  const basicPay = basicFor(input.basic, input.periodKey, input.startedOn ?? null, input.endedOn ?? null)
  const scheme = hasCommissionScheme(input.basis)
  const inPeriod = (d: string | null) => d !== null && d >= period.start && d <= period.end
  const runsOf = (companyId: string | null) =>
    input.runs === null ? null : (input.runs.get(companyId ?? '') ?? [])
  const counted = (p: CommissionPayment) => start === null || p.receivedOn >= start

  const payments: StatementLine[] = []
  const released: StatementLine[] = []
  const pending: StatementLine[] = []

  /* A PTC or a carried-over entry: where it stands as at this pay day. */
  const place = (make: (k: 'receipt' | 'ptc_reversal') => StatementLine, rel: (asOf: string) => ReturnType<typeof releaseOf>,
    reversedOn: string | null) => {
    const rk = reversedOn === null ? null : periodKeyOf(reversedOn)
    /* Released only on a pay day BEFORE the period it was reversed in: reversed first, never paid. */
    const asOf = rk !== null && rk <= period.key ? shiftPeriod(rk, -1) : period.key
    const r = rel(asOf)
    if (rk !== null && rk <= period.key) {
      if (rk === period.key && r.key !== null) {
        const l = make('ptc_reversal'); l.paidIn = r.key; l.releasedBy = r.by
        payments.push(l)
      }
      return
    }
    if (r.key === period.key) { const l = make('receipt'); l.releasedBy = r.by; released.push(l) }
    else if (r.key === null) { const l = make('receipt'); l.waiting = r.waiting; pending.push(l) }
  }

  if (scheme) {
    for (const p of input.payments) {
      if (!counted(p)) continue
      if (!p.paidToClient) {
        if (inPeriod(p.receivedOn)) payments.push(lineFor(p, 'receipt'))
        if (inPeriod(p.reversedOn)) {
          const l = lineFor(p, 'reversal'); l.paidIn = periodKeyOf(p.receivedOn)
          payments.push(l)
        }
        continue
      }
      if (p.receivedOn > period.end) continue
      place((k) => lineFor(p, k), (asOf) => releaseOf({
        runId: p.payoverRunId, ownKey: periodKeyOf(p.receivedOn), runs: runsOf(p.companyId), asOf,
      }), p.reversedOn)
    }
    for (const c of input.carried ?? []) {
      if (c.createdOn > period.end) continue
      place((k) => lineForCarried(c, k), (asOf) => releaseOf({
        fromDay: start ?? c.createdOn, ownKey: periodKeyOf(c.createdOn), runs: runsOf(c.companyId), asOf,
      }), c.reversedOn)
    }
  }
  payments.sort((a, b) => a.on.localeCompare(b.on) || a.payment.paymentId.localeCompare(b.payment.paymentId))

  const releasedGroups: PtcGroup[] = [...group(released)].map(([, lines]) => ({
    companyId: lines[0].payment.companyId, client: lines[0].payment.client ?? 'Unknown client',
    lines, commission: sum(lines.map((l) => l.commission)), owed: null, owedSince: null, owedRun: null, waiting: null,
  }))
  const pendingGroups: PtcGroup[] = [...group(pending)].map(([, lines]) => {
    /* The client's position is the same for every line that has reached a run; say it once. */
    const owing = lines.find((l) => l.waiting?.outstanding != null)?.waiting ?? null
    const first = lines[0].waiting
    return {
      companyId: lines[0].payment.companyId, client: lines[0].payment.client ?? 'Unknown client',
      lines, commission: sum(lines.map((l) => l.commission)),
      owed: owing?.outstanding ?? null,
      owedSince: owing?.since ?? null,
      owedRun: owing?.run ?? null,
      waiting: owing ? WAITING_WORDS.client_owes : first ? WAITING_WORDS[first.reason] : null,
    }
  })
  const byClient = (a: PtcGroup, b: PtcGroup) => a.client.localeCompare(b.client)
  releasedGroups.sort(byClient)
  pendingGroups.sort(byClient)

  const paymentsTotal = sum(payments.map((l) => l.commission))
  const releasedTotal = sum(releasedGroups.map((g) => g.commission))
  const pendingTotal = sum(pendingGroups.map((g) => g.commission))
  return {
    period, payday: paydayOf(period.key), basis: input.basis, scheme,
    basic: basicPay.amount, basicPay,
    payments, paymentsTotal,
    released: releasedGroups, releasedTotal,
    pending: pendingGroups, pendingTotal,
    /* PENDING IS NEVER IN HERE. It is money the firm has not been paid; it is shown, not owed. */
    payable: cents(basicPay.amount + paymentsTotal + releasedTotal),
    runsUnread: scheme && input.runs === null
      && (input.payments.some((p) => p.paidToClient && counted(p)) || (input.carried ?? []).length > 0),
    reconstructed: scheme ? input.payments.filter((p) => counted(p) && p.holderSource === 'backfill'
      && (inPeriod(p.receivedOn) || inPeriod(p.reversedOn))).length : 0,
    commissionStart: start,
  }
}

/** The clients whose payover runs a set of payments and carried-over entries needs. */
export function clientsWithPtc(payments: CommissionPayment[], carried: CarriedEntry[] = []): string[] {
  return [...new Set([
    ...payments.filter((p) => p.paidToClient && p.companyId).map((p) => p.companyId as string),
    ...carried.map((c) => c.companyId),
  ])].sort()
}

/** The firm's month: one row a person, built from the same statement, so the two cannot disagree. */
export interface SummaryRow {
  userId: string
  basic: number
  /** Set when the basic is a share of the month (a starter or a leaver). */
  prorata: boolean
  commission: number
  pending: number
  payable: number
  scheme: boolean
}

export function summarise(input: {
  periodKey: string
  people: { userId: string; basis: PayBasis; basic: number | null; startedOn?: string | null; endedOn?: string | null }[]
  payments: CommissionPayment[]
  runs: Map<string, PayoverRun[]> | null
  carried?: CarriedEntry[]
  commissionStart?: string | null
}): { rows: SummaryRow[]; unheld: number } {
  const byHolder = new Map<string, CommissionPayment[]>()
  for (const p of input.payments) {
    if (!p.holderId) continue
    byHolder.set(p.holderId, [...(byHolder.get(p.holderId) ?? []), p])
  }
  const rows = input.people.map((person) => {
    const s = buildStatement({
      periodKey: input.periodKey, basis: person.basis, basic: person.basic,
      startedOn: person.startedOn ?? null, endedOn: person.endedOn ?? null,
      payments: byHolder.get(person.userId) ?? [], runs: input.runs,
      carried: (input.carried ?? []).filter((c) => c.userId === person.userId),
      commissionStart: input.commissionStart ?? null,
    })
    return {
      userId: person.userId, basic: s.basic, prorata: s.basicPay.prorata !== null || s.basicPay.none !== null,
      commission: cents(s.paymentsTotal + s.releasedTotal),
      pending: s.pendingTotal, payable: s.payable, scheme: s.scheme,
    }
  })
  const period = periodForKey(input.periodKey)
  const start = input.commissionStart ?? null
  const unheld = sum(input.payments
    .filter((p) => !p.holderId && p.receivedOn >= period.start && p.receivedOn <= period.end && p.reversedOn === null
      && (start === null || p.receivedOn >= start))
    .map((p) => p.amount))
  return { rows, unheld }
}

/* ------------------------------------------------------------------------------------------------
 * Carried-over entries, read from a sheet
 * ---------------------------------------------------------------------------------------------- */

export interface CarriedSheetRow {
  /** The spreadsheet row, as Excel numbers it (the heading is row 1). */
  row: number
  clerk: string
  client: string
  raw: string
  amount: number | null
  note: string | null
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
const header = (keys: string[], ...names: string[]) => keys.find((k) => names.includes(norm(k)))

/**
 * A CARRIED-OVER SHEET: a column for the clerk (name or email), one for the client (name or code) and
 * one for the amount. Headings are found by name, so the column order is the firm's business. Throws,
 * in words, when one is missing. Read in the browser; the file is never stored.
 */
export function parseCarriedSheet(rows: Record<string, string>[]): CarriedSheetRow[] {
  const keys = Object.keys(rows[0] ?? {})
  const clerk = header(keys, 'clerk', 'clerk name', 'clerk email', 'name', 'email', 'collector', 'agent')
  const client = header(keys, 'client', 'client name', 'client code', 'code', 'company')
  const amount = header(keys, 'amount', 'commission', 'amount owed', 'value')
  const note = header(keys, 'note', 'notes', 'comment')
  const missing = [!clerk && 'Clerk', !client && 'Client', !amount && 'Amount'].filter(Boolean)
  if (missing.length) throw new Error(`The sheet needs a ${missing.join(', ')} heading in its first row.`)
  return rows.map((r, i) => {
    const raw = String(r[amount as string] ?? '').trim()
    const t = raw.replace(/^R\s*/i, '').replace(/[\s ,]/g, '')
    const n = t !== '' && /^-?(\d+\.?\d*|\.\d+)$/.test(t) ? cents(Number(t)) : null
    return {
      row: i + 2, clerk: String(r[clerk as string] ?? '').trim(), client: String(r[client as string] ?? '').trim(),
      raw, amount: n, note: note ? (String(r[note] ?? '').trim() || null) : null,
    }
  }).filter((r) => r.clerk !== '' || r.client !== '' || r.raw !== '')
}

export interface PersonOption { id: string; name: string; email: string }
export interface ClientChoice { id: string; name: string; code: string | null }

export type CarriedRowState = 'ready' | 'pick' | 'not_an_amount' | 'left_out'

export interface MatchedCarriedRow extends CarriedSheetRow {
  userId: string | null
  companyId: string | null
  state: CarriedRowState
  /** Why a row needs a person, where it does. */
  why: string | null
}

/** A person's choice for a row's clerk or client. LEAVE_OUT_ROW leaves the whole row out. */
export const LEAVE_OUT_ROW = '__leave_out__'

/**
 * MATCHED LIKE THE BROUGHT-FORWARD BALANCES: an exact name or email (case and spacing aside) for the
 * clerk, an exact name or code for the client -- else a person picks. Never a nearest name: a guessed
 * clerk is somebody else's pay, and a guessed client releases it on the wrong payover.
 */
export function matchCarried(
  rows: CarriedSheetRow[], people: PersonOption[], clients: ClientChoice[],
  picks: Record<string, string> = {},
): MatchedCarriedRow[] {
  const one = <T>(xs: T[]) => (xs.length === 1 ? xs[0] : null)
  return rows.map((r) => {
    if (picks[`${r.row}`] === LEAVE_OUT_ROW) return { ...r, userId: null, companyId: null, state: 'left_out', why: null }
    const pc = picks[`${r.row}:clerk`]
    const pk = picks[`${r.row}:client`]
    const person = pc ? people.find((p) => p.id === pc) ?? null
      : one(people.filter((p) => norm(p.name) === norm(r.clerk) || norm(p.email) === norm(r.clerk)))
    const client = pk ? clients.find((c) => c.id === pk) ?? null
      : one(clients.filter((c) => norm(c.name) === norm(r.client))) ?? one(clients.filter((c) => c.code !== null && norm(c.code) === norm(r.client)))
    if (r.amount === null || r.amount <= 0) {
      return { ...r, userId: person?.id ?? null, companyId: client?.id ?? null, state: 'not_an_amount',
        why: r.amount === null ? `"${r.raw}" is not an amount` : 'Only an amount owed to the clerk can be carried over' }
    }
    const state: CarriedRowState = person && client ? 'ready' : 'pick'
    return { ...r, userId: person?.id ?? null, companyId: client?.id ?? null, state,
      why: state === 'pick' ? [!person && 'clerk', !client && 'client'].filter(Boolean).join(' and ') + ' not found exactly' : null }
  })
}
