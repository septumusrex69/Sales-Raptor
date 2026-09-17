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

/**
 * How an outcome reads at a glance. Green worked, amber is worth another try, red is dead, and
 * grey is "we know nothing" -- which covers both untried and somebody else's number, because
 * neither tells you anything about reaching this person.
 */
export type OutcomeTone = 'grey' | 'green' | 'amber' | 'red'

export const TRACE_OUTCOMES: { outcome: TraceOutcome; label: string; tone: OutcomeTone; meaning: string }[] = [
  { outcome: 'verified', label: 'Reached them', tone: 'green', meaning: 'It is them, and this reaches them.' },
  { outcome: 'no_answer', label: 'No answer', tone: 'amber', meaning: 'A live number nobody picked up. Worth another hour of the day.' },
  /*
   * "Wrong person", not "Not the debtor". On a director's profile the subject is not the debtor
   * at all, and a collector reading "not the debtor" against a director's own number would take
   * it to mean something it does not.
   */
  { outcome: 'not_theirs', label: 'Wrong person', tone: 'grey', meaning: 'Somebody else answered. It is not their number.' },
  { outcome: 'unreachable', label: 'Disconnected', tone: 'red', meaning: 'Switched off, unobtainable or disconnected.' },
]

/**
 * The same list with "not tested" on the front, which is what the picker offers.
 *
 * Untried is a REAL choice here, not the absence of one: picking it is the firm's "you can
 * unverify it", and a picker that can only ever move forwards leaves a wrong outcome standing.
 */
export const OUTCOME_OPTIONS: { outcome: TraceOutcome | null; label: string; tone: OutcomeTone; meaning: string }[] = [
  { outcome: null, label: 'Not tested', tone: 'grey', meaning: 'Nobody has tried it yet.' },
  ...TRACE_OUTCOMES,
]

export const outcomeLabel = (o: TraceOutcome | null | undefined): string | null =>
  TRACE_OUTCOMES.find((x) => x.outcome === o)?.label ?? null

export const outcomeTone = (o: TraceOutcome | null | undefined): OutcomeTone =>
  TRACE_OUTCOMES.find((x) => x.outcome === o)?.tone ?? 'grey'

/**
 * How loudly the bureau's risk grade should read.
 *
 * Only a high grade earns red. A grade shown in red whatever it says is a grade nobody reads,
 * and most profiles come back average.
 */
export const riskTone = (risk: string | null | undefined): OutcomeTone =>
  risk === null || risk === undefined ? 'grey'
    : /high|poor|adverse/i.test(risk) ? 'red'
      : /average|medium|fair/i.test(risk) ? 'amber'
        : 'green'

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

/* ------------------------------------------------------------------ *
 * The workspace: what the sections are, and what a row in one is.
 * ------------------------------------------------------------------ */

export type TraceCategoryId =
  | 'phones' | 'emails' | 'addresses' | 'employment' | 'people' | 'companies' | 'property'

export interface TraceCategory {
  id: TraceCategoryId
  title: string
  kinds: TraceItemKind[]
  /** The line under the heading: what a person DOES with this list, not what it contains. */
  blurb: string
  /** What the first column actually holds, so the header is never a generic "Value". */
  valueHeading: string
  /**
   * Whether a row here can be tried and given an outcome.
   *
   * A house cannot be rung and a directorship cannot answer. Offering a picker against them
   * would be asking a question with no true answer, which is how a column of "Not tested"
   * against every property teaches people the column means nothing.
   */
  worked: boolean
}

/**
 * The firm's own order, off the design they drew: numbers first because that is the work, then
 * the other ways to reach them, then who and what they are attached to.
 *
 * Employment sits with the addresses rather than with the companies: where somebody WORKS is a
 * route to a garnishee, which is a collections step, while a directorship is an asset question.
 */
