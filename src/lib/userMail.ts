/**
 * An agent's mailbox, inside Raptor.
 *
 * Every message the sync reads is here, whether or not it matched anything — which is the whole
 * point. Mail that matches no account and no CRM record used to be skipped and lost, and at
 * 50 agents taking 50-100 messages a day nobody was ever going to find it by browsing 100 000
 * accounts.
 *
 * Metadata and a snippet only. The body stays in the mailbox, exactly as attachments already do.
 *
 * Three things a person does here: link a message to a debtor account, throw it away, or leave
 * it and let the 30-day prune take it. All three are enforced in the database rather than only
 * in this file — see the policies on user_emails.
 */
import { supabase } from './supabase'
import { chargeItem, type ChargeResult } from './accountCharges'
import { addNote } from './accountWorkspace'
import {
  CORRESPONDENCE_ACTION_CODE, CORRESPONDENCE_DESCRIPTION, CORRESPONDENCE_ITEM_ID,
  EMAIL_IN_KIND, receivedEmailNote,
} from './emailRules'

export interface MailItem {
  id: string
  folder: string
  uid: number
  messageId: string | null
  fromAddress: string
  fromName: string | null
  subject: string | null
  snippet: string | null
  attachmentNames: string[]
  isJunk: boolean
  occurredAt: string
  readAt: string | null
  /** Set once it is on an account — by the sync matching it, or by hand. */
  linkedAccountId: string | null
  /** The account it was filed against, for showing where it went. */
  linkedAccount: { accountNumber: string | null; debtorName: string | null } | null
}

interface MailRow {
  id: string
  folder: string
  uid: number
  message_id: string | null
  from_address: string
  from_name: string | null
  subject: string | null
  snippet: string | null
  attachment_names: string[] | null
  is_junk: boolean
  occurred_at: string
  read_at: string | null
  linked_account_id: string | null
  debtor_accounts: {
    account_number: string | null
    debtor_first_name: string | null
    debtor_surname: string | null
  } | null
}

const COLUMNS = `
  id, folder, uid, message_id, from_address, from_name, subject, snippet,
  attachment_names, is_junk, occurred_at, read_at, linked_account_id,
  debtor_accounts ( account_number, debtor_first_name, debtor_surname )
`

function toItem(r: MailRow): MailItem {
  const name = [r.debtor_accounts?.debtor_first_name, r.debtor_accounts?.debtor_surname]
    .filter(Boolean).join(' ') || null
  return {
    id: r.id,
    folder: r.folder,
    uid: r.uid,
    messageId: r.message_id,
    fromAddress: r.from_address,
    fromName: r.from_name,
    subject: r.subject,
    snippet: r.snippet,
    attachmentNames: r.attachment_names ?? [],
    isJunk: r.is_junk,
    occurredAt: r.occurred_at,
    readAt: r.read_at,
    linkedAccountId: r.linked_account_id,
    linkedAccount: r.linked_account_id
      ? { accountNumber: r.debtor_accounts?.account_number ?? null, debtorName: name }
      : null,
  }
}

export type MailFilter = 'needs-filing' | 'filed' | 'junk' | 'all'

/**
 * A page of the mailbox.
 *
 * Paged, not fetched whole, and this is not premature: 75 messages a day for 30 days is over
 * 2 000 rows per agent. `search` matches sender and subject — the two things somebody actually
 * remembers about an email they are looking for.
 */
export async function fetchMail(input: {
  userId: string
  filter: MailFilter
  search?: string
  /** Rows to skip, for paging. */
  offset?: number
  limit?: number
}): Promise<{ items: MailItem[]; more: boolean }> {
  const limit = input.limit ?? 50
  const offset = input.offset ?? 0

  let q = supabase.from('user_emails').select(COLUMNS).eq('user_id', input.userId)

  // Junk is its own view rather than a flag on the others: a mailbox that mixes spam into the
  // list of things needing attention is a list nobody works.
  if (input.filter === 'needs-filing') q = q.is('linked_account_id', null).eq('is_junk', false)
  else if (input.filter === 'filed') q = q.not('linked_account_id', 'is', null)
  else if (input.filter === 'junk') q = q.eq('is_junk', true)

  const term = input.search?.trim()
  if (term) {
    // Commas and parentheses would be read as `or()` syntax rather than as text.
    const safe = term.replace(/[,()]/g, ' ')
    q = q.or(`from_address.ilike.%${safe}%,subject.ilike.%${safe}%,from_name.ilike.%${safe}%`)
  }

  // One row past the page, so "is there more" needs no second count query.
  const { data, error } = await q
    .order('occurred_at', { ascending: false })
    .range(offset, offset + limit)
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as unknown as MailRow[]
  return { items: rows.slice(0, limit).map(toItem), more: rows.length > limit }
}

