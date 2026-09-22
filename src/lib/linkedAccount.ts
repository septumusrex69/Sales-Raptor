/**
 * One debtor, two accounts from the same client — and what to say about it on an import.
 *
 * THE FIRM, looking at a row refused for "Reference BF-308 appears twice in this file": "it's the
 * same reference number, but two accounts. It could be like a linked account — just call it
 * linked account, not other account. So it's the same person with two different accounts from the
 * same client. Usually these accounts should be worked by the same people. The first thing that
 * should happen is it should ask you: this looks like a linked account, do you want to accept it
 * or reject it? But there should be an accept option."
 *
 * THIS REVERSES A REFUSAL, and the reasoning it rested on was wrong rather than outweighed. A
 * repeated reference reads like a mistake in the file and is usually not one: the column holds the
 * CLIENT's reference, which is theirs to reuse, and the reference a debtor quotes when they pay is
 * the one Raptor generates. So two rows sharing a client reference collide over nothing. Refusing
 * them put a second genuine debt back on the client to argue about.
 *
 * "LINKED ACCOUNT" IS THE FIRM'S WORD AND IT OVERRULES THE ONE IN sameDebtor.ts. That file argues
 * at length for "other accounts" -- that "linked" implies somebody linked them and invites an
 * unlink button that cannot exist, since the grouping is derived and never stored. The argument
 * still holds and the firm has heard it; they want their own word on the screen, and the words
 * on the screen are theirs. Nothing about the derivation changed, only what it is called.
 *
 * WHAT IS NOT CLAIMED. That the ledgers combine -- they do not, each account keeps its own
 * capital, its own in duplum ceiling and its own commission. And that the two ARE one debtor: the
 * screen says "looks like", because a client reusing a reference for a different person is rarer
 * than the alternative and not impossible, and the person deciding can see both.
 */

import { CLIENT_POSITIONS, clientPosition } from './clientPosition.ts'

/** An account already on the client's book, as much of it as a decision needs. */
export interface BookAccount {
  /** Ours -- what the debtor quotes when they pay. */
  reference: string | null
  /** Theirs, off their own sheet. What makes this look linked. */
  clientReference: string | null
  name: string | null
  idNumber: string | null
  capital: number | null
  status: string | null
  subStatus: string | null
  /** Whose desk it is on, as a profiles.id. Null is the unallocated pile. */
  heldBy: string | null
  heldByName: string | null
}

/** Why a row looks like a second account for a debtor already here. */
export type LinkedHow =
  /** The client used the same reference. */
  | 'client-reference'
  /** Same identity and the same amount -- see signaturesOf. */
  | 'same-debtor'

export interface LinkedMatch {
  how: LinkedHow
  /** An earlier line in THIS file, where that is what it matched. */
  line: number | null
  /** An account already on the book, where that is what it matched. */
  account: BookAccount | null
}

/**
 * The account in one line, as somebody deciding needs to read it.
 *
 * THE FIRM: "there might be another one, and that's the reference number for the client, and the
 * surname is Peter, and the account is currently being worked by Jennifer, or allocated to
 * Jennifer, or it's been withdrawn, or it's been settled or whatever. Then we can see who worked
 * on that account."
 *
 * THE POSITION, NOT THE STATUS COLUMN. CLAUDE.md's first rule: `status = 'Active: Unfrozen'`
 * describes how a row got into the table and says nothing about the debtor. "Paying" and
 * "Refusing to pay" are what somebody deciding whether this is a second debt actually needs.
 */
export function linkedSummary(account: BookAccount): string {
  const position = CLIENT_POSITIONS[clientPosition({
    status: account.status, subStatus: account.subStatus,
  })].label
  return [
    account.reference ?? 'no reference',
    account.name ?? 'no name',
    position,
    account.heldByName ? `on ${account.heldByName}'s desk` : 'on nobody’s desk',
  ].join(' · ')
}

/**
 * What the row says about it.
 *
 * NAMED AS A QUESTION, not as a finding. The screen cannot know whether a debtor genuinely owes
 * twice and neither can we -- only the person with both in front of them can, which is why this
 * ends by telling them what the two answers mean rather than by recommending one.
 */
export function linkedMessage(match: LinkedMatch, reference: string | null): string {
  const what = match.how === 'client-reference'
    ? `The client has used reference ${reference ?? 'this'} twice`
    : 'The same debtor and the same amount appear twice'

  if (match.line !== null) {
    return `${what} — this looks like a linked account, a second debt for one debtor. Row `
      + `${match.line} is the other one. Accept it if they genuinely owe twice, or reject it if `
      + 'the client has sent the same debt to us twice.'
  }
  if (match.account) {
    return `${what} — this looks like a linked account, a second debt for one debtor. Already on `
      + `the book: ${linkedSummary(match.account)}. Accept it if they genuinely owe twice, or `
      + 'reject it if the client has sent the same debt to us twice.'
  }
  return `${what} — this looks like a linked account, a second debt for one debtor.`
}

/**
 * Whose desk the new account should land on, where there is an obvious answer.
 *
 * THE FIRM: "usually these accounts should be worked by the same people ... so it's good if the
 * same person handles the account, possibly. So we need to give that option as well."
 *
 * OFFERED, NEVER APPLIED BY ITSELF. It is the person accepting the row who decides, and the
 * account it points at may be settled, withdrawn or on the desk of somebody who has left. A
 * suggestion is worth making; a silent allocation is an account appearing on a collector's list
 * that nobody chose to put there.
 *
 * Null where the match is to another row in the SAME file -- that account does not exist yet, so
 * there is no desk to follow.
 */
export function suggestedDesk(
  match: LinkedMatch | null,
): { id: string; name: string } | null {
  const a = match?.account
  if (!a?.heldBy) return null
  return { id: a.heldBy, name: a.heldByName ?? 'whoever holds it' }
}
