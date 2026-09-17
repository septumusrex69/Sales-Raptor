import { ImapFlow, type ListResponse } from 'imapflow'
import { simpleParser } from 'mailparser'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from './crypto.js'
import {
  assembleBody, describeParts, flattenParts, inlineImagesFromParsed, listedAttachments,
  partContent, placeholderIndex, placeholderName, plainText, readableParts,
  type MessageBody, type MessagePart,
} from './mime.js'
import {
  automatedMailKind, automatedMailNote,
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
  last_seen_uid_sent: number | null
  /* A high-water mark per folder, for everything beyond INBOX, Junk and Sent. See otherFolders. */
  folder_uids?: Record<string, number> | null
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

/**
 * THE OTHER FOLDERS, which Raptor could not see.
 *
 * The firm reported two messages that were in their mail client and not in Raptor. The sync's own
 * log gave the answer: this server has EIGHTEEN folders and the sync read three of them.
 *
 *   INBOX, INBOX.Sent, INBOX.Drafts, INBOX.Archive, INBOX.spambucket, INBOX.Trash,
 *   INBOX.Archive.Deleted Items, INBOX.Blocked, INBOX.Sent.Trash, INBOX.Sent Items,
 *   INBOX.Spam Emails, INBOX.Spam Emails 1, INBOX.Spam Emails 2, INBOX.Spam Emails 3, ...
 *
 * A server-side rule, or another mail client, files mail into those — and everything it touched
 * was invisible here, permanently, with nothing on screen saying so. That is worse than an empty
 * mailbox: an empty one looks broken, and this looked complete.
 *
 * WHAT IS SKIPPED, AND WHY EACH:
 *  - Trash, and anything under it. Deleted mail is deleted; pulling it back into a working queue
 *    would put every message somebody has already thrown away in front of them again.
 *  - Drafts. Half-written and never sent — not correspondence with anybody.
 *  - The three that are already handled by name, so they are not read twice.
 */
const SKIP_FOLDER = /(^|\.)(trash|deleted items|drafts|junk e-?mail)(\.|$)/i

export function otherFolders(paths: string[], handled: (string | undefined)[]): string[] {
  const already = new Set(handled.filter((p): p is string => !!p).map((p) => p.toLowerCase()))
  return paths.filter((path) => {
    if (already.has(path.toLowerCase())) return false
    if (path.toUpperCase() === 'INBOX') return false
    /*
     * Tested on the whole path, which covers a nested folder for free: the leading (^|\.) matches
     * the separator, so "INBOX.Archive.Deleted Items" is recognised as deleted mail rather than as
     * an archive that happens to contain the word.
     */
    return !SKIP_FOLDER.test(path)
  })
}

/**
 * Whether a folder's mail should be treated as junk.
 *
 * By name, because a server has exactly one \\Junk special-use folder and this mailbox has five
 * things that are plainly spam. It only changes how the row is labelled -- the message is still
 * fetched and still visible, which is the whole point of reading these folders at all.
 */
export function looksLikeJunk(path: string): boolean {
  return /(^|\.)(spam|junk|blocked|bulk)/i.test(path.split('.').pop() ?? path)
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
  /*
   * THROUGH listedAttachments AND placeholderName, which the download route also uses. The filter
   * and the naming convention used to live only here, and the route that has to find the file
   * again knew nothing about either -- so an attachment with no filename was listed on the
   * message and 404ed on every attempt to open it.
   */
  return listedAttachments(attachments)
    .map((att, i) => att.filename || placeholderName(i))
    .slice(0, MAX_ATTACHMENT_NAMES)
}

/**
 * The senders this agent has blocked, loaded once per sync rather than once per message.
 *
 * Returned as two sets because they are checked differently: an address must match exactly, a
 * domain matches anything after the @. At 3 750 messages a day, one query beats 3 750.
 */
async function loadBlocks(
  admin: SupabaseClient,
  userId: string,
): Promise<{ addresses: Set<string>; domains: Set<string> }> {
  const { data, error } = await admin
    .from('mail_blocks')
    .select('pattern, kind')
    .eq('user_id', userId)
  if (error) {
    // A blocklist we could not read must not stop the sync. Worst case is a week of newsletters.
    console.error(`[emailSync] could not read the blocklist for ${userId}: ${error.message}`)
    return { addresses: new Set(), domains: new Set() }
  }
  const addresses = new Set<string>()
  const domains = new Set<string>()
  for (const row of data ?? []) {
    const pattern = String(row.pattern).toLowerCase()
    if (row.kind === 'domain') domains.add(pattern)
    else addresses.add(pattern)
  }
  return { addresses, domains }
}

/** Is this sender on the agent's blocklist? */
function isBlocked(address: string | null, blocks: { addresses: Set<string>; domains: Set<string> }): boolean {
  if (!address) return false
  const clean = address.toLowerCase()
  if (blocks.addresses.has(clean)) return true
  const at = clean.lastIndexOf('@')
  return at > -1 && blocks.domains.has(clean.slice(at + 1))
}

/**
 * The senders whose mail this agent has said never needs matching.
 *
 * Loaded once per folder, exactly like the blocklist, and matched exactly like it. The two are
 * kept apart because they mean opposite things: a block stops the mail becoming a row at all,
 * this lets it in and stops it asking for attention. A supplier's invoice you need to keep and
 * may need to find again is the whole reason the second one exists.
 */
async function loadSenderRules(
  admin: SupabaseClient,
  userId: string,
): Promise<{ addresses: Set<string>; domains: Set<string> }> {
  const { data, error } = await admin
    .from('mail_sender_rules')
    .select('pattern, kind')
    .eq('user_id', userId)
    .eq('action', 'no_record')
  if (error) {
    // A rule we could not read must not stop the sync. Worst case is a supplier's mail asking to
    // be matched one more time, which is a nuisance rather than a loss.
    console.error(`[emailSync] could not read sender rules for ${userId}: ${error.message}`)
    return { addresses: new Set(), domains: new Set() }
  }
  const addresses = new Set<string>()
  const domains = new Set<string>()
  for (const row of data ?? []) {
    const pattern = String(row.pattern).toLowerCase()
    if (row.kind === 'domain') domains.add(pattern)
    else addresses.add(pattern)
  }
  return { addresses, domains }
}

/** How much of a body is worth keeping to recognise a message by. The rest stays in the mailbox. */
const SNIPPET_LENGTH = 240

/**
 * Put the message in the agent's own mailbox, whatever else happens to it.
 *
 * This runs for EVERY message, before any attempt to match it. It is what closes the hole the
 * firm asked about: mail that matches no account and no CRM record used to be skipped with a log
 * line and lost, and at 50 agents x 50-100 messages a day nobody was ever going to find it by
 * browsing 100 000 accounts.
 *
 * Metadata and a snippet only. No body — see the note on the table.
 *
 * Returns the row id so a match can mark it linked, or null when it was already there (a
 * resynced mailbox) or could not be written. Never throws: a mailbox row is a convenience, and
 * losing one must not stop the message being filed against an account or a deal.
 */
async function fileUserEmail(
  admin: SupabaseClient,
  userId: string,
  message: {
    folder: string
    uid: number
    messageId: string
    fromAddress: string
    fromName: string | null
    subject: string
    body: string
    attachmentNames: string[]
    isJunk: boolean
    at: string
    /** The agent has a standing rule for this sender: it arrives already dealt with. */
    noRecordNeeded?: boolean
    /** Pulled from the Sent folder: a mailbox row and nothing else. Never filed, never charged. */
    isSent?: boolean
    /** Who it went to. The useful address on a sent message; From is always us. */
    toAddress?: string | null
    toName?: string | null
    /** Everyone the message went to, and everyone copied. See replyAllTo. */
    toRecipients?: { name: string | null; address: string }[]
    ccRecipients?: { name: string | null; address: string }[]
  },
): Promise<string | null> {
  const { data, error } = await admin
    .from('user_emails')
    .upsert(
      {
        user_id: userId,
        folder: message.folder,
        uid: message.uid,
        message_id: message.messageId,
        from_address: message.fromAddress,
        from_name: message.fromName,
        subject: message.subject,
        snippet: message.body.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LENGTH) || null,
        attachment_names: message.attachmentNames,
        is_junk: message.isJunk,
        is_sent: message.isSent ?? false,
        to_address: message.toAddress ?? null,
        to_name: message.toName ?? null,
        to_recipients: message.toRecipients ?? [],
        cc_recipients: message.ccRecipients ?? [],
        /*
         * Sent mail arrives settled. It is not waiting to be matched to anything — we wrote it,
         * we know where it went — and a Sent folder dropping 2 000 messages into the queue an
         * agent works is a queue nobody works.
         */
        no_record_at: (message.noRecordNeeded || message.isSent) ? new Date().toISOString() : null,
        /*
         * AND SENT MAIL ARRIVES READ. The firm: "all the sent emails are marked as unread -- sent
         * emails should automatically be read."
         *
         * Nothing sets read_at on a message you wrote, so a mailbox whose Sent folder syncs two
         * thousand messages put two thousand bold rows on the Sent tab that no action could clear:
         * opening one is the only thing that marks mail read, and nobody opens their own sent mail
         * to tick it off. You wrote it -- you have read it.
         */
        read_at: message.isSent ? new Date().toISOString() : null,
        occurred_at: message.at,
      },
      { onConflict: 'user_id,message_id', ignoreDuplicates: true },
    )
    .select('id')
  if (error) {
    console.error(`[emailSync] mailbox row failed for ${message.messageId}: ${error.message}`)
    return null
  }
  return data?.[0]?.id ?? null
}

