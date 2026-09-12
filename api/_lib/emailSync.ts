import { ImapFlow, type ListResponse } from 'imapflow'
import { simpleParser } from 'mailparser'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from './crypto.js'
import {
  CORRESPONDENCE_ACTION_CODE, CORRESPONDENCE_DESCRIPTION, CORRESPONDENCE_ITEM_ID,
  EMAIL_IN_KIND, normaliseAddress, receivedEmailNote, threadIds,
} from '../../src/lib/emailRules.js'
import { chargeItemWith, type ChargeResult } from '../../src/lib/chargeEngine.js'

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

/**
 * Does this message belong to a DEBTOR account rather than to the CRM?
 *
 * Two ways to know, and the first is far stronger than the second.
 *
 * A reply carries In-Reply-To (and References) naming the Message-ID of the message it answers.
 * We record that id on every email Raptor sends from an account, so a reply to a demand letter
 * identifies its own account with no guessing at all — including when the debtor answers from an
 * address nobody has ever captured, which is common and is exactly the case address matching
 * gets wrong.
 *
 * Failing that, the sender's address against the account's own contacts. Compared normalised,
 * because a From header wraps the address in a display name and mail clients disagree about
 * capitalising the local part.
 *
 * Retired addresses still match on purpose. "Retired" means we stopped writing to it, not that
 * mail from it is somebody else's — and a debtor writing from an address we had given up on is
 * precisely the contact a collector needs to see.
 */
async function findAccount(
  admin: SupabaseClient,
  fromAddress: string,
  parsed: { inReplyTo?: string; references?: string | string[] },
): Promise<{ accountId: string; via: 'thread' | 'address' } | null> {
  for (const id of threadIds(parsed.inReplyTo, parsed.references)) {
    const { data } = await admin
      .from('account_emails')
      .select('account_id')
      .eq('message_id', id)
      .limit(1)
      .maybeSingle()
    if (data) return { accountId: data.account_id as string, via: 'thread' }
  }

  const address = normaliseAddress(fromAddress)
  if (!address) return null
  const { data: contact } = await admin
    .from('account_contacts')
    .select('account_id')
    .eq('kind', 'email')
    .ilike('value', address)
    .limit(1)
    .maybeSingle()
  if (contact) return { accountId: contact.account_id as string, via: 'address' }
  return null
}

/**
 * File a debtor's reply against their account: the email itself, and a line on the timeline.
 *
 * Raises item 6, "correspondence received and attended to", R13 — the firm's instruction: "for
 * every email received, there's also a correspondence fee". Together with the R25 item 1(a) on
 * what we send, an exchange costs the debtor both.
 *
 * The fee is charged AFTER the row is filed, and only when the file actually happened. That
 * order is what makes it idempotent: the unique index on message_id means a second sync of the
 * same message inserts nothing, returns an empty array, and never reaches the charge. A resynced
 * mailbox therefore cannot bill a debtor twice for one email — which is the failure that matters
 * here, since nobody is watching this run.
 *
 * If the charge throws, the message stays filed and unbilled. That is the safe direction to
 * fail: a fee that was missed can be raised by hand, a fee that was raised twice is a complaint.
 *
 * Returns false when the message was already filed, so the caller does not count it twice.
 */
