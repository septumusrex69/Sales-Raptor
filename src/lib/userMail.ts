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
/*
 * A NOTE ON VOCABULARY.
 *
 * The interface says MATCHED, NEEDS MATCHING and UNMATCH; the database says is_filed,
 * linked_account_id and linked_*. Same thing, two words, at the firm's instruction — "match" is
 * what a collector calls it, and they are right.
 *
 * The columns were deliberately NOT renamed. is_filed is a generated column that the mailbox
 * tabs, the delete guard, the 30-day prune and the nav_counts RPC all read, and renaming it
 * means a migration touching every one of them for a word nobody outside this file sees. Worth
 * doing on a quiet day; not worth doing in the middle of a feature.
 */
import { supabase } from './supabase'
import { refreshNavCounts } from './navCounts'
import { mirrorReadToAccount, mirrorUnreadToAccount } from './mailReadState'
import type { ContactCandidate } from './signature'
import { chargeItem, type ChargeResult } from './accountCharges'
import { addNote } from './accountWorkspace'
import {
  CORRESPONDENCE_ACTION_CODE, CORRESPONDENCE_DESCRIPTION, CORRESPONDENCE_ITEM_ID,
  EMAIL_IN_KIND, receivedEmailNote,
} from './emailRules'

export interface MailItem {
  id: string
  folder: string
  /** Pulled from the Sent folder. Never filed on a record and never charged. */
  isSent: boolean
  /** Who it went to. The useful address on a sent message, where From is always us. */
  toAddress: string | null
  toName: string | null
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
  /**
   * Set once it is on a DEBTOR ACCOUNT — by the sync matching it, or by hand.
   *
   * Not the same question as "is this filed": a message on a lead or a client has this null and
   * is filed all the same. Use `isFiled` for that, and `linkedTo` for where it went. This stays
   * because only an account charges a fee, and the fee rules ask specifically about an account.
   */
  linkedAccountId: string | null
  /** Filed anywhere at all — account, lead, deal, client or contact. */
  isFiled: boolean
  /**
   * Somebody looked at it and decided it belongs on nobody's file.
   *
   * A supplier's invoice, an accountant's note, a service provider. Not junk — it is real work
   * mail you may need again — and not matched, because there is no record for it to go on.
   */
  noRecordAt: string | null
  /** Dealt with, however it was dealt with: matched OR marked as needing no record. */
  isSettled: boolean
  /** Where it was filed, ready to label and link. Null while it is still waiting. */
  linkedTo: LinkedRecord | null
}

/** One of the five things a message can be filed against, named and addressable. */
export interface LinkedRecord {
  kind: 'account' | 'lead' | 'deal' | 'client' | 'contact'
  id: string
  /** What to call it on screen — a debtor, a deal name, a company. */
  label: string
  /** Where it lives in Raptor. */
  path: string
}

interface MailRow {
  id: string
  folder: string
  is_sent: boolean | null
  to_address: string | null
  to_name: string | null
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
  linked_lead_id: string | null
  linked_deal_id: string | null
  linked_company_id: string | null
  linked_contact_id: string | null
  is_filed: boolean
  is_settled: boolean
  no_record_at: string | null
  debtor_accounts: {
    account_number: string | null
    debtor_first_name: string | null
    debtor_surname: string | null
  } | null
  leads: { first_name: string | null; last_name: string | null; company_name: string | null } | null
  deals: { name: string | null } | null
  companies: { name: string | null } | null
  contacts: { first_name: string | null; last_name: string | null } | null
}

/*
 * The five places a message can be filed, each embedded for its name.
 *
 * Five embeds on one row looks expensive and is not: four of them are null on any given message,
 * and PostgREST resolves a null foreign key without touching the other table.
 *
 * THE DEBTOR EMBED NAMES ITS CONSTRAINT, and must. There are now TWO foreign keys from
 * user_emails to debtor_accounts — linked_account_id and moved_from_account_id — so the bare
 * `debtor_accounts ( ... )` form is ambiguous and PostgREST refuses the whole request with
 * "more than one relationship was found". That is not a hypothetical: this exact comment warned
 * about it, the very next migration added the second key, and the mailbox went blank.
 *
 * The other four have one key each and resolve by name. Add a second to any of them and it must
 * be spelled out the same way.
 */
const COLUMNS = `
  id, folder, is_sent, to_address, to_name, uid, message_id, from_address, from_name, subject, snippet,
  attachment_names, is_junk, occurred_at, read_at, is_filed, is_settled, no_record_at,
  linked_account_id, linked_lead_id, linked_deal_id, linked_company_id, linked_contact_id,
  debtor_accounts!user_emails_linked_account_id_fkey ( account_number, debtor_first_name, debtor_surname ),
  leads ( first_name, last_name, company_name ),
  deals ( name ),
  companies ( name ),
  contacts ( first_name, last_name )
`

/** Join the parts of a person's name, or nothing at all if we have none of them. */
const fullName = (...parts: (string | null | undefined)[]) =>
  parts.filter(Boolean).join(' ') || null

/**
 * Where this message was filed, as one thing the page can label and link.
 *
 * Order matters. A debtor account wins over everything: it is the only destination that raises a
 * fee, and if a row somehow carried both, saying "on a lead" while a debtor has been charged R13
 * would be the misleading half. After that, most specific first — a deal says more than the
 * client it belongs to, and the sync fills both in on a threaded reply.
 */
function linkedRecord(r: MailRow): LinkedRecord | null {
  if (r.linked_account_id) {
    return {
      kind: 'account',
      id: r.linked_account_id,
      label: fullName(r.debtor_accounts?.debtor_first_name, r.debtor_accounts?.debtor_surname)
        ?? r.debtor_accounts?.account_number ?? 'a debtor account',
      path: `/accounts/${r.linked_account_id}`,
    }
  }
  if (r.linked_deal_id) {
    return { kind: 'deal', id: r.linked_deal_id, label: r.deals?.name ?? 'a deal', path: `/deals/${r.linked_deal_id}` }
  }
  if (r.linked_lead_id) {
    return {
      kind: 'lead',
      id: r.linked_lead_id,
      label: fullName(r.leads?.first_name, r.leads?.last_name) ?? r.leads?.company_name ?? 'a lead',
      path: `/leads/${r.linked_lead_id}`,
    }
  }
  if (r.linked_company_id) {
    return { kind: 'client', id: r.linked_company_id, label: r.companies?.name ?? 'a client', path: `/companies/${r.linked_company_id}` }
  }
  if (r.linked_contact_id) {
    return {
      kind: 'contact',
      id: r.linked_contact_id,
      label: fullName(r.contacts?.first_name, r.contacts?.last_name) ?? 'a contact',
      path: `/contacts/${r.linked_contact_id}`,
    }
  }
  return null
}

