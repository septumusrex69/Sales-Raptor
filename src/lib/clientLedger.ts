import type { ClientEntry } from './business'

/**
 * THE CLIENT'S LEDGER, ONE LINE A PAYOVER.
 *
 * The firm, 10 Oct, looking at a ledger with a line per PTC: "rather than saying like every PTC
 * ... refer to, for example, there's one payover. This was the payover date, and according to this
 * payover, there is a credit or a debit balance ... and then there was a withdrawal invoice, so
 * it's again credited or debited." A client is settled with by payover, so a payover is the unit
 * of their ledger; the payments behind one are its detail, opened by a click.
 *
 * WHAT IS FOLDED, AND WHAT STANDS ALONE. Money collected or owed on an account (held, owed, a
 * reversal, a re-split) belongs to the payover whose period covers the day it was booked -- the
 * same eleventh-to-tenth window the run was built from -- and a set-off or a release that names a
 * run belongs to that run. Everything else is an event of its own in the client's eyes and keeps
 * its own line: the payover being PAID to them, a charge waiting for the next payover, an invoice
 * raised, an invoice paid. Money booked after the last run is one line for its cycle, saying it is
 * not on a payover yet, rather than vanishing until a run is built.
 *
 * DEBIT AND CREDIT ARE THE FIRM'S BOOKS. A debit is the client owing us more (or us owing them
 * less); a credit is the reverse. The client's running balance closes on exactly the figure the
 * database's own window closes on, because a regrouping moves lines between rows and never changes
 * their sum -- `check-client-ledger` holds that.
 */

export interface LedgerRun {
  id: string
  invoiceNumber: string | null
  periodStart: string
  periodEnd: string
  status: string
}

export interface LedgerRow {
  key: string
  on: string
  label: string
  /** A small word on where this stands: the run's state, or "Not on a payover yet". */
  state: string | null
  reference: string | null
  runId: string | null
  /** Positive: credit (we owe them more). Negative: debit (they owe us more). */
  amount: number
  balance: number
  /** The lines behind it; one, for a line that stands alone. */
  lines: ClientEntry[]
}

const FOLDED = new Set(['held', 'owed', 'reversal', 're_split'])
const RUN_OWN = new Set(['set_off', 'released'])

const RUN_STATE: Record<string, string> = {
  needs_review: 'Being checked',
  ready: 'Ready to approve',
  approved: 'Approved',
  sent: 'Sent to the client',
  paid: 'Paid',
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function short(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** The eleventh-to-tenth cycle a day falls in. */
export function cycleOf(day: string): { start: string; end: string } {
  const [y, m, d] = day.split('-').map(Number)
  const sy = d >= 11 ? y : (m === 1 ? y - 1 : y)
  const sm = d >= 11 ? m : (m === 1 ? 12 : m - 1)
  const ey = sm === 12 ? sy + 1 : sy
  const em = sm === 12 ? 1 : sm + 1
  return { start: iso(sy, sm, 11), end: iso(ey, em, 10) }
}

const label = (r: LedgerRun) =>
  `Payover ${r.invoiceNumber ?? ''} · ${short(r.periodStart)} – ${short(r.periodEnd)}`.replace('  ', ' ')

export function ledgerByPayover(entries: ClientEntry[], runs: LedgerRun[]): LedgerRow[] {
  const live = runs.filter((r) => r.status !== 'void')
  const byId = new Map(live.map((r) => [r.id, r]))
  const groups = new Map<string, LedgerRow>()
  const rows: LedgerRow[] = []

  const groupFor = (key: string, make: () => Omit<LedgerRow, 'amount' | 'balance' | 'lines'>) => {
    let g = groups.get(key)
    if (!g) {
      g = { ...make(), amount: 0, balance: 0, lines: [] }
      groups.set(key, g)
      rows.push(g)
    }
    return g
  }
  const runGroup = (r: LedgerRun) => groupFor(`run:${r.id}`, () => ({
    key: `run:${r.id}`, on: r.periodEnd, label: label(r), state: RUN_STATE[r.status] ?? r.status,
    reference: r.invoiceNumber, runId: r.id,
  }))

  entries.forEach((e, i) => {
    let g: LedgerRow
    const run = e.runId ? byId.get(e.runId) : undefined
    if (RUN_OWN.has(e.kind) && run) {
      g = runGroup(run)
    } else if (FOLDED.has(e.kind)) {
      const covering = live.find((r) => r.periodStart <= e.on && e.on <= r.periodEnd)
      if (covering) {
        g = runGroup(covering)
      } else {
        const c = cycleOf(e.on)
        g = groupFor(`open:${c.start}`, () => ({
          key: `open:${c.start}`, on: c.end,
          label: `Collections ${short(c.start)} – ${short(c.end)}`,
          state: 'Not on a payover yet', reference: null, runId: null,
        }))
      }
    } else {
      g = groupFor(`own:${i}`, () => ({
        key: `own:${i}`, on: e.on,
        label: e.kind === 'payover_paid' ? `Payover ${e.reference ?? ''} paid to the client`.replace('  ', ' ')
          : e.kind === 'invoice_raised' ? `Invoice${e.reference ? ` ${e.reference}` : ''}: ${e.description}`
          : e.kind === 'invoice_paid' ? `Invoice${e.reference ? ` ${e.reference}` : ''} paid by the client`
          : e.description,
        state: e.kind === 'charge_pending' ? 'Comes off the next payover' : null,
        reference: e.reference, runId: e.runId,
      }))
    }
    g.lines.push(e)
    g.amount += e.amount
  })

  /*
   * A GROUP IS DATED BY THE DAY IT SPEAKS FOR -- a run by the last day of its period, a line of its
   * own by its day -- and a run sorts before a payment of that run on the same day, because the
   * payover has to exist before it can be paid. The running balance is then the sum to that row.
   */
  const order = (r: LedgerRow) => (r.key.startsWith('own:') ? 1 : 0)
  rows.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : order(a) - order(b)))
  let bal = 0
  for (const r of rows) {
    r.amount = Math.round(r.amount * 100) / 100
    bal = Math.round((bal + r.amount) * 100) / 100
    r.balance = bal
  }
  return rows
}
