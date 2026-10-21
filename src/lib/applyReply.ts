/**
 * Writing a client's answer onto the account, once somebody has said so.
 *
 * SEPARATE FROM THE PARSER ON PURPOSE. correctionReply.ts reads and decides nothing; this writes
 * and reads nothing. The firm's standing instruction is that corrections are "the firm's
 * decision, made case by case, never a migration that sweeps", so the two halves are not allowed
 * to become one function that does both on arrival.
 *
 * WHAT IT WILL NOT WRITE IS THE POINT OF IT. A handover amount and a date of default are not
 * details about a debtor -- they are the ledger's opening figures. in duplum is measured from
 * the capital and prescription runs from the date, both are stamped at handover and never
 * recalculated, and remittances have been passed against them. Changing one from a screen that
 * reads an email would rewrite an account's whole arithmetic on a client's say-so. So those come
 * back REFUSED, with the reason, and a person deals with them deliberately.
 */
import { addContact, saveDebtorIdentity, updateContact } from './accountWorkspace.ts'
import type { AccountContact, ContactKind } from './accountWorkspace.ts'

/** Why an answer cannot be written from here. Shown as-is; each is a sentence, not a code. */
export const LEDGER_FIELDS: Record<string, string> = {
  capital: 'The handover amount is the ledger’s opening figure and in duplum is measured '
    + 'from it. It is not changed from here.',
  default_date: 'The date of default is what in duplum and prescription both run from, and it '
    + 'is stamped at handover. It is not changed from here.',
  last_payment_date: 'The last date of payment interrupts prescription. It is not changed from '
    + 'here.',
}

/** The identity fields, and the patch key each one is. */
const IDENTITY: Record<string, 'idNumber' | 'surname' | 'firstName' | 'secondName' | 'title' | 'initials'> = {
  id_number: 'idNumber',
  registration_number: 'idNumber',
  name: 'surname',
  first_name: 'firstName',
  second_name: 'secondName',
  title: 'title',
  initials: 'initials',
}

/**
 * The contact kinds, and which existing row an answer replaces.
 *
 * A label as well as a kind, because an account carries several numbers and "cell number 2" has
 * to land on the second one rather than on whichever phone row comes back first. The label is
 * the sheet's own column name, so what is written matches what the client was asked for.
 */
const CONTACTS: Record<string, { kind: ContactKind; label: string | null }> = {
  cell_1: { kind: 'mobile', label: null },
  cell_2: { kind: 'phone', label: 'Alternative' },
  cell_3: { kind: 'phone', label: 'Third number' },
  home_phone: { kind: 'phone', label: 'Home' },
  work_phone: { kind: 'work', label: null },
  email_1: { kind: 'email', label: null },
  email_2: { kind: 'email', label: 'Second address' },
  employer: { kind: 'employer', label: null },
}

export type ApplyOutcome =
  | { done: true; what: string }
  | { done: false; why: string }

/**
 * One answer, written or refused.
 *
 * Never throws for a reason a person could have foreseen: a field this does not handle, or a
 * ledger figure, comes back as a sentence rather than an exception, because the caller is
 * applying a list and one refusal must not stop the rest.
 */
export async function applyReplyAnswer(input: {
  accountId: string
  key: string
  value: string
  /** The account's contacts, so a replacement edits the right row instead of adding a second. */
  contacts: AccountContact[]
}): Promise<ApplyOutcome> {
  const value = input.value.trim()
  if (!value) return { done: false, why: 'Nothing was filled in.' }

  const ledger = LEDGER_FIELDS[input.key]
  if (ledger) return { done: false, why: ledger }

  const identity = IDENTITY[input.key]
  if (identity) {
    await saveDebtorIdentity(input.accountId, { [identity]: value })
    return { done: true, what: value }
  }

  const contact = CONTACTS[input.key]
  if (contact) {
    /*
     * REPLACED WHERE THERE IS ONE, ADDED WHERE THERE IS NOT -- and a retired row is left alone.
     * A number somebody retired was retired for a reason, and quietly reviving it because the
     * client sent a correction for a different one would put a dead number back on the desk.
     */
    const existing = input.contacts.find((c) => !c.retiredAt && c.kind === contact.kind
      && (contact.label === null ? !c.label : c.label === contact.label))
    if (existing) {
      await updateContact(existing.id, { value })
      return { done: true, what: value }
    }
    await addContact({
      accountId: input.accountId,
      kind: contact.kind,
      value,
      label: contact.label,
      /* The first of its kind is the one the account bar dials and the composer writes to. */
      isPrimary: !input.contacts.some((c) => !c.retiredAt && c.kind === contact.kind),
    })
    return { done: true, what: value }
  }

  /*
   * NAMED, NOT SWALLOWED. Most of the sheet's forty columns have nowhere on an account to live
   * yet -- see the known gap in check-handover-draft -- and an answer that vanished would be a
   * client who corrected something and was never told it went nowhere.
   */
  return { done: false, why: 'There is nowhere on the account to put this yet.' }
}