export const TRACE_CATEGORIES: TraceCategory[] = [
  {
    id: 'phones', title: 'Phone numbers', kinds: ['mobile', 'phone', 'work'],
    blurb: 'Record an outcome and save useful numbers to the account.',
    valueHeading: 'Number / type', worked: true,
  },
  {
    id: 'emails', title: 'Email addresses', kinds: ['email'],
    blurb: 'Record an outcome and save useful addresses to the account.',
    valueHeading: 'Address', worked: true,
  },
  {
    id: 'addresses', title: 'Addresses', kinds: ['address'],
    blurb: 'Confirm where they are and save it to the account.',
    valueHeading: 'Address', worked: true,
  },
  {
    id: 'employment', title: 'Employment', kinds: ['employer'],
    blurb: 'Where they work is the route to a garnishee.',
    valueHeading: 'Employer / role', worked: true,
  },
  {
    id: 'people', title: 'Linked people', kinds: ['link'],
    blurb: 'A shared surname is a possible relative, not a confirmed one. Save one as a next of kin.',
    valueHeading: 'Name', worked: false,
  },
  {
    id: 'companies', title: 'Companies', kinds: ['directorship'],
    blurb: 'What they direct. An active directorship is an asset and a place to serve.',
    valueHeading: 'Company', worked: false,
  },
  {
    id: 'property', title: 'Property', kinds: ['property'],
    blurb: 'Deeds the bureau holds against them. Only what they still own is an asset.',
    valueHeading: 'Property', worked: false,
  },
]

export const categoryById = (id: TraceCategoryId): TraceCategory =>
  TRACE_CATEGORIES.find((c) => c.id === id) ?? TRACE_CATEGORIES[0]

/** How many findings sit under each section. What the rail wears, so nobody opens an empty list. */
export function categoryCounts(items: TraceItem[]): Record<TraceCategoryId, number> {
  const out = {} as Record<TraceCategoryId, number>
  for (const c of TRACE_CATEGORIES) out[c.id] = groupTraceRows(itemsIn(items, c)).length
  return out
}

export const itemsIn = (items: TraceItem[], category: TraceCategory): TraceItem[] =>
  items.filter((i) => category.kinds.includes(i.kind))

/**
 * One row per THING, not per row the bureau printed.
 *
 * A profile files the same number under Cell, Home and Work -- one real one carried a single
 * number under all three, updated within a month of each other. Listed as the bureau printed
 * them the collector sees fifteen numbers where there are six, rings the same one three times,
 * and marks one of the three tested while the other two still read "Not tested".
 *
 * So a row is a number, carrying the types it was filed under and every finding behind it. An
 * outcome recorded on the row is recorded on all of them, which is what makes the count honest.
 * The bureau's rows are not thrown away -- they are still what is stored, and still what a
 * report reads back.
 */
export interface TraceRow {
  /** The thing itself, normalised. Grouping key and nothing else. */
  key: string
  /** As the bureau printed it, which is what a person should see and dial. */
  value: string
  /** Every type it was filed under: Home, Work, Mobile. */
  kinds: TraceItemKind[]
  /** Every finding behind this row. An outcome is written to all of them. */
  items: TraceItem[]
  label: string | null
  /** The most recent date any of them was seen. */
  seenOn: string | null
  /** The WORST of them: a number held against ten people is held against ten people. */
  peopleLinked: number | null
  amount: number | null
  status: string | null
  /** The agreed outcome, or null where they have not all been given the same one. */
  outcome: TraceOutcome | null
  /** True when the findings behind this row disagree, which only a merge can produce. */
  mixed: boolean
  /** Already on the account's contact details. */
  promoted: boolean
}

/**
 * What two findings have to share to be the same thing.
 *
 * Spacing is how a number was typed, not a fact about it, so it comes out. Case is the same for
 * an address. Anything else -- a name, a company -- is compared as printed but case-folded.
 */
export const traceRowKey = (item: TraceItem): string =>
  item.kind === 'mobile' || item.kind === 'phone' || item.kind === 'work'
    ? item.value.replace(/[^0-9+]/g, '')
    : item.value.trim().toUpperCase().replace(/\s+/g, ' ')

const KIND_ORDER: TraceItemKind[] = ['phone', 'work', 'mobile', 'email', 'address', 'employer', 'link', 'directorship', 'property']

