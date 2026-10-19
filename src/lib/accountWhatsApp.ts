/**
 * A WHATSAPP OPENED TO A DEBTOR, RECORDED (S9, 19 Oct).
 *
 * WhatsApp is opened by a link (lib/whatsapp.ts), so the conversation itself never reaches Raptor.
 * What does is what the person says on the way back: how many messages went (the firm, 19 Oct: "it
 * should ask you how many messages were sent. And that should also be ... correspondence"). A note
 * on the timeline, so the next person knows the debtor was written to and on which number, and the
 * charge for each message.
 *
 * ITEM 1(c), LIKE AN SMS: "necessary electronic communication, other than facsimile or e-mail", R3.50
 * each, which is where WhatsApp falls in the gazette's wording -- 1(a)'s R25 is a letter, fax or
 * e-mail. One per message sent, as the firm said: "it's a small price to pay". A count of nought is
 * noted and charges nothing; a charge raised in error is reversed the way any other is ("if somebody
 * queries it, we'll just remove it").
 *
 * A LETTER SENT BY WHATSAPP IS ALSO A LETTER (the firm, 19 Oct: "if we've sent, for example, an
 * acknowledgement of debt or a document to WhatsApp, that's also a letter ... It's a WhatsApp, but
 * it's a letter ... So it should charge them for that as well"). The PDF is the same document the
 * email would have carried, and the email carries item 1(a); so the letter is charged R25 under 1(a)
 * as a letter, ONCE, on top of the messages under 1(c). Only once something went: a letter chosen and
 * then not sent (a count of nought) charges nothing.
 *
 * THE CHARGE IS NOT IN THE NOTE: the firm asked that charges stay off the timeline ("still showing
 * the charges on the notes is not necessary").
 */
import { addNote } from './accountWorkspace'
import { chargeItem, type ChargeResult } from './accountCharges'
import { whatsAppNote } from './whatsapp'

export const WHATSAPP_ITEM = '1c'
/* The action code Swordfish already used for this, so imported history and new presses read alike. */
export const WHATSAPP_ACTION_CODE = 'whatsapp'
/* The letter itself: item 1(a) and the catalogue's own 'letter', as a posted or emailed one. */
export const WHATSAPP_LETTER_ITEM = '1a'
export const WHATSAPP_LETTER_ACTION_CODE = 'letter'

export async function recordWhatsApp(input: {
  accountId: string
  number: string
  /** Messages sent, as the person said. Nought is noted and not charged. */
  count: number
  /** The letter sent with it, where one was (S9: "send a section 129 via WhatsApp"). */
  about?: string | null
  actor: { id: string | null; name: string | null }
}): Promise<(ChargeResult | null)[]> {
  const charge = input.count > 0 ? await chargeItem({
    accountId: input.accountId,
    itemId: WHATSAPP_ITEM,
    actionCode: WHATSAPP_ACTION_CODE,
    description: 'WhatsApp',
    quantity: input.count,
    createdBy: input.actor.id,
  }) : null
  const letter = input.about && input.count > 0 ? await chargeItem({
    accountId: input.accountId,
    itemId: WHATSAPP_LETTER_ITEM,
    actionCode: WHATSAPP_LETTER_ACTION_CODE,
    description: `Letter by WhatsApp: ${input.about}`,
    quantity: 1,
    createdBy: input.actor.id,
  }) : null
  await addNote({
    accountId: input.accountId,
    body: input.about && input.count > 0 ? `${whatsAppNote(input.number, input.count)} · ${input.about}` : whatsAppNote(input.number, input.count),
    authorName: input.actor.name,
    createdBy: input.actor.id,
    source: 'system',
  })
  return [charge, letter]
}
