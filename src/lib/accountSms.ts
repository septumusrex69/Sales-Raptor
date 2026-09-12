/**
 * Sending a debtor an SMS from an account.
 *
 * Annexure B item 1(c) — "necessary electronic communication, other than facsimile or e-mail
 * (each)", R3.50 — and "each" is the network's word, not ours: a 200-character message is two
 * communications and is billed as two. That is why the fee carries the segment count.
 *
 * Charged AFTER the send, and only if the send succeeded, for the same reason a trace is: a fee
 * for a message that never left is a charge the firm cannot justify, while a message with no fee
 * is only a bookkeeping gap.
 */
import { addNote } from './accountWorkspace'
import { chargeItem, type ChargeResult } from './accountCharges'
import { smsCost } from './smsSegments'

/** Item 1(c). Named once so the reason for the charge is greppable from the compose box. */
export const SMS_ITEM = '1c'
export const SMS_ACTION_CODE = 'SMS'

export interface SentSms {
  id: string
  reference: string
  segments: number
  encoding: string
  to: string
}

/** Hand the message to the server, which holds the provider token. */
export async function sendAccountSms(input: {
  accessToken: string
  accountId: string
  to: string
  text: string
}): Promise<SentSms> {
  const res = await fetch('/api/sms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.accessToken}` },
    body: JSON.stringify({ accountId: input.accountId, to: input.to, text: input.text }),
  })
  const body = (await res.json().catch(() => ({}))) as Partial<SentSms> & { error?: string; ok?: boolean }
  if (!res.ok || !body.ok) throw new Error(body.error ?? 'The message could not be sent.')
  return {
    id: body.id ?? '',
    reference: body.reference ?? '',
    segments: body.segments ?? smsCost(input.text).segments,
    encoding: body.encoding ?? 'GSM-7',
    to: body.to ?? input.to,
  }
}

/** Charge for a message that has already gone, and write it on the timeline. */
export async function recordSentSms(input: {
  accountId: string
  sent: SentSms
  text: string
  actor: { id: string | null; name: string | null }
}): Promise<ChargeResult> {
  const charge = await chargeItem({
    accountId: input.accountId,
    itemId: SMS_ITEM,
    actionCode: SMS_ACTION_CODE,
    description: 'SMS',
    quantity: input.sent.segments,
    createdBy: input.actor.id,
  })
  await addNote({
    accountId: input.accountId,
    body: smsNote(input.sent, input.text),
    // Raptor's words, not a person's: hidden when the timeline is set to show only
    // what people wrote. See TimelineEntry.automated.
    source: 'system',
    authorName: input.actor.name,
    createdBy: input.actor.id,
  })
  return charge
}

/**
 * What the timeline says. The message itself, because that is the part anyone will want to read.
 *
 * Just the message. The fee, the segment count and all — it is on the transaction list, and on
 * this timeline as its own entry. The firm's instruction: "don't have to say about the charges
 * in the notes."
 */
export function smsNote(sent: SentSms, text: string): string {
  return `SMS to ${sent.to}: ${text}`
}