export function groupTraceRows(items: TraceItem[]): TraceRow[] {
  const byKey = new Map<string, TraceItem[]>()
  for (const item of items) {
    const key = traceRowKey(item)
    const held = byKey.get(key)
    if (held) held.push(item); else byKey.set(key, [item])
  }

  return [...byKey.entries()].map(([key, group]) => {
    const outcomes = new Set(group.map((i) => i.outcome))
    const newest = group.reduce((a, b) => ((b.seenOn ?? '') > (a.seenOn ?? '') ? b : a))
    return {
      key,
      /* The newest printing of it, so a number is shown the way it was most recently filed. */
      value: newest.value,
      kinds: [...new Set(group.map((i) => i.kind))].sort(
        (a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b),
      ),
      items: group,
      label: newest.label,
      seenOn: group.reduce<string | null>((a, i) => ((i.seenOn ?? '') > (a ?? '') ? i.seenOn : a), null),
      peopleLinked: group.reduce<number | null>(
        (a, i) => (i.peopleLinked === null ? a : Math.max(a ?? 0, i.peopleLinked)), null),
      amount: newest.amount,
      status: newest.status,
      outcome: outcomes.size === 1 ? group[0].outcome : null,
      mixed: outcomes.size > 1,
      /* On the account if ANY of them made it there -- it is one number either way. */
      promoted: group.some((i) => i.promotedContactId !== null),
    }
  })
}

export type TraceSort = 'recent' | 'oldest' | 'fewest_links'

export const TRACE_SORTS: { sort: TraceSort; label: string }[] = [
  { sort: 'recent', label: 'Most recently seen' },
  { sort: 'oldest', label: 'Oldest first' },
  { sort: 'fewest_links', label: 'Held against fewest people' },
]

/** The picker above the list. 'any' is every row; the rest narrow to one outcome. */
export type OutcomeFilter = TraceOutcome | 'any' | 'untested'

/**
 * The list a person is looking at: grouped, narrowed, and put in an order.
 *
 * ONE FUNCTION, because the count under the table and the rows in it have to be the same
 * question asked once. Written twice they drift, and the failure is a table saying "showing 6 of
 * 15" over a list of 5.
 */
export function workRows(input: {
  items: TraceItem[]
  category: TraceCategory
  search?: string
  outcome?: OutcomeFilter
  sort?: TraceSort
}): TraceRow[] {
  const { items, category, search = '', outcome = 'any', sort = 'recent' } = input
  const needle = search.trim().toUpperCase()

  const rows = groupTraceRows(itemsIn(items, category)).filter((r) => {
    if (needle !== '' && !`${r.value} ${r.label ?? ''}`.toUpperCase().includes(needle)) return false
    if (outcome === 'any') return true
    if (outcome === 'untested') return r.outcome === null && !r.mixed
    return r.outcome === outcome
  })

  return rows.sort((a, b) => {
    if (sort === 'fewest_links') {
      /* Null is not "nought other people" -- it is "the bureau did not say", so it sorts last. */
      const av = a.peopleLinked ?? Number.MAX_SAFE_INTEGER, bv = b.peopleLinked ?? Number.MAX_SAFE_INTEGER
      if (av !== bv) return av - bv
    }
    const seen = sort === 'oldest'
      ? (a.seenOn ?? '').localeCompare(b.seenOn ?? '')
      : (b.seenOn ?? '').localeCompare(a.seenOn ?? '')
    if (seen !== 0) return seen
    return a.value.localeCompare(b.value)
  })
}

/**
 * One page of them, and the sentence under the table.
 *
 * CLAMPED, because the page number outlives the list it was counted against. Somebody on page 3
 * types into the search box, four rows come back, and an unclamped slice hands them an empty
 * table with a working Previous button -- which reads as the search having found nothing.
 */
