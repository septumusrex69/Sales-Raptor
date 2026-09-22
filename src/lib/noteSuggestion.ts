/**
 * What to tell the clerk who picks this account up, written for them in advance.
 *
 * THE FIRM: "you can automatically fill the note for the clerk ... the script would say, for
 * example, there is no ID number, just note, perhaps do a trace or confirm the ID number if
 * possible. But fill it automatically and then just accept, and they can remove it if they need
 * to."
 *
 * AN INSTRUCTION, NEVER A RESTATEMENT. noteForAccount already puts every problem underneath what
 * was typed -- the typed part is the instruction and the list under it is the evidence. So a
 * suggestion that said "the ID number is not an ID number" would print that sentence twice and
 * tell nobody what to do about it. Each line below is the NEXT ACTION and nothing else.
 *
 * WHAT IT DOES NOT DO IS DECIDE. It fills the box; a person reads it, edits it, clears it, and
 * then accepts or rejects. Nothing here is written anywhere until they press a button -- which is
 * the same rule the reply parser follows, and for the same reason: a suggestion nobody read is
 * worse than a blank box, because it looks like somebody thought about it.
 */

/** A problem as the planner leaves it: the column it is about, and what is wrong. */
export interface NotableProblem {
  key: string | null
  message: string
}

/*
 * ONE INSTRUCTION PER COLUMN, in the order they are worth doing.
 *
 * Keyed on the column rather than on the message, because a message is prose that gets reworded
 * and a key is the thing the planner actually carries. Where one column can be wrong two ways
 * that need different work -- an identity number missing versus mistyped -- the message is read
 * as well, and only there.
 */
const BY_KEY: Record<string, (message: string) => string> = {
  id_number: (m) => (/thirteen digits/.test(m)
    /* Thirteen digits that fail the check digit is a transposition, which the debtor can settle
       in one question. A trace would be the long way round for a typo. */
    ? 'Read the ID number back to the debtor on first contact — it is thirteen digits but one of '
      + 'them is wrong, which is usually two swapped.'
    : 'Confirm the ID number with the debtor on first contact, or trace for it. Nothing that '
      + 'needs an identity number can go out until it is on the account.'),

  email_1: () => 'Ask for an email address on first contact. A section 129 is sent by email, so '
    + 'this account cannot be taken to legal without one.',

  cell_1: () => 'Get a working number on first contact, or trace for one.',
  cell_2: () => 'Get a working number on first contact, or trace for one.',
  cell_3: () => 'Get a working number on first contact, or trace for one.',
  home_phone: () => 'Get a working number on first contact, or trace for one.',
  work_phone: () => 'Get a working number on first contact, or trace for one.',

  debtor_kind: () => 'Confirm whether this is a person or a business before anything goes out — '
    + 'it is being worked as a person, and a letter to a company is addressed differently.',

  last_payment_date: () => 'Confirm the date of the last payment with the client. Prescription '
    + 'runs from it.',

  /*
   * A DUPLICATE IS A QUESTION FOR THE CLIENT, not work for the collector -- and it is the one
   * where doing the obvious thing is wrong. Ringing a debtor about a debt they have already paid
   * once is how a complaint starts.
   */
  client_reference: (m) => (/[Dd]uplicate/.test(m)
    ? 'Check with the client that this is a second debt and not the same one twice, before '
      + 'contacting the debtor.'
    : 'Confirm the client’s own reference before anything goes out — it is what the debtor '
      + 'is told to quote when they pay.'),

  street_1: () => 'A summons is served at an address. Trace for one before this reaches legal.',
}

/** The one for a problem carrying no column: nobody can be reached at all. */
const NO_CONTACT = 'Trace for a telephone number or an email address before anything else — '
  + 'there is no way to reach this debtor as the account stands.'

/**
 * The note to put in the box, or an empty string where there is nothing worth saying.
 *
 * EMPTY RATHER THAN A PLEASANTRY. A row whose only problem is one nobody can act on gets a blank
 * box, because a note saying "please note the above" is a line every collector learns to skip and
 * it drags the real ones down with it.
 *
 * DE-DUPLICATED, since four missing telephone columns are one instruction. Ordered by the
 * problems' own order, which is the order the planner found them in and roughly the order they
 * matter in.
 */
export function suggestedNote(problems: NotableProblem[]): string {
  const lines: string[] = []
  for (const p of problems) {
    const line = p.key ? BY_KEY[p.key]?.(p.message) : NO_CONTACT
    if (line && !lines.includes(line)) lines.push(line)
  }
  /*
   * ONE LINE STANDS ALONE; SEVERAL ARE BULLETED. Two instructions run together into a paragraph
   * read as one sentence somebody half-finished, and the second one gets missed.
   */
  if (lines.length === 0) return ''
  if (lines.length === 1) return lines[0]
  return lines.map((l) => `• ${l}`).join('\n')
}
