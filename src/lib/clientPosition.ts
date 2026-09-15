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
 * THE WORDS ARE THE FIRM'S OWN, lifted from the client-facing document its legal department
 * already maintains. They were written to be read by a client and they read better than anything
 * invented here would.
 *
 * NO FLAG LAYER. A catalogue of thirty flags underneath these positions was built and then
 * removed, at the firm's instruction to "forget about the flags, let's just keep to main
 * sub-statuses to make it simple". One status per account, and the richer breakdown becomes the
 * paid analysis a client subscribes to rather than a second vocabulary everybody has to maintain.
 * The descriptions from that catalogue survive here, on the positions that absorbed them.
 *
 * Pure on purpose: every input is passed in, nothing is fetched, no clock of its own. The report
 * that has to be reproducible three months later cannot depend on a function that reads today.
 */

export type ClientPosition =
  | 'paying'
  | 'arranged'
  | 'broken_arrangement'
  | 'refusing'
  | 'cannot_pay'
  | 'negotiating'
  | 'in_progress'
  | 'tracing'
  | 'disputed'
  | 'legal'
  | 'under_administration'
  | 'frozen'
  | 'closed'

/**
 * The four-state indicator beside a status: does anyone need to act?
 *
 * THREE OF THE FOUR ARE DERIVED, one is stored. Reading the firm's own table, every sub-status
 * maps to a fixed tone -- Paying is always progressing, Tracing is always attention, Frozen is
 * always inactive. A field whose value is a pure function of another field is not a second field;
 * it is presentation, and storing it only creates a way for the two to disagree.
 *
 * 'client_action' is the exception and the reason the indicator is worth having at all. It cannot
 * be derived from the status, because "we are waiting on YOU" is true of a disputed account, a
 * frozen one and a legal one alike. It is the flag that turns "why have you not collected" into
 * "here are eleven you can unblock today".
 */
export type ClientFlag = 'progressing' | 'attention' | 'client_action' | 'inactive'

export const CLIENT_FLAGS: Record<ClientFlag, { label: string; dot: string }> = {
  progressing: { label: 'Progressing', dot: '\u{1F7E2}' },
  attention: { label: 'Attention', dot: '\u{1F7E0}' },
  client_action: { label: 'Client action required', dot: '\u{1F534}' },
  inactive: { label: 'Inactive', dot: '\u26AA' },
}

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
  /**
   * How it is going, when nothing is owed by the client.
   *
   * Separate from inPlay, which asks whether anybody is expected to be ringing. Legal is not in
   * play -- it sits with attorneys -- but it is progressing. Under administration is neither.
   */
  tone: Exclude<ClientFlag, 'client_action'>
}

export const CLIENT_POSITIONS: Record<ClientPosition, PositionMeta> = {
  paying: {
    label: 'Paying',
    meaning: 'Money received from this debtor during the period.',
    inPlay: true,
    tone: 'progressing',
  },
  arranged: {
    label: 'Arranged',
    meaning: 'The debtor has arranged instalments, or a settlement, to clear the account.',
    inPlay: true,
    tone: 'progressing',
  },
  broken_arrangement: {
    label: 'Broken arrangement',
    /* The firm's own words: speed is what recovers a defaulted payment. */
    meaning: 'An arranged instalment was not paid. We make contact immediately — speed is what recovers a defaulted payment.',
    inPlay: true,
    tone: 'attention',
  },
  refusing: {
    /*
     * WILL NOT, as against CANNOT below. Avoiding contact belongs here, at the firm's
     * instruction -- "a guy that's avoiding contact is avoiding" -- which is the right call: a
     * debtor dodging a working number has answered, just not in words.
     *
     * Kept apart from `cannot_pay` because the client's decision turns on exactly this. You
     * litigate a refuser and you cycle back to a pensioner, and one label covering both would
     * put an unemployed debtor in hospital on a list headed "consider legal action".
     */
    label: 'Refusing to pay',
    meaning: 'The debtor will not pay, or is avoiding us on details that work. Usually a legal decision.',
    inPlay: true,
    tone: 'attention',
  },
  cannot_pay: {
    /*
     * CANNOT, as against WILL NOT above. The firm's own client documentation is unambiguous
     * here: unemployed, pensioner, hospitalised, business closed -- and its Pensioner note says
     * "cannot make payments mainly due to financial restraints ... we continue to attempt to
     * procure payment". That is not a refusal and must not be reported as one.
     */
    label: 'Cannot pay',
    meaning: 'The debtor is unable to pay — unemployed, a pensioner, in hospital, or the business has closed. We check back.',
    inPlay: true,
    tone: 'attention',
  },
  negotiating: {
    label: 'Negotiating',
    meaning: 'We have reached the debtor and are working towards an arrangement.',
    inPlay: true,
    tone: 'progressing',
  },
  in_progress: {
    /*
     * NOT "BEING WORKED", at the firm's instruction that "the word work will not work" -- and
     * they were right for a better reason than wording.
     *
     * "Being worked" described what the FIRM is doing, while every other position describes
     * what the ACCOUNT is. That is two axes on one list, which is the exact fault this model was
     * built to avoid: an account that is refusing to pay is also being worked, so the two were
     * never alternatives and could not sit on the same ladder.
     *
     * Read as the account's own state, this is simply the one with no conclusion yet. Ordinary
     * collection is under way and nothing has come of it. The moment something does -- a
     * promise, a refusal, a dispute, a dead number -- the account leaves for the position that
     * says so.
     */
    label: 'In progress',
    meaning: 'Ordinary collection is under way. Nothing has come of it yet.',
    inPlay: true,
    tone: 'progressing',
  },
  tracing: {
    label: 'Tracing',
    meaning: 'We could not reach the debtor on the details supplied. A trace is lodged with the credit and information bureaus.',
    inPlay: true,
    tone: 'attention',
  },
  disputed: {
    label: 'Disputed',
    meaning: 'The debtor disputes the account. We are establishing the dispute in writing and resolving it with our legal team.',
    inPlay: true,
    tone: 'attention',
  },
  legal: {
    label: 'Legal',
    meaning: 'A Section 129 letter of demand has been issued, or the matter is with attorneys on your instruction.',
    inPlay: false,
    tone: 'progressing',
  },
  under_administration: {
    /*
     * ONE POSITION FOR FIVE PROCESSES, at the firm's instruction to "find one category for all
     * of that stuff".
     *
     * Debt review, business rescue, liquidation, sequestration and a deceased estate look
     * unalike until you ask what the firm actually DOES about them, and then they are the same
     * thing: somebody else is administering the debtor's affairs, we deal with that person
     * rather than with the debtor, ordinary collection is restricted by law, and what we can
     * recover usually goes through a claim.
     *
     * Kept apart from `legal` because the two are opposites. `legal` is a step WE took --
     * Section 129, summons, attorneys. This is a process the DEBTOR is under, which constrains
     * what we may do. Putting them together would report the firm as taking action on accounts
     * where it is in fact being held back.
     *
     * Beats `legal` in the precedence for that reason: an account we served with Section 129
     * that then went under debt review is governed by the debt review, whatever we did first.
     */
    label: 'Under administration',
    meaning: 'A practitioner, liquidator, trustee or executor is administering the debtor. We deal with them, not the debtor.',
    inPlay: false,
    tone: 'attention',
  },
  frozen: {
    label: 'Frozen',
    meaning: 'Work is stopped. See the reason and who asked for it.',
    inPlay: false,
    tone: 'inactive',
  },
  closed: {
    label: 'Closed',
    meaning: 'Back with you — settled, withdrawn, prescribed, untraceable, or recommended for write-off.',
    inPlay: false,
    tone: 'inactive',
  },
}