/**
 * Mark a mailbox row as filed against an account.
 *
 * Set by the sync when it matched the message itself, so the Mail page can show it as already
 * dealt with and — importantly — will not offer to link it a second time. Linking is what raises
 * the R13 by hand, so a row that is already linked is a row that cannot be charged twice.
 */
async function markUserEmailLinked(
  admin: SupabaseClient,
  rowId: string,
  accountId: string,
): Promise<void> {
  await admin.from('user_emails')
    .update({ linked_account_id: accountId, linked_at: new Date().toISOString() })
    .eq('id', rowId)
    .is('linked_account_id', null)
}

/**
 * The same, for a message the CRM claimed rather than a debtor account.
 *
 * Without this the mailbox row stays unfiled forever even though the message HAS been filed —
 * it is on the lead's timeline as an Activity. The agent then sees it sitting in "Needs filing",
 * does the obvious thing, and files a sales reply onto a debtor account, charging somebody R13
 * under item 6 for correspondence that had nothing to do with their debt. A wrong entry on a
 * statement is worth more than the R13.
 *
 * `is_filed` is generated from these columns, so setting any one of them takes the message off
 * the working list and out of the sidebar count at the same time.
 *
 * Guarded on is_filed so a re-sync cannot move a message an agent has since filed somewhere
 * else by hand — their decision is the better one and it stands.
 */
