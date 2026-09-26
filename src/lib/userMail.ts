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
import type { InviteResponse } from './inviteReply.ts'
import { senderName, type MailFilter } from './emailRules'
import { refreshNavCounts } from './navCounts'
import { mirrorReadToAccount, mirrorUnreadToAccount } from './mailReadState'
import type { ContactCandidate } from './signature'
import { chargeItem, type ChargeResult } from './accountCharges'
import { addNote } from './accountWorkspace'
import {
  automatedMailKind,
  CORRESPONDENCE_ACTION_CODE, CORRESPONDENCE_DESCRIPTION, CORRESPONDENCE_ITEM_ID,
  EMAIL_IN_KIND, receivedEmailNote, type Recipient,
} from './emailRules'

export interface MailItem {
  id: string
  folder: string
  /** Pulled from the Sent folder. Never filed on a record and never charged. */
  isSent: boolean
  /**
   * Everyone the message went to, and everyone copied.
   *
   * THE MAPPER IS THE TRAP THIS CODEBASE HAS A NAME FOR. A column in the database, in the type
   * and in the select but missing from toItem reads as undefined for ever and nothing fails.
   */
  toRecipients: Recipient[]
  ccRecipients: Recipient[]
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
  /**
   * What this person told the organiser, where the message was a meeting request.
   *
   * Null means unanswered, which is not the same as declined — the organiser's tracking list
   * shows those two differently and so must the card.
   */
  inviteResponse: InviteResponse | null
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
  to_recipients: Recipient[] | null
  cc_recipients: Recipient[] | null
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
  invite_response: InviteResponse | null
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
  id, folder, is_sent, to_address, to_name, to_recipients, cc_recipients,
  uid, message_id, from_address, from_name, subject, snippet,
  attachment_names, is_junk, occurred_at, read_at, is_filed, is_settled, no_record_at,
  invite_response,
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
    /* Defaulted to empty rather than left undefined: a list nobody can map over is a crash. */
    toRecipients: Array.isArray(r.to_recipients) ? r.to_recipients : [],
    ccRecipients: Array.isArray(r.cc_recipients) ? r.cc_recipients : [],
    toAddress: r.to_address ?? null,
    toName: r.to_name ?? null,
    uid: r.uid,
    messageId: r.message_id,
    fromAddress: r.from_address,
    /*
     * CLEANED ON THE WAY OUT. Everything synced before this stored the whole From header as the
     * name -- `"Kestrel Supplies" <info@kestrel.example>` -- and those rows cannot be re-read,
     * because fileUserEmail ignores duplicates on purpose so a re-sync cannot overwrite an
     * agent's filing. See senderName: null where there is no real name, so the caller can fall
     * back to the address rather than print it twice.
     */
    fromName: senderName(r.from_name, r.from_address),
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
    inviteResponse: r.invite_response ?? null,
    linkedTo: linkedRecord(r),
  }
}

/* Declared with the rules rather than here, so bumpUnread can be imported and exercised without
   dragging a database client in with it. Re-exported because this is where callers look for it. */
export type { MailFilter } from './emailRules'

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
  /**
   * Search the WHOLE mailbox rather than the tab you happen to be standing on.
   *
   * The firm asked the question that gave this away: "if you search, can you only search in a
   * specific folder, or can you search across the whole mailbox?" It was the tab, and that is the
   * wrong default for a search box -- somebody looking for a message knows the sender and the
   * subject and has no idea which of six tabs it settled in. A search that quietly excludes junk
   * is worst of all, because junk is exactly where a message goes missing.
   *
   * Only meaningful WITH a search term. On its own it would just be the All tab with junk and sent
   * folded in, which is not a view anybody asked for.
   */
  everywhere?: boolean
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

export function scope<Q>(q: Q, input: MailScope): Q {
  let out = q as Narrowable

  /*
   * is_settled, not is_filed. A message matched to a record is settled; so is one somebody has
   * marked as needing no record — a supplier's invoice, an accountant's note. Both have been
   * dealt with, and a queue that keeps showing what you have already dealt with is a queue
   * nobody reads. See the generated column in schema.sql.
   */
  /*
   * A SEARCH GOES EVERYWHERE, so no tab clause is applied at all -- junk and sent included. See
   * MailScope.everywhere. Guarded on the term as well as the flag, because without one this would
   * silently turn the tab you are looking at into the whole mailbox.
   */
  const searching = !!input.search?.trim()
  const wholeMailbox = !!input.everywhere && searching

  if (wholeMailbox) {
    /* No tab clause at all. Deliberately empty rather than a chain of `else if`s each carrying
       `&& !wholeMailbox` -- one condition in one place is what keeps this readable. */
  } else if (input.filter === 'needs-filing') out = out.eq('is_settled', false).eq('is_junk', false).eq('is_sent', false)
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
  else if (input.filter === 'no-record') out = out.not('no_record_at', 'is', null)
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
    out = out.or(`from_address.ilike.%${safe}%,subject.ilike.%${safe}%,from_name.ilike.%${safe}%`)
  }

  return out as Q
}

