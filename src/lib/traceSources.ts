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
import { TRACING_ACTION_CODE } from './actionTariff.ts'

export type TraceSourceKind =
  /** A registered credit bureau. Item 4(c), and only these. */
  | 'credit_bureau'
  /** Anything else somebody is looked for in. Item 3. */
  | 'other'

/**
 * WHAT THIS SOURCE IS SEARCHED ON.
 *
 * THE FIRM, sending four screenshots of the sites they actually use: "it's the links that you would
 * put in here. It would open the link so the data would be traced appropriately. For example, if
 * you go to Google AI, you want to copy anything about the data that you could find -- name,
 * surname, or company. Or if you go to the SASSA grant, you'd want an ID number, whatever is
 * required for that."
 *
 * THEY ARE DESCRIBING A BUG. Every source copied the ID number, because the button was written
 * when XDS was the only one -- so pressing Google put thirteen digits on the clipboard for a search
 * that wants a person's name, and SARS's VAT vendor search, which asks for a VAT number or an exact
 * trading name, got an ID number too. A key that is wrong for the site is worse than no key: it is
 * pasted, it returns nothing, and the collector concludes the person is not there.
 */
/**
 * WHAT A SOURCE ASKS WHEN THE COLLECTOR COMES BACK.
 *
 * `yes_no` carries its own words for each answer, because "Yes" alone on a timeline six months
 * later says nothing: what goes on the account is the SENTENCE, not the box that was ticked.
 */
export type TraceQuestion =
  | { kind: 'text'; prompt: string; placeholder: string }
  | { kind: 'yes_no'; prompt: string; yes: string; no: string }

export type TraceSearchOn =
  /** The ID number for a person, the registration number for a company. */
  | 'identity'
  /** What they are called. A person's full name, or the company's. */
  | 'name'

export interface TraceSource {
  /** Stable key. Stored, so it may not be renamed when the label changes. */
  id: string
  /** What the firm calls it. */
  name: string
  kind: TraceSourceKind
  /**
   * Opened in a tab where there is a portal; null where the search is made some other way.
   *
   * MAY CARRY `{key}`, which is substituted with whatever this source is searched on, URL-encoded.
   * Google takes its query in the address, so there the press lands on the results rather than on
   * an empty box -- and the clipboard copy is then a convenience rather than the whole mechanism.
   * Every other one of these sites posts a form, so the key has to be pasted and `{key}` is absent.
   */
  url: string | null
  /** One line in the picker: what it is searched on, or what it comes back with. */
  what: string
  /** Which key to copy, and to substitute into `{key}`. See TraceSearchOn. */
  searchOn: TraceSearchOn
  /**
   * THE QUESTION THIS SOURCE ANSWERS, ASKED IN ITS OWN WORDS.
   *
   * THE FIRM: "there are different things that you need to record when you go to the other things
   * and what your findings are. So for SASSA, for example, you'd say, can you confirm that they're
   * receiving the grant? Yes or no?"
   *
   * ONE FREE-TEXT BOX WAS THE WRONG SHAPE FOR THE ONE SOURCE THAT MATTERS MOST. "Drawing a grant"
   * typed into a note is a sentence nobody can group on; the fact itself is the difference between
   * REFUSING to pay and CANNOT pay, which CLAUDE.md says must never be on one list. A yes or a no
   * is answerable in a tap by somebody looking at the screen, and it is the thing a client report
   * can count.
   *
   * TEXT WHERE A YES OR NO WOULD BE A LIE. A web search does not answer a question; it comes back
   * with whatever it comes back with, and forcing that into two boxes would be the same fault as
   * the trace outcome picker that offered "Disconnected" against an address.
   */
  asks: TraceQuestion
  /**
   * A SECOND THING THE SITE ASKS FOR THAT RAPTOR CANNOT GIVE IT.
   *
   * SASSA's status page wants the ID number AND the phone number the grant was applied on, and
   * that is not a number the firm holds -- a debtor's mobile on our contact list is not necessarily
   * the one they used. Said on the screen rather than discovered on the site, because a collector
   * who opens a form they cannot complete has spent the trip for nothing.
   */
  alsoNeeds?: string
  /**
   * WHAT THIS SOURCE CAN BE SEARCHED ON INSTEAD, WHERE THERE IS NO IDENTITY NUMBER.
   *
   * THE FIRM: "the cell phone number can also be traced." A registered bureau will search on one,
   * and on a book where 19 668 of 19 912 live accounts carry no identity number that is the
   * difference between a trace and no trace at all.
   *
   * THE BUREAU AND NOTHING ELSE, which is why this is a field rather than a rule. SASSA's status
   * page wants an identity number, the voters' roll wants an identity number, CIPC wants a
   * registration number -- hand any of them a cell number and the form cannot be submitted, so
   * the collector makes the trip for nothing. See mobileKeyFor.
   */
  fallbackOn?: 'mobile'
}

