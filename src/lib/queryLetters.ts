/**
 * What Raptor writes to a debtor about their query.
 *
 * PLACEHOLDER WORDING. This is a mechanism with words in it, not settled legal correspondence —
 * the firm's attorney has the final text, and these letters move into the letters/SMS/WhatsApp
 * template system when that is built. Two things in particular are theirs to decide, not ours:
 *
 *   - The seven working days. Section 129 read with section 130 of the National Credit Act gives
 *     a consumer TEN business days to respond to a section 129 notice before a credit provider
 *     may go to court. Seven is the firm's own policy period and is shorter, so the letter must
 *     not read as though it is the statutory one.
 *   - Not every handed-over account is a credit agreement under the Act. A trade debt between two
 *     companies is not, and a section 129 reference on such an account is simply wrong. That is
 *     why the Act is named in one sentence that can be lifted out per template.
 *
 * Plain text on purpose. The mail sender wraps it and adds the sender's signature, so nothing
 * here should try to be HTML.
 */

export interface LetterContext {
  /** How the debtor is addressed: "Mr Buitendag", "Ms Ndlovu". */
  debtorName: string
  /** The reference the debtor knows the account by. */
  accountReference: string
  /** The firm whose book the account sits on. */
  clientName: string
  /** Q-2026-0041 — what the debtor quotes back at us. */
  queryNumber: string
  /** The working-day deadline, already computed. Written in full: "21 September 2026". */
  deadline: string
  /** Who it comes from, as it should be signed. */
  agentName: string
  firmName: string
}

export interface Letter {
  subject: string
  body: string
}

export type LetterKind = 'acknowledgement' | 'reminder' | 'lapsed'

/** "2026-09-21" -> "21 September 2026". A date in a letter is never written in ISO. */
export function longDate(date: string): string {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d || m < 1 || m > 12) return date
  return `${d} ${months[m - 1]} ${y}`
}

/** Goes out the moment a query is raised. Starts the clock the deadline is counted from. */
function acknowledgement(c: LetterContext): Letter {
  return {
    subject: `Your query on account ${c.accountReference} — reference ${c.queryNumber}`,
    body: [
      `Dear ${c.debtorName}`,
      '',
      `We confirm that you have raised a query on the above account, which we administer on behalf of ${c.clientName}.`,
      '',
      `You are entitled to dispute this account, and section 129 of the National Credit Act 34 of 2005 provides for you to do so.`,
      '',
      `So that your query can be properly considered, please send it to us in writing, together with any documents that support it, by ${c.deadline}. This is seven working days from the date of this letter.`,
      '',
      `If we have not received your written query by that date, the query will be regarded as not valid, the account will return to collections, and legal proceedings may follow.`,
      '',
      `Please quote reference ${c.queryNumber} in all correspondence.`,
      '',
      'Yours faithfully',
      c.agentName,
      c.firmName,
    ].join('\n'),
  }
}

/** Two working days before the deadline, and only while nothing has come in. */
function reminder(c: LetterContext): Letter {
  return {
    subject: `Reminder: your query on account ${c.accountReference} — reference ${c.queryNumber}`,
    body: [
      `Dear ${c.debtorName}`,
      '',
      `This is a friendly reminder that we are still waiting for the written query you raised on the above account.`,
      '',
      `Please send it to us, with any supporting documents, by ${c.deadline}.`,
      '',
      `If we do not receive it by then, the query will be regarded as not valid and the account will return to collections.`,
      '',
      `Please quote reference ${c.queryNumber}.`,
      '',
      'Yours faithfully',
      c.agentName,
      c.firmName,
    ].join('\n'),
  }
}

/**
 * Sent by hand, never by the sweep.
 *
 * When the clock runs out the account goes back to collections and a diary entry lands on the
 * agent — a person decides whether to tell the debtor. A machine closing a query and posting the
 * bad news the same morning a letter arrives is how a firm ends up in front of the Council.
 */
function lapsed(c: LetterContext): Letter {
  return {
    subject: `Your query on account ${c.accountReference} — reference ${c.queryNumber}`,
    body: [
      `Dear ${c.debtorName}`,
      '',
      `We wrote to you on the above account asking for your query in writing by ${c.deadline}. We have not received it.`,
      '',
      `The query has therefore been closed as not valid and the account has returned to collections. If you have in fact sent your query, please contact us immediately quoting reference ${c.queryNumber}.`,
      '',
      'Yours faithfully',
      c.agentName,
      c.firmName,
    ].join('\n'),
  }
}

const LETTERS: Record<LetterKind, (c: LetterContext) => Letter> = {
  acknowledgement, reminder, lapsed,
}

export function queryLetter(kind: LetterKind, context: LetterContext): Letter {
  return LETTERS[kind](context)
}
