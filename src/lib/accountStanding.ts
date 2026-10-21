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
  /** The other companies they sit on. Empty until their own consumer trace has been filed. */
  companies: DirectorCompany[]
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
  /**
   * Null = against the debtor on this account. Set = against that director PERSONALLY.
   *
   * THE READ SIDE OF THE DISTINCTION, and it has to be carried all the way to the screen or the
   * column is decorative. The importer files a director's own judgments against them for a
   * reason: counted as the company's they would inflate the one signal the firm has said will
   * drive the likelihood of collection it reports to clients. A fetch that selects every judgment
   * on the account and hands them to one list undoes that silently — the rows are filed correctly
   * and displayed wrongly, which is worse than not storing them, because the screen now asserts
   * something the database does not.
   */
  againstDirectorId: string | null
  caseNumber: string
  /** As the bureau words it: 'JUDGEMENT BY DEFAULT', 'CONSENT TO JUDGEMENT'. */
  caseType: string | null
  /** What the debt was: 'VAT', 'CREDIT AGREEMENT', 'GOODS SOLD AND DELIVERED'. */
  caseReason: string | null
  plaintiff: string | null
  filedOn: string | null
  amount: number | null
  /**
   * The row as the bureau printed it, kept when its columns could not be split with certainty.
   *
   * A consumer report wraps its judgment cells, so the case type, the reason and the plaintiff
   * arrive as one run of words. Where the split is not certain the judgment used to be shown and
   * then dropped — and the PLAINTIFF went with it, which is the part a collector most wants. So
   * the row is kept in the words it was printed in and the columns stay null.
   *
   * NEVER A SUBSTITUTE FOR plaintiff. It is displayed as unread, not as a value.
   */
  sourceText: string | null
  source: string
  recordedAt: string
}

/**
 * Another company a director sits on, off their own consumer profile.
 *
 * It reads in two directions. A director who ACTIVELY runs four other companies is somebody with
 * assets to discuss. One whose other directorships have all been resigned is somebody stepping
 * away from things, which is worth knowing before an afternoon is spent on them.
 */
export interface DirectorCompany {
  id: string
  directorId: string
  companyName: string
  status: 'Active' | 'Resigned' | null
  appointedOn: string | null
  /** Where the bureau gives one, so the company can later be traced in its own right. */
  registrationNumber: string | null
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
 * What to show of a director's other directorships.
 *
 * THE FIRM'S OWN INSTRUCTION, in these words: "We could mention the active directorships. But if
 * there are other directorships where he's not active, there can be a little sign that says there
 * are other directors that he's not active anymore."
 *
 * So the active ones are named and the resigned ones are a count. One real profile carries thirty
 * directorships; listed in full they would bury the account under somebody's CV, and the two that
 * are live are the only ones a collector can do anything with.
 */
export interface DirectorshipSummary {
  /** Named, newest appointment first. These are companies that could actually be approached. */
  active: DirectorCompany[]
  /** Counted, not named. A sign that there is history here, not a list to read. */
  resigned: number
}

export function directorshipSummary(companies: DirectorCompany[]): DirectorshipSummary {
  const active = companies
    .filter((c) => c.status === 'Active')
    .sort((a, b) => (b.appointedOn ?? '').localeCompare(a.appointedOn ?? ''))
  return { active, resigned: companies.filter((c) => c.status !== 'Active').length }
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
  /**
   * How many are on file in the bureau's own words because their columns could not be split.
   *
   * They COUNT — a judgment nobody could parse is still a judgment — but they cannot be reported
   * on by plaintiff or reason, and the screen says which ones those are.
   */
  unread: number
}

/**
 * Split a list of judgments by who they are actually against.
 *
 * Called at the point of display, so there is one place that knows the rule and no screen has to
 * remember it. `own` is what the client is told about; `byDirector` is context for the collector.
 */
export function splitJudgments(judgments: AccountJudgment[]): {
  own: AccountJudgment[]
  byDirector: Map<string, AccountJudgment[]>
} {
  const own: AccountJudgment[] = []
  const byDirector = new Map<string, AccountJudgment[]>()
  for (const j of judgments) {
    if (j.againstDirectorId === null) { own.push(j); continue }
    const list = byDirector.get(j.againstDirectorId)
    if (list) list.push(j); else byDirector.set(j.againstDirectorId, [j])
  }
  return { own, byDirector }
}

export function judgmentSummary(judgments: AccountJudgment[]): JudgmentSummary {
  let total = 0
  let withoutAmount = 0
  let unread = 0
  let newest: string | null = null
  for (const j of judgments) {
    if (j.amount === null) withoutAmount += 1
    else total += j.amount
    if (j.sourceText !== null && j.plaintiff === null) unread += 1
    if (j.filedOn && (newest === null || j.filedOn > newest)) newest = j.filedOn
  }
  return { count: judgments.length, newest, total, withoutAmount, unread }
}
