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
import { mirrorReadToMailbox, mirrorUnreadToMailbox } from './mailReadState'
import {
  EMAIL_ACTION_CODE, EMAIL_DESCRIPTION, EMAIL_ITEM_ID, EMAIL_OUT_KIND, sentEmailNote,
} from './emailRules'

export * from './emailRules'

interface Actor {
  id: string | null
  name: string | null
}

/** One person on a header line. The same shape user_emails and emailRules already use. */
export interface Recipient {
  name: string | null
  address: string
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
  /**
   * Everyone else the message went to, or was copied to.
   *
   * What makes a reply-all from the account possible: without it, answering a thread the
   * debtor's attorney was on went back to the debtor alone. Empty on anything filed before the
   * columns existed, which reads as "nobody else known" and simply hides the button.
   */
  toRecipients: Recipient[]
  ccRecipients: Recipient[]
  sentByName: string | null
  /** Excluding VAT. Null where nothing was charged at all — every inbound message. */
  chargedExclVat: number | null
  /**
   * THE TICKET THIS EMAIL RAISED, where somebody pressed the button on it.
   *
   * What makes the press once-only on the screen as well as in the endpoint: a second press would
   * raise a second ticket for one objection, and on a dispute the second is refused by
   * one_open_dispute_per_account -- after the first has already charged item 3.
   */
  queryId: string | null
  /**
   * WHO IS ON THE OTHER END: the debtor, or the client the account belongs to.
   *
   * Decided by the database on insert (account_email_correspondent). The firm: "This email came
   * from the client and then it came to the debtor account. Should go to the ticket if there was
   * one and or go to the client profile." The account's Emails tab is the record of what passed
   * between the firm and the DEBTOR -- what a section 129 proof of communication rests on -- so it
   * reads only 'debtor'; a ticket reads both, because a dispute is a conversation with both.
   */
  correspondent: 'debtor' | 'client'
  /** Null means NOBODY has opened it yet — the account's read state, not a mailbox's. */
  readAt: string | null
  /** Who cleared it for the account. Null on an old row read before the column existed. */
  readBy: string | null
  /** Whose inbox it arrived in. No longer who may read it — see markRepliesRead. */
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
  query_id: string | null
  correspondent: 'debtor' | 'client'
  to_recipients: Recipient[] | null
  cc_recipients: Recipient[] | null
  sent_by_name: string | null
  charged_excl_vat: number | string | null
  read_at: string | null
  read_by: string | null
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
    queryId: r.query_id ?? null,
    correspondent: r.correspondent === 'client' ? 'client' : 'debtor',
    /* Named by hand like every other field here -- see the warning in CLAUDE.md. A column that
       is in the table, in the type and in the select but missing from this mapper reads as
       undefined for ever and nothing fails. */
    toRecipients: r.to_recipients ?? [],
    ccRecipients: r.cc_recipients ?? [],
    sentByName: r.sent_by_name,
    // Postgres numerics arrive as strings through PostgREST. Null stays null: it means no fee
    // was ever due, which the list shows differently from a fee that came out at zero.
    chargedExclVat: r.charged_excl_vat === null ? null : Number(r.charged_excl_vat),
    readAt: r.read_at,
    readBy: r.read_by ?? null,
    receivedBy: r.received_by,
    occurredAt: r.occurred_at,
  }
}

/**
 * Every message either way between the firm and THIS DEBTOR, newest first.
 *
 * NOT THE CLIENT'S. A liaison forwarding a dispute to the client, and the client's answer, are
 * filed against the account and its ticket -- and drew in this list beside the demands until the
 * firm saw one there. This list is what proves what the debtor was told; the client's half of a
 * dispute is on the ticket (fetchQueryEmails), which reads both.
 */