function toItem(r: MailRow): MailItem {
  return {
    id: r.id,
    folder: r.folder,
    isSent: !!r.is_sent,
    toAddress: r.to_address ?? null,
    toName: r.to_name ?? null,
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
    isFiled: r.is_filed,
    noRecordAt: r.no_record_at,
    isSettled: r.is_settled,
    linkedTo: linkedRecord(r),
  }
}

export type MailFilter = 'needs-filing' | 'filed' | 'no-record' | 'junk' | 'sent' | 'all'

/**
 * A page of the mailbox.
 *
 * Paged, not fetched whole, and this is not premature: 75 messages a day for 30 days is over
 * 2 000 rows per agent. `search` matches sender and subject — the two things somebody actually
 * remembers about an email they are looking for.
 */
/** What a mailbox query is narrowed by — shared so the list and its count cannot disagree. */
export interface MailScope {
  filter: MailFilter
  search?: string
  /** Only messages not yet read. Composes with the tab rather than replacing it. */
  unreadOnly?: boolean
}

/**
 * Apply a scope to a user_emails query.
 *
 * Extracted because the unread COUNT on the tab strip has to mean exactly what the unread LIST
 * shows. Two copies of these clauses would drift the first time one of them changed, and the
 * symptom is the worst kind: a badge that says 3 over a list of 5.
 *
 * The cast is deliberate. Constraining the generic to PostgrestFilterBuilder's own shape makes
 * tsc give up with "type instantiation is excessively deep" — its generics carry the whole row
 * type through every call. Narrowable names only the three methods used here, and each of them
 * genuinely returns the same builder, so the cast back to Q is sound.
 */
interface Narrowable {
  eq(column: string, value: unknown): Narrowable
  is(column: string, value: unknown): Narrowable
  not(column: string, operator: string, value: unknown): Narrowable
  or(filters: string): Narrowable
}

function scope<Q>(q: Q, input: MailScope): Q {
  let out = q as Narrowable

  /*
   * is_settled, not is_filed. A message matched to a record is settled; so is one somebody has
   * marked as needing no record — a supplier's invoice, an accountant's note. Both have been
   * dealt with, and a queue that keeps showing what you have already dealt with is a queue
   * nobody reads. See the generated column in schema.sql.
   */
  if (input.filter === 'needs-filing') out = out.eq('is_settled', false).eq('is_junk', false).eq('is_sent', false)
  /*
   * WHAT WE SENT, including from Outlook or a phone — the Sent folder is synced, so this is the
   * whole of it rather than only what Raptor sent itself.
   *
   * Its own tab and in no other. Sent mail is not waiting to be matched, is not junk, and is not
   * part of the incoming working list; a Sent folder emptied into "All" is two thousand messages
   * nobody is looking for on top of the ones they are.
   */
  else if (input.filter === 'sent') out = out.eq('is_sent', true)
  // Matched means ON A RECORD, and only that. No-record mail has its own tab: putting it here
  // would have the Matched list claiming a supplier is on somebody's file.
  else if (input.filter === 'filed') out = out.eq('is_filed', true)
  /*
   * Suppliers, the accountant, the telephone provider — and NOT what you sent.
   *
   * no_record_at carries two different meanings, and reading it alone conflated them. On an
   * incoming message it is a decision somebody made: this belongs on nobody's file. On a SENT
   * message the sync sets it only to keep the Sent folder out of the matching queue (see
   * fileUserEmail), and that is not the same statement at all.
   *
   * Without the is_sent clause this tab showed every message the agent had ever sent, mixed in
   * among the suppliers it exists for. On the firm's own mailbox that was 24 of the 53 rows —
   * and it is what "I have many unread emails at No record needed" turned out to mean.
   */
  else if (input.filter === 'no-record') out = out.not('no_record_at', 'is', null).eq('is_sent', false)
  else if (input.filter === 'junk') out = out.eq('is_junk', true)
  /*
   * "All" means the whole mailbox EXCEPT junk, at the firm's instruction: "normal mailbox goes
   * to all, junk still goes to junk, junk doesn't go to all".
   *
   * Which makes All the working list rather than an audit of everything, and that is the point —
   * junk is where the volume is, and a list that mixes a hundred newsletters into the messages
   * somebody has to act on is a list nobody works. Junk has its own tab and its own bulk clear.
   *
   * This stays a plain equality rather than "junk unless filed" because FILING CLEARS THE JUNK
   * FLAG (see linkMailToAccount and linkMailToRecord). Deciding a message belongs on a debtor's
   * account is the strongest possible statement that it is not spam, so the two states are made
   * mutually exclusive at the moment of filing instead of every query having to ask for both.
   * Without that, a debtor's reply the mail server misfiled as spam would be rescued onto an
   * account and then vanish from All anyway.
   */
  else if (input.filter === 'all') out = out.eq('is_junk', false).eq('is_sent', false)

  /*
   * Unread NARROWS whichever tab you are on rather than being a sixth tab of its own.
   *
   * "Unread junk" and "unread that still needs filing" are both real questions, and a tab could
   * only answer one of them. A toggle answers all five.
   */
  if (input.unreadOnly) out = out.is('read_at', null)

  const term = input.search?.trim()
  if (term) {
    // Commas and parentheses would be read as `or()` syntax rather than as text.
    const safe = term.replace(/[,()]/g, ' ')
    const fields = [
      `from_address.ilike.%${safe}%`,
      `subject.ilike.%${safe}%`,
      `from_name.ilike.%${safe}%`,
    ]
    /*
     * On the Sent tab, search the RECIPIENT as well — and only there.
     *
     * Searching a sent message by sender is searching for yourself, so until now the Sent tab's
     * search could only match a subject line. The recipient is the thing anybody actually
     * remembers about a message they sent.
     *
     * Deliberately not added to the other tabs. The sync records to_address on every message,
     * incoming ones included, where it holds OUR address — so searching it everywhere would make
     * the firm's own address match every message in the mailbox.
     */
    if (input.filter === 'sent') {
      fields.push(`to_address.ilike.%${safe}%`, `to_name.ilike.%${safe}%`)
    }
    out = out.or(fields.join(','))
  }

  return out as Q
}