/**
 * How many messages in this view are unread.
 *
 * Scoped to the same tab and search the list is showing, so the number on the toggle is the
 * number of rows the toggle would leave behind. Counted in the database — the page is 50 rows
 * and the answer is routinely larger.
 */
export async function countUnread(userId: string, input: MailScope): Promise<number> {
  const { count, error } = await scope(
    supabase.from('user_emails').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    { ...input, unreadOnly: true },
  )
  if (error) throw new Error(error.message)
  return count ?? 0
}

/**
 * Unread on every tab at once.
 *
 * The firm: "the junk email doesn't indicate to me if there's anything that's unread, the free
 * mail also not." One number on All told you the mailbox had unread mail and nothing about WHERE
 * -- so an unread message a spam filter had misfiled sat in Junk with nothing anywhere saying so,
 * which is the one place it most needed saying.
 *
 * SIX COUNTS THROUGH scope(), NOT ONE RPC. A function in SQL would be a second definition of every
 * tab's clauses, and this file has already been bitten by exactly that: nav_counts wrote its own
 * and drifted, so the badge said 3 over a list of 5. These are head counts on indexed columns and
 * they go out in parallel; the round trips are cheaper than the drift.
 *
 * SCOPED BY THE SEARCH TOO, so the number on a tab is the number of rows pressing it leaves
 * behind. A badge that ignores the search box is a badge that lies the moment somebody types.
 */
