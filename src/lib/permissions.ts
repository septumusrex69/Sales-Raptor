import { useEffect, useRef, useState } from 'react'
import type { User } from '../types'

/**
 * Whether `user` may edit, close, or delete a record owned by `ownerId` —
 * the owner themselves, or an Administrator/Sales Manager. Mirrors the
 * Supabase RLS update/delete policies in supabase/schema.sql exactly, so
 * the UI only ever offers actions the database will actually allow;
 * RLS remains the real enforcement boundary, this just avoids a
 * confusing "button works, then silently fails" experience.
 */
export function canEditOwned(user: Pick<User, 'id' | 'role'> | null | undefined, ownerId: string | undefined): boolean {
  if (!user) return false
  if (user.role === 'Administrator' || user.role === 'Sales Manager' || user.role === 'Liaison Manager') return true
  return !!ownerId && user.id === ownerId
}

/** Reassigning a record to a different owner is a managerial action, independent of who currently owns it. */
export function canReassign(user: Pick<User, 'role'> | null | undefined): boolean {
  return user?.role === 'Administrator' || user?.role === 'Sales Manager' || user?.role === 'Liaison Manager'
}

/**
 * Whether this person may put an ACCOUNT on somebody's desk.
 *
 * NOT canReassign, which is the sales side's test and leaves out the pre-legal team leader — the
 * person who actually shares the collections floor's work out. It lived as a bare array inside
 * AccountsList and the account screen needed the same answer, which is how a permission ends up
 * written twice and enforced once: the list would offer it to a team leader and the account
 * screen would not, for the same action on the same account.
 */
export function canHandOutAccounts(role: Pick<User, 'role'>['role'] | undefined): boolean {
  return role === 'Administrator' || role === 'Sales Manager'
    || role === 'Liaison Manager' || role === 'Pre-legal Team Leader'
}

/**
 * Whether this person may look at a client.
 *
 * A pre-legal agent works debtors, not the firm's relationships. They see the account, the
 * debtor, the ledger and the dispute — everything needed to collect — and not the client behind
 * it, whose commission rates, mandate and open deals are the liaison's business and commercially
 * sensitive besides.
 *
 * Enforced in three places because hiding a link is not a permission: the client links on the
 * account and on a dispute, the Clients entry in the sidebar, and the /companies routes
 * themselves. RLS remains the real boundary — this stops the app offering what the database
 * should refuse.
 */
export function canViewClients(role: Pick<User, 'role'>['role'] | undefined): boolean {
  return role !== undefined && role !== 'Pre-legal Agent'
}

/**
 * Whether this person may move a message that is ALREADY filed onto a different record.
 *
 * Administrator only, at the firm's instruction. Filing unfiled mail is everyday work and stays
 * open to everyone; re-filing moves a debtor's correspondence between accounts and raises a
 * second item 6 fee on the destination, which makes it a money action.
 *
 * The real boundary is the protect_filed_mail_target trigger in supabase/schema.sql, which
 * silently reverts the change for anyone else. This only stops the app offering a button that
 * would appear to work and quietly do nothing.
 */
export function canRefileMail(role: Pick<User, 'role'>['role'] | undefined): boolean {
  return role === 'Administrator'
}

/**
 * Whether this person may stop or restart work on an account.
 *
 * Not a collector's decision, at the firm's instruction that removing an account from
 * circulation sits at management level. A liaison is included because a freeze is most often
 * something a CLIENT asked for, and the liaison is who the client asks.
 *
 * A freeze changes no balance and raises no fee, so it is reversible and needs no approval —
 * what it needs is a name against it, which is what the reason and the status history give it.
 */
export function canFreezeAccounts(role: Pick<User, 'role'>['role'] | undefined): boolean {
  return role === 'Administrator'
    || role === 'Pre-legal Team Leader'
    || role === 'Liaison Manager'
    || role === 'Liaison'
}

/**
 * Whether this person is answerable for somebody else's collections work.
 *
 * THE FIRM ASKED FOR ONE THING AND IT IMPLIES THIS: "it flags them and it flags the team leader
 * as well in the team leader's dashboard." A collector sees their own carried accounts; a leader
 * sees the floor's. That is a different screen for the same panel, so it needs a name.
 *
 * NOT canReassign, which is the sales side's managerial test and does not include the pre-legal
 * team leader — who is precisely the person this is for. Borrowing that one would have shown a
 * collections team leader nothing and a sales manager the collections floor.
 */
export function canLeadCollections(role: Pick<User, 'role'>['role'] | undefined): boolean {
  return role === 'Administrator' || role === 'Pre-legal Team Leader'
}

