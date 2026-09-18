/**
 * How a collector is doing, from the figures the database returns.
 *
 * THE RANKING METRICS ARE DELIBERATELY BOOK-INDEPENDENT, and that is the whole point of this
 * file. Rand collected measures the book somebody was handed at least as much as it measures
 * them: give a junior 130 gym memberships with a median balance of R1 800 and the entire
 * recoverable book is under a quarter of a million, while one payment on a commercial account
 * can be R139 000. Rank on rand and the people on small books can never produce the numbers
 * that would earn them bigger ones, so nobody is ever promoted out of the generic pile.
 *
 * So rand collected is shown, because it matters and the firm earns on it — but the figures that
 * compare two collectors fairly are payments per hundred accounts, the promise-kept rate and the
 * recovery rate. Those survive being given a different book.
 *
 * Everything here is pure arithmetic over the RPC's output, so it can be tested without a
 * database — which matters, because these numbers will decide who gets promoted.
 */

export interface CollectorStats {
  userId: string
  /** Accounts in play on their desk right now. Written-off and frozen do not count. */
  inPlayAccounts: number
  /** Capital outstanding across those accounts. */
  inPlayValue: number
  collected: number
  payments: number
  calls: number
  callsAnswered: number
  emailsSent: number
  smsSent: number
  notesWritten: number
  promisesMade: number
  promisesKept: number
  promisesBroken: number
  /** Distinct accounts worked in the period, however many times each. */
  accountsTouched: number
  /**
   * Traces BOUGHT and traces WORKED, which are two different things a month apart.
   *
   * Pulling a trace costs the firm money and produces a list of numbers, addresses and employers.
   * Working it is ringing them and recording what happened. A collector who pulls forty traces
   * and rings none of them has spent the firm's money and moved nothing — and one number for both
   * would hide exactly that.
   */
  tracesPulled: number
  /** What those traces gave them to work with: numbers, addresses, employers, links. */
  traceLeads: number
  /** Findings they actually tried, counted on the day the outcome was recorded. */
  tracesWorked: number
  /** Of those, the ones that turned out to be right. */
  tracesVerified: number
}

export interface CollectorScore extends CollectorStats {
  /** Calls, emails, SMS and notes — everything a person did to an account. */
  actions: number
  /**
   * Actions per account ON THE BOOK, not per account touched.
   *
   * Per-touched would reward working forty accounts hard and ignoring four hundred: the number
   * would climb as the book was neglected. Against the whole book it answers the question a
   * team leader actually asks, which is whether the book is being covered.
   */
  actionsPerAccount: number | null
  /** How much of the book was reached at all. The other half of actions per account. */
  coverage: number | null
  averagePayment: number | null
  /**
   * Collected against the book's outstanding capital.
   *
   * MIXES A FLOW WITH A STOCK — a period's collections over a balance as it stands today — which
   * is how the industry quotes it and is fine for comparing two collectors in the same month.
   * It is not a rate to annualise or to put in front of a client.
   */
  recoveryRate: number | null
  /** Payments per hundred accounts. The fairest single figure across unlike books. */
  paymentsPerHundred: number | null
  /**
   * Kept over RESOLVED, never over made.
   *
   * A promise taken on the 9th for the 25th is neither kept nor broken on the 10th. Dividing by
   * promises made would score an agent nought for a promise that has not come due yet, and
   * penalise exactly the person who takes promises further out.
   */
  promiseKeptRate: number | null
  /** Resolved promises: the denominator of the kept rate, worth showing beside it. */
  promisesResolved: number
  callAnswerRate: number | null
  /**
   * Of the trace findings this person tried, how many were real.
   *
   * VERIFIED OVER WORKED, never over what the bureau printed. A trace comes back with eleven
   * numbers and most of them are stale by construction — that is what a trace is. Judging
   * somebody on how many of the eleven were good would be judging the bureau. What this measures
   * is whether they are picking the likely ones and getting through.
   */
  traceHitRate: number | null
}