/** Unread, per tab — one number for each place a person can look. */
export type MailUnreadCounts = Record<MailFilter, number>

/** Nothing unread anywhere. Used while the first count is in flight, and when it fails. */
export const NO_UNREAD: MailUnreadCounts = {
  all: 0, 'needs-filing': 0, filed: 0, 'no-record': 0, junk: 0, sent: 0,
}

/**
 * How much unread mail is sitting behind each tab.
 *
 * The firm's complaint that this answers: "I have many unread emails at No record needed and
 * there is no indication that there is an unread email." There was one count on the page, it was
 * shown on two tabs, and every other tab could be full of unread mail and say nothing.
 *
 * ONE ROUND TRIP for all six, through mail_unread_counts(). Six separate head-counts would be
 * six requests on every load and after every action, and they would arrive at different moments
 * — so the strip could show a set of numbers that were never all true at once.
 *
 * NOT scoped to the search box, deliberately. A tab badge answers "what is in this tab", which
 * is a fact about the mailbox; narrowing it as somebody types would make the numbers flicker
 * while they hunt for one message, and the list itself already shows what the search found.
 *
 * The SQL mirrors scope() above clause for clause. They are the same question in two languages,
 * and scripts/qa/check-mail-counts.mjs fails when they drift.
 */
export async function fetchMailUnreadCounts(): Promise<MailUnreadCounts> {
  const { data, error } = await supabase.rpc('mail_unread_counts')
  if (error) throw new Error(error.message)
  const row = (Array.isArray(data) ? data[0] : data) as {
    all_mail: number; needs_matching: number; matched: number
    no_record: number; junk: number; sent: number
  } | undefined
  return {
    all: Number(row?.all_mail ?? 0),
    'needs-filing': Number(row?.needs_matching ?? 0),
    filed: Number(row?.matched ?? 0),
    'no-record': Number(row?.no_record ?? 0),
    junk: Number(row?.junk ?? 0),
    sent: Number(row?.sent ?? 0),
  }
}

export async function fetchMail(input: MailScope & {
  userId: string
  /** Rows to skip, for paging. */
  offset?: number
  limit?: number
}): Promise<{ items: MailItem[]; more: boolean }> {
  const limit = input.limit ?? 50
  const offset = input.offset ?? 0

  const q = scope(
    supabase.from('user_emails').select(COLUMNS).eq('user_id', input.userId),
    input,
  )

  // One row past the page, so "is there more" needs no second count query.
  const { data, error } = await q
    .order('occurred_at', { ascending: false })
    .range(offset, offset + limit)
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as unknown as MailRow[]
  return { items: rows.slice(0, limit).map(toItem), more: rows.length > limit }
}

/*
 * countNeedsFiling is gone, and its absence is the point.
 *
 * It counted unsettled AND UNREAD mail, while the Needs matching tab listed unsettled mail
 * whatever its read state — so reading five unmatched messages took the badge to nought over a
 * list of five. That is the "badge saying 3 over a list of 5" this file warns about in scope(),
 * and it had grown a third variant: the sidebar counted something different again.
 *
 * There is now ONE answer per tab, from one query, in fetchMailUnreadCounts above.
 */

/**
 * This belongs on nobody's file.
 *
 * The third answer to "what is this?", beside matching it and calling it junk. A telephone
 * provider, an accountant, a supplier: real work mail that is not junk, whose sender must not be
 * blocked because you need their mail, and which belongs to no debtor, lead or client. Without
 * this it sat in Needs matching for ever, and a work queue with permanent residents is a work
 * queue nobody reads.
 *
 * It does NOT mark the message read. Deciding a supplier's invoice needs no record says nothing
 * about whether anybody has read the invoice, and those are two different jobs.
 *
 * Refused on mail that is already on a record — that mail is somebody's history and a fee may
 * have been raised against it, so "needs no record" would be a plain contradiction.
 */
export async function markNoRecordNeeded(ids: string[], actorId: string | null): Promise<number> {
  if (ids.length === 0) return 0
  const { data, error } = await supabase
    .from('user_emails')
    .update({
      no_record_at: new Date().toISOString(),
      no_record_by: actorId,
      // Saying it needs no record is a decision about it, which is the opposite of spam.
      is_junk: false,
    })
    .in('id', ids)
    .eq('is_filed', false)
    .select('id')
  if (error) throw new Error(error.message)
  refreshNavCounts()
  return (data ?? []).length
}

/** Put it back in the queue — the decision was wrong, or something changed. */
export async function clearNoRecordNeeded(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const { data, error } = await supabase
    .from('user_emails')
    .update({ no_record_at: null, no_record_by: null })
    .in('id', ids)
    .not('no_record_at', 'is', null)
    .select('id')
  if (error) throw new Error(error.message)
  refreshNavCounts()
  return (data ?? []).length
}

/** A standing decision about one sender: their mail never needs matching. */
export interface SenderRule {
  id: string
  pattern: string
  kind: 'address' | 'domain'
  label: string | null
  createdAt: string
}