/**
 * WHOSE DISPUTES THIS PERSON MAY LOOK AT.
 *
 * The firm, having made a new user and opened the board: "I went into the disputes pane and I saw
 * everybody's dispute. I think by default it should be related to the user." The owner filter
 * started on "All Owners" and offered every person in the firm, so a collector on their first
 * morning was reading the whole floor's disputes.
 *
 * THREE ANSWERS, AND THE MIDDLE ONE IS THE FIRM'S OWN SHAPE:
 *
 *   - An ADMINISTRATOR sees anybody's. "As an administrator, you should be able to see other
 *     people's disputes."
 *   - A LEADER sees their own and, ONE AT A TIME, anybody in their team. The firm was explicit
 *     that this is per person rather than pooled: "for any individual in your team — I can't see
 *     how it would benefit to look at a bird's eye view at the entire team's tickets." So this
 *     returns the people, and `mayPoolDisputes` refuses the pooled view.
 *   - EVERYBODY ELSE sees their own, and the picker has nobody else in it.
 *
 * A SALES MANAGER IS NOT A LEADER HERE. They lead the sales side and a dispute is a collections
 * record; nothing the firm said puts the floor's disputes in front of them. Inferred rather than
 * instructed — say so if it is wrong.
 *
 * ORDERED WITH THE PERSON THEMSELVES FIRST, because that is the one they open every morning.
 */
export function visibleDisputeOwners<T extends Pick<User, 'id' | 'role' | 'teamId'>>(
  me: Pick<User, 'id' | 'role' | 'teamId'> | null | undefined,
  everyone: T[],
): T[] {
  if (!me) return []
  const self = everyone.filter((u) => u.id === me.id)
  if (me.role === 'Administrator') {
    return [...self, ...everyone.filter((u) => u.id !== me.id)]
  }
  if (me.role === 'Pre-legal Team Leader' || me.role === 'Liaison Manager') {
    /*
     * A LEADER WITH NO TEAM LEADS NOBODY, which is the safe way round: `teamId` is optional and
     * eleven of the firm's people have none, so matching undefined to undefined would hand every
     * teamless leader every other teamless person.
     */
    const mates = me.teamId
      ? everyone.filter((u) => u.id !== me.id && !!u.teamId && u.teamId === me.teamId)
      : []
    return [...self, ...mates]
  }
  return self
}

/**
 * Whether the board may be looked at as a whole rather than one person at a time.
 *
 * ONLY AN ADMINISTRATOR. The firm ruled the pooled view out for a leader in the same breath as
 * granting them their team: a leader picks a person. Keeping "All Owners" for them would be the
 * bird's-eye view they said they had no use for, sitting at the top of the list as the easiest
 * thing to click.
 */
export function mayPoolDisputes(role: Pick<User, 'role'>['role'] | undefined): boolean {
  return role === 'Administrator'
}

/** Roles eligible to own a Lead/Deal/Task/Contact/Company — i.e. show up in "assign to" / "Client Liaison" pickers. */
export function isAssignableOwner(role: Pick<User, 'role'>['role']): boolean {
  return role === 'Administrator' || role.includes('Sales') || role === 'Liaison' || role === 'Liaison Manager'
}

/**
 * "Owner" list-filter state that defaults to the current user's own
 * records the moment their profile loads — Administrators/Sales
 * Managers default to "All" instead, since seeing the whole team is
 * their normal view. A pre-supplied value (e.g. a drill-down link's
 * `?owner=` URL param) always wins and is never overridden.
 *
 * currentUser is typically still null on first render (the profile
 * fetch after sign-in is async), so this can't be a useState initializer
 * — it applies once, in an effect, the moment currentUser actually
 * arrives, and never again afterward (so it doesn't stomp on a later
 * manual filter change).
 */
export function useDefaultOwnerFilter(
  initialValue: string | undefined,
  currentUser: Pick<User, 'id' | 'role'> | null | undefined,
): [string, (value: string) => void] {
  const [owner, setOwner] = useState(initialValue ?? 'All')
  const defaulted = useRef(!!initialValue)
  useEffect(() => {
    if (defaulted.current || !currentUser) return
    defaulted.current = true
    if (currentUser.role !== 'Administrator' && currentUser.role !== 'Sales Manager') {
      setOwner(currentUser.id)
    }
  }, [currentUser])
  return [owner, setOwner]
}

/**
 * Whether this person may open the library at all.
 *
 * EVERYONE, at the firm's instruction: "perhaps everyone can view everything in the library. Only
 * [an administrator] can edit." That reverses an earlier instruction to keep collectors out of it
 * altogether, and the newer one is the better rule — a collector reading a script on a live call
 * benefits from seeing the whole ladder it sits on, and the risk a library carries is in WRITING
 * it, not in reading it.
 *
 * Here as a function rather than as `true` written into the page, so the one place that decides
 * this stays findable the day it narrows again. It mirrors message_templates_select, which has
 * always been open to every authenticated user.
 */
export function canViewLibrary(role: Pick<User, 'role'>['role'] | undefined): boolean {
  return role !== undefined
}

/**
 * Whether this person may CHANGE what the library says.
 *
 * ADMINISTRATOR ONLY, and this is the half that was never in question: "only [an administrator]
 * can edit." The wording is the firm's legal position, the attorney signs it off, and a sentence
 * nobody approved goes out four hundred times rather than once. A workflow is the same thing in
 * another form — it decides WHEN a statutory notice is sent.
 *
 * Mirrors message_templates_insert/update/delete and the workflow_* write policies in
 * supabase/schema.sql. RLS is the real boundary; this stops the app offering a button the
 * database would refuse.
 */
export function canEditLibrary(role: Pick<User, 'role'>['role'] | undefined): boolean {
  return role === 'Administrator'
}