export const TRACE_SOURCES: readonly TraceSource[] = [
  {
    id: 'xds',
    name: 'XDS',
    kind: 'credit_bureau',
    url: 'https://www.online.xds.co.za/Portal/Account/Login?ReturnUrl=%2FPortal%2F',
    what: 'Numbers, addresses, employment, deeds and linked people. Searched on an ID or a registration number.',
    searchOn: 'identity',
    /* THE ONE SOURCE THAT TAKES A CELL NUMBER. See TraceSource.fallbackOn: a bureau will search on
       one, and nothing else on this list will. */
    fallbackOn: 'mobile',
    asks: { kind: 'text', prompt: 'Anything to note about this search?',
      placeholder: 'Usually nothing \u2014 the findings are in the report you upload.' },
  },
  {
    /*
     * SASSA, AND IT IS THE ONE THAT DECIDES A RUNG. The social grants agency: what it answers is
     * whether somebody draws a grant, which is the difference between "refusing to pay" and
     * "cannot pay" -- and CLAUDE.md says in as many words that those two must never be on one
     * list. A grant is the evidence behind cannot_pay rather than a collector's impression of a
     * phone call.
     *
     * THE SECOND FIELD IS WHY alsoNeeds EXISTS. The status page asks for the phone number the
     * application was submitted on, which the firm does not hold -- the mobile on our contact list
     * is not necessarily the one they applied with.
     */
    id: 'sassa',
    name: 'SASSA',
    kind: 'other',
    url: 'https://srd.sassa.gov.za/sc19/status',
    what: 'Whether they draw an SRD grant \u2014 the difference between cannot pay and will not pay.',
    searchOn: 'identity',
    /* THE FIRM'S OWN QUESTION, in their own words: "can you confirm that they're receiving the
       grant? Yes or no?" A yes is the evidence behind `cannot pay` rather than a collector's
       impression of a telephone call. */
    asks: { kind: 'yes_no', prompt: 'Are they receiving a grant?',
      yes: 'Confirmed on SASSA that they draw an SRD grant.',
      no: 'SASSA shows no SRD grant for this ID number.' },
    alsoNeeds: 'the phone number they applied on, which Raptor does not hold \u2014 ask them for it',
  },
  {
    /*
     * THE VOTERS' ROLL IS A LOCATOR, and the firm sent the screenshot that shows why: it comes back
     * with a ward, a voting district and the voting station's ADDRESS. That is not where the debtor
     * lives, and it must never be written down as though it were -- it is where they registered,
     * which is a suburb and a municipality to look in. On a book where 97% of accounts carry no ID
     * number this will often refuse, and that is the honest answer rather than a failure.
     */
    id: 'iec',
    name: 'IEC voters\u2019 roll',
    kind: 'other',
    url: 'https://www.elections.org.za/pw/Voter/My-ID-Information-Details',
    what: 'Ward, voting district and voting station \u2014 the area they registered in, not an address.',
    searchOn: 'identity',
    asks: { kind: 'text', prompt: 'Which ward and voting station?',
      placeholder: 'Ward 79900090, Soshanguve \u2014 Thorntree View Primary. Area only, not an address.' },
  },
  {
    /*
     * CIPC THROUGH BIZPORTAL: who the directors are and whether the company still trades. For a
     * company debtor it is the route to the people behind it, which is what a surety claim needs.
     */
    id: 'cipc',
    name: 'CIPC \u00b7 BizPortal',
    kind: 'other',
    url: 'https://www.bizportal.gov.za/',
    what: 'Directors and company status, on a registration number. For a company debtor.',
    searchOn: 'identity',
    asks: { kind: 'text', prompt: 'What does CIPC show?',
      placeholder: 'In business. Directors: M Dlamini, P Naidoo.' },
  },
  {
    /*
     * SARS'S VAT VENDOR SEARCH, AND IT IS THE ONE THAT PROVED THE searchOn FIELD WAS NEEDED. Its
     * own note reads "You need a valid VAT Number or an Exact VAT Trading Name" -- so an ID number
     * on the clipboard, which is what every source used to get, is the one thing it cannot use.
     * The firm holds no VAT number for a debtor, so the trading name is what goes across.
     */
    id: 'sars_vat',
    name: 'SARS VAT vendor search',
    kind: 'other',
    url: 'https://secure.sarsefiling.co.za/vatvendorsearch.aspx',
    what: 'Whether a company is a registered VAT vendor. Searched on the exact trading name.',
    searchOn: 'name',
    asks: { kind: 'yes_no', prompt: 'Is it a registered VAT vendor?',
      yes: 'SARS confirms it is a registered VAT vendor under that trading name.',
      no: 'SARS shows no VAT registration under that trading name.' },
  },
  {
    /*
     * AND AN ORDINARY WEB SEARCH, WHICH IS THE ONE THE LINK CAN ACTUALLY CARRY. Google takes its
     * query in the address, so `{key}` lands the press on the results rather than on an empty box.
     * Every other site here posts a form and has to be pasted into.
     */
    id: 'google',
    name: 'Web search',
    kind: 'other',
    url: 'https://www.google.com/search?q={key}',
    what: 'Name, surname or company \u2014 an employer, a trading name, a death notice, a new town.',
    searchOn: 'name',
    asks: { kind: 'text', prompt: 'What did you find?',
      placeholder: 'A new employer, a trading name, a death notice, a new town \u2014 or nothing.' },
  },
  /*
   * CSA IS GONE, AND THE FIRM RETIRED IT BY NOT KNOWING WHAT IT WAS.
   *
   * It was carried here as their own shorthand with the full name unconfirmed, flagged twice as
   * needing confirmation before go-live. Asked a third time: "I don't know what CSA is."
   *
   * SAFE TO REMOVE BECAUSE NOTHING STORES IT. `sourceId` is read once, to pick the item and the
   * words, and is never written to a row -- the fee carries its Annexure B item and the timeline
   * note carries the source's NAME. So no record points at this entry, and "Somewhere else" below
   * covers anything it might have been.
   */
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
    searchOn: 'identity',
    asks: { kind: 'text', prompt: 'What did you find?',
      placeholder: 'Nothing came back.' },
  },
]

