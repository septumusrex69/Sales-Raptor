/**
 * ONE CONVERSATION ON A TICKET, IN THE ORDER IT HAPPENED, WITH EACH VOICE NAMED.
 *
 * THE FIRM, showing a design of what a dispute ticket should look like: a single timeline carrying
 * the internal note, the client's email and the debtor's own words one under the other, each
 * labelled with who said it.
 *
 * ------------------------------------------------------------------------------------------------
 * IT WAS TWO CARDS AND THEY COULD NOT BE READ TOGETHER
 * ------------------------------------------------------------------------------------------------
 *
 * The notes were in one card and the correspondence in another, so the one question a ticket exists
 * to answer -- what has actually passed between the three parties, and in what order -- could only
 * be answered by reading two lists side by side and merging them in your head. On the firm's own
 * example that is a debtor saying they paid at 09:15, a client asking about it at 10:02 and a
 * liaison writing up the account at 11:24: one exchange, told in three places by three people, and
 * drawn as two unrelated boxes.
 *
 * ------------------------------------------------------------------------------------------------
 * THE VOICE IS DERIVED, NEVER STORED
 * ------------------------------------------------------------------------------------------------
 *
 * A ticket's emails are `account_emails` rows, and that table has one address column -- the OTHER
 * party's, whichever end of the exchange they were on. So "is this the client or the debtor" is
 * answered by looking at the address against the client's own people, which the ticket page already
 * holds because it needs them to compose. Storing a voice column would be a third place for the
 * same fact to live and the one that goes stale when somebody corrects an address.
 *
 * WHERE IT CANNOT TELL, IT SAYS THE NEUTRAL THING. An outbound message to an address matching
 * nobody known is "Sent" rather than guessed into one camp: a ticket is read six months later by
 * somebody deciding whether a client was told, and a confident wrong label is worse there than an
 * honest vague one.
 *
 * PURE: no database, no clock, no network.
 */

/** Who is speaking. The chip on the row, and the only thing that decides its colour. */
export type ThreadVoice =
  /** Somebody in the firm wrote it down for the next person. Never leaves the building. */
  | 'internal'
  /** Somebody in the firm rang somebody. Internal in the same sense, and its own kind of work. */
  | 'call'
  /** Raptor's own words -- a stage change, an outcome, a workflow event. */
  | 'system'
  /** The debtor, in their own words. */
  | 'debtor'
  /** The client. */
  | 'client'
  /** We wrote, and the address matches nobody the page knows. */
  | 'sent'

export const VOICE_LABEL: Record<ThreadVoice, string> = {
  internal: 'Internal',
  call: 'Call',
  system: 'Raptor',
  debtor: 'Debtor',
  client: 'Client',
  sent: 'Sent',
}

export interface ThreadEntry {
  /** Unique across both sources, so a key is never a note id colliding with an email id. */
  key: string
  at: string
  voice: ThreadVoice
  /** Whose words these are, for the line beside the chip. */
  who: string
  body: string
  /** On an email only. */
  subject?: string | null
  attachmentNames?: string[]
  /** Set on an email, so the row can offer to forward the real thing. */
  emailId?: string
  /** On an email: it came IN, so it can be answered (S14) -- a message we sent is forwarded, not replied to. */
  inbound?: boolean
}

/** What the thread needs of a note. An AccountNote satisfies it. */
export interface ThreadNote {
  id: string
  body: string
  authorName: string | null
  createdAt: string
  /** 'note', 'call', 'query'. */
  kind: string
  /** 'manual', 'system', 'swordfish'. */
  source: string
}

