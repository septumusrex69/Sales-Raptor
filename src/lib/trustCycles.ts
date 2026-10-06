/**
 * THE TRUST, READ A PAYOVER CYCLE AT A TIME.
 *
 * THE FIRM: "it should reflect everything that is currently in the trust. How much money is
 * currently in the trust? And what is for this month's payover? And what is for next month's
 * payover? ... if we're on the 6th of October, the money for last month that was running from the
 * 10th of August to the 11th of September has not been paid out on the 11th of October. So that
 * money's in there. Plus, money from the 11th of September to the 6th of October is in there as
 * well."
 *
 * TWO CYCLES ARE IN THE ACCOUNT AT ONCE AND THE OLD SCREEN SHOWED ONE NUMBER. A client's balance
 * in trust is a running total of every receipt ever placed to them and not yet paid over -- which
 * on any day after the 11th is at least two different payovers falling due a month apart. Asked
 * "what goes out on the 11th", the overview could only answer with a figure that also contained
 * money collected yesterday.
 *
 * PURE, AND APART FROM `trust.ts`, so a check can import it: trust.ts pulls in the Supabase client
 * and can only be read back as text from the QA layer. The same split emailStyle.ts and
 * firmSettingsRow.ts are already in, for the same reason.
 *
 * NO `Date` IN THE PARSING. Every date here arrives as a Postgres `date` -- 'YYYY-MM-DD', no time
 * and no zone -- and `new Date('2026-10-11')` reads it as UTC midnight, which in Johannesburg is
 * two in the morning and in Honolulu is the 10th. A cycle boundary is exactly where that costs a
 * day, so the parts are split out of the string and arithmetic is done in UTC on purpose.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * What the database hands back, one row per cycle that still has money in it.
 *
 * `firmEarned` and `firmMoved` are the firm's own money split in two, and the split is not
 * cosmetic: earned is what a cycle's receipts earned, moved is a DRAWING to the business account
 * or a correction. A drawing is made against the whole pot rather than against a month, so added
 * into one column the month somebody drew would read as a month the firm earned nothing.
 */
export interface TrustCycle {
  periodStart: string
  periodEnd: string
  /** The day this cycle is paid over to clients. Derived from the lag in trust settings. */
  paysOn: string
  isOpen: boolean
  toClients: number
  firmEarned: number
  firmMoved: number
  toDebtors: number
  /**
   * Entries nobody has placed to a party yet. READ BUT NOT DRAWN ON THE OVERVIEW, deliberately:
   * the control block's "not yet identified" row is `trust_position`'s, which also counts receipts
   * sitting on the BANK STATEMENT with nobody's name on them -- and those belong to no cycle,
   * because nothing yet says which receipt they are. Two numbers under one heading, one of them
   * smaller, would read as a disagreement about the same thing.
   */
  unplaced: number
  /** Everything above, netted -- what this cycle is still holding in the trust account. */
  held: number
  runs: number
  runsPaid: number
  runsToDo: number
}

/** '2026-09-10' as a day count, in UTC, so no local clock can move it. */
function dayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/** Whole days from one date to the other; negative where `to` is behind `from`. */
export function daysBetween(from: string, to: string): number {
  return dayOf(to) - dayOf(from)
}

/** '2026-09-10' as '10 Sep 2026'. Hand-rolled: `en-ZA` renders September as "Sept". */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/**
 * The cycle's own name: '11 Aug – 10 Sep 2026'.
 *
 * THE YEAR ONCE WHERE BOTH ENDS SHARE IT, because the firm reads a strip of these down a column
 * and '11 Aug 2026 – 10 Sep 2026' is the same fact typed twice. December to January gets both.
 */
export function cycleLabel(start: string, end: string): string {
  const [ys, ms, ds] = start.split('-').map(Number)
  const [ye, me, de] = end.split('-').map(Number)
  if (ys === ye) return `${ds} ${MONTHS[ms - 1]} – ${de} ${MONTHS[me - 1]} ${ye}`
  return `${shortDate(start)} – ${shortDate(end)}`
}

export type CycleTone = 'open' | 'due' | 'late'

export interface CycleState {
  /** What this cycle IS, in two or three words. */
  word: string
  /** When it moves, and how far off that is. */
  detail: string
  tone: CycleTone
}

/**
 * WHERE A CYCLE STANDS TODAY, IN THE FIRM'S OWN TENSE.
 *
 * Three states and no more: it is still collecting, it has closed and is waiting for its day, or
 * its day has gone by and the money is still here. `late` is amber rather than red ON PURPOSE --
 * the day it compares against comes from `payover_lag_months`, which is a default the firm has
 * not yet confirmed, and a red banner driven by a setting nobody has named is the warning
 * CLAUDE.md says is worse than none. It states the fact and leaves the judgement.
 */
export function cycleState(c: TrustCycle, today: string): CycleState {
  if (c.isOpen) {
    const left = daysBetween(today, c.periodEnd)
    return {
      word: 'Collecting now',
      detail: left <= 0
        ? `Closes today · pays over ${shortDate(c.paysOn)}`
        : `${left === 1 ? '1 day' : `${left} days`} to run · pays over ${shortDate(c.paysOn)}`,
      tone: 'open',
    }
  }
  const until = daysBetween(today, c.paysOn)
  if (until >= 0) {
    return {
      word: 'Closed',
      detail: until === 0
        ? `Pays over today, ${shortDate(c.paysOn)}`
        : `Pays over ${shortDate(c.paysOn)}, in ${until === 1 ? '1 day' : `${until} days`}`,
      tone: 'due',
    }
  }
  const late = -until
  return {
    word: 'Still in trust',
    detail: `Was due ${shortDate(c.paysOn)}, ${late === 1 ? '1 day' : `${late} days`} ago`,
    tone: 'late',
  }
}