export async function countUnreadByTab(
  userId: string, search?: string,
): Promise<Record<MailFilter, number>> {
  const tabs: MailFilter[] = ['all', 'needs-filing', 'filed', 'no-record', 'junk', 'sent']
  const counts = await Promise.all(
    tabs.map((filter) => countUnread(userId, { filter, search }).catch(() => 0)),
  )
  return Object.fromEntries(tabs.map((t, i) => [t, counts[i]])) as Record<MailFilter, number>
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

/** How many messages are waiting to be filed. Counted in the database, not fetched and counted here. */
export async function countNeedsFiling(userId: string): Promise<number> {
  /*
   * THROUGH scope(), SO THE NUMBER AND THE LIST CANNOT DISAGREE.
   *
   * These clauses were written out again here and had already drifted two ways from the list they
   * sit over. The count required the message to be UNREAD and the list did not, so opening five
   * unmatched messages took the badge to nought above a list of five — the exact "badge that says
   * 3 over a list of 5" that scope() was extracted to prevent, reintroduced one level above the
   * guard. And the count never excluded what we had SENT, which the list does.
   *
   * Reading is not matching. A message a collector has read is still on nobody's file, and the
   * badge is counting work left, not mail left unopened.
   */
  const { count, error } = await scope(
    supabase.from('user_emails').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    { filter: 'needs-filing' },
  )
  if (error) throw new Error(error.message)
  return count ?? 0
}

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

/**
 * The two standing decisions that can be made about a sender.
 *
 *   no_record    real work mail -- a supplier, an accountant -- that belongs on nobody's file.
 *   always_junk  spam. Their mail still arrives and is still filed; it lands under Junk.
 *
 * They are mutually exclusive by design, and the unique index on (user_id, pattern) makes them
 * so: a sender cannot be both a supplier and spam, and junking one REPLACES the other.
 */
export type SenderRuleAction = 'no_record' | 'always_junk'

/** A standing decision about one sender: their mail never needs matching. */
export interface SenderRule {
  id: string
  pattern: string
  kind: 'address' | 'domain'
  label: string | null
  createdAt: string
}

export async function fetchSenderRules(
  userId: string,
  /* Which standing decision. Defaulted so every existing caller keeps the list it asked for. */
  action: SenderRuleAction = 'no_record',
): Promise<SenderRule[]> {
  const { data, error } = await supabase
    .from('mail_sender_rules')
    .select('id, pattern, kind, label, created_at')
    .eq('user_id', userId)
    .eq('action', action)
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
  /**
   * The message as it was actually written, where it was written in HTML.
   *
   * Never rendered into the app's own page — it goes through sanitizeEmailHtml and into a
   * sandboxed frame. The text above is still carried beside it and is still what a forward
   * quotes, because a quoted reply is prose, not a newsletter.
   */
  html: string
  /** The raw ICS where the message was a meeting request. Parsed by the page — see parseInvite. */
  calendar: string
}> {
  const res = await fetch('/api/email/attachment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ mailId }),
  })
  const body = (await res.json().catch(() => ({}))) as {
    text?: string; html?: string; details?: ContactCandidate[]; images?: InlineImage[]
    imagesSkipped?: number; calendar?: string; error?: string
  }
  if (!res.ok) throw new Error(body.error ?? 'Could not read that message.')
  // `details` are read off the message's HTML on the server — see findLinkedDetails. They are
  // what an image signature gives up, since its text yields nothing.
  return {
    text: body.text ?? '',
    html: body.html ?? '',
    details: body.details ?? [],
    images: body.images ?? [],
    imagesSkipped: body.imagesSkipped ?? 0,
    calendar: body.calendar ?? '',
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

/**
 * Whether this address belongs to a shared provider rather than to a company.
 *
 * Asked by two different features for opposite reasons. Blocking wants to know because blocking
 * gmail.com would silence debtors; creating a lead wants to know because a gmail.com address says
 * nothing about who somebody works for, and "Gmail" in the Company box is worse than a blank one.
 */
export function isSharedDomain(address: string): boolean {
  const domain = domainOf(address)
  return !!domain && SHARED_DOMAINS.has(domain)
}

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

export async function emptyJunk(input: { userId: string }): Promise<{ deleted: number }> {
  /*
   * DELETING JUNK DELETES JUNK. IT DOES NOT BLOCK ANYBODY.
   *
   * It used to offer to block every sender in the folder as well, with the box ticked by default,
   * and the firm pressed it: "I accidentally just said empty junk and then it said block all of
   * these people ... that's a very bad and dangerous idea." Thirty addresses went onto the
   * blocklist in one action, among them their own BANK, Telkom, a supplier and four real people
   * who had written to them.
   *
   * The two are not the same decision and must never be offered as one. Deleting junk is about
   * MAIL THAT IS ALREADY HERE, it is reversible in the way that matters -- every message is still
   * on the mail server -- and it is done in a hurry, by definition, because junk is where the
   * volume is. Blocking is about EVERY FUTURE MESSAGE from somebody, it is invisible once done,
   * and its cost is a client's mail that silently never arrives. A destructive sweep must not
   * carry a permanent, silent decision along with it, and certainly not pre-ticked.
   *
   * Blocking one sender still lives on the open message, where you have read something first.
   */
  const { data: gone, error } = await supabase
    .from('user_emails')
    .delete()
    .eq('user_id', input.userId)
    .eq('is_junk', true)
    /* Junk that somebody has since put on a record is not junk any more, and is not ours to
       delete: it is on a debtor's file and a fee may have been raised against it. */
    .eq('is_filed', false)
    .select('id')
  if (error) throw new Error(error.message)

  refreshNavCounts()
  return { deleted: gone?.length ?? 0 }
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
    .select('id')
    .maybeSingle<{ id: string }>()
  if (claimError) throw new Error(claimError.message)
  if (!claimed) throw new Error('That email has already been filed.')

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
  /*
   * THE SAME RULE ON THE OTHER DOOR.
   *
   * The sync refuses to file a bounce as a debtor's correspondence; this is the path a PERSON
   * uses, and without the same guard an agent could put a Mail Delivery Subsystem notice on an
   * account by hand and raise the R13 the sync had just declined.
   *
   * Only the sender is available here — the mailbox row keeps the address, the subject and a
   * snippet, not the headers — so this catches less than the sync does. It catches the case that
   * matters: mail from the two mailbox names the standards reserve for a mail system reporting
   * on itself.
   */
  const automated = automatedMailKind({ from: input.mail.fromAddress })
  if (automated !== null) {
    throw new Error(
      automated === 'bounce'
        ? 'That is a delivery failure notice from a mail system, not correspondence from the debtor. Filing it would charge them R13 under item 6 for our own server\u2019s message.'
        : 'That is an automatic reply, not something the debtor wrote. Filing it would charge them R13 under item 6.',
    )
  }

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
   * Compared case-insensitively and without spaces, since "083 555 0199" and "0835550199" are
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
    .select('id')
    .maybeSingle<{ id: string }>()
  if (claimError) throw new Error(claimError.message)
  if (!claimed) throw new Error('That email has already been filed.')

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
 *
 * AND MOVING ONE MESSAGE IS NOT AUTOMATICALLY A VERDICT ON ITS SENDER ANY MORE. See `remember`.
 */
export async function setJunk(
  ids: string[],
  junk: boolean,
  /*
   * Whose mailbox. Given, the sender can be remembered -- see rememberJunkSenders below. Optional
   * so a caller with no session still moves the message; the standing rule is the extra, not the
   * act.
   */
  userId?: string | null,
  /**
   * MAKE THE STANDING RULE, OR JUST MOVE THIS ONE.
   *
   * THE FIRM: "if I say move to junk, can it also ask me if I can move and always send those
   * things to junk?" It always made the rule, silently, and said so afterwards -- which was the
   * firm's own earlier instruction ("every time a new email is received from that email address,
   * it should be moved to junk") and is right for the sender you are junking BECAUSE they are a
   * nuisance. It is wrong for the other kind of junk move, which the firm described in the same
   * breath: "sometimes I get like stuff that I want to see but it's junk... it's kind of
   * semi-important otherwise I would have blocked it." Shelving one message is not a verdict on
   * a sender, and a rule made on that move quietly diverts mail somebody wanted.
   *
   * SO THE CALLER SAYS, and true is the default: every caller that predates the question meant
   * the rule, and a silent change of that would leave the firm's nuisance senders arriving in the
   * inbox again with nothing to explain it.
   */
  remember: boolean = true,
): Promise<{ moved: number; remembered: string[]; kept: string[] }> {
  if (ids.length === 0) return { moved: 0, remembered: [], kept: [] }
  /*
   * THE SENDERS, READ BEFORE THE UPDATE. Afterwards the rows are still there, but reading first
   * means one query answers both "who wrote these" and "which of them may be ruled on", and the
   * rule is written from the same list the person was looking at.
   */
  const senders = userId ? await sendersOf(ids) : []
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

  /*
   * AND THE SENDER IS REMEMBERED, OR FORGOTTEN. The firm: "every time a new email is received
   * from that email address, it should be moved to junk. Stay there." Moving one message is a
   * decision about the sender, so it is kept as one -- and "Not junk" takes it back, or the move
   * could not be undone and the next message would return to Junk anyway.
   */
  let remembered: string[] = []
  let kept: string[] = []
  if (userId && senders.length > 0) {
    if (junk) {
      if (remember) ({ remembered, kept } = await rememberJunkSenders(userId, senders))
      /*
       * "Just this one" LEAVES A RULE THAT IS ALREADY THERE. It is a decision about this message,
       * not a change of mind about the sender -- and quietly cancelling a standing rule from a
       * button that says "move it" is the kind of thing nobody would connect to the mail that
       * starts arriving again a week later. "Not junk" is the undo, and it is explicit.
       */
    } else await forgetJunkSenders(userId, senders)
  }

  // Junk is excluded from the sidebar count, so moving mail either way changes it.
  refreshNavCounts()
  return { moved: data?.length ?? 0, remembered, kept }
}

/** The distinct addresses these messages came from, lowercased and without blanks. */
async function sendersOf(ids: string[]): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_emails').select('from_address').in('id', ids)
  if (error) throw new Error(error.message)
  const out = new Set<string>()
  for (const r of data ?? []) {
    const a = String((r as { from_address: string | null }).from_address ?? '').trim().toLowerCase()
    if (a.includes('@')) out.add(a)
  }
  return [...out]
}

/**
 * Make "always junk" stand for these senders.
 *
 * AN ADDRESS ON A DEBTOR'S FILE IS LEFT ALONE, and that is the one judgement in here. Junk is not
 * a block -- the mail still arrives -- but this file already says why that is not enough: "junk
 * is exactly where a message goes missing", and the junk tab is where a debtor writing from a
 * free address lands often enough that the move was made reversible on purpose. A standing rule
 * that quietly sent a debtor's every future reply to Junk could lose an arrangement, and nobody
 * would see it go.
 *
 * So the MESSAGE still moves -- somebody asked for that and it is one message -- and the RULE is
 * not made. The caller says which, so the person is told rather than left to assume.
 */
async function rememberJunkSenders(
  userId: string, senders: string[],
): Promise<{ remembered: string[]; kept: string[] }> {
  const remembered: string[] = []
  const kept: string[] = []
  for (const address of senders) {
    if (await debtorFileFor(address)) { kept.push(address); continue }
    remembered.push(address)
  }
  if (remembered.length > 0) {
    const { error } = await supabase.from('mail_sender_rules').upsert(
      remembered.map((pattern) => ({
        user_id: userId, pattern, kind: 'address' as const, action: 'always_junk', label: null,
      })),
      /*
       * REPLACING whatever rule was there, rather than ignoring the conflict. A sender who was
       * "needs no record" and has now been junked is spam: the later decision is the true one,
       * which is the same reasoning as junking clearing no_record_at on the message itself.
       */
      { onConflict: 'user_id,pattern' },
    )
    if (error) throw new Error(error.message)
  }
  return { remembered, kept }
}

/** Stop junking them. "Not junk" has to undo the standing rule, or it undoes nothing. */
async function forgetJunkSenders(userId: string, senders: string[]): Promise<void> {
  const { error } = await supabase
    .from('mail_sender_rules').delete()
    .eq('user_id', userId).eq('action', 'always_junk').in('pattern', senders)
  if (error) throw new Error(error.message)
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