/** How many messages are waiting to be filed. Counted in the database, not fetched and counted here. */
export async function countNeedsFiling(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('user_emails')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('linked_account_id', null)
    .eq('is_junk', false)
    .is('read_at', null)
  if (error) throw new Error(error.message)
  return count ?? 0
}

/**
 * The full text of a message, fetched from the mailbox when somebody opens it.
 *
 * Raptor holds a 240-character snippet; this is how a person reads the rest. It rides on
 * /api/email/attachment, which already opens IMAP connections — Vercel's Hobby plan caps this
 * project at twelve functions and it is at twelve, so a thirteenth route would have made reading
 * your own mail wait on a billing change.
 *
 * Throws with the server's own wording. The caller keeps showing the snippet either way: a
 * message the mail server has since moved should not leave the row blank.
 */
export async function fetchMailBody(mailId: string, accessToken: string): Promise<string> {
  const res = await fetch('/api/email/attachment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ mailId }),
  })
  const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string }
  if (!res.ok) throw new Error(body.error ?? 'Could not read that message.')
  return body.text ?? ''
}

export async function markMailRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase
    .from('user_emails')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids)
    .is('read_at', null)
  if (error) throw new Error(error.message)
}

/**
 * Throw a message away.
 *
 * Raptor forgets it; the real mailbox keeps it. Nothing here touches the IMAP server — this
 * deletes a row holding a sender, a subject and a snippet. The message is still in Outlook.
 *
 * It also will not come back: the sync's watermark has already moved past that UID, so a pruned
 * or deleted message is not re-imported on the next run. That is the intended behaviour for
 * spam, and the reason linked mail is protected by the database rather than by this function.
 */
export async function deleteMail(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const { data, error } = await supabase
    .from('user_emails')
    .delete()
    .in('id', ids)
    .is('linked_account_id', null)
    .select('id')
  if (error) throw new Error(error.message)
  return data?.length ?? 0
}

/* ------------------------------------------------------------------ *
 * Blocked senders
 * ------------------------------------------------------------------ */

export interface BlockedSender {
  id: string
  pattern: string
  kind: 'address' | 'domain'
  label: string | null
  createdAt: string
}

/**
 * Domains that may never be blocked wholesale.
 *
 * A debtor emailing from Gmail is the normal case, not the exception — blocking gmail.com to be
 * rid of one nuisance would silence a large share of the book, and silently, because a blocked
 * sender never becomes a row to notice. Addresses at these domains can still be blocked one at
 * a time; it is only the whole-domain block that is refused.
 */
const SHARED_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.za', 'live.com',
  'live.co.za', 'msn.com', 'yahoo.com', 'yahoo.co.za', 'ymail.com', 'icloud.com', 'me.com',
  'mac.com', 'aol.com', 'protonmail.com', 'proton.me', 'zoho.com', 'gmx.com', 'mail.com',
  'webmail.co.za', 'telkomsa.net', 'vodamail.co.za', 'mweb.co.za', 'absamail.co.za',
  'iafrica.com', 'polka.co.za', 'lantic.net',
])

export function domainOf(address: string): string | null {
  const at = address.lastIndexOf('@')
  return at > -1 ? address.slice(at + 1).toLowerCase() : null
}

/** Why a whole-domain block is being refused, or null when it is fine. */
export function domainBlockProblem(address: string): string | null {
  const domain = domainOf(address)
  if (!domain) return 'That is not an email address.'
  if (SHARED_DOMAINS.has(domain)) {
    return `${domain} is a shared email provider — blocking all of it would silence debtors too. `
      + 'Block just this address instead.'
  }
  return null
}

export async function fetchBlockedSenders(userId: string): Promise<BlockedSender[]> {
  const { data, error } = await supabase
    .from('mail_blocks')
    .select('id, pattern, kind, label, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: r.id as string,
    pattern: r.pattern as string,
    kind: r.kind as 'address' | 'domain',
    label: (r.label as string | null) ?? null,
    createdAt: r.created_at as string,
  }))
}

/**
 * Is this address on a debtor's file?
 *
 * The guard that matters most. Blocking an address that belongs to a debtor would stop their
 * mail reaching us at all, and because a blocked sender never becomes a row, nobody would ever
 * find out — the account would simply look unworked. Retired contacts count: "retired" means we
 * stopped writing to it, not that mail from it is somebody else's.
 */