export function pageOf<T>(rows: T[], page: number, size: number): {
  rows: T[]
  /** The page actually shown, which is not always the one asked for. */
  page: number
  pages: number
  /** For "Showing 6 of 15": how many are on screen out of how many there are. */
  showing: number
  total: number
} {
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const safe = Math.min(Math.max(1, page), pages)
  const slice = rows.slice((safe - 1) * size, safe * size)
  return { rows: slice, page: safe, pages, showing: slice.length, total: rows.length }
}

/* ------------------------------------------------------------------ *
 * What XDS is searched on, and whether it is safe to hand over.
 * ------------------------------------------------------------------ */

/**
 * The number a bureau search is run against, checked before it is copied anywhere.
 *
 * WHY THIS EXISTS. The Trace button copies the account's ID number so it can be pasted into the
 * portal, and it copied whatever was in the field. On one account that was a TELEPHONE NUMBER --
 * the ID was never captured and Swordfish's export carried a phone number in the ID column. It
 * copied faithfully, and pasting it into XDS is a search the firm pays for, run against something
 * that is not a person.
 *
 * So nothing is copied unless it can actually be what it claims to be. A missing number and a
 * wrong number are told apart on purpose: one needs capturing, the other needs correcting, and a
 * collector told only "no ID" would go and type the phone number in again.
 *
 * 24 accounts in the staging book are in the second state, every one of them carrying that same
 * number on its contact list as well -- see BACKLOG.
 */
export type TraceSearchKey =
  | { ok: true; value: string; what: 'ID number' | 'registration number' }
  | { ok: false; found: string | null; why: 'missing' | 'not-an-id' | 'not-a-registration' }

/**
 * A company registration number: 2016/210735/07.
 *
 * A bureau prefixes a letter of its own (K2016/210735/07) and the firm's records do not, so the
 * letter is allowed and ignored -- see normaliseRegistration, which is what strips it.
 */
const REGISTRATION = /^[A-Z]?\s*\d{4}\s*\/\s*\d{6}\s*\/\s*\d{2}$/i

export function traceSearchKey(
  debtorKind: 'individual' | 'company',
  value: string | null | undefined,
  /** Passed in rather than imported, so this file keeps importing nothing. See isValidSaId. */
  validId: (id: string) => boolean,
): TraceSearchKey {
  const found = (value ?? '').trim()
  if (found === '') return { ok: false, found: null, why: 'missing' }

  if (debtorKind === 'company') {
    return REGISTRATION.test(found)
      ? { ok: true, value: found, what: 'registration number' }
      : { ok: false, found, why: 'not-a-registration' }
  }

  /*
   * Luhn-checked, not merely thirteen digits. A transposed pair is the commonest way a number gets
   * typed wrong, and it is thirteen digits either way -- so a length check would pass exactly the
   * number that traces somebody else.
   */
  const digits = found.replace(/\s/g, '')
  return validId(digits)
    ? { ok: true, value: digits, what: 'ID number' }
    : { ok: false, found, why: 'not-an-id' }
}

/** What to tell somebody when there is nothing safe to search on. */
export function searchKeyProblem(key: TraceSearchKey, debtorKind: 'individual' | 'company'): string | null {
  if (key.ok) return null
  if (key.why === 'missing') {
    return debtorKind === 'company'
      ? 'This account has no registration number on it, so there is nothing to search on. Add one under the debtor’s details.'
      : 'This account has no ID number on it, so there is nothing to search on. Add one under the debtor’s details.'
  }
  /*
   * NAMED, so it gets fixed. "Not a valid ID" sends somebody looking for a typo; saying it looks
   * like a telephone number says which field it belongs in. The book has 24 of exactly this.
   */
  const looksLikeAPhone = /^0[1-8]\d{8}$/.test(key.found?.replace(/\D/g, '') ?? '')
  return key.why === 'not-a-registration'
    ? `The registration field holds “${key.found}”, which is not a registration number. Nothing was copied — correct it under the debtor’s details.`
    : `The ID field holds “${key.found}”, which is not a valid ID number${
      looksLikeAPhone ? ' — it looks like a telephone number' : ''
    }. Nothing was copied — correct it under the debtor’s details.`
}
