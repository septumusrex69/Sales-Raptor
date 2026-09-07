import { ImapFlow, type ListResponse } from 'imapflow'
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
  last_seen_uid_junk: number | null
}

/** On the very first sync of a mailbox there's no watermark yet — pull only the most recent messages instead of its entire history. */
const FIRST_SYNC_MESSAGE_LIMIT = 25
/**
 * A ceiling on the stored body, not a preview length -- the Emails card clamps long
 * messages behind "Show more" on its own. This was 2000, which cut an ordinary 500-word
 * email off mid-sentence and lost the rest permanently; 20k comfortably holds a long
 * business email while still refusing to store a runaway newsletter or quoted-history chain.
 */
const NOTES_MAX_LENGTH = 20000

function findFolder(mailboxes: ListResponse[], specialUse: string, commonNames: string[]): string | undefined {
  const bySpecialUse = mailboxes.find((m) => m.specialUse === specialUse)
  if (bySpecialUse) return bySpecialUse.path
  const byName = mailboxes.find((m) => commonNames.includes(m.name.toLowerCase()) || commonNames.includes(m.path.toLowerCase()))
  return byName?.path
}

/** No point recording 40 filenames on one message; nobody scans past the first few. */
const MAX_ATTACHMENT_NAMES = 10

/**
 * Real attachments only -- signature logos and tracking pixels shouldn't bury a genuine
 * mandate in image001.png noise at this mailbox's volume.
 *
 * The test is `related`: mailparser sets it for parts referenced from the HTML body by cid,
 * which is exactly what an embedded signature image is. Disposition is deliberately NOT
 * used, because Apple Mail (and others) send perfectly real attachments as 'inline' -- an
 * earlier version filtered on that and silently dropped a .docx someone had genuinely
 * attached. An unnamed image with no filename is the remaining tracking-pixel shape.
 */
function realAttachmentNames(
  attachments: { filename?: string; related?: boolean; contentDisposition?: string; contentType?: string }[] | undefined,
): string[] {
  return (attachments ?? [])
    .filter((att) => !att.related && !(!att.filename && (att.contentType ?? '').startsWith('image/')))
    .map((att, i) => att.filename || `attachment-${i + 1}`)
    .slice(0, MAX_ATTACHMENT_NAMES)
}

async function findMatch(admin: SupabaseClient, fromAddress: string) {
  const email = fromAddress.toLowerCase()
  const { data: contact } = await admin.from('contacts').select('id, company_id, owner_id').ilike('email', email).limit(1).maybeSingle()
  if (contact) {
    return { contactId: contact.id as string, companyId: (contact.company_id as string | null) ?? undefined, notifyUserId: contact.owner_id as string }
  }
  const { data: lead } = await admin.from('leads').select('id, company_id, owner_id').ilike('email', email).limit(1).maybeSingle()
  if (lead) return { leadId: lead.id as string, companyId: (lead.company_id as string | null) ?? undefined, notifyUserId: lead.owner_id as string }
  const { data: company } = await admin.from('companies').select('id, account_owner_id').ilike('email', email).limit(1).maybeSingle()
  if (company) return { companyId: company.id as string, notifyUserId: company.account_owner_id as string }
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
    const sentPath = findFolder(mailboxes, '\\Sent', ['sent', 'sent items', 'sent messages', 'inbox.sent', 'inbox/sent'])
    if (!sentPath) return
    await client.append(sentPath, rawMessage, ['\\Seen'])
  } finally {
    await client.logout().catch(() => {})
  }
}

export interface FetchedAttachment {
  filename: string
  contentType: string
  content: Buffer
}

/**
 * Fetches one attachment straight out of the mailbox, on demand.
 *
 * Deliberately does NOT copy files into Storage: this mailbox takes thousands of
 * attachments a week, the overwhelming majority of which nobody ever opens twice, so
 * warehousing them all would mean paying indefinitely to store read-once auto-replies for
 * the sake of the handful of mandates that matter. The mailbox is already the archive --
 * this just reaches into it.
 *
 * Looks in the folder the message was synced from first, and falls back to searching by
 * Message-ID, since a message genuinely does move (rescued from Spam, filed into a folder)
 * after the CRM logged it. Returns null if the message or the named file is gone.
 */
