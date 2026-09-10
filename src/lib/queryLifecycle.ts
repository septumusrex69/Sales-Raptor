/**
 * The life of a query, from "the debtor disputes this" to "here is what we decided".
 *
 * Pure: no database, no clock of its own, no email. It answers three questions and nothing else —
 * where can this query go next, what is owed to the debtor today, and may the account be worked
 * while it is open. Everything that acts on those answers lives elsewhere, which is what makes
 * the answers testable.
 */
import { addWorkingDays, subtractWorkingDays } from './workingDays.ts'
import type { LetterKind } from './queryLetters.ts'

/** The firm's own policy period, not a statutory one. See queryLetters.ts. */
export const WRITTEN_QUERY_WORKING_DAYS = 7
/** How far ahead of the deadline the reminder goes out. */
export const REMINDER_WORKING_DAYS = 2

/**
 * Where a query sits.
 *
 * `awaiting_written` is the new one and the only state with a clock. The debtor has said they
 * dispute the account; nothing is in writing yet, and until it is there is nothing to assess.
 */
export type QueryState =
  | 'awaiting_written'
  | 'received'
  | 'with_liaison'
  | 'with_client'
  | 'resolved'

export const QUERY_STATE_LABEL: Record<QueryState, string> = {
  awaiting_written: 'Awaiting written query',
  received: 'Received',
  with_liaison: 'With the liaison',
  with_client: 'With the client',
  resolved: 'Resolved',
}

/** The columns of the board, in order. Resolved sits last because that is where things end. */
export const QUERY_BOARD_ORDER: QueryState[] = [
  'awaiting_written', 'received', 'with_liaison', 'with_client', 'resolved',
]

/**
 * Who the mail comes from at each rung.
 *
 * Anything to a DEBTOR goes out from the pre-legal agent who owns the query. Anything to a CLIENT
 * goes from the client liaison. The same query therefore writes with two different voices
 * depending on who it is addressing, which is the firm's own convention and not a technicality:
 * a debtor should never receive a letter signed by the person who talks to their creditor.
 */
export type LetterAudience = 'debtor' | 'client'
export function senderFor(audience: LetterAudience): 'query_owner' | 'client_liaison' {
  return audience === 'debtor' ? 'query_owner' : 'client_liaison'
}

export interface QueryClock {
  /** The day the query was raised, which the seven days are counted from. */
  raisedOn: string
  /** Set once the debtor's written query is in hand. Stops the clock. */
  receivedOn?: string | null
  /** Stamped when each automated letter actually went, so nothing is ever sent twice. */
  acknowledgementSentOn?: string | null
  reminderSentOn?: string | null
  /** A person can stop the automated letters on one query without closing it. */
  automationPaused?: boolean
}

/** The day the debtor's written query is due. */
export function deadlineFor(raisedOn: string, holidays: Record<string, string> = {}): string {
  return addWorkingDays(raisedOn, WRITTEN_QUERY_WORKING_DAYS, holidays)
}

/** The day the reminder should go, given a deadline. */
export function reminderDateFor(deadline: string, holidays: Record<string, string> = {}): string {
  return subtractWorkingDays(deadline, REMINDER_WORKING_DAYS, holidays)
}

/**
 * Which automated letter is owed today, if any.
 *
 * Deliberately returns at most one thing and never looks at the past: a sweep that missed a day
 * should send the letter late, not send two. A reminder whose date has slipped by still goes out
 * while the deadline is ahead, because a late reminder is useful and a skipped one is not; once
 * the deadline has passed there is nothing to remind anyone about.
 */
export function letterDue(
  clock: QueryClock,
  state: QueryState,
  today: string,
  holidays: Record<string, string> = {},
): LetterKind | null {
  if (state !== 'awaiting_written') return null
  if (clock.automationPaused) return null
  if (clock.receivedOn) return null
  if (!clock.acknowledgementSentOn) return 'acknowledgement'
  const deadline = deadlineFor(clock.raisedOn, holidays)
  if (clock.reminderSentOn) return null
  if (today > deadline) return null
  // The acknowledgement and the reminder must never land on the same day -- on a short window
  // the reminder date can fall on or before the day the query was raised.
  if (clock.acknowledgementSentOn >= today) return null
  return today >= reminderDateFor(deadline, holidays) ? 'reminder' : null
}

/**
 * Has the window run out with nothing received?
 *
 * This does NOT close the query. The clerk gets a diary entry and decides — a machine that closes
 * a dispute on the morning the debtor's letter is sitting in the post is exactly the outcome the
 * seven days were meant to prevent.
 */
export function windowLapsed(
  clock: QueryClock,
  state: QueryState,
  today: string,
  holidays: Record<string, string> = {},
): boolean {
  if (state !== 'awaiting_written') return false
  if (clock.receivedOn) return false
  return today > deadlineFor(clock.raisedOn, holidays)
}

/**
 * May the account be collected on while this query is open?
 *
 * Only the written-query window holds collections, and only while it is still running. The firm
 * asked the debtor for something and gave them a date; chasing them for payment in the meantime
 * makes a liar of the letter. Once the date passes, the account goes back to being worked whether
 * or not anybody has closed the query.
 *
 * Interest is NOT affected, and neither are fees for actions actually performed. The hold is on
 * pursuing the debtor, not on the arithmetic of what they owe.
 */
export function collectionsHeld(
  clock: QueryClock,
  state: QueryState,
  today: string,
  holidays: Record<string, string> = {},
): boolean {
  if (state !== 'awaiting_written') return false
  if (clock.receivedOn) return false
  return today <= deadlineFor(clock.raisedOn, holidays)
}

export interface Transition {
  to: QueryState
  label: string
  /** What lands on the account timeline when this is taken. */
  note: string
  /** Roles allowed to take it. Empty means anyone signed in. */
  roles?: string[]
}

/**
 * Only a liaison or a manager may put a query in front of a client. A collections agent writing
 * to a client about a disputed account on their own initiative is the liaison's relationship
 * being spent by somebody who does not hold it.
 */
const LIAISON_ROLES = ['Administrator', 'Sales Manager', 'Liaison Manager', 'Liaison']

/**
 * Where a query can go from where it is.
 *
 * Every state can reach `resolved`, because any rung can answer a query it is holding — that is
 * the whole reason the ladder has rungs. Those are added by {@link transitionsFor} rather than
 * repeated here.
 */
const FORWARD: Record<QueryState, Transition[]> = {
  awaiting_written: [
    { to: 'received', label: 'Written query received', note: 'The debtor sent their query in writing.' },
  ],
  received: [
    { to: 'with_liaison', label: 'Escalate to liaison', note: 'Escalated to the client liaison.' },
  ],
  with_liaison: [
    { to: 'with_client', label: 'Send to client', note: 'Sent to the client.', roles: LIAISON_ROLES },
    { to: 'received', label: 'Send back to the agent', note: 'Returned to the agent.' },
  ],
  with_client: [
    { to: 'with_liaison', label: 'Client answered', note: 'The client has answered.' },
  ],
  resolved: [],
}

const RESOLVE: Transition = { to: 'resolved', label: 'Resolve', note: 'Query closed.' }
/** Reopening exists because a closed query and a debtor who disagrees are not the same thing. */
const REOPEN: Transition = { to: 'received', label: 'Reopen', note: 'Query reopened.' }

export function transitionsFor(state: QueryState): Transition[] {
  if (state === 'resolved') return [REOPEN]
  return [...FORWARD[state], RESOLVE]
}

export function canTake(t: Transition, role: string | undefined): boolean {
  return !t.roles || t.roles.includes(role ?? '')
}