/**
 * THE ADDRESS TO OPEN, WITH THE KEY IN IT WHERE THE SITE TAKES ONE.
 *
 * Null where there is nothing to open -- a source with no portal is searched some other way, and
 * opening a blank tab would be the app pretending to have done something.
 *
 * THE KEY IS URL-ENCODED, which is not a formality: a web search on a company is "Rinda Roo
 * Company" with spaces in it, and an unencoded space ends the URL at the first word.
 */
export function traceSourceUrl(source: TraceSource, key: string | null): string | null {
  if (!source.url) return null
  if (!source.url.includes('{key}')) return source.url
  /* A templated URL with nothing to put in it would open a search for the literal "{key}". */
  if (!key || !key.trim()) return null
  return source.url.replace('{key}', encodeURIComponent(key.trim()))
}

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
  /**
   * WHAT CAME BACK, in the collector's own words.
   *
   * THE FIRM, having opened four of these sites by hand: "how do we capture the data? ... they
   * should either capture it or the screenshots should be uploaded. I believe maybe things should
   * just be typed in. That might be better."
   *
   * TYPED, AND THEY TALKED THEMSELVES INTO THE RIGHT ANSWER. A bureau hands back a PDF that
   * Raptor parses into numbers, addresses and linked people; these sites hand back a WEB PAGE and
   * there is no file to read. The two candidates were a screenshot and a sentence, and a
   * screenshot is unsearchable -- nobody can ask "which debtors draw a grant" of an image, which
   * is this codebase's standing complaint about showing somebody a column instead of an answer.
   *
   * SO THE SENTENCE IS THE RECORD and the screenshot is evidence to attach beside it. It is also
   * the only half that survives the one question that matters: SASSA answering yes is the
   * difference between "refusing to pay" and "cannot pay", and CLAUDE.md says those two may never
   * be on one list.
   *
   * OPTIONAL. A search that found nothing is still worth recording -- the next collector needs to
   * know where has already been tried -- and a required box with nothing to put in it is how
   * people learn to type a full stop.
   */
  found?: string | null
}): string {
  const where = input.source.id === 'other'
    ? (input.named?.trim() || 'another source')
    : input.source.name
  const n = Math.max(1, Math.floor(input.count ?? 1))
  const said = (input.found ?? '').trim()
  if (input.source.kind === 'credit_bureau') {
    return `Trace done — ${n > 1 ? `${n} credit bureau searches` : 'credit bureau search'} (${where}).`
  }
  /* THE FINDING IS THE SENTENCE WHERE THERE IS ONE. "Searched SASSA." says the work happened;
     "Searched SASSA — drawing an SRD grant since March" is the reason the work was worth doing. */
  return said ? `Trace done — searched ${where} — ${said}` : `Trace done — searched ${where}.`
}

