/**
 * One message, two rows, one read state.
 *
 * A debtor's reply now exists in two places on purpose: in the agent's mailbox (user_emails) and
 * on the debtor's file (account_emails). That is the whole point of managing mail from one
 * place — but it left the two copies with independent `read_at` columns and nothing joining
 * them, so reading a reply in the mailbox left it still bold on the account. Somebody then
 * chases a message that has already been read, or worse, answered.
 *
 * These two functions are the join. Whichever copy you read, the other stops being unread.
 *
 * `message_id` is the key, because it is the mail server's own identifier for the message and
 * the only thing the two rows genuinely share. Rows with no Message-ID (a handful of senders
 * omit the header) simply cannot be paired, and are skipped rather than guessed at by subject
 * and timestamp — a wrong pairing would silently mark an unrelated message read.
 *
 * Neither function widens anybody's reach. Both go through PostgREST as the signed-in user, and
 * both tables' policies scope the update to that user: account_emails by `received_by`,
 * user_emails by `user_id`. Handing either one a colleague's message id changes nothing.
 *
 * Neither throws. The copy you actually opened has already been marked read by the caller;
 * failing to mirror it is a stale badge, not lost work, and is not worth an error over a
 * message the agent has plainly dealt with.
 */
import { supabase } from './supabase'

/** Drop nulls and duplicates — an `in` filter with 50 copies of one id is 50 wasted bytes. */
function usable(messageIds: (string | null | undefined)[]): string[] {
  return [...new Set(messageIds.filter((m): m is string => !!m))]
}

/** Read it in your mailbox → the copy on the debtor's file stops being unread. */
export async function mirrorReadToAccount(messageIds: (string | null | undefined)[]): Promise<void> {
  const ids = usable(messageIds)
  if (ids.length === 0) return
  const { error } = await supabase
    .from('account_emails')
    .update({ read_at: new Date().toISOString() })
    .in('message_id', ids)
    .is('read_at', null)
  if (error) console.error('[mailReadState] the account copy stayed unread:', error.message)
}

/**
 * Put it back to unread in your mailbox → the copy on the debtor's file goes back with it.
 *
 * The other direction of the same rule, and it matters for the same reason. Somebody who opens a
 * message, realises they cannot deal with it now and marks it unread has made a decision about
 * the work; if only one of the two copies hears about it, the account still reads as dealt with
 * and the message is quietly lost again.
 */
export async function mirrorUnreadToAccount(messageIds: (string | null | undefined)[]): Promise<void> {
  const ids = usable(messageIds)
  if (ids.length === 0) return
  const { error } = await supabase
    .from('account_emails')
    .update({ read_at: null })
    .in('message_id', ids)
    .not('read_at', 'is', null)
  if (error) console.error('[mailReadState] the account copy stayed read:', error.message)
}

/** Read it on the account → the copy in your mailbox stops being unread. */
export async function mirrorReadToMailbox(messageIds: (string | null | undefined)[]): Promise<void> {
  const ids = usable(messageIds)
  if (ids.length === 0) return
  const { error } = await supabase
    .from('user_emails')
    .update({ read_at: new Date().toISOString() })
    .in('message_id', ids)
    .is('read_at', null)
  if (error) console.error('[mailReadState] the mailbox copy stayed unread:', error.message)
}

/**
 * Put it back to unread on the account → the copy in your mailbox goes back with it.
 *
 * THE FOURTH DIRECTION, and it was missing. Three of the four existed because the account could
 * only ever be read, never unread — there was no button for it. Now there is one on every screen
 * that shows a message, and without this the account row would go bold while the mailbox row
 * stayed read, which is the same split this file exists to close.
 */
export async function mirrorUnreadToMailbox(messageIds: (string | null | undefined)[]): Promise<void> {
  const ids = usable(messageIds)
  if (ids.length === 0) return
  const { error } = await supabase
    .from('user_emails')
    .update({ read_at: null })
    .in('message_id', ids)
    .not('read_at', 'is', null)
  if (error) console.error('[mailReadState] the mailbox copy stayed read:', error.message)
}