async function markUserEmailOnRecord(
  admin: SupabaseClient,
  rowId: string,
  on: { contactId?: string; leadId?: string; companyId?: string; dealId?: string },
): Promise<void> {
  await admin.from('user_emails')
    .update({
      linked_lead_id: on.leadId ?? null,
      linked_deal_id: on.dealId ?? null,
      linked_company_id: on.companyId ?? null,
      linked_contact_id: on.contactId ?? null,
      linked_at: new Date().toISOString(),
    })
    .eq('id', rowId)
    .eq('is_filed', false)
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
/**
 * The raw header lines a bounce is recognised by.
 *
 * READ OFF headerLines, NOT parsed.headers. mailparser turns some headers into objects — a
 * Content-Type comes back as `{ value, params }` — and a caller expecting a string gets
 * "[object Object]", which matches nothing and fails silently in the direction that charges the
 * debtor. headerLines is the unparsed truth: `{ key, line }` with the key already lower-cased.
 *
 * The Content-Type is rebuilt from its parts because that is the one header whose PARAMETER
 * matters: `multipart/report` alone is not a bounce, `report-type=delivery-status` is.
 */
function headerFields(parsed: {
  /* Readonly, because that is how mailparser hands it over and copying it buys nothing. */
  headerLines?: readonly { readonly key: string; readonly line: string }[]
  from?: { text: string }
}): {
  from: string | null
  returnPath: string | null
  autoSubmitted: string | null
  contentType: string | null
  failedRecipients: string | null
  autoReply: string | null
} {
  const lines = parsed.headerLines ?? []
  const of = (name: string): string | null => {
    const hit = lines.find((h) => h.key === name)
    if (!hit) return null
    /* "Auto-Submitted: auto-replied" -> "auto-replied". A header with no colon is not a header. */
    const at = hit.line.indexOf(':')
    return at === -1 ? '' : hit.line.slice(at + 1).trim()
  }
  return {
    from: parsed.from?.text ?? of('from'),
    returnPath: of('return-path'),
    autoSubmitted: of('auto-submitted'),
    contentType: of('content-type'),
    failedRecipients: of('x-failed-recipients'),
    autoReply: of('x-autoreply') ?? of('x-autorespond'),
  }
}

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
    /** The mailbox this arrived in: whose Messages count it belongs to, and its address. */
    mailbox: { userId: string; address: string }
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
        // Which of our mailboxes it came to, and therefore who is waiting on it. read_at stays
        // null: unread is the whole point, and the Messages menu is what clears it.
        our_address: message.mailbox.address,
        received_by: message.mailbox.userId,
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
    body: receivedEmailNote(message.fromName || message.fromAddress, message.subject, message.body),
    kind: EMAIL_IN_KIND,
    source: 'manual',
    author_name: message.fromName || message.fromAddress,
    created_at: message.at,
  })
  return true
}