/** What the thread needs of an email. An AccountEmail satisfies it. */
export interface ThreadEmail {
  id: string
  direction: 'out' | 'in'
  /** The OTHER party's address, whichever end they were on. See the header. */
  debtorAddress: string
  subject: string | null
  body: string | null
  attachmentNames: string[]
  sentByName: string | null
  occurredAt: string
  /**
   * THE DATABASE'S OWN ANSWER, where the row carries it (account_email_correspondent). It knows what
   * this page cannot: that an address is a CLIENT PORTAL login (S15). Stephan's first portal question
   * was drawn "DEBTOR" -- the portal user's address is on no contact or company row, so the address
   * test below fell through to "inbound is the debtor's side".
   */
  correspondent?: 'debtor' | 'client'
}

const sameAddress = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

/**
 * WHICH VOICE A NOTE IS.
 *
 * `source` DECIDES BEFORE `kind` DOES, and that order matters: the account timeline's own "hide
 * automatic entries" reads `source` for exactly this reason -- a collector who happens to write
 * like the app still counts as a person, and Raptor's own entries still count as Raptor's however
 * they are filed.
 */
export function noteVoice(note: ThreadNote): ThreadVoice {
  if (note.source === 'system') return 'system'
  if (note.kind === 'call') return 'call'
  return 'internal'
}

/**
 * WHICH VOICE AN EMAIL IS.
 *
 * INBOUND IS WHOEVER SENT IT, and the address is the only thing that says which. A client chasing a
 * reconciliation and a debtor disputing the debt arrive through the same column.
 *
 * OUTBOUND IS WHO IT WENT TO, for the same reason and read the same way -- a liaison's email to the
 * client and a collector's to the debtor are both `out`, and labelling them alike would put "we
 * wrote to them" on a ticket where the question is WHICH them.
 */
export function emailVoice(email: ThreadEmail, clientAddresses: readonly string[]): ThreadVoice {
  if (email.correspondent === 'client') return 'client'
  if (clientAddresses.some((a) => sameAddress(a, email.debtorAddress))) return 'client'
  /*
   * ANYTHING ELSE ON AN ACCOUNT'S CORRESPONDENCE IS THE DEBTOR'S SIDE, and that is the table's own
   * contract rather than a guess: `account_emails.debtor_address` is "the debtor's address,
   * whichever end of the exchange it was on". The client list is the exception to it, because a
   * liaison writing to the client from a ticket files through the same table.
   *
   * INBOUND IS ALWAYS THE DEBTOR'S SIDE for the same reason -- it arrived on this account's
   * correspondence, which is what that table is -- so an unknown sender is still the debtor's end
   * of the exchange rather than an unlabelled row.
   */
  if (email.direction === 'in') return 'debtor'
  /*
   * AND THE ONE CASE WHERE IT HONESTLY CANNOT TELL: an outbound message on a ticket where NO client
   * address is known at all. Then "not the client" means nothing, because nothing is the client --
   * and labelling a liaison's email to a client as the debtor's would be a confident wrong label on
   * a ticket somebody reads six months later to decide whether the client was told. Found by this
   * file's own check, which expected an outbound to the debtor to say so and got the neutral word.
   */
  if (clientAddresses.length === 0) return 'sent'
  return 'debtor'
}

/**
 * EVERYTHING SAID ON THIS TICKET, NEWEST FIRST.
 *
 * NEWEST FIRST because a ticket is opened to find out where it has got to, and the answer is at
 * the bottom of a chronological list -- which on a ticket three weeks old is a scroll. The firm's
 * own design reads down from the most recent.
 *
 * TIES BROKEN ON THE KEY so the order is stable. Two entries sharing a timestamp to the second is
 * rare and a list that reshuffles itself between renders is the kind of thing nobody reports and
 * everybody distrusts.
 */
