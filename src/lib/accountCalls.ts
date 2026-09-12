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
import { supabase } from './supabase'
import {
  consultationNote, dialledNote, noAnswerNote,
  ATTEMPT_DESCRIPTION, ATTEMPT_ITEM_ID, CONSULTATION_DESCRIPTION, CONSULTATION_ITEM_ID,
} from './callRules.ts'

export * from './callRules.ts'

interface Actor {
  id: string | null
  name: string | null
}

/**
 * A call was placed: Annexure B item 2, the telephone call.
 *
 * Charged on the dial, answered or not -- the firm's rule: "if we make an outgoing call, it's
 * charged, even if the person answers or not." An answered call then also charges item 7 when
 * BuzzBox reports it, so a conversation costs the debtor both.
 *
 * Worth recording that this was their decision rather than a reading of the tariff. Item 2 is
 * gazetted as the "necessary phone call, WHICH IS NOT a consultation", so on the face of it an
 * answered call carries item 7 instead of item 2, not as well as. The firm was told that and
 * chose both; if the charge is ever queried, this comment is the reason it looks the way it does.
 *
 * The row in account_calls is what lets the webhook find its way back to this account: BuzzBox's
 * events carry an extension and a number and nothing of ours, so the dial has to leave a marker
 * for them to match against.
 */
export async function recordDial(input: {
  accountId: string
  number: string
  extension: string | null
  actor: Actor
}): Promise<{ charge: ChargeResult; callId: string | null }> {
  const charge = await chargeItem({
    accountId: input.accountId,
    itemId: ATTEMPT_ITEM_ID,
    actionCode: 'phone_call',
    description: ATTEMPT_DESCRIPTION,
    createdBy: input.actor.id,
  })

  /*
   * Recorded, never allowed to fail the call.
   *
   * If this insert fails the collector has still made the call and the fee has still been raised;
   * losing the marker only means the consultation has to be confirmed by hand. Throwing here
   * would turn a missing convenience into a red error over a call that went fine.
   */
  let callId: string | null = null
  const { data, error } = await supabase.from('account_calls').insert({
    account_id: input.accountId,
    placed_by: input.actor.id,
    placed_by_name: input.actor.name,
    extension: input.extension,
    number: input.number,
  }).select('id').maybeSingle<{ id: string }>()
  if (!error) callId = data?.id ?? null

  await addNote({
    accountId: input.accountId,
    body: dialledNote(input.number, input.extension, charge),
    // Raptor's words, not a person's: hidden when the timeline is set to show only
    // what people wrote. See TimelineEntry.automated.
    source: 'system',
    authorName: input.actor.name,
    createdBy: input.actor.id,
  })
  return { charge, callId }
}

/**
 * Has BuzzBox reported this call answered yet?
 *
 * The browser asks after dialling so it can say "consultation charged" without the collector
 * having to tell it anything. Returns null while nothing is known, which is the ordinary state
 * for the first few seconds and the permanent state for a call placed through the tel: fallback.
 */
export async function callOutcome(callId: string): Promise<{
  answeredAt: string | null
  endedAt: string | null
  hangupCause: string | null
} | null> {
  const { data, error } = await supabase
    .from('account_calls')
    .select('answered_at, ended_at, hangup_cause')
    .eq('id', callId)
    .maybeSingle<{ answered_at: string | null; ended_at: string | null; hangup_cause: string | null }>()
  if (error || !data) return null
  return { answeredAt: data.answered_at, endedAt: data.ended_at, hangupCause: data.hangup_cause }
}

/**
 * The debtor answered and the call ran: a consultation, Annexure B item 7.
 *
 * Confirmed by the person who made the call, and it has to be. BuzzBox reports that the line
 * connected, which is not the same fact: a voicemail system answers exactly like a debtor does,
 * and billing a consultation for a message left on an answering machine is not defensible.
 * Whether there was a conversation is knowable only to whoever listened.
 *
 * The comment is REQUIRED here, at the firm's request -- "many of the debtor answers you need to
 * fill it out, so make that obligatory". A consultation charged with nothing written about it is
 * a R60 fee with no evidence behind it, which is the one kind nobody can defend later.
 */
export async function recordConsultation(input: {
  accountId: string
  number: string
  /** What was said. Not optional: a consultation with no record of it is indefensible. */
  comment: string
  /** The account_calls row, where there is one, so the fee is claimed exactly once. */
  callId?: string | null
  actor: Actor
}): Promise<ChargeResult> {
  const said = input.comment?.trim()
  if (!said) throw new Error('Write what was said before charging a consultation.')

  /*
   * Claim the call before charging it.
   *
   * Only where we have a row to claim -- a tel: call has none. The claim is the same conditional
   * update the webhook used to do: it only matches while the stamp is null, so a double-click or
   * a retried request cannot raise two R60 fees for one conversation.
   */
  if (input.callId) {
    const { data: claimed } = await supabase.from('account_calls')
      .update({ consultation_charged_at: new Date().toISOString() })
      .eq('id', input.callId)
      .is('consultation_charged_at', null)
      .select('id')
      .maybeSingle<{ id: string }>()
    if (!claimed) throw new Error('This call has already been charged a consultation.')
  }

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
  await addComment(input.accountId, said, input.actor)
  return charge
}

/**
 * The collector's own words about a call, written only if there are any.
 *
 * `kind: 'call'` is the whole point of it being its own note. Without it the timeline showed a
 * collector's account of a phone call as a plain yellow sticky beside every other note, and the
 * firm said so: "it says that it's a note that's made from note, not from a telephone call".
 * The kind gives it the phone icon and the call's colour, so the history reads as what happened.
 */
async function addComment(accountId: string, comment: string | undefined, actor: Actor): Promise<void> {
  const body = comment?.trim()
  if (!body) return
  await addNote({ accountId, body, kind: 'call', authorName: actor.name, createdBy: actor.id })
}

/**
 * Nobody picked up.
 *
 * Charges nothing: the dial already raised item 2, and a call that rang out earns that and
 * nothing more. This only closes the record and carries whatever the collector wrote.
 */
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