async function fileAccountEmail(
  admin: SupabaseClient,
  accountId: string,
  message: {
    fromAddress: string
    fromName: string
    subject: string
    body: string
    messageId: string
    inReplyTo: string | null
    attachmentNames: string[]
    folder: string
    uid: number
    at: string
  },
): Promise<boolean> {
  const { data: inserted, error } = await admin
    .from('account_emails')
    .upsert(
      {
        account_id: accountId,
        direction: 'in',
        debtor_address: normaliseAddress(message.fromAddress) ?? message.fromAddress,
        subject: message.subject,
        body: message.body,
        message_id: message.messageId,
        in_reply_to: message.inReplyTo,
        attachment_names: message.attachmentNames,
        email_folder: message.folder,
        email_uid: message.uid,
        // The debtor wrote it, so there is no Raptor user to credit. The name off the From
        // header is who it reads as on the timeline.
        sent_by_name: message.fromName || message.fromAddress,
        occurred_at: message.at,
      },
      { onConflict: 'message_id', ignoreDuplicates: true },
    )
    .select('id')
  if (error) {
    console.error(`[emailSync] account ${accountId}: filing inbound email failed: ${error.message}`)
    return false
  }
  // ignoreDuplicates returns an empty array rather than an error when the row already existed.
  // This is the idempotency gate: everything below it, the FEE included, runs exactly once per
  // message however many times a mailbox is resynced.
  if (!inserted || inserted.length === 0) return false

  /*
   * Item 6, R13, raised with no person in the room.
   *
   * chargeItemWith takes the database as a parameter precisely so this can happen here — the
   * same Annexure B arithmetic the browser runs, against the service-role client, with every cap
   * applied. A written-off account and the items 1–7 ceiling both stop it, and a message that
   * earns nothing is still filed with the fee recorded as unbilled.
   *
   * Wrapped, because a fee that could not be raised must not lose the debtor's message. The
   * email is already on the account at this point; the worst case here is a R13 somebody raises
   * by hand later.
   */
  let charge: ChargeResult | null = null
  try {
    charge = await chargeItemWith(admin, {
      accountId,
      itemId: CORRESPONDENCE_ITEM_ID,
      actionCode: CORRESPONDENCE_ACTION_CODE,
      description: CORRESPONDENCE_DESCRIPTION,
      // Nobody clicked anything. The sync raised it, so there is no user to credit.
      createdBy: null,
      // Dated when the debtor wrote, not when we happened to sync — a reply that arrives on the
      // 1st must not land in the previous month's fees because the mailbox was slow.
      at: new Date(message.at),
    })
    await admin.from('account_emails')
      .update({ charged_excl_vat: charge.exclVat })
      .eq('id', inserted[0].id)
  } catch (err) {
    console.error(`[emailSync] account ${accountId}: item 6 not raised on inbound email:`, err)
  }

  /*
   * The note is what puts it on the Activity timeline, and it is 'manual' on purpose.
   *
   * The timeline can be set to show only what people wrote. A debtor's own words are exactly
   * that — marking them 'system' would hide the reply behind the same filter that hides
   * "Trace done — 4 credit bureau searches".
   */
  await admin.from('account_notes').insert({
    account_id: accountId,
    body: receivedEmailNote(message.fromName || message.fromAddress, message.subject, message.body, charge),
    kind: EMAIL_IN_KIND,
    source: 'manual',
    author_name: message.fromName || message.fromAddress,
    created_at: message.at,
  })
  return true
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

      /*
       * Thread first, sender second.
       *
       * Matching on the sender's address alone finds the client but cannot know which of its
       * deals is being discussed — a client with five open deals gets every reply filed against
       * none of them. A reply carries In-Reply-To (and References) naming the Message-ID of the
       * message it answers, and outbound sends now record that id, so the reply can be filed
       * against the exact deal it belongs to.
       *
       * References is checked as well as In-Reply-To because some clients drop the latter; it
       * is walked newest-first so a long thread resolves to its most recent turn.
       */
      /*
       * A debtor's reply is checked for first, and it leaves by a different door.
       *
       * Debtor correspondence does not belong in `activities` — that table hangs off contacts,
       * leads, deals and companies, which is the sales side of the business. A debtor's history
       * is their account. So when a message belongs to one it is filed there and this message is
       * finished; nothing below runs for it.
       *
       * The collision to know about: an address that is BOTH a CRM contact and a contact on a
       * debtor account now files to the account. That is rare — a debtor is not usually a
       * sales contact — and when it happens, an email from someone who is on a debtor's file is
       * far more likely to be about the debt than about a deal.
       */
      const accountMatch = await findAccount(admin, fromAddress, parsed)
      if (accountMatch) {
        const filedOnAccount = await fileAccountEmail(admin, accountMatch.accountId, {
          fromAddress,
          fromName: parsed.from?.text ?? fromAddress,
          subject: parsed.subject || '(no subject)',
          body: (parsed.text || '').slice(0, NOTES_MAX_LENGTH),
          messageId: parsed.messageId ?? `${conn.user_id}:${path}:${uid}`,
          inReplyTo: parsed.inReplyTo ?? null,
          attachmentNames: realAttachmentNames(parsed.attachments),
          folder: path,
          uid: msg.uid,
          at: (parsed.date ?? new Date()).toISOString(),
        })
        console.log(
          `[emailSync] ${path} UID ${uid}: debtor account ${accountMatch.accountId} via ${accountMatch.via}` +
          `${filedOnAccount ? ', filed' : ', already filed'}`,
        )
        if (filedOnAccount) {
          logged += 1
          // Straight to the account, which is the page whoever reads this has to be on.
          const { data: account } = await admin
            .from('debtor_accounts').select('assigned_to').eq('id', accountMatch.accountId).maybeSingle()
          const assignee = (account?.assigned_to as string | null) ?? null
          if (assignee) {
            await admin.from('notifications').insert({
              user_id: assignee,
              type: 'Email received',
              message: `Reply from ${parsed.from?.text || fromAddress}: ${parsed.subject || '(no subject)'}`,
              link: `/accounts/${accountMatch.accountId}`,
            })
          }
        }
        continue
      }

      const crmThreadIds = threadIds(parsed.inReplyTo, parsed.references)

      let threadMatch: { dealId?: string; leadId?: string; companyId?: string; contactId?: string } | null = null
      for (const id of crmThreadIds) {
        const { data: parent } = await admin
          .from('activities')
          .select('deal_id, lead_id, company_id, contact_id')
          .eq('email_message_id', id)
          .limit(1)
          .maybeSingle()
        if (parent) {
          threadMatch = {
            dealId: (parent.deal_id as string | null) ?? undefined,
            leadId: (parent.lead_id as string | null) ?? undefined,
            companyId: (parent.company_id as string | null) ?? undefined,
            contactId: (parent.contact_id as string | null) ?? undefined,
          }
          console.log(`[emailSync] ${path} UID ${uid}: threaded onto ${id} (deal=${threadMatch.dealId ?? '-'})`)
          break
        }
      }

      const match = await findMatch(admin, fromAddress)
      if (!match && !threadMatch) {
        console.log(`[emailSync] ${path} UID ${uid}: sender ${fromAddress} matches no Contact/Lead/Company and no known thread, skipped`)
        continue
      }

      // A reply from an address nobody has captured yet — a colleague of the contact, a new
      // person on the account — still belongs on the record it is answering, so the thread
      // stands on its own where the address lookup found nothing.
      const filed = {
        contactId: match?.contactId ?? threadMatch?.contactId,
        leadId: match?.leadId ?? threadMatch?.leadId,
        companyId: match?.companyId ?? threadMatch?.companyId,
        dealId: threadMatch?.dealId,
      }
      console.log(
        `[emailSync] ${path} UID ${uid}: filed (contact=${filed.contactId ?? '-'}, lead=${filed.leadId ?? '-'}, company=${filed.companyId ?? '-'}, deal=${filed.dealId ?? '-'}), writing activity...`,
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
            contact_id: filed.contactId ?? null,
            lead_id: filed.leadId ?? null,
            company_id: filed.companyId ?? null,
            deal_id: filed.dealId ?? null,
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
        if (match?.notifyUserId) {
          // Straight to the deal when the reply threaded onto one — that is the page the
          // person reading the notification actually needs to be on.
          const link = filed.dealId
            ? `/deals/${filed.dealId}`
            : filed.companyId
              ? `/companies/${filed.companyId}`
              : filed.leadId
                ? `/leads/${filed.leadId}`
                : `/contacts/${filed.contactId}`
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
