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
