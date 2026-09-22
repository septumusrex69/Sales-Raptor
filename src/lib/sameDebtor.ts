/**
 * One person, several accounts.
 *
 * THE FIRM: "it is also possible for the same debtor to be handed over twice ... the same ID
 * number. You can create something called a linked account ... it will indicate, when you're on
 * an account, this debtor has other accounts, those account numbers, and you would be able to
 * click on that account number and it opens that account."
 *
 * NOTHING IS STORED AND NOTHING IS CREATED. Two accounts belong to one debtor because they carry
 * the same identity number, which is a fact about the rows rather than a relationship somebody
 * made — the same shape as the client position and the account band, which CLAUDE.md sets out as
 * derived and never stored. Three things follow from that and they are the reason for it:
 *
 *   - it works on the sixteen thousand accounts already imported, with no migration and nobody
 *     going through the book joining things up by hand;
 *   - it cannot go stale, so there is no "unlink" to build and no link left pointing at an
 *     account somebody has since corrected;
 *   - a corrected ID number fixes the grouping on the next read, in both directions at once.
 *
 * WHICH IS ALSO WHY THE WORD MATTERS. "Linked" says somebody linked them; it invites an unlink
 * button that cannot exist. It is also half-taken: `user_emails.linked_account_id` already points
 * from a piece of mail to an account, and `userMail.ts` records that the firm's own word for THAT
 * is "match". So the screen says OTHER ACCOUNTS, which states the fact and claims nothing else —
 * above all not that the ledgers are combined, because they are not: each account keeps its own
 * capital, its own in duplum ceiling and its own commission.
 */

import { isValidSaId } from './newDebtor.ts'

/**
 * THE DATABASE'S WORDS, NOT THE SHEET'S.
 *
 * `debtor_accounts.debtor_kind` is 'individual' or 'company'; the handover sheet asks a client
 * "Person or business". Two vocabularies for one distinction is already one more than anybody
 * needs, and this groups DATABASE ROWS, so it speaks the database's. Written 'person' | 'business'
 * first, which typechecked against nothing and would have grouped no company ever.
 */
export type DebtorKind = 'individual' | 'company'

/**
 * The key two accounts must share to be one debtor, or null where we cannot say.
 *
 * NULL IS THE COMMON ANSWER AND IT HAS TO BE. `debtor_id_number` is one column with two meanings
 * disambiguated by `debtor_kind` (see accountBook.ts), and on the sheet the firm actually sent it
 * held a CELL PHONE NUMBER in all 45 rows. Grouping on whatever is in that column would have put
 * every debtor who shares a telephone number into one person — and worse, it would have done it
 * silently on a screen that invites somebody to click through to "their" other account.
 *
 * So a person needs a thirteen-digit ID that passes its own checksum, and a business needs
 * something registration-number shaped. Anything else groups with nothing.
 */
export function debtorKey(
  idNumber: string | null | undefined, kind: DebtorKind | string | null | undefined,
): string | null {
  const raw = (idNumber ?? '').replace(/\s/g, '')
  if (!raw) return null
  if (kind === 'company') {
    /* 2019/940923/07 and its unpunctuated form are the same registration. Reduced to digits so
       the two spellings of one company meet, and length-checked so a short code does not group
       unrelated businesses. */
    const digits = raw.replace(/\D/g, '')
    return digits.length >= 10 ? `reg:${digits}` : null
  }
  return isValidSaId(raw) ? `id:${raw}` : null
}

/** An account as this panel needs it: enough to decide whether to show it and where it goes. */
export interface OtherAccount {
  id: string
  reference: string | null
  clientName: string | null
  balance: number | null
  status: string | null
  /**
   * Written off, which is the only closed state the book actually has.
   *
   * There is no "settled" here, and this said `settled` first. `debtor_accounts.status` holds
   * exactly five values -- Active: Activated, Active: Re-opened, Active: Unfrozen, Frozen,
   * Written-off -- and nothing else; `is_settled` is a generated column on `user_emails`, about a
   * thread rather than a debt. Decided by isWrittenOff, which accountStatus.ts exists to be the
   * single place for, after two parts of the app disagreed about what a closed account was.
   */
  writtenOff: boolean
}

/**
 * What the panel shows, and in what order.
 *
 * OPEN ONES FIRST, because an account still being worked is the one worth knowing about: a person
 * with a live arrangement on one debt and a settled one from 2019 needs to see the live one
 * without scrolling. Within each half, the largest balance first — if somebody is deciding which
 * of a debtor's accounts to press on, that is the order they would ask for.
 */
export function orderOtherAccounts(rows: OtherAccount[]): OtherAccount[] {
  return [...rows].sort((a, b) => {
    if (a.writtenOff !== b.writtenOff) return a.writtenOff ? 1 : -1
    return (b.balance ?? 0) - (a.balance ?? 0)
  })
}

/** What the heading says. One place, because the firm may yet prefer another word for it. */
export const OTHER_ACCOUNTS_HEADING = 'Other accounts for this debtor'
