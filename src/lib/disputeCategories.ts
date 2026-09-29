/**
 * The dispute classification.
 *
 * Its own module because it is pure data with two rules attached, and because accountQueries
 * talks to Postgres — which would mean the taxonomy could only be exercised in a browser. The
 * thing a collector picks from on every call is worth being able to test in a second.
 */

/**
 * What a debtor is actually disputing, as the firm classifies it.
 *
 * The first list was a guess — seven labels invented from what disputes tend to be about. This
 * one is the firm's own, and it is a better instrument for the same reason any real taxonomy
 * beats an improvised one: the categories divide on WHY the debtor is objecting rather than on
 * what they happened to say. "Already paid" and "amount disputed" were two names for arguments
 * that need entirely different answers; "payment query" and "amount dispute" are not.
 *
 * The examples are not decoration. A collector on a call has seconds to classify, and the second
 * column is what makes the difference between the right box and the nearest one — so they are
 * shown beside the choice rather than kept in a manual nobody opens.
 *
 * Ordered as the firm wrote it, not alphabetically: the common ones are near the top, which is
 * where a list that gets used every day should put them.
 */
export interface QueryCategory {
  /** Stored on the dispute, and what every report groups by. Never change one without migrating. */
  value: string
  /** The kinds of thing that belong here, in the collector's words. */
  examples: string
}

export const QUERY_CATEGORIES: QueryCategory[] = [
  { value: 'Amount dispute', examples: 'Incorrect balance, fees, interest, missing payment' },
  { value: 'Product/service dispute', examples: 'Defective, not delivered, incomplete service' },
  { value: 'Liability dispute', examples: 'Wrong debtor, no contract, fraud, no surety' },
  { value: 'Payment query', examples: 'Paid, partially paid, proof submitted' },
  { value: 'Contract/cancellation', examples: 'Cancelled, renewal, notice period' },
  { value: 'Information request', examples: 'Invoice, statement, contract, breakdown' },
  { value: 'Legal/status issue', examples: 'Prescription, debt review, liquidation' },
  { value: 'Third-party payment', examples: 'Insurance, medical aid, employer' },
  { value: 'Administrative query', examples: 'Wrong contact details, communication preference' },
  { value: 'Other', examples: 'Anything the list above does not cover — say what it is' },
]

/** The one category that will not carry itself: "Other" says nothing without the words. */
export const CATEGORY_NEEDING_EXPLANATION = 'Other'

/**
 * How much explanation "Other" has to come with.
 *
 * Long enough that "n/a", "see notes" and a stray keystroke do not pass, short enough that a
 * real sentence always does. A category that means "not one of the nine" is worthless to anyone
 * reading it later unless the words say what it actually was.
 */
export const EXPLANATION_MIN_LENGTH = 15

export function explanationMissing(category: string | null | undefined, description: string): boolean {
  return category === CATEGORY_NEEDING_EXPLANATION && description.trim().length < EXPLANATION_MIN_LENGTH
}

export function categoryExamples(value: string | null | undefined): string | null {
  return QUERY_CATEGORIES.find((c) => c.value === value)?.examples ?? null
}

/** Where a dispute sits. Mirrors the account_queries.stage check constraint. */
export type DisputeStage = 'agent' | 'team_leader' | 'liaison' | 'client'

/**
 * Where a dispute sits, given who is holding it.
 *
 * The stage follows the assignee rather than being set separately, because they cannot disagree
 * without one of them being a lie. Handing a dispute to the liaison IS escalating it to the
 * liaison; making somebody then press a button to say so is a second chance to forget.
 */
export function stageForAssignee(
  assigneeRole: string | undefined,
  isClientLiaison: boolean,
): DisputeStage {
  if (!assigneeRole) return 'agent'
  if (isClientLiaison) return 'liaison'
  if (assigneeRole === 'Pre-legal Team Leader') return 'team_leader'
  if (assigneeRole === 'Liaison' || assigneeRole === 'Liaison Manager') return 'liaison'
  return 'agent'
}

