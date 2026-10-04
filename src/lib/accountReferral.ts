/**
 * PUTTING AN ACCOUNT ON SOMEBODY ELSE'S DAY -- AND THE DIARY ENTRY IS THE REFERRAL.
 *
 * TWO THINGS THE FIRM ASKED FOR, and they are the same mechanism with two different sentences:
 *
 *   A TEAM LEADER REFERS AN ACCOUNT. They have looked at a file and want a collector to do
 *   something with it. "The referral is the diary entry" -- not a note beside one, not a message
 *   as well. A referral that is a note is a referral somebody has to notice; a referral that is a
 *   diary entry is on their day, dated, and counted in their fifty.
 *
 *   RECEPTION TRANSFERS A CALLER. The switchboard has the debtor on the line and the account on
 *   the screen. Transferring the call without handing over the account is what the firm does
 *   today: the collector picks up a stranger and starts asking for a reference number.
 *
 * ONE DIARY ENTRY PER ACCOUNT, which is the firm's own rule and is enforced by a partial unique
 * index -- so both of these TAKE the account's one open date and supersede what was there. That is
 * right for both: a referral from the person who runs the floor outranks a routine review, and a
 * debtor on the telephone outranks everything. The superseded entry keeps the day it was always
 * due, which is what makes "this was booked for the 7th and nobody worked it" survive as a fact.
 *
 * NEITHER CHANGES WHO OWNS THE ACCOUNT. Reassignment is a different act with a different
 * consequence -- it moves the file onto somebody's book, against their ceiling -- and it has its
 * own box. A referral asks somebody to look at an account; it does not give it to them.
 *
 * PURE: the sentences only. The write is one `diarise` call at the call site, because the diary is
 * the one place a dated obligation is created and a second writer here would be a second rule
 * about what supersedes what.
 */

/** Which of the two is being done. They produce different sentences and different days. */
export type ReferralKind = 'refer' | 'transfer'

/**
 * WHAT THE DIARY ENTRY SAYS, which is the only record either of these leaves.
 *
 * IT NAMES WHO SENT IT. A diary entry that appeared overnight with no author is one a collector
 * reads as a system booking and works last; one that says the team leader asked for it is a
 * different instruction entirely. `diarise` stamps created_by, but the REASON is what the diary
 * draws on the day, so the name goes in the words.
 *
 * AND IT CARRIES THE ASK VERBATIM. The person referring knows why; paraphrasing it into a category
 * would lose the one thing the collector needs.
 */
export function referralReason(input: {
  kind: ReferralKind
  /** Who is sending it. Null where the session has no name, which should not happen and might. */
  fromName: string | null
  /** What they want done, in their own words. */
  ask: string
  /** Where the caller can be reached, on a transfer. */
  callerNumber?: string | null
}): string {
  const who = input.fromName?.trim() || 'A team leader'
  const ask = input.ask.trim()
  if (input.kind === 'transfer') {
    const number = input.callerNumber?.trim()
    /*
     * THE NUMBER IS THE HALF THAT SURVIVES A DROPPED TRANSFER, which is what happens on a switch
     * often enough to plan for. Without it the collector has a caller who has gone and no way
     * back to them.
     */
    const back = number ? ` If the call drops, they are on ${number}.` : ''
    return `${who} is transferring a caller now. ${ask}${back}`
  }
  return `Referred by ${who}. ${ask}`
}

/**
 * WHEN IT LANDS.
 *
 * A TRANSFER IS TODAY AND CANNOT BE ANYTHING ELSE -- there is a person on the telephone. A
 * referral takes a date, because a team leader reading a file on Friday afternoon may well want it
 * worked on Monday, and forcing it onto today is how a referral becomes something that gets moved.
 */
export function referralDueOn(kind: ReferralKind, today: string, chosen?: string | null): string {
  if (kind === 'transfer') return today
  return (chosen ?? '').trim() || today
}

/**
 * WHAT THE DIARY LADDER CALLS IT.
 *
 * A CALLBACK, FOR BOTH. The ladder's kinds are the firm's own work ladder -- broken promise, new
 * account, promise due, callback, dispute chase, no contact, trace, review -- and neither of these
 * is any of the others. A callback is a dated thing a person has to do because somebody asked;
 * that is exactly what both of these are.
 *
 * NOT A REVIEW, which is the last rung and explicitly the kind with no event behind it. A referral
 * from the floor's leader and a debtor on the line are both events, and filing either as a review
 * would sort them below a trace on the day's list.
 */
export const REFERRAL_DIARY_KIND = 'callback'

/**
 * THE SENTENCE THE SENDER SEES WHEN IT IS DONE.
 *
 * SAYS WHOSE DAY IT LANDED ON AND WHEN, because a referral that quietly succeeded looks exactly
 * like one that quietly failed. And it says what did NOT happen -- the account has not moved --
 * so nobody refers a file believing they have handed it over.
 */
export function referralDone(input: {
  kind: ReferralKind
  toName: string
  dueOn: string
}): string {
  if (input.kind === 'transfer') {
    return `${input.toName} has it on their day now. Transfer the call.`
  }
  return `It is on ${input.toName}'s diary for ${input.dueOn}. The account is still where it was `
    + '— referring does not hand it over.'
}
