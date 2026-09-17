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
