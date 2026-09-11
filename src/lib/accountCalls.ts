/**
 * Calls to a debtor, on the account's own timeline.
 *
 * PhoneLink already logs a CRM Activity when a rep dials a lead or a contact. A debtor account
 * is not one of those -- its history is account_notes, and its fees are Annexure B -- so the
 * account page writes its own record rather than teaching PhoneLink about a second world.
 *
 * The fee rules live in callRules.ts, which touches no database.
 */
import { chargeItem, type ChargeResult } from './accountCharges.ts'
import { addNote } from './accountWorkspace.ts'
import {
  consultationNote, dialledNote, noAnswerNote, CONSULTATION_DESCRIPTION, CONSULTATION_ITEM_ID,
} from './callRules.ts'

export * from './callRules.ts'

interface Actor {
  id: string | null
  name: string | null
}

/**
 * A call was placed.
 *
 * Written the moment BuzzBox accepts the dial, and charged for nothing. Placing a call is not
 * yet work done to the debtor: the phone may ring out. What it IS is a fact about what the
 * collector did, and a fact the account was previously losing entirely -- the firm's complaint
 * was that dialling left no trace at all.
 */
export async function recordDial(input: {
  accountId: string
  number: string
  extension: string | null
  actor: Actor
}): Promise<void> {
  await addNote({
    accountId: input.accountId,
    body: dialledNote(input.number, input.extension),
    // Raptor's words, not a person's: hidden when the timeline is set to show only
    // what people wrote. See TimelineEntry.automated.
    source: 'system',
    authorName: input.actor.name,
    createdBy: input.actor.id,
  })
}

/**
 * The debtor answered and the call ran: a consultation, Annexure B item 7.
 *
 * Confirmed by the person who made the call rather than detected. BuzzBox can call us back about
 * a call -- `CallSetup.webhookUrl` -- but its payload is undocumented, so there is nothing yet to
 * read "answered" out of. Asking is honest; guessing at a fee is not. See
 * docs/buzzbox-integration.md for what capturing a real payload would take.
 */
export async function recordConsultation(input: {
  accountId: string
  number: string
  /** What was said, if the collector typed anything. Their words, so their note. */
  comment?: string
  actor: Actor
}): Promise<ChargeResult> {
  const charge = await chargeItem({
    accountId: input.accountId,
    itemId: CONSULTATION_ITEM_ID,
    actionCode: 'consultation',
    description: CONSULTATION_DESCRIPTION,
    createdBy: input.actor.id,
  })
  /*
   * One note or two, and the difference is who wrote it.
   *
   * The firm's rule: "a phone call can be hidden, except if there's a comment for the phone call,
   * then that can show." So the machine's record of the call is always written and always marked
   * automatic, and anything the collector typed goes in beside it as their own note -- which
   * survives "just what people wrote", because they wrote it.
   */
  await addNote({
    accountId: input.accountId,
    body: consultationNote(input.number, charge),
    // Raptor's words, not a person's: hidden when the timeline is set to show only
    // what people wrote. See TimelineEntry.automated.
    source: 'system',
    authorName: input.actor.name,
    createdBy: input.actor.id,
  })
  await addComment(input.accountId, input.comment, input.actor)
  return charge
}

/** The collector's own words about a call, written only if there are any. */
async function addComment(accountId: string, comment: string | undefined, actor: Actor): Promise<void> {
  const body = comment?.trim()
  if (!body) return
  await addNote({ accountId, body, authorName: actor.name, createdBy: actor.id })
}

/** Nobody picked up. Recorded, never charged. */
export async function recordNoAnswer(input: {
  accountId: string
  number: string
  /** Rare but real: "rang out, someone else picked up and said he moved". */
  comment?: string
  actor: Actor
}): Promise<void> {
  await addNote({
    accountId: input.accountId,
    body: noAnswerNote(input.number),
    // Raptor's words, not a person's: hidden when the timeline is set to show only
    // what people wrote. See TimelineEntry.automated.
    source: 'system',
    authorName: input.actor.name,
    createdBy: input.actor.id,
  })
  await addComment(input.accountId, input.comment, input.actor)
}
