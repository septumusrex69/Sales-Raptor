import { departmentOf } from './departments.ts'
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
 * the client was charged and the overrides in force; clerk_commission_ledgers: the client's own
 * running statement). Everything decided is decided in this file, once.
 *
 * NOTHING HERE IS STORED. A statement is worked out every time it is opened, from the payments as
 * they stand. That is safe only because every input is itself fixed by date -- the payment day, the
 * desk on that day, the override in force on that day, the ledger as at a period's end -- so a month
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
 */
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
 * from the page. (The firm has not ruled on rounding; this is the ordinary bookkeeping choice and it
 * is in HANDOFF as a question.)
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
 * What a client owes the firm, read off the client's own ledger
 * ---------------------------------------------------------------------------------------------- */

/** One line of client_ledger: positive, we owe the client more; negative, they owe us more. */
export interface LedgerLine { companyId: string; on: string; amount: number }

/** Half a cent: a balance this close to nought IS nought. */
const NIL = 0.005

/** The client's balance at the close of a day: positive, the firm owes them; negative, they owe it. */
export function balanceAt(lines: LedgerLine[], day: string): number {
  let sum = 0
  for (const l of lines) if (l.on <= day) sum += l.amount
  return cents(sum)
}

/**
 * SINCE WHEN THE CLIENT HAS OWED THE FIRM, as at a day: the first day of the unbroken run of owing
 * that day is in. Null when they owe nothing that day. Read a day at a time over the days the ledger
 * moved, because a balance is only ever different on a day something was entered.
 */
export function owingSince(lines: LedgerLine[], day: string): string | null {
  const days = [...new Set(lines.filter((l) => l.on <= day).map((l) => l.on))].sort()
  let since: string | null = null
  for (const d of days) {
    if (balanceAt(lines, d) < -NIL) { if (since === null) since = d }
    else since = null
  }
  return since
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
  /** Null until the receipt is approved -- and a PTC's debt to the firm is on the ledger only then. */
  approvedOn: string | null
  reversedOn: string | null
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
  }
}

/* ------------------------------------------------------------------------------------------------
 * The PTC hold
 * ---------------------------------------------------------------------------------------------- */

/**
 * WHEN A PTC'S COMMISSION IS RELEASED -- THE FIRM'S RULE, AND THE DAY IT IS READ ON.
 *
 * THE FIRM: "the clerk doesn't get the commission because the clerk is instructed to pay it into our
 * trust fund. And we can't pay the clerk commission if a client is owing us money ... if the client
 * doesn't owe us money at all, there's a zero balance for the client, then we can start paying out the
 * clerks ... So if the entire account for a specific client has been settled and they don't owe us,
 * then only can commission be paid out."
 *
 * PRECISELY: a PTC's commission is released in the FIRST pay period, from the one it was received in
 * onwards, at whose END (the 10th) --
 *   1. the PTC was approved (before that its debt to the firm is not on the client's ledger at all,
 *      so a clear-looking ledger would release it for nothing),
 *   2. it had not been reversed, and
 *   3. the client's ledger balance was nought or in the client's favour -- they owed the firm nothing.
 * Read at the period's END and not on the day the balance crossed nought, because pay is by period:
 * a client clear for one afternoon mid-month and owing again by its end has not settled.
 *
 * A PERIOD STILL RUNNING is read as at its end too, which for the current period means the ledger as
 * it stands today -- so this month's releases are provisional until the 10th, and the page says so.
 *
 * WHOLE, NOT PART: "only can commission be paid out" -- the firm releases once the client is clear,
 * so there is no part-release while they owe something.
 *
 * Null when it has not been released by `upTo` -- or when the ledger could not be read, in which
 * case nothing is ever released: failing closed under-pays on a screen, where failing open would pay
 * out money the firm has not got.
 */
export function releasePeriodOf(
  p: CommissionPayment,
  ledger: LedgerLine[] | null,
  upTo: string,
): string | null {
  if (!p.paidToClient || ledger === null) return null
  for (let key = periodKeyOf(p.receivedOn); key <= upTo; key = shiftPeriod(key, 1)) {
    const end = periodForKey(key).end
    if (p.reversedOn !== null && p.reversedOn <= end) return null
    if (p.approvedOn === null || p.approvedOn > end) continue
    if (balanceAt(ledger, end) >= -NIL) return key
  }
  return null
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
  /** Pending only: what the client owed the firm at the period's end, and since when. */
  owed: number | null
  owedSince: string | null
  /** Pending only: why it is still waiting, in the firm's words. */
  waiting: string | null
}

