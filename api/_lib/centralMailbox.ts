import type { SupabaseClient } from '@supabase/supabase-js'
import { maySendFromCentral } from '../../src/lib/letterOfDemand.js'

/**
 * THE FIRM'S CENTRAL MAILBOX, AND WHETHER THIS CALLER MAY SEND FROM IT (S13, Ryno's letter of demand, 3 Nov:
 * "we need to be able to be controlled from which email address do we send it").
 *
 * The central mailbox is a LOGIN (firm_mailboxes, purpose 'central' -- legal@ at the firm's word, chosen by an
 * Administrator under Settings), and sendAsUser sends as a login. So sending "from legal@" is sending as that
 * login, which is a thing only the server may decide: an Administrator and the client liaisons, the people who
 * write to debtors for clients (maySendFromCentral, shared with the screen so it never offers what this refuses).
 */
export async function centralMailboxFor(
  admin: SupabaseClient, callerId: string,
): Promise<{ userId: string } | { error: string; status: number }> {
  /* Both at once: a send waits on neither longer than it must (check-mail-speed). */
  const [{ data: me }, { data: row }] = await Promise.all([
    admin.from('profiles').select('role').eq('id', callerId).maybeSingle(),
    admin.from('firm_mailboxes').select('user_id').eq('purpose', 'central').maybeSingle(),
  ])
  if (!maySendFromCentral((me as { role?: string } | null)?.role)) {
    return { error: 'Only an Administrator or a client liaison may send from the firm’s central mailbox.', status: 403 }
  }
  const userId = (row as { user_id?: string } | null)?.user_id
  if (!userId) return { error: 'No central mailbox is set. An Administrator chooses one under Settings.', status: 400 }
  return { userId }
}

/**
 * Sends an email through the caller's own connected mailbox via SMTP, with their saved signature
 * appended.
 *
 * WHAT IS LEFT HERE IS THE SESSION AND THE REQUEST BODY. The sending itself moved into
 * `sendAsUser` when the workflow runner needed it: the runner sends the same templates through
 * the same mailboxes with nobody watching, and two copies of a sender would drift -- with the
 * unattended one being the copy that drifts unnoticed. This route's job is to decide WHO is
 * sending, which is the one thing the runner answers differently.
 */