export async function addressBelongsToDebtor(address: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('account_contacts')
    .select('id')
    .eq('kind', 'email')
    .ilike('value', address.trim().toLowerCase())
    .limit(1)
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

/**
 * Never import from this sender again, and clear out what is already here.
 *
 * Refuses outright if the address is on a debtor's file — see addressBelongsToDebtor. A
 * whole-domain block is refused for shared providers for the same reason.
 *
 * Existing UNLINKED mail from the sender goes with it, which is the point: blocking the weekly
 * newsletter should clear the four copies already sitting there. Linked mail is untouched — it
 * is on an account and raised a fee, and the database refuses to delete it anyway.
 */
export async function blockSender(input: {
  userId: string
  address: string
  /** 'domain' blocks everything after the @. */
  scope: 'address' | 'domain'
  label?: string | null
}): Promise<{ pattern: string; removed: number }> {
  const address = input.address.trim().toLowerCase()
  if (!address.includes('@')) throw new Error('That is not an email address.')

  if (await addressBelongsToDebtor(address)) {
    throw new Error(
      `${address} is on a debtor's file. Blocking it would stop their mail reaching Raptor at all, `
      + 'and nobody would see it go missing.',
    )
  }

  let pattern = address
  if (input.scope === 'domain') {
    const problem = domainBlockProblem(address)
    if (problem) throw new Error(problem)
    pattern = domainOf(address)!
  }

  const { error } = await supabase
    .from('mail_blocks')
    .upsert(
      { user_id: input.userId, pattern, kind: input.scope, label: input.label ?? null },
      { onConflict: 'user_id,pattern', ignoreDuplicates: true },
    )
  if (error) throw new Error(error.message)

  // Clear what is already sitting in the mailbox from this sender. Unlinked only.
  let q = supabase.from('user_emails').delete()
    .eq('user_id', input.userId)
    .is('linked_account_id', null)
  q = input.scope === 'domain'
    ? q.ilike('from_address', `%@${pattern}`)
    : q.ilike('from_address', pattern)
  const { data: gone, error: sweepError } = await q.select('id')
  if (sweepError) throw new Error(sweepError.message)

  return { pattern, removed: gone?.length ?? 0 }
}

export interface BlockOutcome {
  /** Addresses now blocked. */
  blocked: string[]
  /** Addresses left alone, and why — a debtor's mail is never silenced by a bulk action. */
  refused: { address: string; reason: string }[]
  /** Messages swept out of Raptor as a result. */
  removed: number
}

/**
 * Block several senders at once, from the list, without opening anything.
 *
 * ADDRESS ONLY. A whole-domain block stays behind the open message on purpose: it is the one
 * that can silence an entire company, and it should cost a deliberate look at what you are
 * silencing. Ticking five bits of junk should not be able to do that by accident.
 *
 * The debtor guard still applies and is checked for every address in ONE query rather than one
 * per address — fifty selected messages are usually a handful of distinct senders, but the query
 * count should not depend on how much somebody ticked. An address on a debtor's file is refused
 * and named; it does not fail the rest of the batch.
 */
export async function blockSenders(input: {
  userId: string
  mail: MailItem[]
}): Promise<BlockOutcome> {
  const addresses = [...new Set(
    input.mail.map((m) => m.fromAddress.trim().toLowerCase()).filter((a) => a.includes('@')),
  )]
  if (addresses.length === 0) return { blocked: [], refused: [], removed: 0 }

  const { data: onFile, error: lookupError } = await supabase
    .from('account_contacts')
    .select('value')
    .eq('kind', 'email')
    .in('value', addresses)
  if (lookupError) throw new Error(lookupError.message)
  const debtors = new Set((onFile ?? []).map((r) => String(r.value).trim().toLowerCase()))

  const refused = addresses.filter((a) => debtors.has(a)).map((address) => ({
    address,
    reason: "on a debtor's file",
  }))
  const allowed = addresses.filter((a) => !debtors.has(a))
  if (allowed.length === 0) return { blocked: [], refused, removed: 0 }

  const labelFor = new Map(input.mail.map((m) => [
    m.fromAddress.trim().toLowerCase(), m.fromName ?? m.subject ?? null,
  ]))
  const { error: writeError } = await supabase.from('mail_blocks').upsert(
    allowed.map((pattern) => ({
      user_id: input.userId, pattern, kind: 'address', label: labelFor.get(pattern) ?? null,
    })),
    { onConflict: 'user_id,pattern', ignoreDuplicates: true },
  )
  if (writeError) throw new Error(writeError.message)

  const { data: gone, error: sweepError } = await supabase
    .from('user_emails')
    .delete()
    .eq('user_id', input.userId)
    .is('linked_account_id', null)
    .in('from_address', allowed)
    .select('id')
  if (sweepError) throw new Error(sweepError.message)

  return { blocked: allowed, refused, removed: gone?.length ?? 0 }
}

/**
 * Clear out junk in one go.
 *
 * Junk is where the volume is and where nobody wants to read anything, so it earns a single
 * answer rather than a page of ticking. Linked mail is excluded, as everywhere — if a debtor's
 * email was wrongly binned by the mail server and somebody rescued it onto an account, emptying
 * junk must not take it back out.
 *
 * `alsoBlock` is what stops the same senders arriving again tomorrow. The debtor guard applies
 * to it exactly as it does to blockSenders.
 */
export async function emptyJunk(input: {
  userId: string
  alsoBlock: boolean
}): Promise<BlockOutcome & { deleted: number }> {
  let outcome: BlockOutcome = { blocked: [], refused: [], removed: 0 }

  if (input.alsoBlock) {
    const { data, error } = await supabase
      .from('user_emails')
      .select('id, from_address, from_name, subject')
      .eq('user_id', input.userId)
      .eq('is_junk', true)
      .is('linked_account_id', null)
    if (error) throw new Error(error.message)
    const asMail = (data ?? []).map((r) => ({
      id: r.id as string,
      fromAddress: r.from_address as string,
      fromName: (r.from_name as string | null) ?? null,
      subject: (r.subject as string | null) ?? null,
    })) as MailItem[]
    outcome = await blockSenders({ userId: input.userId, mail: asMail })
  }

  // Whatever blocking already swept is gone; this takes the rest.
  const { data: gone, error: deleteError } = await supabase
    .from('user_emails')
    .delete()
    .eq('user_id', input.userId)
    .eq('is_junk', true)
    .is('linked_account_id', null)
    .select('id')
  if (deleteError) throw new Error(deleteError.message)

  return { ...outcome, deleted: (gone?.length ?? 0) + outcome.removed }
}

/** Let a sender back in. Their mail appears again from the next sync, not retroactively. */
export async function unblockSender(id: string): Promise<void> {
  const { error } = await supabase.from('mail_blocks').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * File a message against a debtor account.
 *
 * This is the moment the R13 is earned. Item 6 is "correspondence received AND ATTENDED TO", and
 * an agent reading a message and deciding which account it belongs to is precisely the attending
 * — which makes a hand-filed fee more defensible than one raised because an email arrived.
 *
 * The mailbox row is claimed FIRST, with a conditional update that only matches while it is
 * still unlinked. That is what makes the fee happen once: a double click, a retried request, or
 * two people looking at the same shared address cannot raise two R13s for one email.
 */
export async function linkMailToAccount(input: {
  mail: MailItem
  accountId: string
  actor: { id: string | null; name: string | null }
}): Promise<ChargeResult> {
  const { data: claimed, error: claimError } = await supabase
    .from('user_emails')
    .update({
      linked_account_id: input.accountId,
      linked_at: new Date().toISOString(),
      linked_by: input.actor.id,
      // Filing it is reading it.
      read_at: new Date().toISOString(),
    })
    .eq('id', input.mail.id)
    .is('linked_account_id', null)
    .select('id')
    .maybeSingle<{ id: string }>()
  if (claimError) throw new Error(claimError.message)
  if (!claimed) throw new Error('That email has already been filed against an account.')

  const charge = await chargeItem({
    accountId: input.accountId,
    itemId: CORRESPONDENCE_ITEM_ID,
    actionCode: CORRESPONDENCE_ACTION_CODE,
    description: CORRESPONDENCE_DESCRIPTION,
    createdBy: input.actor.id,
    // Dated when the debtor wrote, not when somebody got round to filing it. A message that
    // arrived on the 30th must not land in the next month's fees because it was filed on the 1st.
    at: new Date(input.mail.occurredAt),
  })

  /*
   * The account's own copy of the message.
   *
   * Written to account_emails so the account page, the timeline and the statement all read from
   * one place, exactly as an auto-matched reply does. The snippet is what we have — the full body
   * is still in the mailbox, and this is the point at which it would be worth fetching if the
   * firm ever wants the whole text on the account.
   */
  const { error: fileError } = await supabase.from('account_emails').insert({
    account_id: input.accountId,
    direction: 'in',
    debtor_address: input.mail.fromAddress,
    subject: input.mail.subject,
    body: input.mail.snippet,
    message_id: input.mail.messageId,
    attachment_names: input.mail.attachmentNames,
    email_folder: input.mail.folder,
    email_uid: input.mail.uid,
    sent_by_name: input.mail.fromName || input.mail.fromAddress,
    received_by: input.actor.id,
    // Filed by hand means somebody has just read it. It is not waiting for anyone.
    read_at: new Date().toISOString(),
    charged_excl_vat: charge.exclVat,
    occurred_at: input.mail.occurredAt,
  })
  if (fileError) console.error('[userMail] filed and charged, but the account copy failed:', fileError.message)

  await addNote({
    accountId: input.accountId,
    body: receivedEmailNote(
      input.mail.fromName || input.mail.fromAddress,
      input.mail.subject ?? '',
      input.mail.snippet ?? '',
    ),
    kind: EMAIL_IN_KIND,
    // The debtor's own words, so it survives "just what people wrote" on the timeline.
    authorName: input.mail.fromName || input.mail.fromAddress,
    createdBy: input.actor.id,
  })
  return charge
}