export async function fetchSenderRules(userId: string): Promise<SenderRule[]> {
  const { data, error } = await supabase
    .from('mail_sender_rules')
    .select('id, pattern, kind, label, created_at')
    .eq('user_id', userId)
    .eq('action', 'no_record')
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
 * Stop asking about this sender, for good.
 *
 * The per-message action is lost on a supplier who writes every week — you would settle the same
 * sender over and over. This settles their mail as it arrives, so it lands in All already dealt
 * with and never joins the queue.
 *
 * It also settles what is already sitting there, which is what somebody means by "stop asking
 * about them": a rule that only applied to future mail would leave today's four copies in the
 * queue and look broken.
 *
 * NOT a block, and the difference matters. Their mail still arrives, is still searchable, and can
 * still be matched later if it turns out to belong on a record after all. Nothing goes missing.
 */
export async function addSenderRule(input: {
  userId: string
  address: string
  scope: 'address' | 'domain'
  label?: string | null
}): Promise<{ pattern: string; settled: number }> {
  const address = input.address.trim().toLowerCase()
  if (!address.includes('@')) throw new Error('That is not an email address.')

  let pattern = address
  if (input.scope === 'domain') {
    /*
     * The same guard the blocklist uses, for the same reason: on a shared provider a debtor
     * writing from gmail.com is the normal case, and a rule there would settle their reply
     * before anybody looked at it. Less costly than a block — the mail still arrives — but it
     * would still take a debtor's reply out of the queue, which is exactly the queue's job.
     */
    const problem = domainBlockProblem(address)
    if (problem) throw new Error(problem)
    pattern = domainOf(address)!
  }

  const { error } = await supabase
    .from('mail_sender_rules')
    .upsert(
      { user_id: input.userId, pattern, kind: input.scope, action: 'no_record', label: input.label ?? null },
      { onConflict: 'user_id,pattern', ignoreDuplicates: true },
    )
  if (error) throw new Error(error.message)

  // Settle what is already here. Matched mail is left alone: it is on a record already.
  let q = supabase.from('user_emails')
    .update({ no_record_at: new Date().toISOString() })
    .eq('user_id', input.userId)
    .eq('is_filed', false)
    .is('no_record_at', null)
  q = input.scope === 'domain'
    ? q.ilike('from_address', `%@${pattern}`)
    : q.ilike('from_address', pattern)
  const { data: settled, error: sweepError } = await q.select('id')
  if (sweepError) throw new Error(sweepError.message)

  refreshNavCounts()
  return { pattern, settled: settled?.length ?? 0 }
}

/** Start asking about them again. Mail already settled stays settled — see the note on the tab. */
export async function removeSenderRule(id: string): Promise<void> {
  const { error } = await supabase.from('mail_sender_rules').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Is there already a standing rule covering this sender? */
export function ruledBy(address: string, rules: SenderRule[]): SenderRule | null {
  const clean = address.trim().toLowerCase()
  const domain = domainOf(clean)
  return rules.find((r) => (r.kind === 'address' ? r.pattern === clean : r.pattern === domain)) ?? null
}

/**
 * A picture that was drawn into a message rather than attached to it — a signature, nearly
 * always, which is the case this exists for: a great many South African firms sign off with one
 * flat image, and until now that image simply vanished on the way to the screen.
 *
 * Declared here rather than imported from api/_lib/emailSync, which is where the server's copy
 * lives. That module pulls in imapflow and mailparser; importing its types would drag a mail
 * server's worth of code into the browser bundle for the sake of three field names.
 */
export interface InlineImage {
  /** The cid the message's HTML referred to it by, where it had one. */
  cid: string
  filename: string
  /**
   * The bytes themselves, as a data: URI.
   *
   * Not a URL, and that is the point. A remote image in a debtor's email is how a sender finds
   * out their mail was opened and when; carrying the bytes inline means the browser asks
   * nobody for anything, so opening a message tells the outside world nothing.
   */
  dataUri: string
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
export async function fetchMailBody(
  mailId: string,
  accessToken: string,
): Promise<{
  text: string; details: ContactCandidate[]; images: InlineImage[]; imagesSkipped: number
}> {
  const res = await fetch('/api/email/attachment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ mailId }),
  })
  const body = (await res.json().catch(() => ({}))) as {
    text?: string; details?: ContactCandidate[]; images?: InlineImage[]
    imagesSkipped?: number; error?: string
  }
  if (!res.ok) throw new Error(body.error ?? 'Could not read that message.')
  // `details` are read off the message's HTML on the server — see findLinkedDetails. They are
  // what an image signature gives up, since its text yields nothing.
  return {
    text: body.text ?? '',
    details: body.details ?? [],
    images: body.images ?? [],
    imagesSkipped: body.imagesSkipped ?? 0,
  }
}

/**
 * One attachment off a message, handed to the browser to save.
 *
 * Nothing is stored in Raptor — the file is pulled out of the mailbox on demand and streamed
 * straight through, which is the same bargain the CRM side already makes. At this mailbox's
 * volume, copying every attachment in would be roughly 4 GB a year of files nobody opens.
 *
 * `accountEmailId` reads a debtor's correspondence rather than your own mail: the account's
 * copy, readable by any collector, fetched from the mailbox it actually arrived in.
 *
 * A blob rather than a plain link, because the request needs an Authorization header and a link
 * cannot carry one.
 */
export async function downloadAttachment(input: {
  mailId?: string
  accountEmailId?: string
  filename: string
  accessToken: string
}): Promise<void> {
  const res = await fetch('/api/email/attachment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.accessToken}` },
    body: JSON.stringify({
      mailId: input.mailId,
      accountEmailId: input.accountEmailId,
      filename: input.filename,
    }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? 'Could not download that attachment.')
  }
  const url = URL.createObjectURL(await res.blob())
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = input.filename
    link.click()
  } finally {
    // Revoked whatever happened, so a failed save does not leak the blob for the page's life.
    URL.revokeObjectURL(url)
  }
}

export async function markMailRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { data, error } = await supabase
    .from('user_emails')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids)
    .is('read_at', null)
    // The ids of what actually changed, so the account copies can follow. Rows already read are
    // not returned, which is exactly right: they were mirrored the first time.
    .select('message_id')
  if (error) throw new Error(error.message)

  // Read here means read on the debtor's file too. See mailReadState.
  await mirrorReadToAccount((data ?? []).map((r) => r.message_id as string | null))
  refreshNavCounts()
}