/**
 * Who may put a query in front of a client.
 *
 * A collections agent should not be writing to a client about a disputed account on their own
 * initiative — that is the liaison's relationship to manage. Everything else on a query is open
 * to anyone signed in.
 *
 * Neither pre-legal role is on this list, and that is the point rather than an omission: an agent
 * works the debtor and a team leader supervises that work, but the conversation with a client
 * belongs to whoever holds the relationship.
 */
export const CAN_SEND_TO_CLIENT = ['Administrator', 'Sales Manager', 'Liaison Manager', 'Liaison']

export function canSendToClient(role: string | undefined): boolean {
  return CAN_SEND_TO_CLIENT.includes(role ?? '')
}

/** How a dispute ended. */
export type QueryOutcome = 'valid' | 'partly_valid' | 'not_valid' | 'withdrawn'

export const QUERY_OUTCOME_LABEL: Record<QueryOutcome, string> = {
  valid: 'Valid',
  partly_valid: 'Partly valid',
  not_valid: 'Not valid',
  withdrawn: 'Withdrawn by debtor',
}

/**
 * WHAT AN UPHELD DISPUTE DID TO THE ACCOUNT, which is not the same question as whether it was
 * valid — and the firm named them: "either the account can be withdrawn or the account can stay
 * with new terms and conditions. So, for example, the handover amount can change... or the
 * dispute can be valid but nothing changes."
 *
 * TWO OF THE FOUR CARRY ON AND TWO END IT, and which is which turns on ONE question: is the
 * debtor still in default?
 *
 * A CORRECTED AMOUNT DOES NOT VOID THE DEMAND, and this reverses what was built first. Section
 * 129(1)(a) requires notice of the DEFAULT and the proposal to refer the matter to a debt
 * counsellor, ADR agent, consumer court or ombud. The amount is not the statutory content — most
 * notices state one, but that is not what makes the notice good, and the case law everyone cites
 * is about DELIVERY rather than quantum. The firm pushed back and were right: "the guy disputed
 * it, the dispute was right, the amount was changed, but everything else still stays in place."
 *
 * AND THE BALANCE LOOKS AFTER ITSELF: every notice merges {{balance}} live, so a sequence that
 * resumes on a corrected figure quotes the corrected figure from the next notice onward.
 */
export type QueryEffect = 'no_change' | 'amount_changed' | 'no_longer_in_arrears' | 'withdrawn'

/**
 * THE WORDS AVOID A COLLISION THAT WOULD COST A DEMAND. `outcome` already has a 'withdrawn' and
 * it means the DEBTOR withdrew the dispute — the opposite of the firm's "the account can be
 * withdrawn". Two withdrawns on one screen is how somebody ends a sequence that should have
 * resumed, so neither of these says the word on its own.
 *
 * ORDERED COMMONEST FIRST, which is also safest first: the two that carry on, then the two that
 * end it.
 */
export const QUERY_EFFECT_LABEL: Record<QueryEffect, string> = {
  no_change: 'Nothing changes on the account',
  amount_changed: 'The amount is corrected — still in arrears',
  no_longer_in_arrears: 'The correction clears the arrears',
  withdrawn: 'The client takes the account back',
}

export const QUERY_EFFECT_HINT: Record<QueryEffect, string> = {
  no_change: 'The debt stands. Any sequence that was paused carries on where it stopped.',
  amount_changed: 'The section 129 stands — it said the debtor was in default, which was true, '
    + 'and every notice after it quotes the corrected balance. The sequence carries on.',
  no_longer_in_arrears: 'There was no default to demand remedy of, so the sequence ends. A fresh '
    + 'section 129 can be issued if this account falls into arrears again.',
  withdrawn: 'Nothing more is ever sent. Everything still to come is cancelled.',
}

/* ---------- what kind of escalation this is ---------- */

/**
 * The three reasons an account goes to somebody else.
 *
 * The firm asked for one door — "Escalate" — with the debtor's dispute as one of the things
 * behind it. All three are the same object deliberately: each needs an owner, a chase date and
 * an answer, and building three queues would mean three places to look for what is waiting on
 * you.
 *
 * They are not the same about MONEY, and that is the reason this is a stored column rather than
 * a label. A dispute raises Annexure B item 3 because the debtor's objection is what caused
 * somebody else's time to be spent on the account. An agent asking a team leader what to do is
 * the firm supervising its own staff. A recommendation to sue is the firm deciding how to run
 * its business. A debtor pays for the first and must never pay for the other two.
 */
