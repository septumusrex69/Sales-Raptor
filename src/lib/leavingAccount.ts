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

/* ------------------------------------------------------------------------------------------
 * STOPPING THEM AT THE DOOR (22 Oct)
 * ------------------------------------------------------------------------------------------ */

/**
 * WHAT HAPPENS WHEN SOMEBODY LEAVES AN ACCOUNT FOR ANY OTHER SCREEN.
 *
 * THE FIRM: "before they leave just any account to go to any other pane, it should ask them to
 * re-diarize it. If that same date on the diary is for today, then it should force them to make
 * one in the future. If that diary is for any day after today, then it could possibly ask a
 * question, leave it where it is in the diary or re-diarize." And, of anybody else's account:
 * "it shouldn't force them to re-diarize that account."
 *
 *   'must'     their own account, worked, and its date is today, already gone, or missing: they
 *              may not leave until it has a day AFTER today. A date of today is the one answer
 *              that is certainly wrong -- the account was just worked, and today's entry is the
 *              thing they just did.
 *   'confirm'  their own account, worked, and its date is in the future: one question, keep it
 *              or move it. Keep is one tap.
 *   'none'     everything else, and each for a reason:
 *     NOT WORKED   reading a balance is most of what anybody does; a question every time is a
 *                  question nobody reads (CLAUDE.md). A call taken in is worked once it is logged.
 *     NOT THEIRS   a team leader or a colleague covering may do anything on it, and is never
 *                  forced; diarising it tells the owner instead (DiariseModal).
 *     CLOSED       there is no next day to pick.
 *     A DIARY RUN  "Done & next" already books the next date; asking again on the way to the next
 *                  account is the same question twice.
 *     JUST BOOKED  a future date set during this visit IS the answer to "keep or move".
 */
export type LeavingAsk = 'none' | 'must' | 'confirm'

export function leavingAsk(v: {
  worked: boolean
  mine: boolean
  closed: boolean
  inDiaryRun: boolean
  /** The account's own diary date (never a campaign call), or null where it has none. */
  entry: { dueOn: string; bookedThisVisit: boolean } | null
  today: string
}): LeavingAsk {
  if (!v.worked || v.closed || !v.mine || v.inDiaryRun) return 'none'
  if (!v.entry || v.entry.dueOn <= v.today) return 'must'
  if (v.entry.bookedThisVisit) return 'none'
  return 'confirm'
}
