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
import { chargeItem, chargeMessage, type ChargeResult } from './accountCharges'
import { addNote } from './accountWorkspace'
import { supabase } from './supabase'
import { mirrorReadToMailbox } from './mailReadState'
import {
  EMAIL_ACTION_CODE, EMAIL_OUT_KIND, sentEmailItems, sentEmailNote,
} from './emailRules'

export * from './emailRules'

interface Actor {
  id: string | null
  name: string | null
}

/**
 * What one message we sent cost the debtor, item by item.
 *
 * Both are kept rather than only the total, because they are capped independently: an account
 * with room for the letter but not the correspondence charges R25 and records the R13 unbilled,
 * and the agent should be told which of the two happened rather than shown a number that is
 * quietly short.
 */
export interface SentEmailCharge {
  /** Item 1(a) — the letter itself. */
  email: ChargeResult
  /** Item 6 — the correspondence, which sending also earns. See emailRules.ts. */
  correspondence: ChargeResult
  /** Both together, excluding VAT. What goes on the account's copy of the message. */
  totalExclVat: number
}

/**
 * What to tell the agent, for a message that raised two items.
 *
 * chargeMessage answers for one item at a time and would have to be shown twice, which reads as
 * two separate things having happened rather than one email with two lines against it. Where a
 * cap stopped one of them, the reason is named — a fee that silently did not happen is how a
 * month's billing goes quietly short.
 */
export function sentEmailChargeMessage(charge: SentEmailCharge): string {
  const { email, correspondence, totalExclVat } = charge
  if (email.reason === 'charged' && correspondence.reason === 'charged') {
    return `Charged R${totalExclVat.toFixed(2)} plus VAT — R${email.exclVat.toFixed(2)} for the `
      + `email under item 1(a) and R${correspondence.exclVat.toFixed(2)} for the correspondence `
      + 'under item 6.'
  }
  if (email.reason === 'charged') {
    return `Charged R${email.exclVat.toFixed(2)} plus VAT under item 1(a). `
      + `${chargeMessage(correspondence, '6')}`
  }
  if (correspondence.reason === 'charged') {
    return `Charged R${correspondence.exclVat.toFixed(2)} plus VAT under item 6. `
      + `${chargeMessage(email, '1a')}`
  }
  // Neither landed, and they nearly always fail for the same reason — a written-off account, or
  // the ceiling. Saying it once is the whole message.
  return email.reason === correspondence.reason
    ? chargeMessage(email, '1a').replace('item 1a', 'items 1(a) and 6')
    : `${chargeMessage(email, '1a')} ${chargeMessage(correspondence, '6')}`
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
  /** Null means nobody has opened it yet. Only ever set on an inbound message. */
  readAt: string | null
  /** Whose inbox it arrived in. Only they can mark it read — see markRepliesRead. */
  receivedBy: string | null
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
  read_at: string | null
  received_by: string | null
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
    readAt: r.read_at,
    receivedBy: r.received_by,
    occurredAt: r.occurred_at,
  }
}

/** Every message either way on this account, newest first. */
export async function fetchAccountEmails(accountId: string): Promise<AccountEmail[]> {
  const { data, error } = await supabase
    .from('account_emails')
    .select('id, direction, debtor_address, our_address, subject, body, message_id, in_reply_to, attachment_names, sent_by_name, charged_excl_vat, read_at, received_by, occurred_at')
    .eq('account_id', accountId)
    .order('occurred_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as EmailRow[]).map(toEmail)
}

/**
 * A debtor's reply that the agent it arrived for has not looked at yet.
 *
 * This is what makes a reply findable. Across 100 000 accounts nobody browses for one, so unread
 * debtor mail has to surface where people already look for unread mail — the Messages menu —
 * alongside the CRM's own. Scoped to the mailbox that received it, for the reason MessagesMenu
 * gives about its own count: a badge that climbs with other people's inboxes is ignored inside a
 * week.
 */
export interface DebtorReply {
  id: string
  accountId: string
  /** The account number, for a label that says which debtor without opening anything. */
  accountNumber: string | null
  debtorName: string | null
  from: string
  subject: string | null
  body: string | null
  occurredAt: string
}

interface ReplyRow {
  id: string
  account_id: string
  debtor_address: string
  sent_by_name: string | null
  subject: string | null
  body: string | null
  occurred_at: string
  debtor_accounts: {
    account_number: string | null
    debtor_first_name: string | null
    debtor_surname: string | null
  } | null
}

export async function fetchUnreadReplies(userId: string): Promise<DebtorReply[]> {
  /*
   * The account is embedded, not fetched separately, so the menu can say WHICH debtor without a
   * second round trip per message.
   *
   * `debtor_accounts` resolves because account_id is the only foreign key from here to that
   * table. Note for anyone extending this: there are TWO keys to `profiles` (received_by and
   * sent_by), so embedding that one needs the constraint named — `profiles!account_emails_received_by_fkey`
   * — or PostgREST refuses it as ambiguous at runtime.
   */
  const { data, error } = await supabase
    .from('account_emails')
    .select(`
      id, account_id, debtor_address, sent_by_name, subject, body, occurred_at,
      debtor_accounts ( account_number, debtor_first_name, debtor_surname )
    `)
    .eq('direction', 'in')
    .eq('received_by', userId)
    .is('read_at', null)
    .order('occurred_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as ReplyRow[]).map((r) => ({
    id: r.id,
    accountId: r.account_id,
    accountNumber: r.debtor_accounts?.account_number ?? null,
    debtorName: [r.debtor_accounts?.debtor_first_name, r.debtor_accounts?.debtor_surname]
      .filter(Boolean).join(' ') || null,
    from: r.sent_by_name || r.debtor_address,
    subject: r.subject,
    body: r.body,
    occurredAt: r.occurred_at,
  }))
}

