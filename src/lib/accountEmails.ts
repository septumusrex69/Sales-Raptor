/**
 * Correspondence with a debtor, on the account it belongs to.
 *
 * Sending goes out through the agent's own connected mailbox — the same /api/email/send the CRM
 * uses — and then the message is recorded here, charged, and put on the timeline.
 *
 * The reply finds its way back on its own. api/_lib/emailSync.ts reads the agent's inbox, and a
 * reply carries In-Reply-To naming the Message-ID we recorded on the way out, so it can be filed
 * against this exact account. That is why `messageId` is captured on send and why losing it
 * matters more than it looks: without it a reply can only be matched on the debtor's address,
 * and a debtor who writes from their work address instead is then a stranger.
 *
 * The fee rules live in emailRules.ts, which touches no database.
 */
import { chargeItem, type ChargeResult } from './accountCharges'
import { addNote } from './accountWorkspace'
import { supabase } from './supabase'
import {
  EMAIL_ACTION_CODE, EMAIL_DESCRIPTION, EMAIL_IN_KIND, EMAIL_ITEM_ID, EMAIL_OUT_KIND,
  receivedEmailNote, sentEmailNote,
} from './emailRules'

export * from './emailRules'

interface Actor {
  id: string | null
  name: string | null
}

export interface AccountEmail {
  id: string
  direction: 'out' | 'in'
  debtorAddress: string
  ourAddress: string | null
  subject: string | null
  body: string | null
  messageId: string | null
  inReplyTo: string | null
  attachmentNames: string[]
  sentByName: string | null
  /** Excluding VAT. Null where nothing was charged at all — every inbound message. */
  chargedExclVat: number | null
  occurredAt: string
}

interface EmailRow {
  id: string
  direction: 'out' | 'in'
  debtor_address: string
  our_address: string | null
  subject: string | null
  body: string | null
  message_id: string | null
  in_reply_to: string | null
  attachment_names: string[] | null
  sent_by_name: string | null
  charged_excl_vat: number | string | null
  occurred_at: string
}

function toEmail(r: EmailRow): AccountEmail {
  return {
    id: r.id,
    direction: r.direction,
    debtorAddress: r.debtor_address,
    ourAddress: r.our_address,
    subject: r.subject,
    body: r.body,
    messageId: r.message_id,
    inReplyTo: r.in_reply_to,
    attachmentNames: r.attachment_names ?? [],
    sentByName: r.sent_by_name,
    // Postgres numerics arrive as strings through PostgREST. Null stays null: it means no fee
    // was ever due, which the list shows differently from a fee that came out at zero.
    chargedExclVat: r.charged_excl_vat === null ? null : Number(r.charged_excl_vat),
    occurredAt: r.occurred_at,
  }
}

/** Every message either way on this account, newest first. */
export async function fetchAccountEmails(accountId: string): Promise<AccountEmail[]> {
  const { data, error } = await supabase
    .from('account_emails')
    .select('id, direction, debtor_address, our_address, subject, body, message_id, in_reply_to, attachment_names, sent_by_name, charged_excl_vat, occurred_at')
    .eq('account_id', accountId)
    .order('occurred_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as EmailRow[]).map(toEmail)
}

/**
 * A message has gone: charge it, record it, and put it on the timeline.
 *
 * Called AFTER the send succeeded, for the same reason an SMS is: a fee for a message that never
 * left is a charge the firm cannot justify, while a message with no fee is only a bookkeeping
 * gap. The order inside matters less, but the charge comes first so the note can say what it
 * came to.
 */
export async function recordSentEmail(input: {
  accountId: string
  to: string
  /** The mailbox it went from, so we know where the reply will land. */
  from: string | null
  subject: string
  body: string
  /** The sent message's own Message-ID. Without it the reply cannot be threaded back. */
  messageId: string | null
  /** Set when this was a reply, naming the message it answers. */
  inReplyTo?: string | null
  actor: Actor
}): Promise<ChargeResult> {
  const charge = await chargeItem({
    accountId: input.accountId,
    itemId: EMAIL_ITEM_ID,
    actionCode: EMAIL_ACTION_CODE,
    description: EMAIL_DESCRIPTION,
    createdBy: input.actor.id,
  })

  /*
   * Recorded, never allowed to fail the send.
   *
   * The message has already gone and the fee has already been raised. Throwing here would put a
   * red error on a screen after a debtor has, in fact, been emailed — and the note below is
   * written either way, so the account still shows what was said.
   */
  const { error } = await supabase.from('account_emails').insert({
    account_id: input.accountId,
    direction: 'out',
    debtor_address: input.to,
    our_address: input.from,
    subject: input.subject,
    body: input.body,
    message_id: input.messageId,
    in_reply_to: input.inReplyTo ?? null,
    sent_by: input.actor.id,
    sent_by_name: input.actor.name,
    charged_excl_vat: charge.exclVat,
  })
  if (error) console.error('[accountEmails] the message went but was not filed:', error.message)

  await addNote({
    accountId: input.accountId,
    body: sentEmailNote(input.to, input.subject, input.body, charge),
    kind: EMAIL_OUT_KIND,
    /*
     * A person's note, not Raptor's.
     *
     * The timeline can be set to show only what people wrote, and the words of an email are
     * exactly that — an agent composed them. Marking correspondence 'system' would file a demand
     * letter alongside "Trace done — 4 credit bureau searches" and hide it from the view a
     * collector uses to read what was actually said.
     */
    authorName: input.actor.name,
    createdBy: input.actor.id,
  })
  return charge
}

/**
 * The debtor wrote back.
 *
 * Exported for the sake of one caller that does not exist in the browser: the inbound sync runs
 * on the server with the service key and files its own rows (see api/_lib/emailSync.ts). This is
 * here so the two halves of the record are described in one file, and so the note wording cannot
 * drift between what we send and what we receive.
 *
 * Charges nothing. See EMAIL_ITEM_ID for why that is the tariff's shape and not an oversight.
 */
export function receivedNoteBody(from: string, subject: string, body: string): string {
  return receivedEmailNote(from, subject, body)
}

export { EMAIL_IN_KIND }
