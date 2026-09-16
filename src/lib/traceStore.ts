/**
 * A filed trace, and what has been made of it.
 *
 * THE RULES ONLY. No queries here, so every one of them can be checked without a database — the
 * same split as accountStanding / accountStandingData.
 *
 * The distinction this file exists to hold: a trace ITEM is what the bureau claimed, and a
 * CONTACT is what the firm rings. One becomes the other by somebody trying it and saying so. A
 * bureau profile carries twenty-six numbers going back to 2008, several against ten other people;
 * poured straight into the contact list, the list stops being worth reading.
 */

/** What a finding is. Phones are split by the bureau's own three columns, not lumped together. */
export type TraceItemKind =
  | 'mobile' | 'phone' | 'work' | 'email'
  | 'address' | 'employer' | 'directorship' | 'property' | 'link'

/**
 * What happened when somebody actually tried it.
 *
 * FOUR, AND THE MIDDLE TWO ARE NOT THE SAME. A number that rings out is a live number nobody
 * answered — worth trying again at a different hour. A number that is off, or dead, is not. The
 * firm asked for exactly this distinction: "you called the person on the trace, you couldn't make
 * contact, but it was ringing or the phone was off or whatever."
 */
export type TraceOutcome = 'verified' | 'no_answer' | 'unreachable' | 'not_theirs'

export const TRACE_OUTCOMES: { outcome: TraceOutcome; label: string; meaning: string }[] = [
  { outcome: 'verified', label: 'Reached them', meaning: 'It is the debtor, and this reaches them.' },
  { outcome: 'no_answer', label: 'Rang, no answer', meaning: 'A live number nobody picked up. Worth another hour of the day.' },
  { outcome: 'unreachable', label: 'Off or dead', meaning: 'Switched off, unobtainable or disconnected.' },
  { outcome: 'not_theirs', label: 'Not the debtor', meaning: 'Somebody else answered. It is not their number.' },
]

export const outcomeLabel = (o: TraceOutcome | null | undefined): string | null =>
  TRACE_OUTCOMES.find((x) => x.outcome === o)?.label ?? null

export interface TraceItem {
  id: string
  traceId: string
  accountId: string
  kind: TraceItemKind
  value: string
  /** The second column: a job title, a township, how a link was made. */
  label: string | null
  /** The bureau's own columns, kept as evidence and never edited. */
  peopleLinked: number | null
  seenOn: string | null
  amount: number | null
  status: string | null
  /** What we found out. Null until somebody has tried it. */
  outcome: TraceOutcome | null
  outcomeAt: string | null
  outcomeNote: string | null
  /** Set once this has earned a place on the account's principal details. */
  promotedContactId: string | null
}

export interface FiledTrace {
  id: string
  accountId: string
  subjectKind: 'debtor' | 'director'
  directorId: string | null
  reportKind: 'commercial' | 'consumer' | null
  subjectName: string | null
  idNumber: string | null
  registrationNumber: string | null
  companyStatus: string | null
  contactScore: string | null
  riskScore: string | null
  enquiredOn: string | null
  documentId: string | null
  createdAt: string
  items: TraceItem[]
}

const PHONE_KINDS: TraceItemKind[] = ['mobile', 'phone', 'work']

/**
 * The best number on the trace, and the reasoning is a hierarchy rather than a sort.
 *
 * WHAT WE KNOW BEATS WHAT THE BUREAU SAID. A number somebody has actually reached the debtor on
 * is the principal number whatever its date; below that, a number that at least rang; and only
 * then the bureau's own ordering, which is how recently it saw it. A number somebody has ruled
 * out is never offered, however recent — that is the whole reason for recording an outcome.
 */
export function principalPhone(items: TraceItem[]): TraceItem | null {
  const rank = (i: TraceItem): number => {
    if (i.outcome === 'verified') return 0
    if (i.outcome === 'no_answer') return 1
    if (i.outcome === null) return 2
    return 9 /* unreachable or not theirs: never principal. */
  }
  const usable = items.filter((i) => PHONE_KINDS.includes(i.kind) && rank(i) < 9)
  if (usable.length === 0) return null
  return [...usable].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    /* Then the bureau's evidence: most recently seen, and against the fewest other people. */
    const seen = (b.seenOn ?? '').localeCompare(a.seenOn ?? '')
    if (seen !== 0) return seen
    return (a.peopleLinked ?? 99) - (b.peopleLinked ?? 99)
  })[0]
}

/** The same reasoning for an address: confirmed first, then most recently seen. */
export function principalAddress(items: TraceItem[]): TraceItem | null {
  const usable = items.filter((i) => i.kind === 'address' && i.outcome !== 'not_theirs')
  if (usable.length === 0) return null
  return [...usable].sort((a, b) => {
    const av = a.outcome === 'verified' ? 0 : 1, bv = b.outcome === 'verified' ? 0 : 1
    if (av !== bv) return av - bv
    return (b.seenOn ?? '').localeCompare(a.seenOn ?? '')
  })[0]
}

