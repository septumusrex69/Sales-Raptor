/**
 * WHICH CONTACT FILLS WHICH SLOT ON A DEBTOR'S FILE.
 *
 * THE FIRM, LOOKING AT THE PANEL: "it's important to show that a debtor has a mobile primary
 * number. He could have a secondary number, mobile. Then a work number or a home number -- I'd say
 * a work number, because nobody has a home number anymore. So an email address, there should be
 * a second, an alternative email address. And then the rest of the stuff: residential address,
 * employer, preferred language, contact preference."
 *
 * WHAT THIS REPLACES WAS "THE NEXT NUMBER, WHATEVER IT IS". The second slot was labelled
 * "Alternative number" and held the first phone that was not the primary one -- so on an account
 * carrying a second mobile and a work line, which of the two appeared was decided by the order
 * rows happened to come back in, and the other was pushed down into a list at the bottom of the
 * panel. A collector reading "Alternative number" had no way to tell a second cellphone from a
 * switchboard without opening the chip beside it.
 *
 * THE SLOTS ARE BY KIND NOW, and the panel's own doctrine is why: a fixed set of labelled slots is
 * what shows a collector WHAT IS MISSING. "Work number -- not recorded" is a piece of work to do.
 * "Alternative number" filled with a cellphone says nothing about whether anybody has ever found
 * where this person works.
 *
 * A HOME NUMBER IS NOT GIVEN A SLOT and is not thrown away either. The firm is right that nobody
 * has one, and the book disagrees politely: traces still turn them up, and the one on their own
 * test account is a home line. It keeps its "Home" chip under "Other numbers", where every number
 * beyond the three slots goes.
 *
 * Pure: no database, no clock. accountWorkspace.ts reaches Supabase and nothing importing it can
 * be run in a check, so the rule lives here and the type is imported for its shape alone.
 */
import type { AccountContact } from './accountWorkspace'

export interface DebtorSlots {
  /** The number Call rings, where that number is a cellphone. */
  primaryMobile: AccountContact | null
  secondMobile: AccountContact | null
  workNumber: AccountContact | null
  email: AccountContact | null
  altEmail: AccountContact | null
  address: AccountContact | null
  employer: AccountContact | null
  /** Everything else that can be dialled: a home line, a third mobile, a second switchboard. */
  otherNumbers: AccountContact[]
  /** Every address beyond the two slots. 105 accounts on the book carry more than one. */
  otherEmails: AccountContact[]
}

const DIALABLE = ['mobile', 'phone', 'work'] as const

export function isDialable(c: Pick<AccountContact, 'kind'>): boolean {
  return (DIALABLE as readonly string[]).includes(c.kind)
}

/**
 * The marked one, else the first.
 *
 * THE FLAG WINS WHEREVER IT IS SET, because it is the only thing on the account that somebody
 * chose. Where nobody has chosen, the order fetchWorkspace returns decides -- primary first and
 * then oldest, which is the order the rows were found in.
 */
function pick(list: AccountContact[]): AccountContact | null {
  return list.find((c) => c.isPrimary) ?? list[0] ?? null
}

/**
 * Lay the debtor's live contacts into the slots the panel draws.
 *
 * TAKES THE LIVE LIST ONLY. A retired contact is retired precisely because using it is a mistake,
 * and one sitting in "Mobile (Primary)" is a collector dialling a number the firm already knows is
 * dead. The panel lists them separately, struck through, under "no longer used".
 */
export function debtorSlots(live: AccountContact[]): DebtorSlots {
  const mobiles = live.filter((c) => c.kind === 'mobile')
  const works = live.filter((c) => c.kind === 'work')
  const emails = live.filter((c) => c.kind === 'email')

  const primaryMobile = pick(mobiles)
  const secondMobile = mobiles.find((c) => c.id !== primaryMobile?.id) ?? null
  const workNumber = pick(works)
  const email = pick(emails)
  const altEmail = emails.find((c) => c.id !== email?.id) ?? null

  const taken = new Set(
    [primaryMobile, secondMobile, workNumber, email, altEmail]
      .filter((c): c is AccountContact => c !== null).map((c) => c.id),
  )

  return {
    primaryMobile,
    secondMobile,
    workNumber,
    email,
    altEmail,
    address: live.find((c) => c.kind === 'address') ?? null,
    employer: live.find((c) => c.kind === 'employer') ?? null,
    otherNumbers: live.filter((c) => isDialable(c) && !taken.has(c.id)),
    otherEmails: emails.filter((c) => !taken.has(c.id)),
  }
}

/**
 * THE NUMBER THE PANEL CALLS PRIMARY HAS TO BE THE NUMBER THE CALL BUTTON RINGS.
 *
 * `dialableNumber` picks across all three kinds, so on an account whose only number is a work line
 * the button rings the switchboard while "Mobile (Primary)" sits empty above it -- correct, and
 * only readable if the work slot says so. This answers "is the one Call rings sitting in THIS
 * slot?", which is what the badge beside it means.
 */
export function ringsOnCall(
  contact: AccountContact | null,
  dialled: AccountContact | null | undefined,
): boolean {
  return !!contact && !!dialled && contact.id === dialled.id
}