/**
 * Find one message in a mailbox and hand its shape to whoever asked.
 *
 * Shared by the body fetch and the attachment fetch, which used to keep two copies of this walk
 * on the grounds that merging them needed a "found, or keep looking" decision. It does — and
 * that is exactly what returning null expresses: null means this copy did not have what was
 * wanted, so keep walking. Having one copy is what let the folder hunt below become lazy in both
 * at once.
 *
 * THE ORDER MATTERS. The recorded folder is tried on its own first, and the mailbox listing only
 * happens if that misses. Listing unconditionally — which is what this did — spent a round trip
 * to Johannesburg on every single open, to prepare for a hunt that almost never runs.
 *
 * What `take` receives is the message's SHAPE, not the message: the flattened MIME tree, read out
 * of one small BODYSTRUCTURE fetch. Both callers use it to ask for the one or two parts they
 * actually need. See api/_lib/mime.ts.
 */
async function withMessageStructure<T>(
  conn: { email: string; imap_host: string; imap_port: number; encrypted_password: string },
  location: { folder?: string | null; uid?: number | null; messageId?: string | null },
  take: (client: ImapFlow, uid: number, parts: MessagePart[]) => Promise<T | null>,
): Promise<T | null> {
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
    const tried = new Set<string>()

    const attempt = async (folder: string): Promise<T | null> => {
      if (tried.has(folder)) return null
      tried.add(folder)
      const lock = await client.getMailboxLock(folder).catch(() => null)
      if (!lock) return null
      try {
        let uid = folder === location.folder ? location.uid ?? null : null
        if (uid === null && location.messageId) {
          const found = await client.search({ header: { 'message-id': location.messageId } }, { uid: true })
          uid = found === false || found.length === 0 ? null : found[found.length - 1]
        }
        if (uid === null) return null

        const head = await client.fetchOne(String(uid), { envelope: true, bodyStructure: true }, { uid: true })
        if (!head) return null
        // A message found by UID alone could be a different message entirely if the original was
        // deleted and the UID reused, so confirm identity when we can.
        if (location.messageId && head.envelope?.messageId && head.envelope.messageId !== location.messageId) {
          return null
        }
        return await take(client, uid, flattenParts(head.bodyStructure))
      } finally {
        lock.release()
      }
    }

    if (location.folder) {
      const hit = await attempt(location.folder)
      if (hit !== null) return hit
    }
    // Only now is it worth listing mailboxes: the message has genuinely moved, or been filed.
    if (!location.messageId) return null
    for (const box of await client.list()) {
      const hit = await attempt(box.path)
      if (hit !== null) return hit
    }
    return null
  } finally {
    await client.logout().catch(() => {})
  }
}

/**
 * The full text of one message, fetched from the mailbox on demand.
 *
 * The mailbox tables hold a 240-character snippet and nothing more — see the note on
 * user_emails about why storing 1.37 million bodies a year is not an option. This is how a
 * person reads the whole thing anyway: the mailbox is the archive and Raptor reaches into it,
 * exactly as fetchAttachment already does for files.
 *
 * Asks the server what the message is made of, then fetches only the parts a person is going to
 * look at: its text, and any pictures drawn into it. A four-megabyte message with a scanned
 * mandate attached becomes an eight-kilobyte fetch. It used to pull all four megabytes across
 * from Johannesburg so that somebody could read three paragraphs.
 *
 * The pictures are what finally makes an image signature visible. A great many South African
 * firms sign off with one flat picture, and until now that arrived as a blank space where the
 * sender's name, firm and number should be.
 */
