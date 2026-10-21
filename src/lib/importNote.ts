/**
 * What goes on the CLIENT's own record when a handover is imported.
 *
 * THE FIRM: "in the notes section of the client, I don't see any notes made of any imports that
 * I've made. Of course that's important -- that a handover has been received and imported, this
 * is how many accounts have been imported with the first one, just a quick description. And so
 * collections have been added, and then obviously the query that has been logged."
 *
 * THE CLIENT'S RECORD IS WHERE THIS BELONGS, and that is the whole reason for it. Everything an
 * import already writes is filed against an ACCOUNT -- a note per debtor, a query on the batch,
 * a notice to Communications. Somebody who opens the client to answer "what did we get from them
 * in September" had nothing to read: the book had grown, the queries panel had an entry, and the
 * one place a person looks first said "No activity recorded yet".
 *
 * ONE NOTE PER IMPORT, NOT ONE PER ACCOUNT. The per-account notes already exist and are the
 * record of what was overridden on each row; a client timeline with two hundred lines on it is
 * one nobody scrolls. This is the covering line: what arrived, what opened, what did not, and
 * what was asked of them.
 *
 * PURE, so a check can read the sentence rather than the database.
 */

/** The heading on the timeline. Named for their own file, which is what they will recognise. */
export function importNoteSubject(filename: string): string {
  return `Handover imported: ${filename}`
}

export interface ImportNoteFacts {
  /** Accounts actually opened. */
  created: number
  /** Their capital, already formatted -- see formatCurrency. Null where it is not worth saying. */
  capital: string | null
  /** Rows that did not open an account: refused, or rejected by a person. */
  leftBehind: number
  /** Accounts opened with something the client still has to confirm. */
  corrections: number
  /** Whether a query was raised with them, which is what they will be answering. */
  queryRaised: boolean
  /** References opened on a date of default we chose. See defaultDateFallback.ts. */
  substituted: number
}

/**
 * The body, in sentences rather than a table.
 *
 * WRITTEN AS PROSE because it is read on a timeline between a phone call and an email, where a
 * row of counts reads as a machine talking to itself. Each fact is left out entirely when it is
 * nought -- "0 accounts could not be opened" is a line that makes somebody look for a problem
 * that is not there, which CLAUDE.md names as the thing that teaches people to stop reading.
 */
export function importNoteBody(facts: ImportNoteFacts): string {
  const lines: string[] = []

  lines.push(facts.created === 1
    ? `1 account was opened on the collections book${facts.capital ? `, ${facts.capital} capital` : ''}.`
    : `${facts.created} accounts were opened on the collections book${
      facts.capital ? `, ${facts.capital} capital between them` : ''}.`)

  if (facts.leftBehind > 0) {
    lines.push(facts.leftBehind === 1
      ? '1 account could not be opened and has gone back to the client to correct.'
      : `${facts.leftBehind} accounts could not be opened and have gone back to the client to correct.`)
  }

  if (facts.corrections > 0) {
    lines.push(facts.corrections === 1
      ? '1 of the accounts opened has something for the client to confirm.'
      : `${facts.corrections} of the accounts opened have something for the client to confirm.`)
  }

  /*
   * SAID SEPARATELY FROM THE CORRECTIONS, because they are different facts and the one that
   * matters here is whether the client has been ASKED. A count of corrections with no query
   * raised is work nobody has told them about, and that is exactly the case worth noticing.
   */
  if (facts.queryRaised) lines.push('A query has been raised with the client liaison.')
  else if (facts.corrections > 0 || facts.leftBehind > 0) {
    lines.push('No query was raised — the client has not been told yet.')
  }

  if (facts.substituted > 0) {
    lines.push(facts.substituted === 1
      ? '1 account opened on a date of default we chose, three months before handover, which the client must confirm.'
      : `${facts.substituted} accounts opened on a date of default we chose, three months before handover, which the client must confirm.`)
  }

  return lines.join(' ')
}

/* ---------------------------------------------------------------------------------------------
 * AND WHEN A BATCH IS TAKEN BACK OUT.
 *
 * THE FIRM, looking at a client page after discarding two handovers: "the notes that I made of
 * like retracting the handover file, that's also not there. You remember I took it out, those
 * handover files."
 *
 * THE DISCARD HAD WORKED AND LEFT NO TRACE A PERSON COULD READ. It stamped `discarded_at`,
 * `discarded_by` and the reason on the handover row — which is the right record and is on nobody's
 * screen — while the client's Notes list went on showing three imports and nothing taking any of
 * them back. A reversal that is invisible in the history is indistinguishable from data loss,
 * which is the sentence already written at the top of handoverDiscard.ts and the reason the row is
 * kept at all. It just never reached the one place somebody actually looks.
 *
 * THE SAME SHAPE AS THE IMPORT'S OWN NOTE, deliberately: the two sit next to each other in the
 * client's history and a reader should be able to tell at a glance that one undid the other.
 * ------------------------------------------------------------------------------------------- */

export function discardNoteSubject(reference: string | null): string {
  return `Handover withdrawn: ${(reference ?? '').trim() || 'one batch'}`
}

export interface DiscardNoteFacts {
  /** How many accounts went with it. */
  accounts: number
  /** What they were worth, already formatted — the caller holds the money formatter. */
  capital: string
  /** Why, in the firm's own words. Null where nobody gave one. */
  reason?: string | null
  /** Notices already sent to those debtors, which do not un-send. */
  noticesSent?: number
}

/**
 * WHAT IT SAYS, AND WHY IT SAYS THE UNCOMFORTABLE PART.
 *
 * A wrongly imported batch is exactly the case where the handover email and SMS have already gone
 * out — handoverDiscard refuses to block on them for that reason — so the debtors were written to
 * and nothing can call those messages back. The note says so, because the person reading this in
 * six months is reading it to answer a client asking why their debtor received a letter about an
 * account the firm says it never had.
 */
export function discardNoteBody(facts: DiscardNoteFacts): string {
  const parts = [
    `${facts.accounts === 1 ? 'The account' : `All ${facts.accounts} accounts`} opened from this `
      + `batch ${facts.accounts === 1 ? 'was' : 'were'} removed from the collections book, `
      + `${facts.capital} capital between them.`,
  ]
  if (facts.noticesSent && facts.noticesSent > 0) {
    parts.push(`${facts.noticesSent} ${facts.noticesSent === 1 ? 'notice had' : 'notices had'} `
      + 'already gone out to those debtors and cannot be recalled.')
  }
  /* THE REASON LAST AND IN THEIR OWN WORDS, quoted so it reads as somebody's answer rather than as
     the system's description of what it did. */
  const why = (facts.reason ?? '').trim()
  if (why) parts.push(`Reason given: ${why}`)
  return parts.join(' ')
}