/**
 * HOW FAR THROUGH AN OPEN CYCLE TODAY IS, 0 to 1.
 *
 * Only ever drawn on the open one. A closed cycle's bar would read as progress towards being paid,
 * which is not what the number means and is not something the figure knows.
 */
export function cycleProgress(c: TrustCycle, today: string): number {
  const span = daysBetween(c.periodStart, c.periodEnd) + 1
  if (span <= 0) return 1
  const done = daysBetween(c.periodStart, today) + 1
  return Math.max(0, Math.min(1, done / span))
}

export interface CycleTotals {
  collected: number
  toClients: number
  firmEarned: number
  firmMoved: number
  toDebtors: number
  held: number
}

/**
 * WHAT THE CYCLE ACTUALLY COLLECTED, gross, before it was split between the people it belongs to.
 *
 * THE FIRM PUT THIS COLUMN FIRST on their own sketch -- "COLLECTED, CLIENT PORTION, BF EARNED,
 * OTHER HELD" -- and they are right that it leads: the client portion and the firm's share are
 * both shares OF something, and without the something on the row you cannot see whether a small
 * client column is a quiet month or a fat commission.
 *
 * THE FIRM'S DRAWINGS ARE NOT COLLECTIONS, which is the whole reason this is a function rather
 * than a sum of the row. `firmMoved` is the firm's own column for entries with no receipt behind
 * them -- a drawing to the business account, a correction, a parked credit taken over -- and
 * adding it in would make a month look bigger the more the firm took out of it. `trust_by_cycle`
 * already separates earned from moved for exactly this reason; this is the half that uses it.
 */
export function cycleCollected(c: TrustCycle): number {
  return Math.round((c.toClients + c.firmEarned + c.toDebtors + c.unplaced) * 100) / 100
}

/**
 * THE COLUMN SUMS, AND THEY ARE WHAT TIES THIS SCREEN TOGETHER.
 *
 * `trust_by_cycle` buckets every creditor entry exactly once, so these totals are the SAME figures
 * `trust_position` reports for the whole account: clients to `owedToClients`, debtors to
 * `owedToDebtors`, and the firm's two columns together to `owedToFirm`. The overview draws both,
 * and `check-trust-cycles` holds them against each other -- two arithmetics for one balance is
 * exactly the drift the payover engine was centralised to avoid.
 */
export function cycleTotals(cycles: TrustCycle[]): CycleTotals {
  const r = (v: number): number => Math.round(v * 100) / 100
  return {
    collected: r(cycles.reduce((s, c) => s + cycleCollected(c), 0)),
    toClients: r(cycles.reduce((s, c) => s + c.toClients, 0)),
    firmEarned: r(cycles.reduce((s, c) => s + c.firmEarned, 0)),
    firmMoved: r(cycles.reduce((s, c) => s + c.firmMoved, 0)),
    toDebtors: r(cycles.reduce((s, c) => s + c.toDebtors, 0)),
    held: r(cycles.reduce((s, c) => s + c.held, 0)),
  }
}

/**
 * WHAT STILL HAS TO HAPPEN ON A CLOSED CYCLE, or null where nothing does.
 *
 * A closed cycle holding client money with NO run built is a different problem from one where the
 * runs exist and are waiting to be approved, and "needs attention" over both would flatten them
 * into one shrug. An open cycle is never behind on anything -- its runs are not built until it
 * closes -- so it is asked nothing.
 */
/**
 * The closed cycles still holding client money after the day they were due out.
 *
 * PAST ITS DAY, NOT MERELY CLOSED. A cycle closes on the 10th and is paid over later -- how much
 * later is a trust setting -- so between those two dates it is holding client money entirely
 * properly. Only once `paysOn` has gone by is the firm holding somebody else's money longer than
 * it said it would, and that is the one of the four checks that is about a promise rather than a
 * sum.
 *
 * `toClients > 0` because a cycle that nets to nothing for clients has nothing to be late with.
 *
 * LATE IS ASKED OF `cycleState`, NOT RE-DERIVED. The first draft wrote the comparison out again as
 * `!c.isOpen && c.paysOn < today`, which is the same rule in a second place -- and the rule is not
 * as obvious as it looks, because a closed cycle is NOT late until `paysOn` has gone by, and there
 * is a settable lag between those two dates. Two copies of that drift the day the lag changes, and
 * the symptom would be the overview's own panel disagreeing with the band drawn beside it.
 */
export function overdueCycles(cycles: TrustCycle[], today: string): TrustCycle[] {
  return cycles.filter((c) => c.toClients > 0 && cycleState(c, today).tone === 'late')
}

export function cycleTodo(c: TrustCycle): string | null {
  if (c.isOpen) return null
  if (c.toClients <= 0) return null
  if (c.runs === 0) return 'No payover run has been built for it yet'
  if (c.runsToDo > 0) {
    return c.runsToDo === 1
      ? '1 run still to be approved and paid'
      : `${c.runsToDo} runs still to be approved and paid`
  }
  return null
}
