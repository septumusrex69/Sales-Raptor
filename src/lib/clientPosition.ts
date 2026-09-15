/**
 * What the firm tells a client an account is doing.
 *
 * TWO VOCABULARIES, ONE MAPPING. This file is the mapping, and it exists because the two lists
 * cannot be the same list.
 *
 * An INTERNAL status has to let an agent record the truth, however awkward. Make that list
 * client-friendly and an agent with an awkward truth picks something untrue instead, and then
 * both the queue and the report are wrong. The diary already taught the firm this: "Review"
 * meant nothing, so everything went into it, and 308 of 375 entries ended up in the catch-all.
 *
 * A CLIENT-FACING position has to be short, stable and answer the client's four questions -- is
 * anyone working it, is money coming, what is stuck, what do you need from me. A client shown
 * the internal vocabulary reads "No Contact Yet" against four hundred accounts and concludes
 * nothing is happening.
 *
 * So the internal vocabulary stays as rich as agents need, and this one function turns it into
 * ten positions. Rename an internal status and a client's historical reports are unaffected;
 * change this mapping and you have changed what the firm reports, deliberately, in one place.
 *
 * Pure on purpose: every input is passed in, nothing is fetched, no clock of its own. The report
 * that has to be reproducible three months later cannot depend on a function that reads today.
 */

export type ClientPosition =
  | 'paying'
  | 'arranged'
  | 'broken_arrangement'
  | 'refusing'
  | 'negotiating'
  | 'being_worked'
  | 'tracing'
  | 'disputed'
  | 'legal'
  | 'frozen'
  | 'closed'

interface PositionMeta {
  /** What the client reads. The firm's words, not the database's. */
  label: string
  /** One line under it on the dashboard, in the client's terms rather than the collector's. */
  meaning: string
  /**
   * Is somebody expected to be working this account?
   *
   * The dashboard's most useful single number is how much of the book is actually in play.
   * Frozen, closed and legal are not idle -- they are elsewhere -- and lumping them in with the
   * accounts an agent rings makes a book look busier than it is.
   */
  inPlay: boolean
}

export const CLIENT_POSITIONS: Record<ClientPosition, PositionMeta> = {
  paying: {
    label: 'Paying',
    meaning: 'Money received from this debtor during the period.',
    inPlay: true,
  },
  arranged: {
    label: 'Arranged',
    meaning: 'The debtor has committed to an amount and a date that has not yet arrived.',
    inPlay: true,
  },
  broken_arrangement: {
    label: 'Broken arrangement',
    meaning: 'They committed to pay and the money did not come. Being chased.',
    inPlay: true,
  },
  refusing: {
    /*
     * ITS OWN POSITION, because none of the other ten described it and it is the largest active
     * group on the book -- 88 accounts, 90 with the unfrozen ones.
     *
     * It was first read as a broken arrangement, which was wrong: a broken arrangement means
     * they committed and then failed, and this debtor never committed to anything. Nor is it
     * "being worked", which means contact has not been made -- contact HAS been made and the
     * answer was no.
     *
     * The distinction is the client's decision to make, which is why it cannot be hidden inside
     * a softer position. Somebody who cannot be found needs tracing; somebody who broke a
     * promise needs chasing; somebody who has refused needs the client to decide whether to go
     * legal. Three different questions, and only this one is asked of the client.
     */
    label: 'Refusing to pay',
    meaning: 'The debtor has been reached and will not pay. The next step is usually a legal decision.',
    inPlay: true,
  },
  negotiating: {
    label: 'Negotiating',
    meaning: 'We have reached the debtor and are working towards an arrangement.',
    inPlay: true,
  },
  being_worked: {
    label: 'Being worked',
    meaning: 'Contact is being attempted. We have not reached the debtor yet.',
    inPlay: true,
  },
  tracing: {
    label: 'Tracing',
    meaning: 'The debtor cannot be reached at the details on file. A trace is running.',
    inPlay: true,
  },
  disputed: {
    label: 'Disputed',
    meaning: 'The debtor disputes the debt. Collection is paused while it is answered.',
    inPlay: true,
  },
  legal: {
    label: 'Legal',
    meaning: 'A legal step has been taken -- Section 129, summons, or handed to attorneys.',
    inPlay: false,
  },
  frozen: {
    label: 'Frozen',
    meaning: 'Work is stopped. See the reason and who asked for it.',
    inPlay: false,
  },
  closed: {
    label: 'Closed',
    meaning: 'Off the book -- paid up, withdrawn, written off or prescribed.',
    inPlay: false,
  },
}

/** Dashboard order: money first, then the work, then the ones that are elsewhere. */
export const CLIENT_POSITION_ORDER: ClientPosition[] = [
  'paying', 'arranged', 'broken_arrangement', 'refusing', 'negotiating', 'being_worked',
  'tracing', 'disputed', 'legal', 'frozen', 'closed',
]

