/**
 * Sending an SMS to somebody who is not a debtor.
 *
 * A lead, a client, a deal's contact. The message goes out the same wire as a debtor's and is
 * recorded in the same table — what differs is that NOBODY IS CHARGED.
 *
 * That is not a style choice. Annexure B item 1(c) lets the firm recover R3.50 a segment from a
 * DEBTOR, because a debtor pays for the work of collecting from them. A lead owes the firm
 * nothing. A client is the person paying the firm. A fee raised against either lands on a
 * statement, flows into a remittance, and a remitted fee is never reversed — so this is a
 * mistake that cannot be taken back, and the guard has to be structural rather than careful.
 *
 * THIS MODULE DELIBERATELY CANNOT REACH THE CHARGE ENGINE. Its only import is the segment
 * counter, which is arithmetic — no accountCharges, no chargeEngine, no accountSms, and not even
 * the database client, because the send goes through the server and the note goes through the
 * store. There is nothing here for a fee to be raised from. The
 * separation is checked rather than trusted: scripts/qa/check-crm-charges.mjs walks what the
 * shared record components import, transitively, and fails if any of it can raise a fee.
 *
 * Compare src/lib/accountSms.ts, which is the debtor's version and DOES charge. The two are kept
 * apart on purpose; a single function with a "chargeable" flag is one wrong argument away from
 * billing a client for a text message.
 */
import { smsCost } from './smsSegments'

/** Which record the message belongs to. Exactly one, which the database also enforces. */
export interface CrmSmsTarget {
  leadId?: string
  dealId?: string
  companyId?: string
  contactId?: string
}

export interface SentCrmSms {
  id: string
  reference: string
  segments: number
  encoding: string
  to: string
}

/**
 * Hand the message to the server, which holds the provider token.
 *
 * Nothing in the browser ever sees the Connect Mobile credentials — the same rule the debtor's
 * route follows, and the reason both go through /api rather than talking to the provider directly.
 */
export async function sendCrmSms(input: {
  accessToken: string
  to: string
  text: string
  target: CrmSmsTarget
}): Promise<SentCrmSms> {
  const res = await fetch('/api/sms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.accessToken}` },
    body: JSON.stringify({ to: input.to, text: input.text, ...input.target }),
  })
  const body = (await res.json().catch(() => ({}))) as Partial<SentCrmSms> & {
    error?: string; ok?: boolean; chargeable?: boolean
  }
  if (!res.ok || !body.ok) throw new Error(body.error ?? 'The message could not be sent.')

  /*
   * A last line of defence, and it should never fire.
   *
   * If the server says this message was chargeable then it was addressed to a debtor's account,
   * which means the target was wrong on the way out. The message has already gone, so this
   * cannot undo anything — it makes the mistake loud instead of letting it pass as a success
   * and turn into a fee on somebody's statement.
   */
  if (body.chargeable) {
    console.error('[crmSms] a CRM message came back marked chargeable — check the target', input.target)
  }

  return {
    id: body.id ?? '',
    reference: body.reference ?? '',
    segments: body.segments ?? smsCost(input.text).segments,
    encoding: body.encoding ?? 'GSM-7',
    to: body.to ?? input.to,
  }
}

/**
 * What to write on the record's timeline.
 *
 * Returned rather than written, because the Activity goes through the store's own addActivity —
 * which owns the optimistic update and the rollback. Two ways to write an activity is two ways
 * for them to disagree.
 */
export function crmSmsActivity(input: {
  to: string
  text: string
  sent: SentCrmSms
  who: string
}): { subject: string; notes: string } {
  const segments = input.sent.segments === 1 ? '1 segment' : `${input.sent.segments} segments`
  return {
    subject: `SMS to ${input.who}`,
    // The number and the size on the record, because "did that go?" and "why two segments?" are
    // both asked later, and neither is answerable from the message text alone.
    notes: `${input.text}\n\n— sent to ${input.to} · ${segments}`,
  }
}