export async function fetchAccountEmails(accountId: string): Promise<AccountEmail[]> {
  const { data, error } = await supabase
    .from('account_emails')
    .select('id, direction, debtor_address, our_address, subject, body, message_id, in_reply_to, attachment_names, to_recipients, cc_recipients, sent_by_name, charged_excl_vat, read_at, read_by, received_by, occurred_at, query_id, correspondent')
    .eq('account_id', accountId)
    .eq('correspondent', 'debtor')
    .order('occurred_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as EmailRow[]).map(toEmail)
}

/**
 * THE CORRESPONDENCE ON ONE TICKET: the email that raised it, and anything sent on from it.
 *
 * THE FIRM: "can me, as a client liaison, for example, Stefan, or Nicole, forward that email just
 * like that to the client?" They could not, because the ticket never showed it. The email HAS been
 * filed against the ticket since the day the button existed -- `query_id` on account_emails, with
 * its attachments filed beside it as documents -- and nothing ever read it back.
 *
 * OLDEST FIRST, which is the opposite of the account's list and is right here. An account's mail
 * is a stream you look at the top of; a ticket's is a short conversation you read in order -- the
 * debtor's objection, then what was passed on to the client about it.
 *
 * THE SAME SELECT AS THE ACCOUNT'S, not a narrower one. Every field the reading pane draws is
 * needed for a forward as well -- who it came from, when, what was attached -- and a second
 * hand-written column list is a second place to forget one.
 */
export async function fetchQueryEmails(queryId: string): Promise<AccountEmail[]> {
  const { data, error } = await supabase
    .from('account_emails')
    .select('id, direction, debtor_address, our_address, subject, body, message_id, in_reply_to, attachment_names, to_recipients, cc_recipients, sent_by_name, charged_excl_vat, read_at, read_by, received_by, occurred_at, query_id, correspondent')
    .eq('query_id', queryId)
    .order('occurred_at', { ascending: true })
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
  /**
   * THE CLIENT, ANSWERING ON A TICKET -- see AccountEmail.correspondent. Its place is the ticket,
   * not the debtor's Emails tab, so the menu sends it there and names it as the client's.
   */
  fromClient: boolean
  queryId: string | null
}

interface ReplyRow {
  id: string
  account_id: string
  debtor_address: string
  sent_by_name: string | null
  subject: string | null
  body: string | null
  occurred_at: string
  query_id: string | null
  correspondent: 'debtor' | 'client'
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
      id, account_id, debtor_address, sent_by_name, subject, body, occurred_at, query_id, correspondent,
      debtor_accounts ( account_number, debtor_first_name, debtor_surname )
    `)
    .eq('direction', 'in')
    /*
     * THE DEBTOR'S, AND THE CLIENT'S ONLY WHERE IT ANSWERS A TICKET. Client mail with no ticket is
     * put on the client's own record by the sync, as an email activity, and the menu already lists
     * those -- so listing this copy too would announce one message twice. And it could never be
     * cleared from here: the account's Emails tab, where a reply is read, no longer draws it.
     */
    .or('correspondent.eq.debtor,query_id.not.is.null')
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
    fromClient: r.correspondent === 'client',
    queryId: r.query_id ?? null,
  }))
}

/**
 * Mark replies read.
 *
 * ON AN ACCOUNT, UNREAD MEANS NOBODY HAS LOOKED. The firm, of a section 129 reply still bold
 * days after it was dealt with: "These things remain unread. But I don't know if it was because
 * it was Stefan that was reading and not to Itumeleng." That was exactly it — the policy used
 * to scope this update to `received_by`, so the account's copy could only be cleared by whoever
 * the message happened to arrive for, and everybody else on the file saw it unread for ever.
 *
 * A mailbox's read state is one person's; an account's correspondence is the floor's. So this
 * now clears it for everybody and records WHO cleared it, which is the honest version of the
 * same information — "read by Stephan" says more than a message that quietly stopped being bold.
 */
export async function markRepliesRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { data: me } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('account_emails')
    .update({ read_at: new Date().toISOString(), read_by: me.user?.id ?? null })
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
 * Put a message back to unread.
 *
 * The mirror of markRepliesRead, and it exists for the same reason the mailbox has one: you open
 * a debtor's reply, see it needs an arrangement drawn up and twenty minutes you do not have, and
 * put it back the way you found it so it is still waiting after lunch. Without it, opening a
 * message to see whether it was urgent is the same act as deciding it was not.
 *
 * The other half of the account rule above: if anybody may read it, anybody may put it back,
 * and `read_by` is cleared with it so the row does not keep naming a reader it no longer has.
 */
export async function markRepliesUnread(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { data, error } = await supabase
    .from('account_emails')
    .update({ read_at: null, read_by: null })
    .in('id', ids)
    /* Only rows that were actually read, so the returned ids are the ones that genuinely
       changed and the mailbox copy is not touched for nothing. */
    .not('read_at', 'is', null)
    .select('message_id')
  if (error) throw new Error(error.message)

  // The same message is sitting in the agent's mailbox, where it is now bold again too.
  await mirrorUnreadToMailbox((data ?? []).map((r) => r.message_id as string | null))
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
   * THE TICKET THIS WAS SENT FROM, where it was sent from one.
   *
   * A dispute forwarded to the client is part of that dispute's correspondence, not a loose
   * message on the account -- and the liaison who picks the ticket up next week needs to see that
   * it went and when. Null everywhere else, which is every ordinary email to a debtor.
   */
  queryId?: string | null
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
    /* FILED ON THE TICKET TOO, where it was sent from one. `ticket_belongs_to_the_same_account`
       refuses a ticket from another account on this very column, so a mistyped id is a refusal
       rather than one debtor's dispute carrying another debtor's mail. */
    query_id: input.queryId ?? null,
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