export interface PositionInput {
  /** debtor_accounts.status, as inherited. 'Active: Activated', 'Frozen', 'Written-off', ... */
  status?: string | null
  /** debtor_accounts.sub_status. 'Delinquent Payer', 'Promise To Pay', 'Tracing', ... */
  subStatus?: string | null
  /** Money received inside the reporting period. Not "ever" -- a client report is about a month. */
  paidInPeriod?: boolean
  /**
   * The debtor was actually REACHED in the period: a call they answered, a reply, a consultation.
   * It is the whole difference between Negotiating and Being worked, and it cannot be read off
   * a status -- only off what happened.
   */
  reachedInPeriod?: boolean
  /** An open dispute on the account. */
  disputed?: boolean
  /** A legal step has been taken: Section 129, summons, attorneys. */
  inLegal?: boolean
  /** True once the account is off the book, whatever the inherited status says. */
  closed?: boolean
}

/**
 * The single rung an account is reported on.
 *
 * PRECEDENCE IS STRUCTURAL FIRST, MONEY SECOND, and that is a deliberate choice rather than an
 * accident of ordering. An account in summons that also paid something is reported as Legal: the
 * client needs to know a legal process is running, and "Paying" would hide it. The money is not
 * lost by this -- every report carries collections per position alongside the count, so Legal
 * reads "14 accounts, R38 000 collected" and says both things at once. One label was never going
 * to carry both, so the label says where it is and the column says what it is doing.
 */
export function clientPosition(input: PositionInput): ClientPosition {
  const status = (input.status ?? '').trim()
  const sub = (input.subStatus ?? '').trim()

  // Off the book beats everything: nothing else is true of an account that is finished.
  if (input.closed || /^written[- ]off/i.test(status) || /^closed/i.test(status)) return 'closed'
  if (/^frozen/i.test(status)) return 'frozen'

  // A legal step is a fact about where the matter IS, not about how it is going.
  if (input.inLegal || /section\s*129|summons|attorney|litigat/i.test(sub)) return 'legal'
  if (input.disputed || /defended|dispute/i.test(sub)) return 'disputed'
  if (/tracing|trace/i.test(sub)) return 'tracing'

  if (input.paidInPeriod) return 'paying'
  if (/promise\s*to\s*pay|\bptp\b/i.test(sub)) return 'arranged'

  /*
   * TWO DIFFERENT FACTS, and they were briefly read as one.
   *
   * A payment default is an arrangement that came up short: they committed, and an instalment
   * did not arrive. "Delinquent Payer" -- the firm's inherited Swordfish term -- is somebody who
   * does not pay at all and refuses to, which is not a default because nothing was ever agreed.
   * Collapsing them would have reported 90 refusals as broken arrangements and told the client
   * the wrong thing about the biggest active group on their book.
   */
  if (/payment\s*default/i.test(sub)) return 'broken_arrangement'
  if (/delinquent|refus/i.test(sub)) return 'refusing'

  if (input.reachedInPeriod) return 'negotiating'

  /*
   * The floor, and it is deliberately the honest one. An unrecognised status lands here rather
   * than in a 'unknown' bucket, because "we are working it" is true of every active account by
   * definition, and a position no client can interpret is worse than a modest one.
   */
  return 'being_worked'
}

/**
 * Is this account waiting on the CLIENT rather than on the firm?
 *
 * Kept off the position ladder on purpose: an account can be waiting for a statement AND be
 * actively worked, and collapsing the two loses whichever is not shown. It is the single most
 * useful column on a client report -- the one that turns "why have you not collected" into
 * "here are eleven you can unblock today" -- so it is reported as its own named list.
 *
 * Derived, never stored: a dispute already carries `with_client` as a state, and a second copy
 * of the same fact is a second copy to keep in step.
 */
export function needsClient(input: { openQueryWithClient?: boolean }): boolean {
  return input.openQueryWithClient === true
}

export type FrozenBy = 'firm' | 'client'

/**
 * How a freeze reads to a client.
 *
 * The distinction is the whole point of recording who: an account the CLIENT asked to stop and
 * one BREDELL FERREIRA stopped are opposite facts, and 150 accounts currently say only "Frozen".
 */
export function frozenByLabel(by: FrozenBy | null | undefined, firmName = 'Bredell Ferreira'): string {
  if (by === 'client') return 'Frozen at your request'
  if (by === 'firm') return `Frozen by ${firmName}`
  return 'Frozen — no reason recorded'
}

/** Everything a client needs said about one account's position, in one place. */
export interface PositionReport {
  position: ClientPosition
  label: string
  needsClient: boolean
}

export function positionReport(
  input: PositionInput & { openQueryWithClient?: boolean },
): PositionReport {
  const position = clientPosition(input)
  return { position, label: CLIENT_POSITIONS[position].label, needsClient: needsClient(input) }
}