export async function fetchAttachment(
  conn: { email: string; imap_host: string; imap_port: number; encrypted_password: string },
  location: { folder?: string | null; uid?: number | null; messageId?: string | null },
  filename: string,
): Promise<FetchedAttachment | null> {
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
    const candidateFolders = location.folder ? [location.folder] : []
    if (location.messageId) {
      // Only worth listing mailboxes if we may need to hunt for a moved message.
      const mailboxes = await client.list()
      for (const box of mailboxes) if (!candidateFolders.includes(box.path)) candidateFolders.push(box.path)
    }

    for (const folder of candidateFolders) {
      const lock = await client.getMailboxLock(folder).catch(() => null)
      if (!lock) continue
      try {
        let uid = folder === location.folder ? location.uid ?? null : null
        if (uid === null && location.messageId) {
          const found = await client.search({ header: { 'message-id': location.messageId } }, { uid: true })
          uid = found === false || found.length === 0 ? null : found[found.length - 1]
        }
        if (uid === null) continue

        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true })
        if (!msg || !msg.source) continue
        const parsed = await simpleParser(msg.source)
        // A message found by UID alone could be a different message entirely if the
        // original was deleted and the UID reused, so confirm identity when we can.
        if (location.messageId && parsed.messageId && parsed.messageId !== location.messageId) continue

        const match = (parsed.attachments ?? []).find((att) => (att.filename || '') === filename)
        if (!match) continue
        return { filename, contentType: match.contentType || 'application/octet-stream', content: match.content as Buffer }
      } finally {
        lock.release()
      }
    }
    return null
  } finally {
    await client.logout().catch(() => {})
  }
}

/**
 * Pulls whatever's new in one mailbox since sinceUid, and logs an Activity for
 * any message whose sender matches a known Contact, Lead, or Company email —
 * unmatched mail (most of an inbox, realistically) is left alone so the CRM
 * timeline stays about actual clients/leads, not everything that ever landed
 * in someone's inbox. isJunk only changes the logged subject's wording, so a
 * message a spam filter misfiled is still visible but clearly flagged as such.
 */
async function syncMailbox(
  client: ImapFlow,
  admin: SupabaseClient,
  conn: EmailConnectionRow,
  path: string,
  sinceUid: number | null,
  isJunk: boolean,
): Promise<{ logged: number; maxUid: number }> {
  let logged = 0
  const lock = await client.getMailboxLock(path)
  try {
    let uids: number[]
    if (sinceUid) {
      const found = await client.search({ uid: `${sinceUid + 1}:*` }, { uid: true })
      uids = found === false ? [] : found
    } else {
      const found = await client.search({ all: true }, { uid: true })
      uids = (found === false ? [] : found).slice(-FIRST_SYNC_MESSAGE_LIMIT)
    }

    console.log(`[emailSync] ${path}: found ${uids.length} new UID(s) since ${sinceUid ?? '(first sync)'}`)

    let maxUid = sinceUid ?? 0
    for (const uid of uids) {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true })
      if (!msg || !msg.source) {
        console.log(`[emailSync] ${path} UID ${uid}: fetchOne returned no message/source, skipped`)
        continue
      }
      maxUid = Math.max(maxUid, msg.uid)

      const parsed = await simpleParser(msg.source)
      const fromAddress = parsed.from?.value?.[0]?.address
      if (!fromAddress) {
        console.log(`[emailSync] ${path} UID ${uid}: no parseable From address, skipped`)
        continue
      }

      const match = await findMatch(admin, fromAddress)
      if (!match) {
        console.log(`[emailSync] ${path} UID ${uid}: sender ${fromAddress} matches no Contact/Lead/Company, skipped`)
        continue
      }
      console.log(
        `[emailSync] ${path} UID ${uid}: sender ${fromAddress} matched (contact=${match.contactId ?? '-'}, lead=${match.leadId ?? '-'}, company=${match.companyId ?? '-'}), writing activity...`,
      )
      // Logged whenever a message carries parts at all, so a "my attachment vanished" report
      // can be answered from what the mail server actually sent rather than by guessing.
      if ((parsed.attachments ?? []).length > 0) {
        const described = (parsed.attachments ?? [])
          .map((att) => `${att.filename || '(no filename)'} [${att.contentType}, disposition=${att.contentDisposition ?? '-'}, related=${att.related ?? false}]`)
          .join('; ')
        console.log(`[emailSync] ${path} UID ${uid}: parts -- ${described}`)
      }

      // upsert + ignoreDuplicates rather than insert: a UID this sync reprocesses (a
      // concurrent sync, or the watermark not having advanced yet) must never log the
      // same email twice -- the unique index on (user_id, email_message_id) is what
      // actually enforces that, this just tells Postgres to skip silently on conflict
      // instead of raising an error that would abort the rest of the sync.
      const subjectPrefix = isJunk ? 'Email received (was in Spam/Junk)' : 'Email received'
      const { data: inserted, error } = await admin
        .from('activities')
        .upsert(
          {
            type: 'Email',
            user_id: conn.user_id,
            contact_id: match.contactId ?? null,
            lead_id: match.leadId ?? null,
            company_id: match.companyId ?? null,
            subject: `${subjectPrefix}: ${parsed.subject || '(no subject)'}`,
            notes: (parsed.text || '').slice(0, NOTES_MAX_LENGTH),
            activity_date: (parsed.date ?? new Date()).toISOString(),
            email_message_id: parsed.messageId ?? `${conn.user_id}:${path}:${uid}`,
            is_read: false,
            // Names only -- the files stay in the mailbox. Recording them means an email
            // carrying a signed mandate or an invoice can't land in the CRM looking like an
            // ordinary (or, for an attachment-only email, empty) message.
            attachment_names: realAttachmentNames(parsed.attachments),
            // Breadcrumb back to the message itself, for on-demand attachment fetching.
            email_folder: path,
            email_uid: msg.uid,
          },
          { onConflict: 'user_id,email_message_id', ignoreDuplicates: true },
        )
        .select('id')
      // A duplicate (already-logged Message-ID) is silently skipped by ignoreDuplicates
      // and comes back as an empty array, not an error -- only count it when a row was
      // actually inserted.
      if (error) {
        console.error(`[emailSync] ${path} UID ${uid}: activities upsert failed: ${error.message}`)
      } else if (inserted && inserted.length > 0) {
        console.log(`[emailSync] ${path} UID ${uid}: activity ${inserted[0].id} inserted`)
        logged += 1
        if (match.notifyUserId) {
          const link = match.companyId ? `/companies/${match.companyId}` : match.leadId ? `/leads/${match.leadId}` : `/contacts/${match.contactId}`
          await admin.from('notifications').insert({
            user_id: match.notifyUserId,
            type: 'Email received',
            message: `New email from ${parsed.from?.text || fromAddress}: ${parsed.subject || '(no subject)'}`,
            link,
          })
        }
      } else {
        console.log(`[emailSync] ${path} UID ${uid}: upsert reported a duplicate (already logged), skipped`)
      }
    }

    return { logged, maxUid }
  } finally {
    lock.release()
  }
}