export interface PayStatement {
  period: PayPeriod
  basis: PayBasis
  scheme: boolean
  basic: number
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
  /** True when the client ledgers could not be read: every PTC is held, and the page says why. */
  ledgerUnread: boolean
  /** Payments whose holder was reconstructed when the desk history began rather than observed. */
  reconstructed: number
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

/**
 * ONE PERSON'S PAY FOR ONE PERIOD.
 *
 * `payments` are the payments on accounts this person held on the payment day (the database filters
 * by holder). `ledgers` is every relevant client's ledger, or null when it could not be read.
 *
 * THE SECTIONS, IN THE FIRM'S ORDER: "in a pay slip, there will be all payments made, and the
 * commission for every single payment, and then there will be a section that says PTCs paid out ...
 * and then PTCs not paid out, or like pending or waiting."
 *
 * A REVERSAL IS A NEGATIVE LINE IN THE PERIOD IT IS REVERSED, never a change to the period the money
 * came in: that period may already have been paid. A PTC reversed before it was released simply
 * leaves the pending list -- nothing was paid on it, so nothing comes back.
 */
export function buildStatement(input: {
  periodKey: string
  basis: PayBasis
  basic: number | null
  payments: CommissionPayment[]
  ledgers: Map<string, LedgerLine[]> | null
}): PayStatement {
  const period = periodForKey(input.periodKey)
  const basic = cents(input.basic ?? 0)
  const scheme = hasCommissionScheme(input.basis)
  const inPeriod = (d: string | null) => d !== null && d >= period.start && d <= period.end
  const ledgerOf = (p: CommissionPayment) =>
    input.ledgers === null ? null : (input.ledgers.get(p.companyId ?? '') ?? [])

  const payments: StatementLine[] = []
  const released: StatementLine[] = []
  const pending: StatementLine[] = []

  if (scheme) {
    for (const p of input.payments) {
      if (!p.paidToClient) {
        if (inPeriod(p.receivedOn)) payments.push(lineFor(p, 'receipt'))
        if (inPeriod(p.reversedOn)) payments.push(lineFor(p, 'reversal'))
        continue
      }
      if (p.receivedOn > period.end) continue
      const at = releasePeriodOf(p, ledgerOf(p), period.key)
      if (at === period.key) released.push(lineFor(p, 'receipt'))
      else if (at !== null && inPeriod(p.reversedOn)) {
        /* Released in an earlier period and reversed in this one: it was paid, so it comes back. */
        payments.push(lineFor(p, 'ptc_reversal'))
      } else if (at === null && !(p.reversedOn !== null && p.reversedOn <= period.end)) {
        pending.push(lineFor(p, 'receipt'))
      }
    }
  }
  payments.sort((a, b) => a.on.localeCompare(b.on) || a.payment.paymentId.localeCompare(b.payment.paymentId))

  const releasedGroups: PtcGroup[] = [...group(released)].map(([, lines]) => ({
    companyId: lines[0].payment.companyId, client: lines[0].payment.client ?? 'Unknown client',
    lines, commission: sum(lines.map((l) => l.commission)), owed: null, owedSince: null, waiting: null,
  }))
  const pendingGroups: PtcGroup[] = [...group(pending)].map(([, lines]) => {
    const ledger = ledgerOf(lines[0].payment)
    const owedNow = ledger === null ? null : -balanceAt(ledger, period.end)
    const unapproved = lines.some((l) => l.payment.approvedOn === null || l.payment.approvedOn > period.end)
    const waiting = ledger === null
      ? 'The client’s balance could not be read, so this stays held.'
      : owedNow !== null && owedNow > NIL
        ? 'The client still owes the firm.'
        : unapproved ? 'Waiting for the PTC to be approved.' : 'Waiting for the period to close.'
    return {
      companyId: lines[0].payment.companyId, client: lines[0].payment.client ?? 'Unknown client',
      lines, commission: sum(lines.map((l) => l.commission)),
      owed: owedNow !== null && owedNow > NIL ? cents(owedNow) : null,
      owedSince: ledger === null ? null : owingSince(ledger, period.end),
      waiting,
    }
  })
  const byClient = (a: PtcGroup, b: PtcGroup) => a.client.localeCompare(b.client)
  releasedGroups.sort(byClient)
  pendingGroups.sort(byClient)

  const paymentsTotal = sum(payments.map((l) => l.commission))
  const releasedTotal = sum(releasedGroups.map((g) => g.commission))
  const pendingTotal = sum(pendingGroups.map((g) => g.commission))
  return {
    period, basis: input.basis, scheme, basic,
    payments, paymentsTotal,
    released: releasedGroups, releasedTotal,
    pending: pendingGroups, pendingTotal,
    /* PENDING IS NEVER IN HERE. It is money the firm has not been paid; it is shown, not owed. */
    payable: cents(basic + paymentsTotal + releasedTotal),
    ledgerUnread: scheme && input.ledgers === null && input.payments.some((p) => p.paidToClient),
    reconstructed: scheme ? input.payments.filter((p) => p.holderSource === 'backfill'
      && (inPeriod(p.receivedOn) || inPeriod(p.reversedOn))).length : 0,
  }
}

/** The clients whose ledgers a set of payments needs: only those with a PTC. */
export function clientsWithPtc(payments: CommissionPayment[]): string[] {
  return [...new Set(payments.filter((p) => p.paidToClient && p.companyId).map((p) => p.companyId as string))].sort()
}

/** The firm's month: one row a person, built from the same statement, so the two cannot disagree. */
export interface SummaryRow {
  userId: string
  basic: number
  commission: number
  pending: number
  payable: number
  scheme: boolean
}

export function summarise(input: {
  periodKey: string
  people: { userId: string; basis: PayBasis; basic: number | null }[]
  payments: CommissionPayment[]
  ledgers: Map<string, LedgerLine[]> | null
}): { rows: SummaryRow[]; unheld: number } {
  const byHolder = new Map<string, CommissionPayment[]>()
  for (const p of input.payments) {
    if (!p.holderId) continue
    byHolder.set(p.holderId, [...(byHolder.get(p.holderId) ?? []), p])
  }
  const rows = input.people.map((person) => {
    const s = buildStatement({
      periodKey: input.periodKey, basis: person.basis, basic: person.basic,
      payments: byHolder.get(person.userId) ?? [], ledgers: input.ledgers,
    })
    return {
      userId: person.userId, basic: s.basic, commission: cents(s.paymentsTotal + s.releasedTotal),
      pending: s.pendingTotal, payable: s.payable, scheme: s.scheme,
    }
  })
  const period = periodForKey(input.periodKey)
  const unheld = sum(input.payments
    .filter((p) => !p.holderId && p.receivedOn >= period.start && p.receivedOn <= period.end && p.reversedOn === null)
    .map((p) => p.amount))
  return { rows, unheld }
}