/**
 * Put a message back to unread.
 *
 * The one that gets used most, in practice, is one message at a time: you open a debtor's reply,
 * see it needs a payment arrangement drawn up and twenty minutes you do not have, and put it back
 * the way you found it so it is still waiting after lunch. Without this, opening a message to see
 * whether it was urgent is the same act as deciding it was not.
 *
 * Narrowed to rows that were actually read, so the returned ids are the ones that genuinely
 * changed and the account copies follow only those — the same bargain markMailRead makes.
 */
export async function markMailUnread(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { data, error } = await supabase
    .from('user_emails')
    .update({ read_at: null })
    .in('id', ids)
    .not('read_at', 'is', null)
    .select('message_id')
  if (error) throw new Error(error.message)

  await mirrorUnreadToAccount((data ?? []).map((r) => r.message_id as string | null))
  refreshNavCounts()
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
    .eq('is_filed', false)
    .select('id')
  if (error) throw new Error(error.message)
  refreshNavCounts()
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

/**
 * Is this sender on the agent's blocklist, and if so under which entry?
 *
 * Worth showing on a message, even though a blocked sender never becomes a mailbox row: mail
 * that arrived BEFORE the block is still here, and filed mail survives the block sweep
 * deliberately. So a filed message can sit there looking ordinary while nothing further from
 * that sender will ever reach Raptor again — which matters a great deal if the sender turns out
 * to be a debtor. Saying it on the row is how somebody notices in time to unblock.
 */
export function blockedBy(address: string, blocks: BlockedSender[]): BlockedSender | null {
  const addr = address.trim().toLowerCase()
  if (!addr) return null
  const domain = domainOf(addr)
  return blocks.find((b) => (b.kind === 'address' ? b.pattern === addr : b.pattern === domain)) ?? null
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

/** The debtor whose file an address is saved on, when there is one. */
export interface DebtorFile {
  contactId: string
  accountId: string
  /** The debtor's name, for saying out loud which file it is on. */
  label: string
  accountNumber: string | null
}

/**
 * Whose file is this address saved on?
 *
 * The guard that matters most. Blocking an address that belongs to a debtor would stop their
 * mail reaching us at all, and because a blocked sender never becomes a row, nobody would ever
 * find out — the account would simply look unworked. Retired contacts count: "retired" means we
 * stopped writing to it, not that mail from it is somebody else's.
 *
 * It returns WHICH account rather than a yes or no, and that is not decoration. A refusal that
 * only says "this is on a debtor's file" is a dead end: the address got there by a tick box at
 * matching time, the agent has no memory of ticking it, and there is nothing on the screen
 * saying where to go. Naming the account — and linking to it — turns the same refusal into two
 * clicks. That happened for real: a Yahoo Finance newsletter was matched to a debtor, its
 * address was saved as a contact, and blocking it became impossible with no way to find out why.
 */
export async function debtorFileFor(address: string): Promise<DebtorFile | null> {
  const { data, error } = await supabase
    .from('account_contacts')
    .select('id, account_id, debtor_accounts ( debtor_first_name, debtor_surname, account_number )')
    .eq('kind', 'email')
    .ilike('value', address.trim().toLowerCase())
    .limit(1)
  if (error) throw new Error(error.message)
  const row = (data ?? [])[0]
  if (!row) return null
  const account = row.debtor_accounts as unknown as {
    debtor_first_name: string | null; debtor_surname: string | null; account_number: string | null
  } | null
  return {
    contactId: row.id as string,
    accountId: row.account_id as string,
    label: [account?.debtor_first_name, account?.debtor_surname].filter(Boolean).join(' ')
      || 'a debtor account',
    accountNumber: account?.account_number ?? null,
  }
}

/**
 * Take an address off a debtor's file.
 *
 * Deleted rather than retired, and that is deliberate: retiring says "this reached the debtor and
 * has stopped working", which is a fact about the debtor worth keeping. This is for an address
 * that was never theirs — saved by the tick box when a message was matched to the wrong account.
 * Keeping it would leave the block refused for ever, and leave a newsletter looking like a way to
 * reach somebody it has never reached.
 *
 * Scoped to the account AND the address, so it cannot take an address off a file it is not on.
 */
export async function removeAccountContact(accountId: string, address: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('account_contacts')
    .delete()
    .eq('account_id', accountId)
    .eq('kind', 'email')
    .ilike('value', address.trim().toLowerCase())
    .select('id')
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

  const onFile = await debtorFileFor(address)
  if (onFile) {
    throw new Error(
      `${address} is saved as a contact on ${onFile.label}`
      + `${onFile.accountNumber ? ` (${onFile.accountNumber})` : ''}. Blocking it would stop their `
      + 'mail reaching Raptor at all, and nobody would see it go missing. Take the address off '
      + 'that account first.',
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
    .eq('is_filed', false)
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
    .eq('is_filed', false)
    .in('from_address', allowed)
    .select('id')
  if (sweepError) throw new Error(sweepError.message)

  refreshNavCounts()
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
      .eq('is_filed', false)
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
    .eq('is_filed', false)
    .select('id')
  if (deleteError) throw new Error(deleteError.message)

  refreshNavCounts()
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
      // And filing it says it is not spam, whatever the mail server thought. Without this a
      // debtor's reply rescued out of Junk would be filed on their account and still not appear
      // in All, which excludes junk.
      is_junk: false,
      // Matching is the strongest statement anybody can make about a message, so it overrides
      // "needs no record" exactly as it overrides junk. A supplier's mail that turns out to be a
      // debtor's simply matches, rather than having to be un-settled first. The database holds
      // the two apart with a check constraint — see schema.sql.
      no_record_at: null,
      no_record_by: null,
    })
    .eq('id', input.mail.id)
    .eq('is_filed', false)
    /*
     * AND NOT A MESSAGE WE SENT. This is a money guard, not a tidiness one.
     *
     * fileOnAccount raises item 6 — "correspondence received and attended to", R13 — against the
     * debtor. Run on a sent message that bills them for the firm's own letter, on top of the R25
     * under item 1(a) they were already charged when it went out; it also writes the account's
     * copy with direction 'in' and OUR address as the debtor's, and puts "Email from <the agent>"
     * on their timeline. api/_lib/emailSync.ts routes the Sent folder away from this code for
     * precisely this reason, and the Match button in the mailbox walked around it.
     *
     * In the claim rather than an early return, so a crafted request is refused by the same
     * conditional update that makes the fee happen once.
     */
    .eq('is_sent', false)
    .select('id')
    .maybeSingle<{ id: string }>()
  if (claimError) throw new Error(claimError.message)
  if (!claimed) {
    // Named apart, because "already filed" would send somebody looking for a match that is not
    // there. A sent message is not waiting to be matched and never was.
    throw new Error(input.mail.isSent
      ? 'That is a message you sent, so it cannot be matched to an account. It was charged under '
        + 'item 1(a) when it went out.'
      : 'That email has already been filed.')
  }

  return fileOnAccount({ mail: input.mail, accountId: input.accountId, actor: input.actor })
}

/**
 * Put a message on an account: the fee, the account's copy, and the timeline entry.
 *
 * Split out of linkMailToAccount so that moving a mis-filed message goes through EXACTLY this
 * code rather than a second copy of it. Two ways to put an email on an account is two ways for
 * them to disagree about what a debtor was charged.
 *
 * Claiming the mailbox row is deliberately NOT part of this — the two callers claim differently.
 * Filing claims an unfiled row; moving claims a row away from the account it is already on.
 */
async function fileOnAccount(input: {
  mail: MailItem
  accountId: string
  actor: { id: string | null; name: string | null }
}): Promise<ChargeResult> {
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

  // Filed, so it is no longer waiting: the Mail badge drops now rather than at the next poll.
  refreshNavCounts()
  return charge
}

/**
 * Save contact details a debtor gave us, onto their account.
 *
 * The point is not the record — it is that findAccount() matches incoming mail against
 * account_contacts where kind = 'email'. Save the address once and every future email from it
 * files ITSELF, and the mailbox gets permanently quieter. That is the whole return on this.
 *
 * Which is also why it is never automatic. Auto-filing auto-charges item 6, so an address saved
 * against the wrong debtor does not cause one wrong R13 — it causes a recurring one, silently,
 * until somebody notices. A person ticks these.
 *
 * `source: 'email'` marks where they came from, so a later audit can tell a detail somebody
 * confirmed on a call from one lifted out of a message.
 */
export async function saveAccountContacts(input: {
  accountId: string
  details: { kind: 'email' | 'mobile' | 'phone'; value: string; label?: string }[]
  actor: { id: string | null }
}): Promise<number> {
  if (input.details.length === 0) return 0

  /*
   * Skip what the account already has. account_contacts has no unique index — deliberately, a
   * debtor can have two mobiles — so duplicates are prevented here rather than by the database.
   * Compared case-insensitively and without spaces, since "083 441 9922" and "0834419922" are
   * the same number to everyone except a string comparison.
   */
  const flat = (v: string) => v.replace(/\s+/g, '').toLowerCase()
  const { data: existing } = await supabase
    .from('account_contacts')
    .select('value')
    .eq('account_id', input.accountId)
  const have = new Set((existing ?? []).map((r) => flat(r.value as string)))

  const rows = input.details
    .filter((d) => !have.has(flat(d.value)))
    .map((d) => ({
      account_id: input.accountId,
      kind: d.kind,
      value: d.value,
      label: d.label ?? null,
      source: 'email',
      created_by: input.actor.id,
    }))
  if (rows.length === 0) return 0

  const { error } = await supabase.from('account_contacts').insert(rows)
  if (error) throw new Error(error.message)
  return rows.length
}

/**
 * File a message against a CRM record — a lead, a deal, a client or a contact.
 *
 * NOTHING IS CHARGED, and that is the difference that matters. Annexure B is the tariff for
 * collecting a debt; a lead answering a quotation owes the firm nothing, so there is no account
 * to charge and no item that would apply. Filing to a debtor raises R13 under item 6; filing
 * here raises nothing at all. The two look similar on screen and must never be the same code
 * path, which is why this is a separate function rather than a flag on the one above.
 *
 * The message goes onto the record's timeline as an Email activity, which is where the CRM
 * already keeps correspondence — the same table and the same shape the sync writes when it
 * matches a reply on its own. `email_message_id` carries the mail server's own id so a later
 * reply threads onto this one instead of arriving as a fresh message nobody can place.
 *
 * Claimed first, exactly as the account path is, and for the same reason: a double click or a
 * retried request must not put the same email on a timeline twice.
 */
export async function linkMailToRecord(input: {
  mail: MailItem
  to: { kind: 'lead' | 'deal' | 'client' | 'contact'; id: string; label: string }
  actor: { id: string | null; name: string | null }
}): Promise<void> {
  const column = {
    lead: 'linked_lead_id',
    deal: 'linked_deal_id',
    client: 'linked_company_id',
    contact: 'linked_contact_id',
  }[input.to.kind]

  const { data: claimed, error: claimError } = await supabase
    .from('user_emails')
    .update({
      [column]: input.to.id,
      linked_at: new Date().toISOString(),
      linked_by: input.actor.id,
      // Filing it is reading it, and says it is not spam. See linkMailToAccount.
      read_at: new Date().toISOString(),
      is_junk: false,
      // And it overrides "needs no record", for the reason given in linkMailToAccount.
      no_record_at: null,
      no_record_by: null,
    })
    .eq('id', input.mail.id)
    .eq('is_filed', false)
    // Nothing is charged here, but the entry would still be wrong: it files the message as
    // "Email received" on the record, and we sent it. Same guard, cheaper consequence.
    .eq('is_sent', false)
    .select('id')
    .maybeSingle<{ id: string }>()
  if (claimError) throw new Error(claimError.message)
  if (!claimed) {
    throw new Error(input.mail.isSent
      ? 'That is a message you sent, so it cannot be matched to a record.'
      : 'That email has already been filed.')
  }

  const { error } = await supabase.from('activities').insert({
    type: 'Email',
    user_id: input.actor.id,
    lead_id: input.to.kind === 'lead' ? input.to.id : null,
    deal_id: input.to.kind === 'deal' ? input.to.id : null,
    company_id: input.to.kind === 'client' ? input.to.id : null,
    contact_id: input.to.kind === 'contact' ? input.to.id : null,
    subject: `Email received: ${input.mail.subject || '(no subject)'}`,
    notes: input.mail.snippet ?? '',
    activity_date: input.mail.occurredAt,
    email_message_id: input.mail.messageId,
    email_folder: input.mail.folder,
    email_uid: input.mail.uid,
    attachment_names: input.mail.attachmentNames,
    is_read: true,
  })
  /*
   * Not thrown. The message is already filed — it is off the working list and linked to the
   * record — and an error here would leave the agent looking at a red box for a message that
   * did, in fact, get filed. The timeline entry is the part worth logging loudly and the part
   * somebody can add by hand.
   */
  if (error) console.error('[userMail] filed, but the timeline entry failed:', error.message)

  refreshNavCounts()
}

/**
 * Record a reply we sent to a lead, a deal, a client or a contact.
 *
 * The counterpart to linkMailToRecord, which files an INCOMING message on the same records. This
 * is the outgoing half, and it was missing: replying from the mailbox to mail filed on a lead
 * told the agent "Reply sent and logged on Acme" and logged nothing anywhere. The message went,
 * and the record it was supposedly about never heard about it.
 *
 * NOTHING IS CHARGED, exactly as on the way in. Annexure B is the tariff for collecting a debt,
 * and a lead answering a quotation owes the firm nothing. A reply to a DEBTOR goes through
 * recordSentEmail instead, which raises item 1(a) — the two must stay separate functions, since
 * the difference between them is a charge on somebody's statement.
 *
 * `email_message_id` is the part that earns its keep beyond honesty. api/_lib/emailSync.ts
 * threads an incoming reply by looking up In-Reply-To against this column, so recording the id
 * here is what lets THEIR answer come back to this same lead or deal on its own. Without it the
 * reply can only be matched on the sender's address, which finds the client but not which of
 * their five open deals is being discussed.
 *
 * Never throws. The message has already left; failing to write a timeline entry is a thinner
 * record, not a lost email, and an error box after a reply has demonstrably gone is worse than
 * the gap it reports.
 */
export async function recordSentToRecord(input: {
  to: { kind: 'lead' | 'deal' | 'client' | 'contact'; id: string }
  /** Who it went to, for the timeline to name. */
  toAddress: string
  /** Carries the composer's own "Email sent: " framing, which is the CRM activity convention. */
  subject: string
  body: string
  /**
   * The sent message's own Message-ID, so their reply threads back onto this record.
   *
   * The message this one ANSWERS is deliberately not recorded: activities has no column for it
   * (only email_message_id, email_folder and email_uid), and threading does not need one —
   * emailSync looks an incoming reply's In-Reply-To up against this column, so the id we write
   * here is the whole of the mechanism.
   */
  messageId: string | null
  /** What went with it, so the record shows the quotation was actually attached. */
  attachmentNames?: string[]
  actor: { id: string | null; name: string | null }
}): Promise<void> {
  const { error } = await supabase.from('activities').insert({
    type: 'Email',
    user_id: input.actor.id,
    lead_id: input.to.kind === 'lead' ? input.to.id : null,
    deal_id: input.to.kind === 'deal' ? input.to.id : null,
    company_id: input.to.kind === 'client' ? input.to.id : null,
    contact_id: input.to.kind === 'contact' ? input.to.id : null,
    subject: input.subject,
    notes: input.body,
    activity_date: new Date().toISOString(),
    email_message_id: input.messageId,
    attachment_names: input.attachmentNames ?? [],
    // We wrote it, so there is nobody waiting to read it.
    is_read: true,
  })
  if (error) console.error('[userMail] the reply went, but the timeline entry failed:', error.message)
}

/**
 * Move mail into junk, or back out of it.
 *
 * The mail server's spam verdict is a guess, and it is wrong in both directions: a newsletter it
 * waves through still has to be dealt with by hand, and a debtor writing from a free address
 * lands in Junk often enough that emptying that tab unread would be reckless. So the agent can
 * overrule it either way.
 *
 * Junk is a shelf, not a bin. Nothing is deleted — the message keeps its row, keeps its snippet
 * and is still there under the Junk tab, where "Empty junk" is the deliberate second step that
 * actually removes it. And it stays in the real mailbox regardless; Raptor has never deleted
 * anything from the mail server.
 *
 * Filed mail is refused. A message on a debtor's account is a record, it raised a fee, and
 * hiding it in Junk would take it out of All while leaving it on the account — two places
 * disagreeing about the same message, which is the thing the shared read state was built to
 * stop.
 */
export async function setJunk(ids: string[], junk: boolean): Promise<number> {
  if (ids.length === 0) return 0
  const { data, error } = await supabase
    .from('user_emails')
    .update({
      is_junk: junk,
      // Junking something you had already settled is a change of mind, and junk is the later
      // decision — so it wins. Without this the row would sit in Junk and in No record needed at
      // the same time, and nobody reading the screen could say which was true.
      ...(junk ? { no_record_at: null, no_record_by: null } : {}),
    })
    .in('id', ids)
    .eq('is_filed', false)
    .select('id')
  if (error) throw new Error(error.message)

  // Junk is excluded from the sidebar count, so moving mail either way changes it.
  refreshNavCounts()
  return data?.length ?? 0
}

/**
 * Move a message that was filed on the wrong debtor account.
 *
 * ADMINISTRATOR ONLY, at the firm's instruction — and enforced by the protect_filed_mail_target
 * trigger, not by the button that calls this. See canRefileMail.
 *
 * THE ORIGINAL FEE IS NOT TOUCHED. That is the firm's rule and it is deliberate: a debtor's
 * statement is not rewritten after the fact, because fees flow into remittances and a remittance
 * that has been processed cannot be unwound. Corrections are made forward, in the remittance,
 * by finance. So the R13 raised on the wrong account stands.
 *
 * NOR IS THE ORIGINAL FILING REMOVED. Keeping the fee while deleting the email that justifies it
 * would leave a charge on a statement with nothing behind it — the worst of both. The message
 * stays where it was, so the R13 still has the correspondence behind it.
 *
 * NOTHING IS WRITTEN ON THAT ACCOUNT SAYING IT WAS AN ERROR. That was the first version and the
 * firm was right to stop it: account notes have no visibility flag, so the words reach the
 * debtor on a statement and invite the query they were meant to answer. The correction lives on
 * the mailbox row, which only the firm sees, and the statement side is handled properly later,
 * in the remittance.
 *
 * The destination is then filed normally, fee and all: the correspondence really is on that
 * debtor's file now, really was attended to, and item 6 applies exactly as it would have if it
 * had been filed correctly the first time.
 *
 * Net effect is R13 on each of two accounts for one email. That is understood and accepted —
 * it is the price of never rewriting a statement, and finance squares it in the remittance.
 */
export async function moveFiledMail(input: {
  mail: MailItem
  /** Where it should have gone. */
  toAccountId: string
  /** The debtor's name, for the note left on the original account. */
  toLabel: string
  /** Why, in the mover's words. Optional, and worth having. */
  reason?: string
  actor: { id: string | null; name: string | null }
}): Promise<ChargeResult> {
  const from = input.mail.linkedAccountId
  if (!from) throw new Error('That email is not filed on a debtor account, so there is nothing to move.')
  if (from === input.toAccountId) throw new Error('That email is already on that account.')

  /*
   * Claimed against the account it is CURRENTLY on, so a double click or a retried request
   * cannot move it twice or raise the destination fee twice. Same guard as the original filing,
   * for the same reason.
   *
   * A non-administrator reaches this line only by crafting a request; the trigger reverts the
   * column and the row comes back still pointing at `from`, which the check below catches.
   */
  const { data: moved, error: moveError } = await supabase
    .from('user_emails')
    .update({
      linked_account_id: input.toAccountId,
      linked_at: new Date().toISOString(),
      linked_by: input.actor.id,
    })
    .eq('id', input.mail.id)
    .eq('linked_account_id', from)
    .select('linked_account_id')
    .maybeSingle<{ linked_account_id: string }>()
  if (moveError) throw new Error(moveError.message)
  if (!moved) throw new Error('That email has already been moved.')
  if (moved.linked_account_id !== input.toAccountId) {
    throw new Error('Only an administrator can move an email that is already filed.')
  }

  /*
   * The correction is recorded on the MAILBOX ROW, not as a note on the account it came off.
   *
   * A note would have been the obvious place and it is the wrong one: account_notes has no
   * visibility flag, so "filed here in error" can reach the debtor on a statement or in an
   * answer to a query — and that sentence invites exactly the query it was meant to pre-empt.
   * The firm's instruction. Written here instead, where only the firm can see it.
   *
   * Best effort: the message has already moved and the destination is about to be charged.
   * Failing to annotate it is a thinner audit trail, not a wrong statement, and is not worth
   * throwing away a completed move over.
   */
  const { error: markError } = await supabase
    .from('user_emails')
    .update({ moved_from_account_id: from, moved_reason: input.reason?.trim() || null })
    .eq('id', input.mail.id)
  if (markError) console.error('[userMail] moved, but the move was not annotated:', markError.message)

  return fileOnAccount({
    mail: input.mail,
    accountId: input.toAccountId,
    actor: input.actor,
  })
}

/**
 * Take a message off the account it was matched to, without putting it anywhere else.
 *
 * ADMINISTRATOR ONLY — enforced by protect_filed_mail_target, which reverts any change to a link
 * that is already set, clearing it included. Same rule as moving, because it is the same act.
 *
 * The gap this fills: until now the only way out of a wrong match was to name the right account
 * on the spot. Often nobody knows it yet — a message matched by surname to the wrong Mthembu has
 * to come off that account today, and finding the right one is a separate job. This puts it back
 * in the mailbox, where it waits with everything else still to be matched.
 *
 * THE ACCOUNT KEEPS ITS FEE AND ITS COPY, exactly as with a move, and for the firm's reason: a
 * statement is never rewritten after the fact, because fees feed remittances and a processed
 * remittance cannot be unwound. Removing the email while keeping the fee would leave a charge
 * with nothing behind it. Finance corrects it forward.
 *
 * So this is not an undo. It unmatches the MAILBOX message; the account's record stands.
 */
export async function unmatchMail(input: {
  mail: MailItem
  reason?: string
  actor: { id: string | null; name: string | null }
  /**
   * Take the sender's address off that account's contacts as well.
   *
   * Offered because unmatching and the saved address are the same mistake seen twice: matching a
   * message ticks "save this address" by default, so a newsletter matched to a debtor by accident
   * lands on their file as a contact — and then cannot be blocked, with nothing on screen saying
   * why. Unmatching says the message does not belong there; the address usually does not either.
   *
   * Never assumed. The address may have been the debtor's all along, with only this one message
   * matched wrongly, and deleting a real contact is not something to do on somebody's behalf.
   */
  removeContact?: boolean
}): Promise<void> {
  const from = input.mail.linkedAccountId
  if (!from) throw new Error('That email is not matched to a debtor account.')

  const { data: cleared, error } = await supabase
    .from('user_emails')
    .update({
      linked_account_id: null,
      // Where it came off, and why, kept on the message itself — never on the debtor's account,
      // where it could reach them on a statement. See the columns in schema.sql.
      moved_from_account_id: from,
      moved_reason: input.reason?.trim() || null,
      linked_at: new Date().toISOString(),
      linked_by: input.actor.id,
    })
    .eq('id', input.mail.id)
    .eq('linked_account_id', from)
    .select('linked_account_id')
    .maybeSingle<{ linked_account_id: string | null }>()
  if (error) throw new Error(error.message)
  if (!cleared) throw new Error('That email has already been unmatched.')
  /*
   * A non-administrator gets here only by crafting a request: the trigger puts the account back
   * and the row returns still matched, which this catches rather than reporting a success that
   * did not happen.
   */
  if (cleared.linked_account_id !== null) {
    throw new Error('Only an administrator can unmatch an email.')
  }

  // After the unmatch, not before: if the unmatch is refused there is nothing to tidy up, and
  // taking the address off first would leave the account edited and the message still matched.
  if (input.removeContact) await removeAccountContact(from, input.mail.fromAddress)

  refreshNavCounts()
}