/**
 * WHAT THE FOUR WERE, AND HOW MANY ARE LEFT.
 *
 * THE FIRM, capping tracing: "Cap all the tracing activities at four a month. Whether or not it's
 * a trace or the other necessary expense. Just detail them."
 *
 * "JUST DETAIL THEM" IS THE HALF THAT MAKES THE CAP WORKABLE. A collector who presses Trace and is
 * told "no charge, four already this month" has no way of knowing whether the four were four real
 * searches or one search counted four times, and no way to put the case to a team leader. So the
 * four are listed, by date and by what was searched.
 *
 * COUNTED THE SAME WAY THE ENGINE COUNTS, which is the thing that must not drift: billed rows
 * only, this calendar month, on the action code rather than the item -- see MONTHLY_LIMIT. A
 * panel that counted unbilled rows too would show four used while the engine still allowed one,
 * and the collector would be told two different numbers by the same screen.
 */
export interface TracingCharge {
  /** The day it was raised, ISO. */
  on: string
  /** What the statement calls it: "Credit bureau search" or "ONE". */
  description: string
  /** Rands excluding VAT. */
  exclVat: number
}

export interface TracingMonth {
  used: number
  left: number
  limit: number
  charges: TracingCharge[]
}

/**
 * Read the month off a list of this account's fees.
 *
 * PURE, so a check can hold it against the engine's own arithmetic without a database. The caller
 * passes the fee rows it already has -- the account page loads the whole ledger anyway, so this
 * costs no request.
 */
export function tracingThisMonth(
  fees: readonly { incurredAt: string; description: string; amountExclVat: number; billed: boolean; actionCode: string | null }[],
  monthOf: string,
  limit: number,
): TracingMonth {
  const month = monthOf.slice(0, 7)
  const charges = fees
    .filter((f) => f.billed && f.actionCode === TRACING_ACTION_CODE && f.incurredAt.slice(0, 7) === month)
    .map((f) => ({ on: f.incurredAt.slice(0, 10), description: f.description, exclVat: f.amountExclVat }))
    .sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0))
  return {
    used: charges.length,
    left: Math.max(0, limit - charges.length),
    limit,
    charges,
  }
}