export type EscalationKind = 'dispute' | 'request' | 'help' | 'litigation' | 'import'

/**
 * WHAT A REQUEST IS ASKING FOR.
 *
 * THE FIRM: "instead of asking who are we asking, ask what are we asking, and then give it to."
 *
 * AND ASKING **WHO** WAS THE MISTAKE, not merely the wrong order. They asked, of the version this
 * replaces: "from the debtor -- how would we request something from the debtor other than a
 * written dispute, which already has that workflow in place?" The answer is that the source should
 * never have been a field. WHO IS BEING ASKED IS ALREADY ON THE TICKET -- it is whoever it was
 * GIVEN TO. Hand a statement request to the liaison and the client is who gets asked; hand a proof
 * of payment to the collector and the debtor is. Storing it twice meant two fields that could
 * disagree, with nothing able to say which was true.
 *
 * SHAPED LIKE QUERY_CATEGORIES because it does the same job: a closed list so the board sorts by
 * something other than the free text, with the words a collector would use rather than a code.
 */
export const REQUEST_KINDS: QueryCategory[] = [
  { value: 'Statement of account', examples: 'The full statement, or one for a period' },
  { value: 'Contract or agreement', examples: 'The signed agreement, a surety, the terms' },
  { value: 'Invoices', examples: 'The invoices the debt is made up of' },
  { value: 'Proof of delivery', examples: 'Delivery notes, signed receipts, waybills' },
  { value: 'Proof of payment', examples: 'A payment somebody says was made' },
  { value: 'Debtor details', examples: 'An address, a number, an employer, an identity number' },
  { value: 'Something on our own file', examples: 'A note, a scanned page, something from the handover' },
  { value: 'Other', examples: 'Anything the list above does not cover — say what it is' },
]

export interface EscalationMeta {
  /** What the option is called. */
  label: string
  /** The one line under it that says when to pick it. */
  blurb: string
  /** Only a dispute may ever raise a fee. Enforced in raiseQuery, not merely read from here. */
  chargeable: boolean
  /** A dispute is classified from QUERY_CATEGORIES; the other two have nothing to classify. */
  needsCategory: boolean
  /**
   * WHAT THE DESCRIPTION BOX IS HEADED, and what it prompts for inside.
   *
   * `prompt` is here for the same reason `submitLabel` is below: it was the third copy of the same
   * if-else chain with a fallback, so a request asked "why has collecting run out of road?" until
   * the check that guards the other two found it.
   */
  prompt: string
  placeholder: string
  /**
   * WHAT THE BUTTON SAYS, AND WHAT THE FEE LINE SAYS WHEN NOTHING IS CHARGED.
   *
   * ON THE KIND RATHER THAN IN A CHAIN ON THE SCREEN, because the screen had
   * `kind === 'dispute' ? … : kind === 'help' ? … : <litigation>` -- and a chain with a fallback
   * gives a NEW kind somebody else's words. The firm found it the day a request was added: "it
   * says like recommend for litigation. Why is that?" A record cannot fall through; a missing
   * entry is a type error before it is a screen.
   */
  submitLabel: string
  /** Only read where `chargeable` is false. Says why the debtor pays nothing for THIS one. */
  freeNote: string
  /**
   * Who this normally goes to, used to preselect the assignee.
   *
   * `anyone` is the request's, at the firm's choosing: a request is low-stakes admin and the
   * person who can answer it is often neither a team leader nor a liaison -- whoever did the
   * import, whoever took the call. A dispute is the opposite and stays on the short list, because
   * a FINDING needs somebody with standing to make it.
   */
  goesTo: 'liaison' | 'team_leader' | 'anyone'
  /**
   * WHAT THE CARD ON THE BOARD IS CHIPPED WITH, and the tint it wears.
   *
   * ON THE KIND FOR THE SAME REASON `submitLabel` IS, and found the same way. The board drew the
   * chip with `kind === 'help' ? 'Team leader asked' : 'For litigation'` -- a chain with a
   * fallback -- so the day `request` was added every request on the board announced itself as a
   * recommendation to sue, and so did every import correction. A record cannot fall through.
   *
   * AND THE TINT IS NOT DECORATION. The firm, looking at the board: "a request and a dispute
   * looks exactly the same. Maybe there should be different colors." They are not the same
   * object at all -- a dispute holds every collection sequence on the account and a request holds
   * nothing -- and a queue where the one that stops the work is indistinguishable from the one
   * that does not is a queue people work in the wrong order.
   */
  cardLabel: string
  /** Tailwind classes for the chip. Rust for the one that stops collecting; quieter for the rest. */
  cardTint: string
}

