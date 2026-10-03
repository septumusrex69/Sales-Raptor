/**
 * A TRACE THAT COULD NOT BE RUN, WHICH IS A RESULT AND WAS NOT RECORDABLE.
 *
 * THE FIRM: "I think it's some place that we have to say like trace attempted and there was no
 * trace on the data. We would need more information like an ID number -- or if there is no ID
 * number to complete the trace. The cell phone number can also be traced, however, you know, we
 * haven't been able to trace the data on the information provided."
 *
 * ------------------------------------------------------------------------------------------------
 * AN HOUR SPENT TRYING LOOKED IDENTICAL TO NEVER HAVING TRIED
 * ------------------------------------------------------------------------------------------------
 *
 * The trace button already refuses to copy a key it cannot use and says why -- "this account has
 * no ID number on it, so there is nothing to search on" -- and then the only way out of the box
 * was "Didn't trace", which wrote nothing. So an account that CANNOT be traced read exactly like
 * an account nobody had got to: no note, no date, nothing for a team leader to look at and nothing
 * for the client to be asked for. On a book where 19 668 of 19 912 live accounts carry no identity
 * number, that is not an edge case -- it is the ordinary one.
 *
 * ------------------------------------------------------------------------------------------------
 * AND IT IS NOT A FEE
 * ------------------------------------------------------------------------------------------------
 *
 * Nothing was searched, so nothing is charged. Annexure B prices ACTIONS -- item 4(c) a bureau
 * search, item 3 a necessary expense -- and there was neither. A debtor billed R16 because the
 * firm's own handover sheet arrived without an identity number would be paying for the client's
 * omission, and it is the kind of line that is only ever found at a taxation. recordTraceAttempt
 * raises nothing and says so.
 *
 * ------------------------------------------------------------------------------------------------
 * "WE CANNOT TRACE ON THIS", NEVER "THE DEBTOR IS UNTRACEABLE"
 * ------------------------------------------------------------------------------------------------
 *
 * accountNarrative's traceSentence already holds this line and it holds here too: whether a debtor
 * is untraceable is a decision a team leader makes about an account, not a conclusion a function
 * may reach on their behalf. What this records is narrower and entirely factual -- the information
 * handed over does not carry a key any of these sources can be searched on. The firm's own words
 * are about the DATA ("no trace on the data", "the information provided"), and that is what the
 * sentences here say.
 *
 * PURE: no database, no clock.
 */

import type { TraceSource } from './traceSources.ts'

/**
 * WHAT A TRACE IS ACTUALLY RUN ON.
 *
 * `TraceSearchOn` says what a SOURCE wants; this says what was in the end used, which is not the
 * same once a cell number can stand in for a missing identity number.
 */
export type TraceKeyKind = 'identity' | 'name' | 'mobile'

/**
 * A SOUTH AFRICAN CELL NUMBER OUT OF WHATEVER IS ON THE CONTACT LIST.
 *
 * THE FIRM: "the cell phone number can also be traced." A bureau will search on one, which on a
 * book that is 97% without identity numbers is the difference between a trace and no trace at all.
 *
 * NOT READ OFF THE CONTACT'S `kind`, deliberately. Half the imported book has every number under
 * one label -- Swordfish carried a single telephone column -- so a cell number filed as a "phone"
 * is the ordinary case, and trusting the label would refuse the number that is sitting there.
 *
 * 086 AND 087 ARE NOT CELL NUMBERS AND LOOK EXACTLY LIKE ONE. 086 is a share-call line and 087 is
 * VoIP; both are ten digits beginning 08 and neither belongs to a person. A bureau searched on one
 * comes back with the business that rents it, which is a search the firm pays for and a result
 * about somebody else entirely -- the same fault as the telephone number sitting in an ID field.
 * So the prefixes are named rather than matched loosely: 06x and 07x in full, and 08 only 081-085.
 */
const CELL = /^0(?:6\d|7\d|8[1-5])\d{7}$/

export function traceableMobile(
  numbers: readonly (string | null | undefined)[],
): string | null {
  for (const raw of numbers) {
    const digits = (raw ?? '').replace(/[^\d+]/g, '')
    /* Written in full with the country code, which is how a bureau report hands them back. */
    const local = /^(?:\+?27)(\d{9})$/.exec(digits)
    const value = local ? `0${local[1]}` : digits
    if (CELL.test(value)) return value
  }
  return null
}

/**
 * THE CELL NUMBER AS A KEY, WHERE THE SOURCE CAN BE SEARCHED ON ONE.
 *
 * ONLY WHERE THE SOURCE SAYS SO, and only the bureau does -- see TraceSource.fallbackOn. SASSA's
 * status page wants an identity number and a voters' roll lookup wants an identity number; handing
 * either a cell number is a form that cannot be submitted, which is a trip the collector makes for
 * nothing. A key that is wrong for the site is worse than no key.
 *
 * AND ONLY AS A FALLBACK. Where the identity number is there, it is what gets searched: it
 * identifies one person, while a cell number identifies whoever is holding it this year.
 */