export async function fetchMessageBody(
  conn: { email: string; imap_host: string; imap_port: number; encrypted_password: string },
  location: { folder?: string | null; uid?: number | null; messageId?: string | null },
): Promise<MessageBody | null> {
  return withMessageStructure(conn, location, async (client, uid, parts) => {
    const { parts: wanted, skippedImages } = readableParts(parts)
    /*
     * What this message is made of, and what we decided to fetch. Types and sizes only — no
     * filenames, no addresses, no content. When somebody says a signature did not appear, this
     * is the difference between reading why in ten seconds and asking them to reproduce it.
     */
    console.log(`[emailSync] uid ${uid} parts: ${describeParts(parts)}`)
    console.log(`[emailSync] uid ${uid} fetching: ${wanted.map((p) => p.part).join(',') || '(none)'}`
      + (skippedImages > 0 ? ` — ${skippedImages} picture(s) too large to show` : ''))

    if (wanted.length > 0) {
      // One fetch for all of them: on this link, two round trips cost more than the bytes do.
      const msg = await client.fetchOne(
        String(uid),
        { uid: true, bodyParts: wanted.map((p) => p.part) },
        { uid: true },
      )
      const assembled = assembleBody(wanted, msg, skippedImages)
      if (assembled) return assembled
    }
    console.log(`[emailSync] uid ${uid} fell back to fetching the whole message`)

    /*
     * Fallback: fetch the whole message and let mailparser sort it out.
     *
     * Slow — this is the path the rest of this exists to avoid — but correct on a message whose
     * structure the walk above could not make sense of. Being occasionally slow beats being
     * occasionally unable to open somebody's mail.
     */
    const whole = await client.fetchOne(String(uid), { source: true }, { uid: true })
    if (!whole || !whole.source) return null
    const parsed = await simpleParser(whole.source)
    /*
     * The HTML comes back as well as the text, because plainText() strips every tag — and the
     * tags are where an image signature keeps its contact details. A signature that renders as a
     * picture still usually wraps the number in <a href="tel:...">, and that anchor was being
     * thrown away before anything could look at it. See findLinkedDetails.
     */
    const fallbackImages = inlineImagesFromParsed(parsed.attachments)
    /*
     * A meeting request reaches this path whenever the structure walk could not place its
     * calendar part, and mailparser hands that part back among the attachments rather than as
     * body text. Missed here, an invite that fell back would read as empty even though the
     * fast path had just been taught to understand it -- one of the two ways in fixed and the
     * other not, which is the shape of bug that survives a release.
     */
    const ics = (parsed.attachments ?? []).find(
      (a) => (a.contentType ?? '').toLowerCase().startsWith('text/calendar'),
    )
    return {
      text: plainText(parsed.text, parsed.html),
      html: parsed.html || '',
      calendar: ics?.content ? Buffer.from(ics.content as Buffer).toString('utf8') : '',
      images: fallbackImages.images,
      imagesSkipped: fallbackImages.skippedImages,
    }
  })
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
 *
 * Fetches only the ONE part that holds the file. A debtor who attaches four photographs of a
 * payslip sends four megabytes; downloading the one a collector clicked used to mean pulling
 * all four across from Johannesburg and throwing three away.
 */
/**
 * What to call a file that arrived with no name.
 *
 * "attachment-1.ics" opens in a calendar; "attachment-1" opens in nothing, and the person saving
 * it has to know what it was and rename it by hand. The extension is taken from the part's own
 * content type, which is the only thing the message actually told us about it.
 */
const EXTENSIONS: Record<string, string> = {
  'text/calendar': '.ics', 'application/pdf': '.pdf', 'text/plain': '.txt',
  'text/html': '.html', 'application/json': '.json', 'text/csv': '.csv',
  'message/rfc822': '.eml', 'application/zip': '.zip',
}

function suggestedName(placeholder: string, contentType: string | undefined): string {
  const ext = EXTENSIONS[(contentType ?? '').toLowerCase().split(';')[0].trim()]
  return ext ? `${placeholder}${ext}` : placeholder
}

export async function fetchAttachment(
  conn: { email: string; imap_host: string; imap_port: number; encrypted_password: string },
  location: { folder?: string | null; uid?: number | null; messageId?: string | null },
  filename: string,
): Promise<FetchedAttachment | null> {
  return withMessageStructure(conn, location, async (client, uid, parts) => {
    /*
     * Match on the filename the STRUCTURE reports, which imapflow has already put back
     * together: MIME-encoded words decoded, RFC 2231 continuations rejoined. That is the same
     * string mailparser produces, which is what the sync recorded and what the caller checked
     * the request against — so the two cannot disagree about which file was asked for.
     */
    /*
     * A PLACEHOLDER IS A POSITION, NOT A NAME, so it is never matched against filenames -- no
     * part is called "attachment-1" and looking for one only wastes a round trip before failing.
     * It is resolved positionally below, against the same list the sync numbered.
     */
    const named = placeholderIndex(filename) === null
      ? parts.find((p) => p.filename === filename)
      : undefined
    if (named) {
      const msg = await client.fetchOne(String(uid), { uid: true, bodyParts: [named.part] }, { uid: true })
      const content = partContent(msg, named)
      if (content) {
        return { filename, contentType: named.type || 'application/octet-stream', content }
      }
    }

    // Fallback for anything the structure walk could not name — an attachment with no filename
    // parameter at all, say. Slow, but it is the behaviour this route had before, and it works.
    const whole = await client.fetchOne(String(uid), { source: true }, { uid: true })
    if (!whole || !whole.source) return null
    const parsed = await simpleParser(whole.source)
    const listed = listedAttachments(parsed.attachments)
    const at = placeholderIndex(filename)
    const match = at === null
      ? listed.find((att) => (att.filename || '') === filename)
      /* The same list, in the same order, numbered the same way the sync numbered it. */
      : listed[at]
    if (!match) return null
    return {
      /* Named for the person saving it: "attachment-1" tells them nothing about what it is. */
      filename: match.filename || suggestedName(filename, match.contentType),
      contentType: match.contentType || 'application/octet-stream',
      content: match.content as Buffer,
    }
  })
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
  /**
   * What sort of folder this is, and it decides far more than a label.
   *
   * 'sent' takes a different path entirely: a mailbox row and nothing else. The matching below
   * files a message onto a debtor's account and raises Annexure B item 6 for RECEIVING it, and a
   * message we sent is item 1(a), already charged when it went out. Running sent mail through
   * the same code would bill the debtor twice for one email.
   */
  kind: 'inbox' | 'junk' | 'sent',
  /**
   * This folder has never been read before, so what is in it is HISTORY.
   *
   * The rows are filed and nothing else happens to them: no matching onto debtor accounts, no
   * Annexure B item 6 for receiving them, no notifications. Fifteen folders coming into view at
   * once is a year of old mail, and running it through the ordinary path would raise fees today
   * against debtors for correspondence that was dealt with months ago — on paper, by somebody who
   * has since left. Whatever arrives in them AFTER this is ordinary new mail and is treated so.
   */
  firstRead = false,
): Promise<{ logged: number; maxUid: number }> {
  const isJunk = kind === 'junk'
  const isSent = kind === 'sent'
  let logged = 0
  // Once per folder, not once per message.
  const blocks = await loadBlocks(admin, conn.user_id)
  const senderRules = await loadSenderRules(admin, conn.user_id)
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
       * The agent's own mailbox first, unconditionally.
       *
       * Written before any matching is attempted, so a message that matches nothing at all still
       * exists somewhere a person can see it. Everything below only decides what ELSE happens to
       * it.
       */
      /*
       * A blocked sender never becomes a row.
       *
       * This is the firm's idea and the reason it is the best storage lever available: a
       * newsletter that arrives weekly costs nothing instead of costing 30 days of retention,
       * every week, forever.
       *
       * The matching below still runs. A block is about noise, not about silencing a debtor — if
       * a blocked address turns out to belong to an account, or answers a demand we sent, it is
       * still filed on that account. Only the mailbox row is skipped.
       */
      const blocked = isBlocked(normaliseAddress(fromAddress), blocks)
      if (blocked) console.log(`[emailSync] ${path} UID ${uid}: sender blocked, no mailbox row`)

      /*
       * EVERYONE, not the first one.
       *
       * mailparser gives an AddressObject or an array of them depending on how the header was
       * written, so both shapes have to be flattened -- a message with two To headers is rare
       * and is exactly the one where dropping the second would lose somebody from a reply-all.
       */
      const people = (field: unknown): { name: string | null; address: string }[] => {
        const objs = Array.isArray(field) ? field : field ? [field] : []
        return objs.flatMap((o) => (o && typeof o === 'object' && 'value' in o
          ? ((o as { value?: { address?: string; name?: string }[] }).value ?? [])
          : []))
          .filter((v) => !!v.address)
          .map((v) => ({
            name: v.name || null,
            address: normaliseAddress(v.address as string) ?? (v.address as string),
          }))
      }
      /*
       * THE DISPLAY NAME, NOT THE WHOLE HEADER.
       *
       * `.text` is mailparser's formatted address -- `"Kestrel Supplies" <info@kestrel.example>` --
       * and storing that made every list row read as a truncated address, printed the address
       * twice on the open message, and made a button offering to open the record as wide as an
       * email address. The name is in .value[0].name and is frequently absent, which is a null and
       * not a fallback: an address masquerading as a name gets greeted in a letter.
       *
       * Worked out once, because BOTH the mailbox row and the debtor account's correspondence had
       * their own copy of the old expression and would have been fixed one at a time.
       */
      const displayName = (parsed.from && 'value' in parsed.from
        ? parsed.from.value?.[0]?.name
        : null) || null

      const toRecipients = people(parsed.to)
      const ccRecipients = people(parsed.cc)
      const firstTo = parsed.to && 'value' in parsed.to ? parsed.to.value?.[0] : undefined

      const mailboxRowId = blocked ? null : await fileUserEmail(admin, conn.user_id, {
        folder: path,
        uid: msg.uid,
        messageId: parsed.messageId ?? `${conn.user_id}:${path}:${uid}`,
        fromAddress: normaliseAddress(fromAddress) ?? fromAddress,
        /*
         * THE NAME, NOT THE WHOLE HEADER. `.text` is mailparser's formatted address --
         * `"Kestrel Supplies" <info@kestrel.example>` -- and storing that made every list row read
         * as a truncated address and the open message print the address twice. The display name
         * is in .value[0].name, and is frequently absent, which is a null and not a fallback.
         */
        fromName: displayName,
        subject: parsed.subject || '(no subject)',
        body: parsed.text || '',
        attachmentNames: realAttachmentNames(parsed.attachments),
        isJunk,
        isSent,
        toAddress: firstTo?.address ? normaliseAddress(firstTo.address) ?? firstTo.address : null,
        toName: firstTo?.name || null,
        toRecipients,
        ccRecipients,
        at: (parsed.date ?? new Date()).toISOString(),
        // isBlocked's twin — the same matching, the opposite intent. See loadSenderRules.
        noRecordNeeded: isBlocked(normaliseAddress(fromAddress), senderRules),
      })

      /*
       * SENT MAIL STOPS HERE, AND SO DOES A FOLDER'S FIRST READ.
       *
       * Everything below files the message onto a record and charges for it — item 6 for a
       * debtor's email, an activity for a CRM contact.
       *
       * A message WE sent was charged as item 1(a) when it went out and the account already has
       * its own copy from the send; going on would bill the debtor twice and file the message
       * against itself.
       *
       * And a folder being read for the first time is history, not post. Fifteen folders came
       * into view at once when the sync stopped ignoring them, and running a year of old mail
       * through this path would raise fees today against debtors for correspondence dealt with
       * months ago. The rows are filed so they can be SEEN — which is the whole complaint — and
       * whatever arrives in that folder afterwards is ordinary new mail. See firstRead.
       */
      if (isSent || firstRead) {
        if (mailboxRowId) logged += 1
        continue
      }

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

      /*
       * OUR OWN MAIL SYSTEM IS NOT THE DEBTOR.
       *
       * A bounce quotes the Message-ID of the letter it is reporting on, so it matched the
       * account by thread exactly as a reply does — and was filed as the debtor's correspondence,
       * put on their timeline in the daemon's name, and charged R13 under item 6. That is money
       * on a real statement for our mail server talking to itself, it counts toward the items 1-7
       * ceiling so it displaces a fee the firm could have charged, and once remittance has run it
       * cannot be taken off.
       *
       * Checked AFTER the match, because the note below needs to know which account it belongs
       * to — and an automated message that matches nothing is just mail in a mailbox.
       */
      const automated = accountMatch ? automatedMailKind(headerFields(parsed)) : null
      if (accountMatch && automated) {
        /*
         * Still recorded, because a demand letter that bounced did not arrive — and a collector
         * about to ring and ask why nobody has answered needs to know the letter never got there.
         * Our words, in our voice, with no fee attached.
         */
        await admin.from('account_notes').insert({
          account_id: accountMatch.accountId,
          body: automatedMailNote(automated, parsed.subject ?? null),
          kind: 'note',
          /* 'system' — Raptor wrote this sentence, not a person. The timeline filters on it. */
          source: 'system',
          author_name: null,
          created_by: null,
        })
        console.log(
          `[emailSync] ${path} UID ${uid}: ${automated} for account ${accountMatch.accountId} — noted, not filed, not charged`,
        )
        /*
         * Marked against the account so nobody can file it by hand afterwards and raise the R13
         * this branch just refused. It belongs to that account; it is simply not the debtor's.
         */
        if (mailboxRowId) await markUserEmailLinked(admin, mailboxRowId, accountMatch.accountId)
        continue
      }

      if (accountMatch) {
        const filedOnAccount = await fileAccountEmail(admin, accountMatch.accountId, {
          fromAddress,
          /* The address where there is no name: this column is what the account's correspondence
             list prints, and it has to say something. See displayName. */
          fromName: displayName ?? fromAddress,
          subject: parsed.subject || '(no subject)',
          body: (parsed.text || '').slice(0, NOTES_MAX_LENGTH),
          messageId: parsed.messageId ?? `${conn.user_id}:${path}:${uid}`,
          inReplyTo: parsed.inReplyTo ?? null,
          attachmentNames: realAttachmentNames(parsed.attachments),
          folder: path,
          uid: msg.uid,
          at: (parsed.date ?? new Date()).toISOString(),
          mailbox: { userId: conn.user_id, address: conn.email },
        })
        console.log(
          `[emailSync] ${path} UID ${uid}: debtor account ${accountMatch.accountId} via ${accountMatch.via}` +
          `${filedOnAccount ? ', filed' : ', already filed'}`,
        )
        // The mailbox row says "already on an account", which is also what stops the Mail page
        // offering to link it again and charge a second R13.
        if (mailboxRowId) await markUserEmailLinked(admin, mailboxRowId, accountMatch.accountId)
        // No notification. The bell is for things the system decided to tell you; an unread
        // email is a person waiting on a reply, and MessagesMenu says why the two are kept
        // apart -- mix them and the number beside the bell stops meaning anything. A debtor's
        // reply is on their account, on the timeline, and in the Emails tab; the firm's own
        // verdict on a notification for it as well was "I don't think it's necessary".
        if (filedOnAccount) logged += 1
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
        // Nothing claimed it, so the mailbox row stays unfiled and waits for a person. That is
        // the whole reason the mailbox exists: this message used to be dropped here.
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
        // On the lead/deal/client now, so the mailbox says so too rather than leaving it in
        // "Needs filing" for somebody to file a second time onto a debtor. See
        // markUserEmailOnRecord.
        if (mailboxRowId) await markUserEmailOnRecord(admin, mailboxRowId, filed)
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
export async function syncConnection(
  admin: SupabaseClient,
  conn: EmailConnectionRow,
): Promise<{ logged: number }> {
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
    const inboxResult = await syncMailbox(client, admin, conn, 'INBOX', conn.last_seen_uid, 'inbox')

    const mailboxes = await client.list()
    const junkPath = findFolder(mailboxes, '\\Junk', ['junk', 'spam', 'junk email', 'bulk mail', 'inbox.junk', 'inbox.spam', 'inbox/junk', 'inbox/spam'])
    const sentPath = findFolder(mailboxes, '\\Sent', ['sent', 'sent items', 'sent messages', 'inbox.sent', 'inbox/sent'])
    console.log(
      `[emailSync] mailboxes: ${mailboxes.map((m) => `${m.path}${m.specialUse ? ` (${m.specialUse})` : ''}`).join(', ')} -- junk: ${junkPath ?? '(none)'}, sent: ${sentPath ?? '(none)'}`,
    )
    const junkResult = junkPath ? await syncMailbox(client, admin, conn, junkPath, conn.last_seen_uid_junk, 'junk') : { logged: 0, maxUid: conn.last_seen_uid_junk ?? 0 }
    /*
     * The Sent folder, so an agent can see what they sent — including mail sent from Outlook or a
     * phone, which Raptor never saw. Messages Raptor sends are appended to this same folder by
     * api/email/send.ts, so they come back through here rather than needing a second path.
     */
    const sentResult = sentPath ? await syncMailbox(client, admin, conn, sentPath, conn.last_seen_uid_sent, 'sent') : { logged: 0, maxUid: conn.last_seen_uid_sent ?? 0 }

    /*
     * AND EVERYTHING ELSE ON THE SERVER. See otherFolders: this mailbox has eighteen folders and
     * the sync read three, so anything a rule filed into Archive, Blocked or "Spam Emails 2" was
     * invisible here with nothing saying so.
     *
     * ONE NEW FOLDER PER RUN. Reading a folder for the first time means fetching and parsing
     * every message in its window, and fifteen of those in one serverless request is a timeout —
     * which leaves no watermark saved and does the whole thing again on the next run, for ever.
     * Folders already known cost one SEARCH each and almost always return nothing. So the backlog
     * is worked off a folder at a time over successive syncs, and nothing is ever half-read.
     */
    const marks: Record<string, number> = { ...(conn.folder_uids ?? {}) }
    let firstReadsLeft = 1
    let otherLogged = 0
    for (const path of otherFolders(mailboxes.map((m) => m.path), [junkPath, sentPath])) {
      const known = marks[path]
      if (known == null && firstReadsLeft <= 0) continue
      if (known == null) firstReadsLeft -= 1
      try {
        const res = await syncMailbox(
          client, admin, conn, path, known ?? null,
          looksLikeJunk(path) ? 'junk' : 'inbox',
          known == null,
        )
        marks[path] = res.maxUid
        otherLogged += res.logged
      } catch (err) {
        /*
         * One unreadable folder must not cost the run. A server can refuse a SELECT on a folder
         * that exists -- a shared mailbox nobody has rights to, a name with a character ImapFlow
         * and the server disagree about -- and throwing here would lose the watermarks of every
         * folder already read this run, including the INBOX.
         */
        console.error(`[emailSync] ${path}: skipped -- ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    // Checked deliberately: a swallowed error here would leave a watermark stuck, so a
    // future sync silently reprocesses the same already-logged messages from scratch (only
    // caught downstream by the dedup upsert above, at the cost of a full re-fetch every time).
    const patch: Record<string, unknown> = { last_seen_uid: inboxResult.maxUid, last_synced_at: new Date().toISOString() }
    if (junkPath) patch.last_seen_uid_junk = junkResult.maxUid
    if (sentPath) patch.last_seen_uid_sent = sentResult.maxUid
    /* Written with the other watermarks in ONE update: two writes could leave a folder marked
       as read while the INBOX's own mark was lost to a failure between them. */
    patch.folder_uids = marks
    const { error: watermarkError } = await admin.from('email_connections').update(patch).eq('user_id', conn.user_id)
    if (watermarkError) throw new Error(`Failed to save sync watermark: ${watermarkError.message}`)

    return { logged: inboxResult.logged + junkResult.logged + sentResult.logged + otherLogged }
  } finally {
    await client.logout().catch(() => {})
  }
}