export const ESCALATION_KINDS: Record<EscalationKind, EscalationMeta> = {
  dispute: {
    label: 'The debtor disputes the account',
    blurb: 'They say something is wrong — the amount, the debt, the paperwork.',
    chargeable: true,
    needsCategory: true,
    prompt: 'What is the issue?',
    placeholder: 'Says she settled it directly with the client in March and has the proof.',
    goesTo: 'liaison',
    cardLabel: 'Dispute',
    cardTint: 'bg-[var(--tint-rust)] text-negative-700',
    submitLabel: 'Raise dispute',
    freeNote: '',
  },
  /*
   * NOT A DISPUTE, AND THE DIFFERENCE IS PHYSICS RATHER THAN SEVERITY. A dispute is a state of the
   * account -- it holds every collection sequence, runs a ten-business-day clock and ends in a
   * finding. A request is a piece of work: it holds nothing, ends when THE THING ARRIVES, and
   * several are open at once. The firm: "requesting additional information doesn't justify
   * something as serious as a dispute."
   *
   * NEVER CHARGEABLE. Item 3 recovers time the DEBTOR caused somebody to spend. A clerk chasing a
   * client for a statement the client should have attached is the client's failing, and billing a
   * debtor for their creditor's admin would not survive being asked about. Where a request really
   * was debtor-caused, the thing that earns a fee is the SENDING of what they asked for -- item
   * 1(a) on the email -- not the asking.
   */
  request: {
    label: 'Ask somebody for information or a document',
    blurb: 'A statement, the contract, proof of delivery — something needed to carry on.',
    chargeable: false,
    needsCategory: false,
    prompt: 'What do you need?',
    placeholder: 'Need the statement for March to June — it was not attached to the handover.',
    goesTo: 'anyone',
    cardLabel: 'Request',
    cardTint: 'bg-[var(--tint-steel)] text-[var(--c-navy-mid)]',
    submitLabel: 'Raise request',
    freeNote: 'Asking for a document is not something the debtor caused. Where they asked for it '
      + 'themselves, what earns a fee is sending it — item 1(a) on the email, charged when it goes.',
  },
  help: {
    label: 'Ask a team leader for help',
    blurb: 'You are not sure how to take this one forward and want a decision.',
    chargeable: false,
    needsCategory: false,
    prompt: 'What do you need decided?',
    placeholder: 'Debtor keeps agreeing to pay and never does. Worth a letter of demand?',
    goesTo: 'team_leader',
    cardLabel: 'Team leader asked',
    cardTint: 'bg-slate-100 text-slate-600',
    submitLabel: 'Ask for help',
    freeNote: 'Asking a team leader what to do is the firm supervising its own staff, not an '
      + 'expense of collecting from this debtor.',
  },
  litigation: {
    label: 'Recommend it for litigation',
    blurb: 'The debtor will not pay and collections has nothing left to try.',
    chargeable: false,
    needsCategory: false,
    prompt: 'Why has collecting run out of road?',
    placeholder: 'Refuses to pay, has the means, ignored three letters. Recommend we sue.',
    goesTo: 'liaison',
    cardLabel: 'For litigation',
    cardTint: 'bg-gold-100 text-[var(--c-gold-deep)]',
    submitLabel: 'Recommend litigation',
    freeNote: 'Deciding whether to sue is the firm\u2019s own business. The attorneys\u2019 costs '
      + 'are a separate matter if it goes ahead.',
  },
  /*
   * RAISED BY THE IMPORT, NOT BY A PERSON, which is why it is not in ESCALATION_KIND_ORDER: the
   * Escalate menu must not offer it. An agent looking at an account cannot decide that the
   * client's handover sheet was wrong -- the import already knows, and knows exactly which cell.
   *
   * NEVER CHARGEABLE. A dispute raises item 3 because the DEBTOR's objection caused the work; a
   * client's data being wrong is not something a debtor pays for, and billing them for their
   * creditor's typing would not survive being asked about.
   */
  import: {
    label: 'The client’s handover data needs correcting',
    blurb: 'Raised by the import when a handover is accepted with something wrong on it.',
    chargeable: false,
    needsCategory: false,
    prompt: 'What is wrong with the handover?',
    placeholder: 'The ID number on the handover sheet is a telephone number.',
    goesTo: 'liaison',
    cardLabel: 'Client data',
    cardTint: 'bg-[var(--tint-green)] text-[var(--c-green)]',
    submitLabel: 'Raise it',
    freeNote: 'A client\u2019s data being wrong is not something a debtor pays for.',
  },
}

