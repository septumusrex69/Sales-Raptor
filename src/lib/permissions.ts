import { useEffect, useRef, useState } from 'react'
import { departmentOf } from './departments.ts'
import { can } from './capabilities.ts'
import type { User } from '../types'

/**
 * THESE ARE NOW NAMES FOR A CAPABILITY, NOT LISTS OF ROLES.
 *
 * Every predicate below used to spell out the roles that passed it. The firm asked for
 * Swordfish's shape -- "you can choose, for example, for a user to have a management template, but
 * you can add them more functionality" -- and a hand-written role list cannot express that at all.
 * So each one now asks `can(user, ...)`, which reads the role's template, adds what this person
 * was granted and removes what was taken away. See capabilities.ts.
 *
 * THREE THINGS IN THIS FILE STILL READ THE ROLE AND ARE NOT CAPABILITIES, which is a distinction
 * worth writing down because they look like the others:
 *
 *   canEditOwned       MIRRORS AN RLS POLICY, WORD FOR WORD. Its whole value is that it says what
 *                      the database will allow; making it grantable would mean the app offering an
 *                      edit that Postgres then refuses, which is the "button works, then silently
 *                      fails" it exists to prevent. It becomes a capability the day the policy does.
 *   visibleDisputeOwners  WHICH ROWS, not whether. A capability answers "may you"; this answers
 *                      "whose". Pooling them IS a capability -- `dispute.pool` -- and that one is
 *                      in the list.
 *   isAssignableOwner  WHO MAY BE GIVEN a lead or a deal. A fact about other people, asked to fill
 *                      a picker, not a permission the person themselves holds.
 *   useDefaultOwnerFilter  WHERE A LIST STARTS, which anybody can then change. A default is not a
 *                      permission, and making it one would mean a manager needing a grant to have
 *                      their own list open the way it always has.
 *
 * THEY KEPT THEIR NAMES ON PURPOSE. Fifty-one call sites read far better as `canFreezeAccounts`
 * than as a string, and the reasoning each one carries is the record of a decision the firm made.
 * What changed is the ARGUMENT: a role string could never answer a per-person question, so they
 * take the person.
 */

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
export function canReassign(user: Pick<User, 'role' | 'grants' | 'revokes'> | null | undefined): boolean {
  return can(user, 'book.reassign')
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
export function canHandOutAccounts(user: Pick<User, 'role' | 'grants' | 'revokes'> | null | undefined): boolean {
  return can(user, 'book.hand_out')
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
export function canViewClients(user: Pick<User, 'role' | 'grants' | 'revokes'> | null | undefined): boolean {
  return can(user, 'client.view')
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
export function canRefileMail(user: Pick<User, 'role' | 'grants' | 'revokes'> | null | undefined): boolean {
  return can(user, 'mail.refile')
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
export function canFreezeAccounts(user: Pick<User, 'role' | 'grants' | 'revokes'> | null | undefined): boolean {
  return can(user, 'book.freeze')
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
export function canLeadCollections(user: Pick<User, 'role' | 'grants' | 'revokes'> | null | undefined): boolean {
  return can(user, 'floor.lead')
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
  /*
   * THE CALL CENTRE MANAGER LEADS THE FLOOR, NOT A TEAM. The firm: "the call centre manager is
   * the manager of the team leaders." A team leader's reach is their own team; theirs is every
   * team, so it is the department rather than teamId that answers this.
   *
   * INFERRED FROM THE SHAPE, NOT INSTRUCTED. The firm described the ladder and not the disputes
   * board specifically. Still one person at a time -- mayPoolDisputes refuses them the pooled
   * view for the same reason it refuses a team leader.
   */
  if (me.role === 'Call Centre Manager') {
    return [...self, ...everyone.filter((u) => u.id !== me.id && departmentOf(u.role) === 'Call centre')]
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
export function mayPoolDisputes(user: Pick<User, 'role' | 'grants' | 'revokes'> | null | undefined): boolean {
  return can(user, 'dispute.pool')
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
export function canViewLibrary(user: Pick<User, 'role' | 'grants' | 'revokes'> | null | undefined): boolean {
  return can(user, 'library.view')
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
export function canEditLibrary(user: Pick<User, 'role' | 'grants' | 'revokes'> | null | undefined): boolean {
  return can(user, 'library.edit')
}

/**
 * WHO SEES THE FINANCE SECTION, AND IT IS ONE ROLE.
 *
 * The firm, setting the condition for the whole module: "The Finance section is Administrator
 * only. Sales representatives never see the payment split." It is the same instinct as the
 * company dashboard's rule -- "we're not going to be disclosing commission and income from the
 * Annexure B fees" -- one screen further in: a payover run IS the commission earned on a client's
 * whole book, and the back office is what the firm still intends to take off every debtor.
 *
 * THIS IS THE COURTESY, NOT THE BOUNDARY. Every function behind these screens checks the role
 * itself, in the database, because they run as security definer and there is no policy to fall
 * back on inside one. A menu item that always refuses is worse than no menu item; a menu item
 * that is the ONLY thing refusing is worse still.
 */
export function canViewFinance(user: Pick<User, 'role' | 'grants' | 'revokes'> | null | undefined): boolean {
  return can(user, 'finance.view')
}

/**
 * WHO MAY RECORD THAT MONEY ARRIVED.
 *
 * NOT THE SAME QUESTION AS canViewFinance, and keeping them apart is the point. The firm's rule
 * is about the SPLIT -- "The Finance section is Administrator only. Sales representatives never
 * see the payment split" -- and capturing a receipt shows none of it. The firm: "let's do it in
 * the finance section and you will be able to do it on the account as well."
 *
 * A PRE-LEGAL AGENT IS NOT ON THIS LIST, and used to be. The firm, seeing the button on a
 * collector's screen: "she's a normal pre-legal agent, she can't be allocating payments."
 *
 * THE PRINCIPLE UNDERNEATH IT IS WHO THE MONEY IS LEARNED FROM. A trust receipt arrives on the
 * firm's own bank statement and is imported; the only thing anybody types in by hand is a PTC,
 * and a PTC is what the CLIENT tells you. A pre-legal agent deals with the DEBTOR, so they are
 * never the person told "he paid us direct" -- and the thing they are told, that the debtor says
 * they paid, is a claim to be checked against the statement rather than a receipt to record.
 *
 * SO: the liaisons, who talk to clients; their manager; the two supervisors on the collections
 * floor, who are where anything unusual on the floor ends up; and finance.
 *
 * AN ALLOW LIST, NOT A DENY LIST. A role added to the firm later is refused until somebody
 * decides it belongs, which is the safe direction for something that creates money.
 *
 * THE SALES SIDE IS ABSENT ON PURPOSE -- CLAUDE.md: fees are charged on ACCOUNTS ONLY and the
 * sales side raises nothing. A representative has no business writing a ledger entry.
 *
 * THE REAL BOUNDARY IS may_record_payment() IN THE DATABASE. This is the browser's copy of it,
 * for deciding whether to draw a button; the two lists are held against each other by
 * check-record-payment.
 */
export function canRecordPayment(user: Pick<User, 'role' | 'grants' | 'revokes'> | null | undefined): boolean {
  return can(user, 'payment.record')
}
