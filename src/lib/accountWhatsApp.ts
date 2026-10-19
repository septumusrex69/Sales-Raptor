/**
 * A WHATSAPP OPENED TO A DEBTOR, RECORDED (S9, 19 Oct).
 *
 * WhatsApp is opened by a link (lib/whatsapp.ts), so the conversation itself never reaches Raptor.
 * What does is what the person says on the way back: how many messages went (the firm, 19 Oct: "it
 * should ask you how many messages were sent. And that should also be ... correspondence"). A note
 * on the timeline, so the next person knows the debtor was written to and on which number, and the
 * charge for each message.
 *
 * EACH MESSAGE IS CORRESPONDENCE, ITEM 1(a), R25 -- not 1(c)'s R3.50. The first version charged
 * WhatsApp like an SMS, as the gazette's "electronic communication, other than facsimile or e-mail"
 * reads; the firm, 19 Oct: "don't charge R3.50 for WhatsApp messages ... charge it as WhatsApp
 * correspondence ... and charge the correspondence fee for this." One per message sent, under the
 * catalogue's own 'whatsapp' ("WhatsApp Correspondence"), so imported history and new presses read
 * alike. A count of nought is noted and charges nothing; a charge raised in error is reversed the way
 * any other is ("if somebody queries it, we'll just remove it").
 *
 * A LETTER SENT BY WHATSAPP IS CORRESPONDENCE TOO, and is not charged twice: the PDF goes in one of
 * the messages counted, so it is in that count at R25, and the charge names it ("WhatsApp
 * correspondence: Final notice"). A message and a letter in one press is not R50.
 *
 * AN ACKNOWLEDGEMENT OF DEBT ALSO RAISES ITEM 4(a) (the firm, 19 Oct: "you can charge 4A for the AOD
 * too"), banded on the balance exactly as SigningPanel's is (chargeAcknowledgementOfDebt). Raised
 * every time, as the firm said of 4(a) before: "Just charge everything ... if somebody queries it,
 * we'll just remove it" -- so an AOD issued for signing and then also WhatsApped is charged twice and
 * left for a person to reverse.
 *
 * THE CHARGE IS NOT IN THE NOTE: the firm asked that charges stay off the timeline ("still showing
 * the charges on the notes is not necessary").
 */
import { addNote } from './accountWorkspace'
import { chargeAcknowledgementOfDebt, chargeItem, type ChargeResult } from './accountCharges'
import { whatsAppNote } from './whatsapp'
import { letterKindOf } from './whatsappLetters'

export const WHATSAPP_ITEM = '1a'
/* The action code Swordfish already used for this, so imported history and new presses read alike. */
export const WHATSAPP_ACTION_CODE = 'whatsapp'
export async function recordWhatsApp(input: {
  accountId: string
  number: string
  /** Messages sent, as the person said. Nought is noted and not charged. */
  count: number
  /** The letter sent with it, where one was (S9: "send a section 129 via WhatsApp"). */
  letter?: { name: string; seedKey: string | null } | null
  /** The balance, for item 4(a)'s band when the letter is an acknowledgement of debt. */
  claimAmount?: number | null
  actor: { id: string | null; name: string | null }
}): Promise<(ChargeResult | null)[]> {
  const about = input.letter?.name ?? null
  const charge = input.count > 0 ? await chargeItem({
    accountId: input.accountId,
    itemId: WHATSAPP_ITEM,
    actionCode: WHATSAPP_ACTION_CODE,
    description: about ? `WhatsApp correspondence: ${about}` : 'WhatsApp correspondence',
    quantity: input.count,
    createdBy: input.actor.id,
  }) : null
  const aod = input.count > 0 && letterKindOf(input.letter?.seedKey) === 'aod' && input.claimAmount != null
    ? await chargeAcknowledgementOfDebt({ accountId: input.accountId, claimAmount: input.claimAmount, createdBy: input.actor.id })
    : null
  await addNote({
    accountId: input.accountId,
    body: about && input.count > 0 ? `${whatsAppNote(input.number, input.count)} · ${about}` : whatsAppNote(input.number, input.count),
    authorName: input.actor.name,
    createdBy: input.actor.id,
    source: 'system',
  })
  return [charge, aod]
}
