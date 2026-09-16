/**
 * What stands behind a debtor, and what already stands against them.
 *
 * Three facts that do not live on the account row and are not ways of reaching anybody:
 *
 *   directors     the people behind a company. A company is not rung; its directors are.
 *   practitioner  who to deal with when the debtor is no longer the person to ask.
 *   judgments     what other creditors have already got against them.
 *
 * They are one module because a collector reads them together, in one breath, before deciding
 * whether this account is worth an afternoon. All three came out of one real file: a company in
 * final liquidation, four of whose six directors had resigned, carrying two default judgments —
 * of which the book could hold exactly none.
 *
 * READ-ONLY, deliberately. Every one of these facts comes off a bureau profile that the firm pays
 * for; none of it is a collector's to type in. Writing them is the trace import's job.
 *
 * THE VOCABULARY AND THE RULES ARE HERE; the queries are in accountStandingData.ts, the same way
 * handOut.ts and handOutData.ts are split. Nothing in this file touches the network, so the
 * checks can run every function in it without a database or a credential.
 */
/**
 * Six offices, and the difference between them is the difference between claim procedures.
 *
 * Not free text. A collector has to be able to tell a liquidator from a debt counsellor at a
 * glance, because what you may do next is not the same — one is a claim proved in an estate, the
 * other is a proposal you may still negotiate with.
 */
export type PractitionerKind =
  | 'liquidator'
  | 'trustee'
  | 'curator'
  | 'executor'
  | 'business_rescue'
  | 'debt_counsellor'

export const PRACTITIONER_KINDS: {
  kind: PractitionerKind
  label: string
  /** What it means for the person reading it, in the firm's words, not the statute's. */
  meaning: string
}[] = [
  {
    kind: 'liquidator',
    label: 'Liquidator',
    meaning: 'The company is being wound up. The claim is proved in the liquidation, not collected from the company.',
  },
  {
    kind: 'trustee',
    label: 'Trustee',
    meaning: 'The estate is sequestrated. The claim is proved with the trustee.',
  },
  {
    kind: 'curator',
    label: 'Curator',
    meaning: 'The debtor cannot manage their own affairs. Everything goes through the curator.',
  },
  {
    kind: 'executor',
    label: 'Executor',
    meaning: 'The debtor has died. The claim goes to the executor of the estate.',
  },
  {
    kind: 'business_rescue',
    label: 'Business rescue practitioner',
    meaning: 'The company is in business rescue. Collection is suspended by the moratorium.',
  },
  {
    kind: 'debt_counsellor',
    label: 'Debt counsellor',
    meaning: 'The debtor is under debt review. A proposal comes through the counsellor.',
  },
]

export const practitionerLabel = (kind: PractitionerKind | null | undefined): string | null =>
  PRACTITIONER_KINDS.find((p) => p.kind === kind)?.label ?? null

export const practitionerMeaning = (kind: PractitionerKind | null | undefined): string | null =>
  PRACTITIONER_KINDS.find((p) => p.kind === kind)?.meaning ?? null

/**
 * A person behind a company, off its bureau profile.
 *
 * NOT a contact. A director is not a way of reaching the company: they are a person with their
 * own ID number, traceable in their own right, whose directorship can end. Filed as contacts, the
 * four resigned directors on one real profile would be four dead ends a collector could not tell
 * from the two who still matter.
 */
export interface AccountDirector {
  id: string
  accountId: string
  /** The key that makes them traceable alone: their own consumer report is fetched on it. */
  idNumber: string | null
  fullName: string
  status: 'Active' | 'Resigned' | null
  appointedOn: string | null
  source: string
  /** When their own trace was last pulled. A trace costs money under Annexure B item 4(c). */
  tracedAt: string | null
}

/**
 * A judgment somebody else already has against this debtor.
 *
 * NOT the firm's own legal action. An account of ours at attorney has its own trail; these are
 * other creditors' judgments read off a bureau profile, and they are the strongest thing in the
 * data about whether this debt will ever be recovered.
 *
 * Kept as rows, never as a count, because which creditor and how long ago is the whole content.
 * A count cannot tell a small retail judgment from six years ago from SARS last year.
 */
export interface AccountJudgment {
  id: string
  accountId: string
  caseNumber: string
  /** As the bureau words it: 'JUDGEMENT BY DEFAULT', 'CONSENT TO JUDGEMENT'. */
  caseType: string | null
  /** What the debt was: 'VAT', 'CREDIT AGREEMENT', 'GOODS SOLD AND DELIVERED'. */
  caseReason: string | null
  plaintiff: string | null
  filedOn: string | null
  amount: number | null
  source: string
  recordedAt: string
}

export interface AccountStanding {
  directors: AccountDirector[]
  judgments: AccountJudgment[]
}

/**
 * Active directors first, then by name.
 *
 * A resigned director is still worth keeping — they are who signed, and a trace may still reach
 * them — but they are not who a collector rings this afternoon. One real profile carries six
 * directors of whom four have resigned; sorted by name alone, the two people worth a call sit
 * third and fifth in a list nobody reads to the end.
 *
 * Its own function so it can be checked without a database.
 */
export function sortDirectors(directors: AccountDirector[]): AccountDirector[] {
  return [...directors].sort((a, b) => {
    const aa = a.status === 'Active', ba = b.status === 'Active'
    if (aa !== ba) return aa ? -1 : 1
    return a.fullName.localeCompare(b.fullName)
  })
}

/**
 * What the judgments add up to, as facts and nothing more.
 *
 * DELIBERATELY NOT A SCORE. The firm has said this data will feed an internal likelihood of
 * collection that goes onto client reports — and a number that goes to a client has to be
 * calibrated against the firm's own recovered outcomes, not invented here. Until that calibration
 * exists, the honest thing to show a collector is the count, the newest one and the total, and
 * let them read the rows. See BACKLOG.
 */
export interface JudgmentSummary {
  count: number
  /** The most recent filing date, which is what says whether this is history or a live problem. */
  newest: string | null
  /** Rand total of those that carry an amount. Judgments without one are not counted in. */
  total: number
  /** How many carry no amount, so the total can say it is a floor rather than the figure. */
  withoutAmount: number
}

export function judgmentSummary(judgments: AccountJudgment[]): JudgmentSummary {
  let total = 0
  let withoutAmount = 0
  let newest: string | null = null
  for (const j of judgments) {
    if (j.amount === null) withoutAmount += 1
    else total += j.amount
    if (j.filedOn && (newest === null || j.filedOn > newest)) newest = j.filedOn
  }
  return { count: judgments.length, newest, total, withoutAmount }
}
