/**
 * ON THE WAY OUT OF AN ACCOUNT: IS THE STATUS STILL RIGHT, AND WHEN DOES IT COME BACK?
 *
 * THE FIRM, having complained that the call box asked after every single call: "I'm confirming
 * that with you when you rediarise. Or if you go out of the account. To confirm the status of the
 * account. And also if you want to rediarise."
 *
 * THEY ARE MOVING ONE QUESTION, NOT ADDING ONE. Asked after every call it is noise -- a collector
 * who rings four numbers on a traced account answers "where does this stand" four times and the
 * answer never changes. Asked once, as they close the account, it is the question they are
 * actually answering: I have finished with this one, here is where it got to, here is when I want
 * it back.
 *
 * AND THE TWO BELONG IN ONE BOX. "Where it stands" and "when it comes back" are the same decision
 * said twice -- an account left negotiating comes back in a week, one left refusing goes to a
 * team leader -- and two separate prompts on the way out is how people learn to dismiss both.
 *
 * WHAT THIS FILE IS: the rule for WHETHER to ask. Pure, so a check can hold it; the box itself is
 * LeavingModal.
 */

/** What is known about the visit, at the moment somebody leaves. */
export interface Visit {
  /** Did they do anything at all? A call, an SMS, an email, a note, a trace, a promise. */
  worked: boolean
  /** Is there already a diary entry waiting on this account? */
  hasOpenEntry: boolean
  /** Is it this person's account? A team leader passing through is not the one to ask. */
  mine: boolean
  /** An account nobody can work is not one to diarise. */
  closed: boolean
}

/**
 * Should the box open at all?
 *
 * FOUR WAYS TO SAY NO, and each is a prompt that would have fired when nothing was wrong -- which
 * CLAUDE.md names as worse than no prompt, because it is how people stop reading them.
 *
 *   NOTHING WAS DONE. Opening an account to read it is most of what anybody does on a busy day --
 *   a team leader checking a figure, somebody answering "what is the balance on this". Asking them
 *   to confirm a status they did not touch is how a status gets confirmed without being looked at,
 *   which is worse than leaving it alone.
 *
 *   IT IS ALREADY DIARISED. The second half of the question is answered, and the first half was
 *   answered when the entry was made. Re-asking teaches people to dismiss it.
 *
 *   IT IS NOT THEIRS. A team leader passing through does not decide where somebody else's account
 *   stands, and `canLeadCollections` is not a licence to answer for the collector who owns it.
 *
 *   IT IS CLOSED. Settled, written off, handed back: there is no next day to pick.
 */
export function shouldAskOnLeaving(visit: Visit): boolean {
  if (!visit.worked) return false
  if (visit.closed) return false
  if (!visit.mine) return false
  return !visit.hasOpenEntry
}

/**
 * THE THINGS THAT COUNT AS HAVING WORKED IT.
 *
 * ACTIONS, NOT KEYSTROKES. Scrolling, opening a tab, running the repayment simulation and reading
 * the statement are all somebody looking; a call, a message, a note, a trace or an arrangement is
 * somebody DOING something, and only the second kind changes where the account stands.
 *
 * A LIST RATHER THAN A BOOLEAN THE PAGE SETS, so that a new action added to the account has to
 * decide which of the two it is instead of defaulting to "looking" by nobody remembering.
 */
export const WORKING_ACTIONS = [
  'call', 'sms', 'email', 'note', 'promise', 'trace', 'dispute', 'letter', 'workflow',
] as const

export type WorkingAction = typeof WORKING_ACTIONS[number]

/** Did this visit include anything that changes where the account stands? */
export function worked(actions: readonly string[]): boolean {
  return actions.some((a) => (WORKING_ACTIONS as readonly string[]).includes(a))
}
