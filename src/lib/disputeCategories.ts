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
export type EscalationKind = 'dispute' | 'help' | 'litigation' | 'import'

export interface EscalationMeta {
  /** What the option is called. */
  label: string
  /** The one line under it that says when to pick it. */
  blurb: string
  /** Only a dispute may ever raise a fee. Enforced in raiseQuery, not merely read from here. */
  chargeable: boolean
  /** A dispute is classified from QUERY_CATEGORIES; the other two have nothing to classify. */
  needsCategory: boolean
  /** What the description box should prompt for. */
  placeholder: string
  /** Who this normally goes to, used to preselect the assignee. */
  goesTo: 'liaison' | 'team_leader'
}

export const ESCALATION_KINDS: Record<EscalationKind, EscalationMeta> = {
  dispute: {
    label: 'The debtor disputes the account',
    blurb: 'They say something is wrong — the amount, the debt, the paperwork.',
    chargeable: true,
    needsCategory: true,
    placeholder: 'Says she settled it directly with the client in March and has the proof.',
    goesTo: 'liaison',
  },
  help: {
    label: 'Ask a team leader for help',
    blurb: 'You are not sure how to take this one forward and want a decision.',
    chargeable: false,
    needsCategory: false,
    placeholder: 'Debtor keeps agreeing to pay and never does. Worth a letter of demand?',
    goesTo: 'team_leader',
  },
  litigation: {
    label: 'Recommend it for litigation',
    blurb: 'The debtor will not pay and collections has nothing left to try.',
    chargeable: false,
    needsCategory: false,
    placeholder: 'Refuses to pay, has the means, ignored three letters. Recommend we sue.',
    goesTo: 'liaison',
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
    placeholder: 'The ID number on the handover sheet is a telephone number.',
    goesTo: 'liaison',
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
export const ESCALATION_KIND_ORDER: EscalationKind[] = ['dispute', 'help', 'litigation']

/**
 * May this escalation raise Annexure B item 3?
 *
 * A function rather than a property read at the call site, so there is exactly one expression in
 * the codebase that answers it and a new kind cannot be added without coming through here.
 */
export function escalationChargeable(kind: EscalationKind | null | undefined): boolean {
  return !!kind && ESCALATION_KINDS[kind]?.chargeable === true
}

/** How the timeline records it. */
export function escalationNote(kind: EscalationKind, description: string): string {
  switch (kind) {
    case 'help': return `Escalated for help: ${description}`
    case 'litigation': return `Recommended for litigation: ${description}`
    default: return `Dispute raised: ${description}`
  }
}