export function mobileKeyFor(
  source: TraceSource,
  mobile: string | null,
): { ok: true; kind: 'mobile'; value: string; what: 'cell number' } | null {
  if (source.fallbackOn !== 'mobile') return null
  if (!mobile) return null
  /* SHAPED LIKE A TraceSearchKey so the button can use either without a branch at every reader:
     `ok` and `value` are what the modal draws, `what` is the word in "the cell number ... is on
     your clipboard". A `kind` as well, because a caller that stores what was searched needs to
     tell a cell number from an identity number and `what` is prose. */
  return { ok: true, kind: 'mobile', value: mobile, what: 'cell number' }
}

/** What the firm needs before this account can be traced, in the firm's words. */
export function traceNeeds(debtorKind: 'individual' | 'company'): string {
  return debtorKind === 'company' ? 'a registration number' : 'an identity number'
}

/**
 * AND WHAT **THIS** SOURCE NEEDED, which is not always the identity number.
 *
 * A web search and SARS's VAT vendor search are searched on a NAME, so an account with nothing to
 * call the debtor stops them -- and asking the client for an identity number because a web search
 * had no name is asking for the wrong thing. It is rare (the account page always has at least a
 * surname to pass) and it is one branch, which is a better trade than a request a client cannot
 * act on.
 */
export function traceNeedsFor(
  source: TraceSource,
  debtorKind: 'individual' | 'company',
): string {
  return source.searchOn === 'name'
    ? (debtorKind === 'company' ? 'the registered name' : 'the debtor’s full name')
    : traceNeeds(debtorKind)
}

/**
 * WHAT THE TIMELINE SAYS, when a trace was attempted and there was nothing to search on.
 *
 * NAMES THE SOURCE, like every other trace note: the next collector reading this needs to know
 * whether the bureau was the thing that could not be run or only the voters' roll.
 *
 * AND NAMES THE CELL NUMBER WHERE THERE IS ONE AND IT STILL DID NOT HELP. An account with a cell
 * number on it reads, to anybody skimming, as an account that could have been traced -- so where
 * the source cannot be searched on one, the note says that rather than leaving the next person to
 * wonder why nobody tried the obvious thing.
 */
export function traceAttemptNote(input: {
  source: TraceSource
  debtorKind: 'individual' | 'company'
  /** Where the identity field holds something that is not an identity number, what it holds. */
  unusable?: string | null
  /** A cell number on the account, where there is one. */
  mobile?: string | null
}): string {
  const needs = traceNeeds(input.debtorKind)
  const what = input.source.searchOn === 'name' ? 'name' : needs
  const bits: string[] = [
    `Trace attempted — ${input.source.name} could not be searched.`,
  ]
  if (input.source.searchOn === 'name') {
    bits.push(`The account carries no name to search on.`)
  } else if (input.unusable) {
    /* NAMED, so it gets fixed rather than re-attempted. searchKeyProblem says the same thing to
       the collector standing in front of the box; this is the half that survives on the record. */
    bits.push(`The identity field holds “${input.unusable}”, which is not ${needs}.`)
  } else {
    bits.push(`The account carries no ${needs.replace(/^an? /, '')}.`)
  }
  /* The cell number is only worth mentioning against a source that cannot use one -- on the
     bureau, a cell number means the trace ran and there is no attempt to record. */
  if (input.mobile && input.source.fallbackOn !== 'mobile') {
    bits.push(`${input.source.name} cannot be searched on the cell number on file.`)
  }
  bits.push(input.source.searchOn === 'name'
    ? 'The debtor could not be traced on the information provided.'
    : `The debtor could not be traced on the information provided — we need ${what} to complete the trace.`)
  return bits.join(' ')
}

/** The request kind this is asked for under. One of REQUEST_KINDS, held here so a check can see it. */
export const TRACE_REQUEST_FOR = 'Debtor details'

/**
 * WHAT THE CLIENT IS ASKED FOR, as the description on the request.
 *
 * THE ASK IS THE WHOLE POINT. The firm's sentence -- "we would need more information like an ID
 * number" -- is addressed to the client, and a trace that cannot run is one of the few places
 * where nothing the firm does next will move the account. Recording the attempt and never asking
 * would leave the account sitting where it is with a tidier note on it.
 *
 * IT SAYS WHAT WAS TRIED. A client asked out of nowhere for an identity number sends a reminder to
 * somebody's inbox; a client told the trace could not be run without one is being told why it
 * matters, which is what gets it answered.
 */
export function traceAttemptAsk(input: {
  debtorKind: 'individual' | 'company'
  debtorName?: string | null
  /** A cell number on the account, where there is one. */
  mobile?: string | null
  /** The source that could not be searched, which decides WHICH key is being asked for. */
  source: TraceSource
}): string {
  const who = (input.debtorName ?? '').trim() || 'the debtor'
  const needs = traceNeedsFor(input.source, input.debtorKind)
  /* "an identity number" -> "identity number", so the sentence below reads as one. */
  const bare = needs.replace(/^(?:an?|the) /, '')
  const held = input.mobile
    ? `We hold a cell number for them but no ${bare}.`
    : `The account was handed over without ${needs}.`
  return `We have not been able to trace ${who} on the information provided. ${held} `
    + `Please let us have ${needs} for ${who} so that we can complete the trace.`
}
