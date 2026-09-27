/**
 * Whose number is it?
 *
 * A COMPANY IS NOT REACHED ON A NUMBER, IT IS REACHED THROUGH A PERSON WHO HAS ONE. On an
 * individual debtor every contact is theirs and saying so is noise. On a company it is the
 * question a collector has to answer before they dial: four numbers in a flat list is four
 * numbers and a guess, and the call opens with the wrong name.
 *
 * Its own module, with no imports that touch the network, so the rule can be checked without a
 * database — accountWorkspace.ts reaches Supabase and nothing importing it can be run in a check.
 */
import type { AccountContact } from './accountWorkspace'

export interface ContactPerson {
  /** Null is the debtor themselves: every individual account, and a company's own switchboard. */
  person: string | null
  role: string | null
  contacts: AccountContact[]
}

/**
 * The people an account is reached through, and everything belonging to each of them.
 *
 * The debtor's own ways of being reached — a switchboard, a registered address, the general
 * mailbox — carry no person and come back first, because they belong to the company rather than
 * to anybody at it, and they are what a collector falls back on when the named people do not
 * answer.
 */
export function contactsByPerson(contacts: AccountContact[]): ContactPerson[] {
  const groups = new Map<string, ContactPerson>()
  for (const c of contacts) {
    const key = c.personName ?? ''
    const held = groups.get(key)
    if (held) {
      held.contacts.push(c)
      /*
       * A role given on ANY of their rows is kept. Whoever typed the second number did not repeat
       * the job title, so taking it from the first row alone loses it whenever the rows happen to
       * arrive the other way round.
       */
      if (held.role === null && c.personRole !== null) held.role = c.personRole
    } else {
      groups.set(key, { person: c.personName ?? null, role: c.personRole ?? null, contacts: [c] })
    }
  }
  /* The company's own details first; then the people, in the order they arrived on the account. */
  return [...groups.values()].sort((a, b) => {
    if ((a.person === null) !== (b.person === null)) return a.person === null ? -1 : 1
    return 0
  })
}

/**
 * The people on the account who are NOT the debtor.
 *
 * A next of kin promoted off a trace is stored with their own name against it, which is what
 * stops a collector opening the call to somebody's sister as though she were the debtor. On a
 * company those people are the whole contact list and they show under "Who to ask for"; on an
 * INDIVIDUAL they were invisible, because that block only ran for companies and an individual's
 * numbers are shown flat on the reasoning that they are all the debtor's.
 *
 * They are not all the debtor's. Anybody with a name attached is somebody else, and that is
 * precisely the row a collector must not dial thinking it is the debtor.
 */
export function otherPeople(contacts: AccountContact[]): ContactPerson[] {
  return contactsByPerson(contacts).filter((g) => g.person !== null)
}

/**
 * WHAT A CONTACT IS, IN ONE WORD.
 *
 * THE FIRM, LOOKING AT AN ACCOUNT'S "OTHER NUMBERS": "it's also important to notify when you save
 * something, what is it? Is it a work number? Is it the additional number? Is it an additional
 * email? Is it a house number? ... I mean these other numbers, it could just be an alternative
 * number, you know."
 *
 * THEY WERE READING THREE IDENTICAL ROWS. On their own account those three numbers are two WORK
 * lines and a HOME line -- the kind was recorded correctly when each was saved off the trace, and
 * then never drawn. A list that knows a number is a work line and does not say so is a list that
 * costs somebody a call to a switchboard at eight in the evening.
 *
 * THE PERSON'S ROLE WINS WHERE THERE IS ONE. "Next of kin" says more about a number than "Mobile"
 * does, and it is the one that stops a collector opening a call to somebody's sister as though
 * she were the debtor.
 *
 * 'other' HAS NO WORD OF ITS OWN. It is the kind a thing gets when nothing else fits, so printing
 * "Other" beside it tells a reader precisely what they already knew; null leaves the row alone.
 */
const KIND_WORD: Record<AccountContact['kind'], string | null> = {
  mobile: 'Mobile',
  phone: 'Home',
  work: 'Work',
  email: 'Email',
  address: 'Address',
  employer: 'Employer',
  other: null,
}

export function contactWhat(contact: Pick<AccountContact, 'kind' | 'personRole'>): string | null {
  return contact.personRole?.trim() || KIND_WORD[contact.kind]
}