/**
 * Mark replies read.
 *
 * Only ever your own — the RLS policy is scoped to received_by, so this cannot clear somebody
 * else's count even if it is handed their ids.
 */
export async function markRepliesRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { data, error } = await supabase
    .from('account_emails')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids)
    .is('read_at', null)
    .select('message_id')
  if (error) throw new Error(error.message)

  // The same message is sitting in the agent's mailbox. Reading it here reads it there.
  // (Not a badge fix: a filed message is not counted by nav_counts. It is the bold row in the
  // mailbox's Filed and All tabs, still advertising itself as unread after it was answered.)
  await mirrorReadToMailbox((data ?? []).map((r) => r.message_id as string | null))
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
  /**
   * What went with it, as the server named the parts.
   *
   * Recorded because a statement or a section 129 letter that was sent and not written down is
   * one nobody can prove was sent — and proving it is the entire point of sending it.
   */
  attachmentNames?: string[]
  actor: Actor
}): Promise<SentEmailCharge> {
  /*
   * BOTH ITEMS, in the order sentEmailItems gives them.
   *
   * Item 1(a) for the letter and item 6 for the correspondence — the firm's instruction: "any
   * email that is sent for any data under anything that is matched charges a mail and
   * correspondence, because you're corresponding and you're sending an email." R38 excluding VAT
   * on a message we send, where it used to be R25.
   *
   * Sequentially rather than in parallel, and that is deliberate: chargeItem reads what the
   * account has already been charged in order to apply the items 1–7 ceiling, so two of them
   * running at once would each read the total from before the other and could take the account
   * past it. The letter goes first, so where there is room for only one it is the R25 that lands.
   *
   * Each is capped on its own and a capped one comes back with exclVat 0 and a reason, which the
   * caller shows. Neither is allowed to fail the send: the message has already gone.
   */
  const charges: ChargeResult[] = []
  for (const item of sentEmailItems) {
    charges.push(await chargeItem({
      accountId: input.accountId,
      itemId: item.itemId,
      // The same action earned both, so both carry the outgoing code. The item id is what tells
      // the two apart on a statement; the action code says what the agent did, and they sent.
      actionCode: EMAIL_ACTION_CODE,
      description: item.description,
      createdBy: input.actor.id,
    }))
  }
  const charge: SentEmailCharge = {
    email: charges[0],
    correspondence: charges[1],
    totalExclVat: charges.reduce((sum, c) => sum + c.exclVat, 0),
  }

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
    attachment_names: input.attachmentNames ?? [],
    // Both items together: what this one message actually cost the debtor.
    charged_excl_vat: charge.totalExclVat,
  })
  if (error) console.error('[accountEmails] the message went but was not filed:', error.message)

  await addNote({
    accountId: input.accountId,
    body: sentEmailNote(input.to, input.subject, input.body),
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

/*
 * The inbound half lives on the server.
 *
 * A debtor's reply is filed by api/_lib/emailSync.ts with the service key: it raises item 6, R13
 * — the firm's "for every email received, there's also a correspondence fee" — writes the
 * account_emails row and puts the note on the timeline. Nothing in the browser creates one, so
 * there is no counterpart to recordSentEmail here.
 *
 * Both halves compose their notes from emailRules.ts, so the wording cannot drift between what
 * we send and what we receive.
 */
