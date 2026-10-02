/**
 * THE PLACES A DEBTOR CAN BE TRACED, AND WHAT EACH ONE COSTS THE DEBTOR.
 *
 * THE FIRM: "where do I do the other traces, like for example CSA and stuff" -- and, on what they
 * cost: the non-bureau searches go under Annexure B item 3, "other necessary expenses not
 * specifically provided for", once per subject.
 *
 * ------------------------------------------------------------------------------------------------
 * TWO ITEMS, AND THE GAZETTE DECIDES WHICH, NOT US
 * ------------------------------------------------------------------------------------------------
 *
 * Item 4(c) is "necessary registered CREDIT BUREAU search" at R16. That wording is narrow on
 * purpose: it is the registered bureaux and nothing else. SASSA is not a credit bureau and neither
 * is a deeds search, so charging either under 4(c) would be billing a debtor under a line of the
 * gazette that does not describe what was done -- which is the kind of thing that is only ever
 * found when somebody asks for a taxation.
 *
 * Everything else is item 3 at R25, which is exactly what item 3 is for. The firm calls it "ONE"
 * on their own statements and that is what the debtor sees.
 *
 * ------------------------------------------------------------------------------------------------
 * ONCE PER SUBJECT, WHICH IS NOT A MONTHLY CAP
 * ------------------------------------------------------------------------------------------------
 *
 * THE FIRM, correcting an earlier reading of item 3: "it's per action, not a total amount of R25."
 * So item 3 is not a once-ever budget -- it is raised each time the work is done. What "once per
 * subject" means is narrower and is about one piece of work: looking for ONE PERSON across several
 * places is one search for that person, not three. Hunting a debtor through SASSA and then through
 * a second source the same afternoon is a single necessary expense; tracing a director later is a
 * different person and a different expense.
 *
 * THE CALLER ANSWERS "has this subject been traced here before", because only the account knows:
 * the ledger stores a description a debtor reads, not a subject key. See recordTrace.
 *
 * ------------------------------------------------------------------------------------------------
 * THE LIST IS THE FIRM'S AND IS NOT FINISHED
 * ------------------------------------------------------------------------------------------------
 *
 * XDS is the one this app was built around and is the only one evidenced in the codebase. SASSA
 * and CSA are here because the firm named them in those words; their labels are the firm's own
 * shorthand and want confirming. A NAME BEING WRONG COSTS NOTHING OUTSIDE THE BUILDING -- the
 * vendor is never on the debtor's statement, which says "Credit bureau search" or "ONE" whichever
 * source was used, at the firm's own earlier instruction ("the bureau's name came off... it told
 * the debtor nothing they needed and named a supplier on a document that goes outside").
 *
 * PURE: no database, no clock.
 */

import type { AnnexureBSchedule } from './annexureB.ts'

export type TraceSourceKind =
  /** A registered credit bureau. Item 4(c), and only these. */
  | 'credit_bureau'
  /** Anything else somebody is looked for in. Item 3. */
  | 'other'

export interface TraceSource {
  /** Stable key. Stored, so it may not be renamed when the label changes. */
  id: string
  /** What the firm calls it. */
  name: string
  kind: TraceSourceKind
  /** Opened in a tab where there is a portal; null where the search is made some other way. */
  url: string | null
  /** One line in the picker: what it is searched on, or what it comes back with. */
  what: string
}

export const TRACE_SOURCES: readonly TraceSource[] = [
  {
    id: 'xds',
    name: 'XDS',
    kind: 'credit_bureau',
    url: 'https://www.online.xds.co.za/Portal/Account/Login?ReturnUrl=%2FPortal%2F',
    what: 'Numbers, addresses, employment, deeds and linked people. Searched on an ID or a registration number.',
  },
  {
    /* THE FIRM'S OWN WORD. SASSA is the social grants agency: what it answers is whether somebody
       draws a grant, which is the difference between "refusing to pay" and "cannot pay" -- and
       those two must never be on one list. It is not a credit bureau. */
    id: 'sassa',
    name: 'SASSA',
    kind: 'other',
    url: null,
    what: 'Whether they draw a grant — which is the difference between cannot pay and will not pay.',
  },
  {
    /* NAMED AS THE FIRM NAMED IT, and flagged: "CSA" is their shorthand and the full name has not
       been confirmed. The label is internal -- the debtor's statement says "ONE" -- so correcting
       it later is one line here and changes nothing already charged. */
    id: 'csa',
    name: 'CSA',
    kind: 'other',
    url: null,
    what: 'The firm’s own shorthand — confirm the full name before this goes live.',
  },
  {
    /*
     * ANYTHING ELSE, BY NAME.
     *
     * A closed list would make every source the firm has not told us about unrecordable, and an
     * unrecordable search is one that gets done and never charged -- which is the firm paying for
     * it. Named by the collector so the timeline says where they looked.
     */
    id: 'other',
    name: 'Somewhere else',
    kind: 'other',
    url: null,
    what: 'Any other search. Say where, and it goes on the timeline.',
  },
]