/**
 * Syncs both INBOX and, if the mail server has one, a Junk/Spam folder --
 * a client's reply that a spam filter misfiled would otherwise never reach
 * the CRM at all. IMAP UIDs are only unique within a single mailbox, so each
 * folder gets and saves its own watermark; searching the Junk folder is
 * strictly additive; a connection whose server has no such folder behaves
 * exactly as before.
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

  await client.connect()
  try {
    const inboxResult = await syncMailbox(client, admin, conn, 'INBOX', conn.last_seen_uid, false)

    const mailboxes = await client.list()
    const junkPath = findFolder(mailboxes, '\\Junk', ['junk', 'spam', 'junk email', 'bulk mail', 'inbox.junk', 'inbox.spam', 'inbox/junk', 'inbox/spam'])
    console.log(
      `[emailSync] mailboxes: ${mailboxes.map((m) => `${m.path}${m.specialUse ? ` (${m.specialUse})` : ''}`).join(', ')} -- junk folder detected as: ${junkPath ?? '(none found)'}`,
    )
    const junkResult = junkPath ? await syncMailbox(client, admin, conn, junkPath, conn.last_seen_uid_junk, true) : { logged: 0, maxUid: conn.last_seen_uid_junk ?? 0 }

    // Checked deliberately: a swallowed error here would leave a watermark stuck, so a
    // future sync silently reprocesses the same already-logged messages from scratch (only
    // caught downstream by the dedup upsert above, at the cost of a full re-fetch every time).
    const patch: Record<string, unknown> = { last_seen_uid: inboxResult.maxUid, last_synced_at: new Date().toISOString() }
    if (junkPath) patch.last_seen_uid_junk = junkResult.maxUid
    const { error: watermarkError } = await admin.from('email_connections').update(patch).eq('user_id', conn.user_id)
    if (watermarkError) throw new Error(`Failed to save sync watermark: ${watermarkError.message}`)

    return { logged: inboxResult.logged + junkResult.logged }
  } finally {
    await client.logout().catch(() => {})
  }
}