/** Where they work, most recently seen first. Employment is the route to a garnishee. */
export function currentEmployer(items: TraceItem[]): TraceItem | null {
  const jobs = items.filter((i) => i.kind === 'employer' && i.outcome !== 'not_theirs')
  if (jobs.length === 0) return null
  return [...jobs].sort((a, b) => (b.seenOn ?? '').localeCompare(a.seenOn ?? ''))[0]
}

/**
 * Property still held, biggest first.
 *
 * ONLY WHAT THEY STILL OWN. The deeds section lists every transaction, including houses sold
 * fifteen years ago — and a sold property on a summary reads as an asset to somebody skimming.
 * `status` carries the bureau's current-owner flag; anything else is history.
 */
export function heldProperty(items: TraceItem[]): TraceItem[] {
  return items
    .filter((i) => i.kind === 'property' && /owner/i.test(i.status ?? ''))
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
}

/**
 * What the panel says about a trace in a few lines.
 *
 * The firm's own list of what matters, in their words: "a principal telephone number, a principal
 * address, property interests if they have properties, and next of kins" — plus where they work
 * and what they direct, which they added afterwards.
 */
export interface TraceSummary {
  phone: TraceItem | null
  address: TraceItem | null
  employer: TraceItem | null
  properties: TraceItem[]
  /** Links that share the debtor's surname. Candidates for a person to judge — never a fact. */
  relatives: TraceItem[]
  directorships: TraceItem[]
  /** How many findings nobody has tried yet. The measure of whether the trace has been worked. */
  untried: number
}

export function traceSummary(items: TraceItem[]): TraceSummary {
  return {
    phone: principalPhone(items),
    address: principalAddress(items),
    employer: currentEmployer(items),
    properties: heldProperty(items),
    /*
     * A link is stored as a relative when the import judged the surname to match — see
     * likelyRelatives. The label carries the bureau's own account of how they are connected.
     */
    relatives: items.filter((i) => i.kind === 'link' && i.status === 'relative'),
    directorships: items.filter((i) => i.kind === 'directorship' && /active/i.test(i.status ?? '')),
    untried: items.filter((i) => (PHONE_KINDS.includes(i.kind) || i.kind === 'email') && i.outcome === null).length,
  }
}

/**
 * One row per thing, keeping the most recent of any repeats.
 *
 * A PROFILE LISTS EMPLOYMENT ONCE PER JOB TITLE, so the same company arrives three times — the
 * same employer as "Technician" and as "Manager All Types". The trace table's key is one row per
 * (trace, kind, value), so a batch carrying repeats was rejected WHOLE: the trace row had already
 * been written, the findings were not, the import threw before its timeline note, and the account
 * was left showing a trace with nothing in it and no way to tell why.
 *
 * Decided here rather than left to the database to complain about, and the newest wins, because a
 * job title from 2009 is not what somebody does now.
 *
 * Its own function so it can be checked without a database — a source-level assertion that this
 * exists passes just as happily on an importer that computes it and then ignores it.
 */
export function keepNewestPerThing<T extends { kind: string; value: string; seen_on?: string | null }>(
  rows: T[],
): T[] {
  const best = new Map<string, T>()
  for (const row of rows) {
    const key = `${row.kind}|${row.value.toUpperCase()}`
    const held = best.get(key)
    if (!held || (row.seen_on ?? '') > (held.seen_on ?? '')) best.set(key, row)
  }
  return [...best.values()]
}

/**
 * Which contact kind a finding becomes when it is promoted.
 *
 * A LINK BECOMES 'other', NOT A PHONE. A relative is a person, and what gets stored about them is
 * their name — the number to reach them on is a separate thing the collector has to find. Filing
 * a name under 'mobile' would put a name where a dialler expects a number.
 */
export function contactKindFor(kind: TraceItemKind): 'mobile' | 'phone' | 'work' | 'email' | 'address' | 'employer' | 'other' {
  if (kind === 'mobile' || kind === 'phone' || kind === 'work' || kind === 'email') return kind
  if (kind === 'address') return 'address'
  if (kind === 'employer') return 'employer'
  return 'other'
}

/**
 * Whether a finding may be put on the account's principal details.
 *
 * NOT ONE RULED OUT, and not one already there. The first is the point of recording an outcome at
 * all; the second is what stops the same number arriving on the contact list three times because
 * three people pressed the button.
 */
export function canPromote(item: TraceItem): boolean {
  if (item.promotedContactId !== null) return false
  if (item.outcome === 'not_theirs') return false
  return item.kind !== 'property'
}