export function ticketThread(input: {
  notes: readonly ThreadNote[]
  emails: readonly ThreadEmail[]
  /** Every address known to belong to the client on this ticket. */
  clientAddresses?: readonly string[]
}): ThreadEntry[] {
  const addresses = input.clientAddresses ?? []
  const entries: ThreadEntry[] = [
    ...input.notes.map((n): ThreadEntry => ({
      key: `note:${n.id}`,
      at: n.createdAt,
      voice: noteVoice(n),
      /* RAPTOR'S OWN ENTRIES ARE NOT SIGNED BY WHOEVER WAS AT THE DESK. `authorName` is carried on
         a system note so the account's timeline can say who was working; on a ticket thread it
         would read as that person having written the sentence, which they did not. */
      who: n.source === 'system' ? 'Raptor' : (n.authorName ?? 'Somebody at the firm'),
      body: n.body,
    })),
    ...input.emails.map((e): ThreadEntry => {
      const voice = emailVoice(e, addresses)
      return {
        key: `email:${e.id}`,
        at: e.occurredAt,
        voice,
        /* THE NAME WHERE THERE IS ONE AND THE ADDRESS WHERE THERE IS NOT. A bare address is still
           an answer to "who said this"; "Unknown" is not. */
        who: e.sentByName ?? (voice === 'sent' ? 'The firm' : e.debtorAddress),
        body: e.body ?? '',
        subject: e.subject,
        attachmentNames: e.attachmentNames,
        emailId: e.id,
        inbound: e.direction === 'in',
      }
    }),
  ]
  entries.sort((a, b) => {
    if (a.at === b.at) return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
    return a.at < b.at ? 1 : -1
  })
  return entries
}

/**
 * WHAT THE TICKET IS WAITING FOR, IN ONE LINE.
 *
 * THE FIRM'S DESIGN PUTS IT ABOVE THE CONVERSATION -- "Next action: ask client to verify payment"
 * -- and it is the right place for it: somebody opening a ticket at nine in the morning is asking
 * what they are supposed to do, and the answer was spread across a stage chip, a chase date and
 * whichever card they thought to read.
 *
 * COMPOSED FROM THE STAGE, which is the one field that already means this. `stageLine` in
 * disputeCategories holds the same reading for the board; this is the imperative form of it, and
 * both come off the same column so they cannot disagree about a ticket.
 */
export const NEXT_ACTION: Record<string, string> = {
  agent: 'Answer it, or pass it to the liaison.',
  team_leader: 'Answer it, or pass it to the liaison.',
  liaison: 'Answer it, or put it to the client.',
  client: 'Chase the client for an answer.',
}

export function nextAction(input: { stage: string; status: string }): string | null {
  /* A CLOSED TICKET HAS NO NEXT ACTION, and inventing one would put work in front of somebody that
     the firm has already decided is finished. */
  if (input.status === 'closed') return null
  return NEXT_ACTION[input.stage] ?? null
}

/**
 * SENDING A TICKET BACK TO THE CLERK WHO RAISED IT.
 *
 * THE FIRM (R-9, Administration · Settings): when a clerk asks a team leader for help and the team
 * leader has a question or needs clarity, there must be a button that refers it back to the clerk
 * and takes it off the team leader's desk -- "currently the clerk is not notified once there is a
 * question from the team leader ... so he will then not be aware and the query will not be
 * resolved." Tested, then widened: "can we have it on the call centre manager as well as client
 * liaisons as well."
 *
 * WHILE IT IS ON SOMEBODY ELSE'S DESK, and only to somebody who is not the clerk themselves. That is
 * the team leader's stage, the liaison's stage, and -- for the Call Centre Manager, who is not a team
 * leader and so holds a ticket at the `agent` stage (`stageForAssignee`) -- a ticket handed to the
 * actor by name. Reading "mine" off `ownerId` rather than off the role keeps the rule to what is true
 * of the ticket: whoever it was handed to may hand it back. The `client` stage is not anybody's desk.
 * Back is the `agent` stage with the raiser as owner -- the same two fields a hand-over writes, so
 * the board, the badge and the bell need nothing new to know about it. A closed ticket is finished.
 */