/** Dashboard order: money first, then the work, then the ones that are elsewhere. */
export const CLIENT_POSITION_ORDER: ClientPosition[] = [
  'paying', 'arranged', 'broken_arrangement', 'refusing', 'cannot_pay', 'negotiating', 'in_progress',
  'tracing', 'disputed', 'legal', 'under_administration', 'frozen', 'closed',
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
  /** A legal step has been taken BY US: Section 129, summons, attorneys. */
  inLegal?: boolean
  /**
   * The DEBTOR is under a formal process — debt review, business rescue, liquidation,
   * sequestration, a deceased estate. The opposite of inLegal: it restrains us rather than
   * being something we did.
   */
  underAdministration?: boolean
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

  /*
   * Somebody else is in charge of the debtor's affairs, which governs whatever we had started.
   * Above `legal` deliberately — see the note on the position.
   */
  if (input.underAdministration
      || /debt\s*review|business\s*rescue|liquidat|sequestrat|deceased|estate|curator/i.test(sub)) {
    return 'under_administration'
  }

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

  /*
   * CANNOT is tested before WILL NOT, so that a stated hardship is never swallowed by a general
   * "not paying" label. Only words that actually name a hardship qualify; nothing is inferred.
   */
  if (/unemploy|pension|hospital|business\s*closed|deceased|incapacit/i.test(sub)) return 'cannot_pay'
  /*
   * "Delinquent Payer" is the firm's inherited term and its own definition is a refusal --
   * "somebody that just doesn't pay at all, he refuses to pay". Avoiding contact is read the
   * same way, on the same instruction.
   */
  if (/delinquent|refus|non.?cooperative|avoid/i.test(sub)) return 'refusing'

  if (input.reachedInPeriod) return 'negotiating'

  /*
   * The floor, and deliberately the honest one. An unrecognised status lands here rather than
   * in an 'unknown' bucket: "collection is under way, nothing has come of it" is true of every
   * active account by definition, and a position no client can interpret is worse than a modest
   * one.
   */
  return 'in_progress'
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

/**
 * The indicator shown beside the status.
 *
 * A client request beats everything, including a closed or frozen account -- especially those.
 * "The account remains frozen pending your instruction" is precisely the case a client needs to
 * see, and a grey dot saying "inactive" would bury it.
 */
export function clientFlag(position: ClientPosition, clientActionRequired = false): ClientFlag {
  if (clientActionRequired) return 'client_action'
  return CLIENT_POSITIONS[position].tone
}

/** Everything a client needs said about one account's position, in one place. */
export interface PositionReport {
  position: ClientPosition
  label: string
  needsClient: boolean
  flag: ClientFlag
  flagLabel: string
}

export function positionReport(
  input: PositionInput & { openQueryWithClient?: boolean },
): PositionReport {
  const position = clientPosition(input)
  const needs = needsClient(input)
  const flag = clientFlag(position, needs)
  return {
    position,
    label: CLIENT_POSITIONS[position].label,
    needsClient: needs,
    flag,
    flagLabel: CLIENT_FLAGS[flag].label,
  }
}
