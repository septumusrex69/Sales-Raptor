/**
 * A WHATSAPP OPENED TO A DEBTOR, RECORDED (S9, 19 Oct).
 *
 * WhatsApp is opened by a link (lib/whatsapp.ts), so the conversation itself never reaches Raptor.
 * What does is the press: a note on the account's timeline, so the next person knows the debtor was
 * written to and on which number, and the charge.
 *
 * ITEM 1(c), LIKE AN SMS: "necessary electronic communication, other than facsimile or e-mail", R3.50
 * each. CHARGED ON THE PRESS, which is the firm's decision (19 Oct): "just charge everything ... if
 * somebody queries it, we'll just remove it." Raptor cannot know whether the message was sent after
 * WhatsApp opened, so the alternative was charging nothing; a charge raised in error is reversed the
 * way any other is.
 *
 * THE CHARGE IS NOT IN THE NOTE: the firm asked that charges stay off the timeline ("still showing
 * the charges on the notes is not necessary").
 */
import { addNote } from './accountWorkspace'
import { chargeItem, type ChargeResult } from './accountCharges'

export const WHATSAPP_ITEM = '1c'
/* The action code Swordfish already used for this, so imported history and new presses read alike. */
export const WHATSAPP_ACTION_CODE = 'whatsapp'

export async function recordWhatsApp(input: {
  accountId: string
  number: string
  actor: { id: string | null; name: string | null }
}): Promise<ChargeResult | null> {
  const charge = await chargeItem({
    accountId: input.accountId,
    itemId: WHATSAPP_ITEM,
    actionCode: WHATSAPP_ACTION_CODE,
    description: 'WhatsApp',
    createdBy: input.actor.id,
  })
  await addNote({
    accountId: input.accountId,
    body: `WhatsApp to ${input.number}`,
    authorName: input.actor.name,
    createdBy: input.actor.id,
    source: 'system',
  })
  return charge
}