/** Null rather than zero when there is nothing to divide by. A rate of 0% is a claim; null is not. */
const rate = (top: number, bottom: number): number | null => (bottom > 0 ? top / bottom : null)

export function scoreCollector(s: CollectorStats): CollectorScore {
  const actions = s.calls + s.emailsSent + s.smsSent + s.notesWritten
  const promisesResolved = s.promisesKept + s.promisesBroken
  return {
    ...s,
    actions,
    actionsPerAccount: rate(actions, s.inPlayAccounts),
    coverage: rate(s.accountsTouched, s.inPlayAccounts),
    averagePayment: rate(s.collected, s.payments),
    recoveryRate: rate(s.collected, s.inPlayValue),
    paymentsPerHundred: s.inPlayAccounts > 0 ? (s.payments / s.inPlayAccounts) * 100 : null,
    promiseKeptRate: rate(s.promisesKept, promisesResolved),
    promisesResolved,
    callAnswerRate: rate(s.callsAnswered, s.calls),
    traceHitRate: rate(s.tracesVerified, s.tracesWorked),
  }
}

/* ---------- reading the numbers ---------- */

export type Band = 'good' | 'fair' | 'poor' | 'unknown'

/**
 * A traffic light, with thresholds that are guesses until the firm has a season of real figures.
 *
 * Stated as a constant rather than scattered through the markup precisely BECAUSE they are
 * guesses: when the firm says "sixty per cent kept is not good, it is average", one line changes.
 */
export const THRESHOLDS = {
  promiseKeptRate: { good: 0.7, fair: 0.45 },
  coverage: { good: 0.8, fair: 0.5 },
  callAnswerRate: { good: 0.35, fair: 0.2 },
  /* A trace is a list of mostly-stale numbers by construction. Getting a third of what you try to
     stick is good work, and these two are guesses until the firm has a season of real figures. */
  traceHitRate: { good: 0.3, fair: 0.15 },
} as const

export function band(value: number | null, t: { good: number; fair: number }): Band {
  if (value === null) return 'unknown'
  if (value >= t.good) return 'good'
  if (value >= t.fair) return 'fair'
  return 'poor'
}

/**
 * Is this person's book over what they should be carrying?
 *
 * The notice belongs on their own screen, not only on a settings table a collector never opens.
 */
export function overBookBy(s: CollectorStats, ceiling: number): number {
  return Math.max(0, s.inPlayAccounts - ceiling)
}

/** Total across a set of collectors, for a team leader's header. */
export function totalStats(all: CollectorStats[]): CollectorStats {
  const sum = (pick: (s: CollectorStats) => number) => all.reduce((t, s) => t + pick(s), 0)
  return {
    userId: '',
    inPlayAccounts: sum((s) => s.inPlayAccounts),
    inPlayValue: sum((s) => s.inPlayValue),
    collected: sum((s) => s.collected),
    payments: sum((s) => s.payments),
    calls: sum((s) => s.calls),
    callsAnswered: sum((s) => s.callsAnswered),
    emailsSent: sum((s) => s.emailsSent),
    smsSent: sum((s) => s.smsSent),
    notesWritten: sum((s) => s.notesWritten),
    promisesMade: sum((s) => s.promisesMade),
    promisesKept: sum((s) => s.promisesKept),
    promisesBroken: sum((s) => s.promisesBroken),
    /*
     * Summed, and therefore an OVERSTATEMENT where two collectors worked the same account. Kept
     * rather than dropped because the team total is read as "how much of the book did we reach",
     * and two people working one account is rare enough not to change that answer — but it is a
     * sum of distinct counts, not a distinct count, and nobody should read it as the latter.
     */
    accountsTouched: sum((s) => s.accountsTouched),
    tracesPulled: sum((s) => s.tracesPulled),
    traceLeads: sum((s) => s.traceLeads),
    tracesWorked: sum((s) => s.tracesWorked),
    tracesVerified: sum((s) => s.tracesVerified),
  }
}
