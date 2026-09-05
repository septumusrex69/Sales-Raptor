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

        await admin.from('activities').insert({
          type: 'Email',
          user_id: conn.user_id,
          contact_id: match.contactId ?? null,
          lead_id: match.leadId ?? null,
          company_id: match.companyId ?? null,
          subject: parsed.subject || '(no subject)',
          notes: (parsed.text || '').slice(0, NOTES_MAX_LENGTH),
          activity_date: (parsed.date ?? new Date()).toISOString(),
        })
        logged += 1
      }

      await admin
        .from('email_connections')
        .update({ last_seen_uid: maxUid, last_synced_at: new Date().toISOString() })
        .eq('user_id', conn.user_id)
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }

  return { logged }
}