export const traceSourceById = (id: string): TraceSource =>
  TRACE_SOURCES.find((s) => s.id === id) ?? TRACE_SOURCES[0]

/** Annexure B item 4(c), and the firm's internal action code for it. */
export const BUREAU_ITEM = '4c'
/** Item 3 — "other necessary expenses not specifically provided for". */
export const OTHER_ITEM = '3'

/**
 * HOW MANY SEARCHES THE BUTTON MAY OFFER, TAKEN OFF THE GAZETTE RATHER THAN TYPED HERE.
 *
 * THE FIRM, looking at a row of buttons running to ten: "make it only go up to four, not more
 * than that." They are reading their own tariff: item 4(c) is `maxPerMonth: 4` on every schedule
 * Raptor holds, so five through ten offered a collector a number the gazette does not have.
 *
 * READ OFF THE SCHEDULE, so a gazette that changes the four changes the buttons and cannot leave
 * them disagreeing. Off `maxPerMonth` DIRECTLY and not through `monthlyLimit`, which answers a
 * different question: that one says whether the ENGINE refuses a fifth charge, and the firm turned
 * that off on 10 September 2026 for a reason recorded in annexureB -- the gazette counts per
 * ACCOUNT while the work happens per PERSON, and a company plus three sureties exhausts four in an
 * afternoon of entirely necessary work. The number is still four either way; what the firm asked
 * for is that the button stop offering more than the tariff names.
 *
 * FOUR WHERE THE SCHEDULE DOES NOT SAY. Every schedule Raptor holds carries the cap -- 2019, 2023
 * and 2026 all say four -- so a schedule without one is a schedule with something wrong with it,
 * and the gazette's own number is a better answer than a row of one button. The floor of one is for
 * a nonsense zero, which would otherwise draw nothing and leave a collector no way out of the
 * modal but "Didn't trace".
 */
export function bureauSearchCounts(schedule: AnnexureBSchedule): number[] {
  const item = schedule.items.find((i) => i.id === BUREAU_ITEM)
  const max = item?.maxPerMonth ?? BUREAU_SEARCHES_A_MONTH
  return Array.from({ length: Math.max(1, max) }, (_, i) => i + 1)
}

/** What every schedule Raptor holds says, and the answer where one somehow does not say. */
export const BUREAU_SEARCHES_A_MONTH = 4

export interface TraceCharge {
  itemId: string
  actionCode: string
  /** WHAT THE DEBTOR READS. Never the vendor — see the header. */
  description: string
}

/**
 * What a search at this source is charged as.
 *
 * TWO DESCRIPTIONS AND NO THIRD. "Credit bureau search" is the gazette's own words for 4(c);
 * "ONE" is the firm's shorthand for item 3 and is what their statements already say. Writing the
 * source into either would put a supplier's name on a document that leaves the building.
 */
export function chargeForSource(source: TraceSource): TraceCharge {
  return source.kind === 'credit_bureau'
    ? { itemId: BUREAU_ITEM, actionCode: 'TRC', description: 'Credit bureau search' }
    : { itemId: OTHER_ITEM, actionCode: 'TRC', description: 'ONE' }
}

/**
 * Should this search raise a fee at all?
 *
 * A BUREAU SEARCH ALWAYS DOES: item 4(c) is priced per search and the gazette says so, which is
 * why the button asks how many were run.
 *
 * ANYTHING ELSE IS ONCE PER SUBJECT. Three places searched for one person in one afternoon is one
 * necessary expense, not three -- see the header. Recorded either way: the work happened, and a
 * search that earns nothing is still something the next collector needs to know was done.
 */
export function chargesForThisSearch(input: {
  source: TraceSource
  /** True where a non-bureau search has already been charged for this same person. */
  alreadyChargedForSubject: boolean
}): boolean {
  if (input.source.kind === 'credit_bureau') return true
  return !input.alreadyChargedForSubject
}

/**
 * What the timeline says happened, in the firm's words and without a fee in it.
 *
 * NAMES THE SOURCE, which the debtor's statement deliberately does not. The timeline is read
 * inside the building by the next collector, and "we looked at SASSA and found nothing" is the
 * single most useful thing to know before looking there again.
 */
export function traceSourceNote(input: {
  source: TraceSource
  /** Where the source is "Somewhere else", what the collector typed. */
  named?: string | null
  count?: number
}): string {
  const where = input.source.id === 'other'
    ? (input.named?.trim() || 'another source')
    : input.source.name
  const n = Math.max(1, Math.floor(input.count ?? 1))
  if (input.source.kind === 'credit_bureau') {
    return `Trace done — ${n > 1 ? `${n} credit bureau searches` : 'credit bureau search'} (${where}).`
  }
  return `Trace done — searched ${where}.`
}
