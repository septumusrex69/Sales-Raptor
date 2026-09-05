import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from './crypto.js'

export interface EmailConnectionRow {
  user_id: string
  email: string
  imap_host: string
  imap_port: number
  encrypted_password: string
  last_seen_uid: number | null
}

/** On the very first sync there's no watermark yet — pull only the most recent messages instead of the mailbox's entire history. */
const FIRST_SYNC_MESSAGE_LIMIT = 25
/** Keep each Activity's logged body short — this is a CRM timeline entry, not a mail client. */
const NOTES_MAX_LENGTH = 2000

async function findMatch(admin: SupabaseClient, fromAddress: string) {
  const email = fromAddress.toLowerCase()
  const { data: contact } = await admin.from('contacts').select('id, company_id').ilike('email', email).limit(1).maybeSingle()
  if (contact) return { contactId: contact.id as string, companyId: (contact.company_id as string | null) ?? undefined }
  const { data: lead } = await admin.from('leads').select('id, company_id').ilike('email', email).limit(1).maybeSingle()
  if (lead) return { leadId: lead.id as string, companyId: (lead.company_id as string | null) ?? undefined }
  const { data: company } = await admin.from('companies').select('id').ilike('email', email).limit(1).maybeSingle()
  if (company) return { companyId: company.id as string }
  return null
}

/**
 * SMTP delivery and IMAP are unrelated protocols -- sending a message via
 * nodemailer only hands it to the recipient's mail server, it never files a
 * copy into the sender's own Sent folder the way composing inside a mail
 * client does. Without this, a message sent through the CRM would never
 * show up in the connected mailbox (e.g. Spark) at all, even though it was
 * genuinely delivered.
 */
export async function appendToSent(
  conn: { email: string; imap_host: string; imap_port: number; encrypted_password: string },
  rawMessage: string | Buffer,
): Promise<void> {
  const password = decrypt(conn.encrypted_password)
  const client = new ImapFlow({
    host: conn.imap_host,
    port: conn.imap_port,
    secure: conn.imap_port === 993,
    auth: { user: conn.email, pass: password },
    logger: false,
  })
  await client.connect()
  try {
    const mailboxes = await client.list()
    const bySpecialUse = mailboxes.find((m) => m.specialUse === '\\Sent')
    const commonNames = ['sent', 'sent items', 'sent messages', 'inbox.sent', 'inbox/sent']
    const byName = mailboxes.find((m) => commonNames.includes(m.name.toLowerCase()) || commonNames.includes(m.path.toLowerCase()))
    const sentPath = bySpecialUse?.path ?? byName?.path
    if (!sentPath) return
    await client.append(sentPath, rawMessage, ['\\Seen'])
  } finally {
    await client.logout().catch(() => {})
  }
}

/**
 * Pulls whatever's new in this person's INBOX since the last sync, and logs
 * an Activity for any message whose sender matches a known Contact, Lead, or
 * Company email — unmatched mail (most of an inbox, realistically) is left
 * alone so the CRM timeline stays about actual clients/leads, not everything
 * that ever landed in someone's inbox.
 */
export async function syncConnection(admin: SupabaseClient, conn: EmailConnectionRow): Promise<{ logged: number }> {
  const password = decrypt(conn.encrypted_password)
  const client = new ImapFlow({
    host: conn.imap_host,
    port: conn.imap_port,
    secure: conn.imap_port === 993,
    auth: { user: conn.email, pass: password },
    logger: false,
  })

  let logged = 0
  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      let uids: number[]
      if (conn.last_seen_uid) {
        const found = await client.search({ uid: `${conn.last_seen_uid + 1}:*` }, { uid: true })
        uids = found === false ? [] : found
      } else {
        const found = await client.search({ all: true }, { uid: true })
        uids = (found === false ? [] : found).slice(-FIRST_SYNC_MESSAGE_LIMIT)
      }

      let maxUid = conn.last_seen_uid ?? 0
      for (const uid of uids) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true })
        if (!msg || !msg.source) continue
        maxUid = Math.max(maxUid, msg.uid)

        const parsed = await simpleParser(msg.source)
        const fromAddress = parsed.from?.value?.[0]?.address
        if (!fromAddress) continue

        const match = await findMatch(admin, fromAddress)
        if (!match) continue

        // upsert + ignoreDuplicates rather than insert: a UID this sync reprocesses (a
        // concurrent sync, or the watermark not having advanced yet) must never log the
        // same email twice -- the unique index on (user_id, email_message_id) is what
        // actually enforces that, this just tells Postgres to skip silently on conflict
        // instead of raising an error that would abort the rest of the sync.
        const { data: inserted, error } = await admin
          .from('activities')
          .upsert(
            {
              type: 'Email',
              user_id: conn.user_id,
              contact_id: match.contactId ?? null,
              lead_id: match.leadId ?? null,
              company_id: match.companyId ?? null,
              subject: `Email received: ${parsed.subject || '(no subject)'}`,
              notes: (parsed.text || '').slice(0, NOTES_MAX_LENGTH),
              activity_date: (parsed.date ?? new Date()).toISOString(),
              email_message_id: parsed.messageId ?? `${conn.user_id}:${uid}`,
            },
            { onConflict: 'user_id,email_message_id', ignoreDuplicates: true },
          )
          .select('id')
        // A duplicate (already-logged Message-ID) is silently skipped by ignoreDuplicates
        // and comes back as an empty array, not an error -- only count it when a row was
        // actually inserted.
        if (!error && inserted && inserted.length > 0) logged += 1
      }

      // Checked deliberately: a swallowed error here would leave the watermark stuck, so every
      // future sync silently reprocesses the same already-logged messages from scratch (only
      // caught downstream by the dedup upsert above, at the cost of a full re-fetch every time).
      const { error: watermarkError } = await admin
        .from('email_connections')
        .update({ last_seen_uid: maxUid, last_synced_at: new Date().toISOString() })
        .eq('user_id', conn.user_id)
      if (watermarkError) throw new Error(`Failed to save sync watermark: ${watermarkError.message}`)
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }

  return { logged }
}