export function canSendBack(
  q: { stage: string; status: string; raisedBy: string | null; ownerId?: string | null },
  actorId: string | null | undefined,
): boolean {
  if (q.status === 'closed' || !q.raisedBy || q.raisedBy === actorId) return false
  if (q.stage === 'team_leader' || q.stage === 'liaison') return true
  return q.stage === 'agent' && !!actorId && q.ownerId === actorId
}

/** The question, as it is filed on the ticket's thread where the clerk will read it. */
export function sendBackNote(toName: string | null, question: string): string {
  return `Sent back to ${toName?.trim() || 'the clerk'}: ${question.trim()}`
}

/**
 * REFERRING A TICKET TO THE AGENT ON THE ACCOUNT (S15). Stephan, on a client's question from the portal:
 * "refer an account to the clerk, to the agent, and give it a referral reason and have it understand the
 * client query. And have them give feedback then."
 *
 * The liaison answers the client; the agent knows the debtor. So from the liaison's desk the ticket can be
 * handed to whoever holds the account, with the reason required -- it is what the agent reads to know what
 * the client wants -- and it comes back with the agent's answer (giveFeedback below). Send Back (R-9)
 * already returns a ticket to the clerk who RAISED it; a client's question was raised by nobody inside the
 * firm, so it needs the agent on the account instead. Offered from the liaison's or team leader's stage, on
 * a ticket about an account (QueryDetail); who to is referTargets below.
 */

/** The referral, as it is filed on the ticket's thread where the agent will read it. */
export function referNote(agentName: string | null, reason: string): string {
  return `Referred to ${agentName?.trim() || 'the agent'}: ${reason.trim()}`
}

/**
 * OR TO THE AGENT'S TEAM LEADER (S15). Stephan, a moment later: "you should also be able to refer it to a
 * team leader." The leader of the agent's own team, at the team_leader stage -- the rung the board already
 * draws. Where the agent has no team (or no leader), every active pre-legal team leader is offered.
 * Never the person referring, never twice.
 */
export function referTargets(input: {
  agentId: string | null
  actorId: string | null | undefined
  users: readonly { id: string; name: string; role?: string; teamId?: string | null; status?: string }[]
}): { id: string; name: string; stage: 'agent' | 'team_leader'; rung: string }[] {
  const agent = input.agentId ? input.users.find((u) => u.id === input.agentId) : undefined
  const leaders = input.users.filter((u) => u.role === 'Pre-legal Team Leader' && u.status !== 'Inactive')
  const own = agent?.teamId ? leaders.filter((u) => u.teamId === agent.teamId) : []
  const out = [
    ...(agent ? [{ id: agent.id, name: agent.name, stage: 'agent' as const, rung: 'Agent on the account' }] : []),
    ...(own.length ? own : leaders).map((u) => ({ id: u.id, name: u.name, stage: 'team_leader' as const,
      rung: own.length ? 'Their team leader' : 'Team leader' })),
  ]
  return out.filter((t, i) => t.id !== input.actorId && out.findIndex((x) => x.id === t.id) === i)
}

/**
 * THE AGENT'S FEEDBACK, AND THE WAY BACK. The agent the ticket was referred to answers and it goes back to
 * the liaison's stage and desk in one press -- an answer that leaves the ticket on the agent's desk is an
 * answer nobody upstairs knows arrived. Only the person holding it, at the agent's or the team leader's
 * stage, with a liaison to return it to.
 */
export function canGiveFeedback(
  q: { stage: string; status: string; ownerId?: string | null },
  actorId: string | null | undefined,
  liaisonId: string | null | undefined,
): boolean {
  if (q.status === 'closed' || !actorId || !liaisonId || liaisonId === actorId) return false
  return (q.stage === 'agent' || q.stage === 'team_leader') && q.ownerId === actorId
}

export function feedbackNote(agentName: string | null, feedback: string): string {
  return `Feedback from ${agentName?.trim() || 'the agent'}: ${feedback.trim()}`
}
