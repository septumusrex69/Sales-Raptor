/**
 * THE EMAIL A TICKET ALREADY KNOWS HOW TO WRITE.
 *
 * THE FIRM, of a request sitting with the liaison: "it should already be able to draft an email for
 * the client... okay, raise, send an email to the client, and it could keep record of the emails
 * that is sent with that specific reference number."
 *
 * THE TICKET ALREADY HOLDS EVERY WORD OF IT. Who the debtor is, which account, what is being asked
 * for and why — a liaison opening a blank compose box has to go back up the page and retype what is
 * written an inch above it, and what they retype is shorter and vaguer every time. So the box opens
 * with the question in it and the liaison edits rather than composes.
 *
 * ------------------------------------------------------------------------------------------------
 * IT IS WRITTEN TO A CLIENT, NOT TO A DEBTOR, AND THAT DECIDES EVERYTHING ABOUT IT
 * ------------------------------------------------------------------------------------------------
 *
 * NO MERGE FIELDS AND NO TEMPLATE LIBRARY. Every template in `message_templates` is a notice to a
 * DEBTOR — a statutory demand, a final notice, an acknowledgement — written under the Act, priced
 * under Annexure B and held to the merge vocabulary `templateProblems` guards. This is a colleague
 * at a credit provider being asked for a document. Running it through that machinery would put a
 * debtor's vocabulary into a client's inbox and a client's question into a list of statutory
 * notices, and the first time somebody edited the wrong one it would go out to a debtor.
 *
 * SO IT IS A FUNCTION, NOT A ROW, and the liaison can rewrite every word of it before it goes.
 *
 * NOTHING IS QUOTED THAT THE CLIENT CANNOT MATCH. The account number and the debtor's name are what
 * the firm's own letters quote and what a client searches their system by. Raptor's case number is
 * deliberately NOT here: it is ours, it means nothing at the client's end, and 21% of the book
 * cannot be identified by the client's own reference anyway — see CLAUDE.md on the three numbers.
 *
 * PURE: no clock, no database. The subject and the body are decided by what the ticket says, so a
 * check can hold the words without a browser.
 */

export interface TicketLetterInput {
  /** 'request' asks for something; 'dispute' tells them what the debtor is objecting to. */
  kind: string
  /** On a request, WHAT is being asked for — the firm's own closed list. */
  requestFor?: string | null
  /** The clerk's own words about the ticket. Always present; the box refuses to save without it. */
  description: string
  /** Who the debtor is, as the client knows them. */
  debtorName?: string | null
  /** The reference on every letter about this account. */
  accountNumber?: string | null
  /** Who to address, where the client record names somebody. */
  contact?: string | null
  /** Who is sending it. */
  from?: string | null
}

/** A sentence a person would actually say, with no trailing full stop to double up on. */
const trim = (s: string | null | undefined) => (s ?? '').trim()

/**
 * THE SUBJECT, AND WHY IT LEADS WITH WHAT IS WANTED.
 *
 * A client liaison's inbox is full of mail about accounts. "Information needed" first says what the
 * message is for before it says which debtor it is about, which is the order somebody triages in;
 * the reference goes last because it is what they search by once they have decided to open it.
 */
export function ticketSubject(input: TicketLetterInput): string {
  const who = trim(input.debtorName)
  const ref = trim(input.accountNumber)
  const lead = input.kind === 'request'
    ? (trim(input.requestFor) || 'Information needed')
    : input.kind === 'dispute' ? 'Account disputed' : 'Query'
  /* NEITHER PIECE IS ASSUMED. A ticket on an account with no number, or a debtor whose name never
     arrived, still produces a subject rather than "Information needed —  — ". */
  return [lead, who, ref].filter(Boolean).join(' — ')
}

/**
 * THE BODY.
 *
 * SHORT, AND IT ASKS ONE THING. The clerk's own description is quoted rather than paraphrased —
 * they wrote it with the debtor on the telephone, and a liaison's summary of a summary is how the
 * client ends up answering a question nobody asked.
 *
 * AND IT ASKS FOR A DATE BACK. A request with no "by when" is the one that sits for three weeks,
 * which is the whole reason a ticket has a chase date at all.
 */
export function ticketBody(input: TicketLetterInput): string {
  const who = trim(input.debtorName) || 'this debtor'
  const ref = trim(input.accountNumber)
  const greeting = trim(input.contact) ? `Dear ${trim(input.contact)}` : 'Good day'
  const about = ref ? `${who} (${ref})` : who

  const ask = input.kind === 'request'
    ? (trim(input.requestFor)
      ? `We need ${trim(input.requestFor).toLowerCase()} on ${about} to carry on collecting.`
      : `We need something from you on ${about} to carry on collecting.`)
    : input.kind === 'dispute'
      ? `${who} has disputed this account and we need your help to answer it.`
      : `We have a query on ${about}.`

  /* THE CLERK'S OWN WORDS, MARKED AS QUOTED. A client reading this has to be able to tell what the
     debtor said from what the firm is asking, and an unmarked paragraph reads as the firm's. */
  const said = trim(input.description)

  const lines = [
    greeting,
    '',
    ask,
    '',
    'What was recorded on the account:',
    said,
    '',
    /* NO INVENTED DEADLINE. The firm sets its own chase dates per ticket and a hard-coded "within
       five days" here would be a promise the ticket's own chase date contradicts. */
    'Please let us know when we can expect this, so that we can tell the debtor where the account '
      + 'stands.',
    '',
    'Kind regards',
    trim(input.from) || '',
  ]
  /* A trailing blank where nobody is named, rather than a dangling line — the compose box is about
     to be edited by a person and an empty last line is where their own name goes. */
  return lines.join('\n').replace(/\n+$/, '\n')
}
