/**
 * THE REFERENCE A COLLEAGUE PUT IN THE SUBJECT LINE.
 *
 * THE FIRM, LOOKING AT FOUR NEW MAILBOXES: "somebody from inside Bredell Ferreira should obviously
 * be in open mail." Right about most of it — and of the 105 colleague emails sitting in Needs
 * matching when they asked, 42 carried an account reference, a balance or a discount. Their own
 * screenshot has two:
 *
 *     RE: Viva Elukwatini (Pty) Ltd // African Ziyebeja (VE0001)
 *     FW: Immediate Payment Notification // F20832
 *
 * Sending every internal address to Open mail would file those on nobody's record and charge
 * nothing for them, which is what Open mail MEANS. So the reference is read first, and only mail
 * that carries none falls through to Open mail.
 *
 * WHY THE SUBJECT AND NOT THE BODY. This is how the firm's people actually write to each other —
 * the reference is in the subject because that is what makes a thread findable in Outlook. A body
 * scan would also hit quoted history, signatures and the reference of a DIFFERENT account
 * forwarded three replies down.
 *
 * ================= THE RULE THAT MATTERS IS IN accountFromReference, NOT HERE =================
 *
 * This file only says what LOOKS like a reference. Whether it identifies an account is a question
 * for the book, and the answer is only accepted when EXACTLY ONE account carries it.
 *
 * CLAUDE.md, on the three numbers that live on an account: `case_number` is Raptor's and is unique.
 * `client_reference` is the client's own filing and IS NOT — 5 013 of them are used on more than
 * one account, so 21% of the book cannot be identified by it. A reference that matches four
 * debtors must file against none of them: putting a colleague's email about a discount onto the
 * wrong debtor's statement, and charging that debtor R13 under item 6 for the privilege, is worse
 * than leaving it in Open mail where somebody can see it.
 */

/**
 * Anything in a subject line shaped like a reference.
 *
 * LETTERS THEN DIGITS, which is what every reference in this business looks like: RAP-123829,
 * VE0001, F20832, ABSTO-4. Returned uppercased and deduplicated, in the order they appear.
 *
 * THE DIGIT FLOOR IS THREE AND IT IS LOAD-BEARING. A subject line is full of things that are
 * letters beside digits and are not references — "R76 156.62" is a balance, "2026 07" is a month,
 * "Top 10" is a list. Three digits is what separates a reference from an amount or a date in the
 * subjects the firm actually sends; "R76" has two and is refused.
 *
 * AND PURE DIGITS ARE NOT A REFERENCE HERE, however much some clients' account numbers look like
 * one. "Management Report | 2026 07" would offer 2026, and an invoice number, a date and a rand
 * amount are all bare digits. A wrong match is worse than no match, so the letters are required.
 * The cost is a client whose references are all-numeric, and those still match by thread, by the
 * sender's address, or by hand.
 */
export function referencesIn(subject: string | null | undefined): string[] {
  if (!subject) return []
  const out: string[] = []
  const seen = new Set<string>()
  /* A separator is allowed between the letters and the digits because Raptor's own case numbers
     carry one (RAP-123829) and some clients' do too (ABSTO/0041). */
  for (const m of subject.matchAll(/\b[A-Za-z]{1,5}[-/]?\d{3,}\b/g)) {
    /* The whole match, as written, uppercased. Keeping the separator means the token reads back
       the way a person typed it; `normaliseReference` is what takes it out for comparing. */
    const token = m[0].toUpperCase()
    const key = normaliseReference(token)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(token)
  }
  return out
}

/**
 * The same token with any separator taken out, for comparing against what is stored.
 *
 * A person writes RAP-123829, RAP 123829 or rap123829 and means one account. The column holds one
 * spelling, so both sides are reduced to letters and digits before they are compared.
 */
export function normaliseReference(token: string): string {
  return token.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

/**
 * IS THIS ADDRESS A COLLEAGUE'S?
 *
 * Same domain as the mailbox being synced, which needs no setting and cannot go stale: whoever
 * shares a mail domain with the person whose inbox this is works here.
 *
 * NOT A LIST OF NAMES. A hand-kept list of staff addresses is a list somebody has to update every
 * time the firm hires, and the day it is wrong is the day a new colleague's mail starts asking to
 * be matched to a debtor.
 */
export function isColleague(fromAddress: string | null | undefined, mailboxAddress: string | null | undefined): boolean {
  const theirs = domainOf(fromAddress)
  const ours = domainOf(mailboxAddress)
  return !!theirs && !!ours && theirs === ours
}

function domainOf(address: string | null | undefined): string | null {
  if (!address) return null
  const at = address.lastIndexOf('@')
  if (at < 0) return null
  const domain = address.slice(at + 1).trim().toLowerCase()
  return domain || null
}