/**
 * WHICH OF THE CLIENT'S TWO LISTS AN ESCALATION BELONGS ON, OR NEITHER.
 *
 * THE FIRM: "there's a difference between a client dispute, a client query, and a debtor's
 * dispute. Queries are for clients and disputes are for debtors. Now there should be two
 * different sections on the client portal about which ones are their open disputes and which ones
 * are their open queries. This would fall under a query, for example, the import that's not
 * completed."
 *
 * The client page had ONE list headed "Disputes on this client's book" and put everything
 * escalated to a liaison on it -- so an import correction, which is the firm asking the CLIENT to
 * check their own data, was shown to them as a DEBTOR disputing the debt. Two different things
 * wearing one word, on the screen a liaison reads before they phone the client.
 *
 * 'help' IS ON NEITHER LIST. An agent asking a team leader what to do is the firm supervising its
 * own staff, and a client has no business seeing it.
 *
 * 'litigation' IS A QUERY, and this one is a judgement rather than something the firm said. It is
 * plainly not a debtor's dispute; and a recommendation to sue is a thing the CLIENT has to
 * authorise, so it belongs in front of them rather than nowhere. Worth confirming.
 */
export type ClientSection = 'dispute' | 'query'

export function clientSection(kind: EscalationKind | null | undefined): ClientSection | null {
  switch (kind) {
    case 'dispute': return 'dispute'
    case 'import': return 'query'
    case 'litigation': return 'query'
    /* Everything raised before the kind column existed reads as a dispute, which is what it was. */
    case null: case undefined: return 'dispute'
    default: return null
  }
}

/** In the order the options should be offered: the common one first. */
/*
 * THE ORDER IS THE LADDER, HEAVIEST FIRST, and `request` sits second rather than last on purpose:
 * it is the one that gets picked most and the one whose absence used to push small things into a
 * dispute.
 */
export const ESCALATION_KIND_ORDER: EscalationKind[] = ['dispute', 'request', 'help', 'litigation']

/**
 * May this escalation raise Annexure B item 3?
 *
 * A function rather than a property read at the call site, so there is exactly one expression in
 * the codebase that answers it and a new kind cannot be added without coming through here.
 */
export function escalationChargeable(kind: EscalationKind | null | undefined): boolean {
  return !!kind && ESCALATION_KINDS[kind]?.chargeable === true
}

/**
 * The chip for a row off the board, including a row raised before the kind column existed.
 *
 * `clientSection` already reads a null kind as a dispute -- which is what it was, because a
 * dispute was the only thing this table held then -- and the chip has to agree with it or the
 * same row says two things on two screens.
 */
export function escalationCard(kind: EscalationKind | null | undefined): { label: string; tint: string } {
  const meta = ESCALATION_KINDS[kind ?? 'dispute'] ?? ESCALATION_KINDS.dispute
  return { label: meta.cardLabel, tint: meta.cardTint }
}

/** How the timeline records it. */
export function escalationNote(kind: EscalationKind, description: string): string {
  switch (kind) {
    case 'request': return `Information requested: ${description}`
    case 'help': return `Escalated for help: ${description}`
    case 'litigation': return `Recommended for litigation: ${description}`
    default: return `Dispute raised: ${description}`
  }
}
