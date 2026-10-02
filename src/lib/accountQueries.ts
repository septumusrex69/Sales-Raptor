/**
 * Queries and disputes.
 *
 * A debtor says something the collector cannot answer — "I already paid", "the goods never
 * arrived", "that is not my account" — and it goes to a named person in Communications, who asks
 * the client and comes back with an answer.
 *
 * Two things shape this module. The team covers for each other: one person owns a query, but
 * whoever is at their desk answers it, so every write records who ACTUALLY did it beside whose
 * query it is. And an outcome is a decision, not an action: "reduce to R4,200" is recorded here
 * and carried out elsewhere, because reducing a balance is a ledger event and this is not the
 * ledger.
 */
import { supabase } from './supabase'
/* The firm's own day, not the server's. A dispute taken at one in the morning in Johannesburg is
   eleven the previous night in UTC, and a date filed under yesterday is what a notice quotes. */
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' })
import { refreshNavCounts } from './navCounts'
import { addNote, type AccountNote } from './accountWorkspace'
import { chargeItem, type ChargeResult } from './accountCharges'
import { nudgeWorkflowsForAccount } from './accountRun.ts'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come back as untyped JSON from PostgREST. */

export type QueryStatus = 'open' | 'closed'


/**
 * Where a query sits on the ladder.
 *
 * The ladder is the point. A query starts with whoever took the call, goes to the client liaison
 * if they cannot answer it, and only reaches the client if the liaison cannot either. Most never
 * get past the second rung.
 *
 * The previous model had one forward move — "send to client" — which made the client the only
 * exit from a query and quietly turned every dispute into correspondence with a client who did
 * not need to hear about it. Any tier can close a query it has answered.
 */
/*
 * The dispute vocabulary lives in disputeCategories.ts — it is pure, and this module talks to
 * Postgres, which would otherwise mean none of it could be exercised outside a browser. Re-exported
 * here so the twelve call sites that already say `from './accountQueries'` keep working: one
 * import for everything about a dispute is the right shape for a caller, whatever the files do.
 */
import {
  canSendToClient, stageForAssignee, escalationChargeable, escalationNote, clientSection,
  CAN_SEND_TO_CLIENT, QUERY_OUTCOME_LABEL, QUERY_EFFECT_LABEL, QUERY_EFFECT_HINT,
  ESCALATION_KINDS, ESCALATION_KIND_ORDER,
  type DisputeStage as QueryStage, type QueryOutcome, type QueryEffect, type EscalationKind,
  QUERY_STAGE_LABEL, stageLine,
  type ClientSection, REQUEST_KINDS,
  classificationMissing, explanationMissing, CLASSIFICATION_REQUIRED,
} from './disputeCategories'

export {
  canSendToClient, stageForAssignee, escalationChargeable, escalationNote, clientSection,
  QUERY_STAGE_LABEL, stageLine,
  CAN_SEND_TO_CLIENT, QUERY_OUTCOME_LABEL, QUERY_EFFECT_LABEL, QUERY_EFFECT_HINT,
  ESCALATION_KINDS, ESCALATION_KIND_ORDER,
}
export type { EscalationKind, ClientSection }
export { REQUEST_KINDS }
export type { QueryStage, QueryOutcome, QueryEffect }

/** What happens when this query moves up, and what it is called on the button. */
export const NEXT_STAGE: Record<QueryStage, { to: QueryStage; label: string; note: string } | null> = {
  agent: { to: 'liaison', label: 'Send to liaison', note: 'Passed to the client liaison.' },
  team_leader: { to: 'liaison', label: 'Send to liaison', note: 'Passed to the client liaison.' },
  liaison: { to: 'client', label: 'Send to client', note: 'Sent to the client.' },
  client: { to: 'liaison', label: 'Client answered', note: 'The client has answered.' },
}

/**
 * The rungs a dispute can be handed to, and nothing else.
 *
 * An agent who cannot answer a dispute has exactly two people to give it to: the liaison who owns
 * the client relationship, or a pre-legal team leader. Offering the whole staff list invited a
 * dispute to be handed to whoever was remembered first, which is how one ends up parked with
 * somebody who has no standing to answer it.
 */
export const DISPUTE_ESCALATION_ROLES = ['Pre-legal Team Leader', 'Liaison Manager', 'Liaison']

export interface AccountQuery {
  id: string
  /**
   * The account this is about, or null where it is about a whole handover sheet.
   *
   * THE FIRM: "let's say there's a handover sheet of 500 imports and 50 of them have problems.
   * Now there'll be 50 different individual queries. I think we should have a query per handover
   * sheet." Exactly one of this and handoverId is set; the database enforces it.
   */
  accountId: string | null
  /** The batch, where this is about a sheet rather than one account. */
  handoverId: string | null
  description: string
  /** What this escalation is. Everything raised before the kinds existed reads as a dispute. */
  kind: EscalationKind
  category: string | null
  status: QueryStatus
  stage: QueryStage
  sentToClientAt: string | null
  ownerId: string | null
  /**
   * WHO RAISED IT, which is not the same person as who owns it and is why this field exists.
   *
   * THE OWNER IS WHOEVER HAS TO ANSWER IT. A collector raising a request sends it to the liaison,
   * so from the moment it is saved the ticket belongs to somebody else — and the disputes board
   * scopes on owner. THE FIRM: "the ticket was created and then it doesn't display in the debt
   * collector's situation." It was on the board; it was on the LIAISON'S board.
   *
   * THE COLUMN WAS ALWAYS WRITTEN AND NEVER READ BACK. `raised_by` has been set on every ticket
   * since requests existed, and the mapper below listed `raised_by_name` and not this — the
   * silent-column fault CLAUDE.md names, under a comment on the very next line warning about it.
   * A value in the database that nothing can read is a value that does not exist.
   */
  raisedBy: string | null
  raisedByName: string | null
  raisedAt: string
  chaseOn: string | null
  outcome: QueryOutcome | null
  outcomeAction: string | null
  outcomeAmount: number | null
  outcomeDone: boolean
  closedAt: string | null
  closedByName: string | null
  /**
   * WHICH STAGE THIS DISPUTE IS IN, which is one fact read two ways.
   *
   * `allegedOn` is the day the debtor SAID it and every dispute has one; `receivedOn` is the day
   * it arrived in writing, and null there means the firm is still waiting. The sequence that is
   * running follows from it -- see workflow_start_on_dispute -- and so does whether the collection
   * sequences are stopped.
   */
  allegedOn: string | null
  receivedOn: string | null
  inWriting: boolean
  /**
   * ON A REQUEST ONLY: WHAT is being asked for. Who it is being asked of is not stored, because it
   * is already on the ticket -- whoever it was given to. Null on everything else, and the database
   * refuses it there (account_queries_for_only_on_request).
   */
  requestFor: string | null
}

const toQuery = (r: any): AccountQuery => ({
  id: r.id,
  /* Hand-written mappers drop columns silently -- CLAUDE.md's own warning. check-dispute-stage
     holds these three against the table. */
  allegedOn: r.alleged_on ?? null,
  receivedOn: r.received_on ?? null,
  inWriting: !!r.in_writing,
  requestFor: (r.request_for ?? null) as string | null,
  accountId: r.account_id ?? null,
  handoverId: r.handover_id ?? null,
  description: r.description,
  kind: (r.kind ?? 'dispute') as EscalationKind,
  category: r.category,
  status: r.status,
  stage: (r.stage ?? 'agent') as QueryStage,
  sentToClientAt: r.sent_to_client_at ?? null,
  ownerId: r.owner_id,
  raisedBy: r.raised_by ?? null,
  raisedByName: r.raised_by_name,
  raisedAt: r.raised_at,
  chaseOn: r.chase_on,
  outcome: r.outcome,
  outcomeAction: r.outcome_action,
  outcomeAmount: r.outcome_amount === null || r.outcome_amount === undefined ? null : Number(r.outcome_amount),
  outcomeDone: !!r.outcome_done,
  closedAt: r.closed_at,
  closedByName: r.closed_by_name,
})

/** Open, and nobody has touched it for a while. The way a query dies is quietly. */
export function isStale(q: AccountQuery, today = new Date().toISOString().slice(0, 10)): boolean {
  if (q.status === 'closed') return false
  return !!q.chaseOn && q.chaseOn < today
}

/** Days since it was raised. What a queue is sorted by when nothing else is urgent. */
export function ageInDays(q: AccountQuery, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(q.raisedAt).getTime()) / 86_400_000))
}

export async function fetchQueries(accountId: string): Promise<AccountQuery[]> {
  const { data, error } = await supabase
    .from('account_queries')
    .select('*')
    .eq('account_id', accountId)
    .order('raised_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(toQuery)
}

export interface QueueRow extends AccountQuery {
  accountNumber: string | null
  debtorName: string
  companyId: string | null
  /**
   * WHOSE DESK THE ACCOUNT IS ON **NOW**, which is not the same as who raised the ticket.
   *
   * THE FIRM: "if an account is reshuffled to another person, the dispute raised goes to the new
   * owner of the account."
   *
   * DERIVED, NEVER COPIED ONTO THE TICKET. A ticket carries who must ANSWER it (the liaison) and
   * who RAISED it (a collector, on the day). Neither moves when the book is shared out again — and
   * the firm reshuffles in bulk, thousands at a time, so a stored third id would be a third thing
   * every hand-out had to remember to rewrite and the one it forgot would be invisible.
   *
   * Read off the account on every fetch instead, so it is right the moment the account moves and
   * cannot drift. The same reasoning the diary applies to a missed entry and the book applies to a
   * client's position.
   */
  accountOwnerId: string | null
}

/**
 * Everything still open, across the book — the Communications queue.
 *
 * Joined to the account in one request rather than fetched per row: a queue that issues a
 * request per line is a queue that gets slower the busier the team is.
 */
export async function fetchOpenQueries(): Promise<QueueRow[]> {
  const { data, error } = await supabase
    .from('account_queries')
    .select('*, debtor_accounts(account_number, debtor_first_name, debtor_surname, company_id, assigned_to)')
    .eq('status', 'open')
    .order('raised_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: any) => {
    const a = r.debtor_accounts ?? {}
    return {
      ...toQuery(r),
      accountNumber: a.account_number ?? null,
      debtorName: [a.debtor_first_name, a.debtor_surname].filter(Boolean).join(' ') || 'Unnamed debtor',
      companyId: a.company_id ?? null,
      accountOwnerId: a.assigned_to ?? null,
    }
  })
}

/**
 * Every dispute in the book, resolved ones included.
 *
 * The queue asks for open work; the board is a picture of the whole thing, and a Resolved column
 * with nothing in it is a column that teaches people the board is broken. Closed disputes are
 * capped at the recent ones — the board is for working, not for archaeology, and a year of
 * resolved rows would push the live columns off the screen.
 */
export async function fetchAllQueries(closedLimit = 40): Promise<QueueRow[]> {
  const [open, closed] = await Promise.all([
    supabase.from('account_queries')
      .select('*, debtor_accounts(account_number, debtor_first_name, debtor_surname, company_id, assigned_to)')
      .eq('status', 'open').order('raised_at', { ascending: true }),
    supabase.from('account_queries')
      .select('*, debtor_accounts(account_number, debtor_first_name, debtor_surname, company_id, assigned_to)')
      .eq('status', 'closed').order('closed_at', { ascending: false }).limit(closedLimit),
  ])
  for (const r of [open, closed]) if (r.error) throw new Error(r.error.message)
  return [...(open.data ?? []), ...(closed.data ?? [])].map(toQueueRow)
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
function toQueueRow(r: any): QueueRow {
  const a = r.debtor_accounts ?? {}
  return {
    ...toQuery(r),
    accountNumber: a.account_number ?? null,
    debtorName: [a.debtor_first_name, a.debtor_surname].filter(Boolean).join(' ') || 'Unnamed debtor',
    companyId: a.company_id ?? null,
    accountOwnerId: a.assigned_to ?? null,
  }
}

/**
 * Raising a query charges the debtor under Annexure B item 3.
 *
 * Item 3 is "other necessary expenses not specifically provided for" — R25 excluding VAT on the
 * current schedule, and the gazette prices it as A TOTAL AMOUNT for the account rather than per
 * occurrence. So the first query on an account charges R25 and the second charges nothing, which
 * is what the words say and not what a naive per-query fee would do.
 *
 * The charge is raised even when it comes out at zero, as an unbilled row, so the work is on the
 * record either way. Whoever raised the query is told which happened.
 */
/**
 * Every query on a client's book, open and closed.
 *
 * A query is about a debt, but it is answered by the client, so the client's page is where a
 * liaison asks "what is outstanding with Accelerate Fitness". Filtered by the client's accounts
 * rather than stored against the client, because the query belongs to the account — one place it
 * lives, two places it is read from.
 */
export async function fetchQueriesForClient(companyId: string): Promise<QueueRow[]> {
  /*
   * TWO READS, NOT ONE. A client's queries now reach them two ways -- through an account they own,
   * and through a handover batch of theirs -- and PostgREST cannot OR across two embedded
   * resources: `!inner` on either one silently drops every row of the other kind. Written as one
   * request it would have shown the account queries and quietly hidden every sheet-level query,
   * which is a shorter list that looks like good news.
   */
  const [byAccount, byBatch] = await Promise.all([
    supabase
      .from('account_queries')
      .select('*, debtor_accounts!inner(account_number, debtor_first_name, debtor_surname, company_id)')
      .eq('debtor_accounts.company_id', companyId)
      .order('raised_at', { ascending: false }),
    supabase
      .from('account_queries')
      .select('*, handovers!inner(company_id, reference, received_at)')
      .eq('handovers.company_id', companyId)
      .order('raised_at', { ascending: false }),
  ])
  if (byAccount.error) throw new Error(byAccount.error.message)
  if (byBatch.error) throw new Error(byBatch.error.message)

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows: QueueRow[] = (byAccount.data ?? []).map((r: any) => {
    const a = r.debtor_accounts ?? {}
    return {
      ...toQuery(r),
      accountNumber: a.account_number ?? null,
      debtorName: [a.debtor_first_name, a.debtor_surname].filter(Boolean).join(' ') || 'Unnamed debtor',
      companyId: a.company_id ?? null,
      accountOwnerId: a.assigned_to ?? null,
    }
  })
  for (const r of (byBatch.data ?? []) as any[]) {
    const h = r.handovers ?? {}
    rows.push({
      ...toQuery(r),
      accountNumber: null,
      /* The sheet stands where the debtor's name would. A batch query is about a file, and
         "Unnamed debtor" on one would read as an account we failed to name. */
      debtorName: (h.reference as string | null) ?? 'One handover sheet',
      companyId: h.company_id ?? null,
      /* A BATCH SITS ON NOBODY'S DESK. It is about a client's own spreadsheet, not a debtor's
         account, so there is no collector for it to follow when the book is shared out. */
      accountOwnerId: null,
    })
  }
  rows.sort((a, b) => (a.raisedAt < b.raisedAt ? 1 : -1))
  return rows
}

/**
 * One query, with whatever it hangs off.
 *
 * FOR ITS OWN PAGE. THE FIRM: "a query should have a card, like the same as a deal, with the
 * details of the query on the inside ... if you click on that little query for this date's
 * handover sheet, then it goes in there." Until now a query had no page: clicking one on the
 * board opened the ACCOUNT, which answers a different question and cannot answer this one at all
 * for a query about a whole sheet.
 *
 * Two reads rather than an embed of both parents: PostgREST resolves an embedded resource against
 * a foreign key, and a row has exactly one of these two set -- so asking for both in one select
 * returns null for whichever is absent and needs the same branch on this side anyway.
 */
export async function fetchQuery(id: string): Promise<{
  query: AccountQuery
  /** The account it is about, where it is about one. */
  account: { id: string; accountNumber: string | null; debtorName: string; companyId: string } | null
  /** The batch it is about, where it is about a sheet. */
  batch: { id: string; reference: string | null; receivedAt: string; companyId: string } | null
  clientName: string | null
  /**
   * WHERE A FORWARD GOES, and why it is fetched here rather than looked up on the screen.
   *
   * THE FIRM: "can me, as a client liaison, for example, Stefan, or Nicole, forward that email
   * just like that to the client." The address is on the CLIENT, one row away from the account or
   * the batch this ticket is about, and the page already makes that hop for `clientName`. Making
   * the liaison find it and type it is how a dispute gets forwarded to the wrong client.
   *
   * NULL IS AN ANSWER, not a failure: a client with no address on file means the Forward button
   * opens with an empty To rather than being hidden, because the person sending it may well know
   * the address the record does not.
   */
  clientEmail: string | null
  clientContact: string | null
  /**
   * EVERYBODY AT THE CLIENT WE HAVE AN ADDRESS FOR.
   *
   * THE FIRM: "if I say email, then it already says Rinda at novacall.co.za. But there's another
   * person on the client's records as well. So there should be an option to CC, or who from the
   * client do you want to send it to -- which person at the client."
   *
   * The compose box has taken a list of recipients all along and was being handed one: the
   * company's own address. A client is an organisation with people in it, and which of them a
   * dispute goes to is a decision the liaison makes per ticket -- the accounts clerk for a
   * reconciliation, the manager for a complaint.
   *
   * THE COMPANY'S OWN ADDRESS STAYS FIRST where there is one. It is the address the firm was given
   * to use, and a picker that opened on whichever person happened to be added first would quietly
   * change where client mail goes.
   */
  clientPeople: { email: string; label: string }[]
} | null> {
  const { data, error } = await supabase
    .from('account_queries').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const q = toQuery(data)

  let companyId: string | null = null
  let acc: { id: string; accountNumber: string | null; debtorName: string; companyId: string } | null = null
  let batch: { id: string; reference: string | null; receivedAt: string; companyId: string } | null = null

  if (q.accountId) {
    const { data: a } = await supabase.from('debtor_accounts')
      .select('id, account_number, debtor_first_name, debtor_surname, company_id')
      .eq('id', q.accountId).maybeSingle()
    if (a) {
      acc = {
        id: a.id as string,
        accountNumber: (a.account_number as string | null) ?? null,
        debtorName: [a.debtor_first_name, a.debtor_surname].filter(Boolean).join(' ') || 'Unnamed debtor',
        companyId: a.company_id as string,
      }
      companyId = acc.companyId
    }
  } else if (q.handoverId) {
    const { data: h } = await supabase.from('handovers')
      .select('id, reference, received_at, company_id').eq('id', q.handoverId).maybeSingle()
    if (h) {
      batch = {
        id: h.id as string,
        reference: (h.reference as string | null) ?? null,
        receivedAt: h.received_at as string,
        companyId: h.company_id as string,
      }
      companyId = batch.companyId
    }
  }

  /* ONE ROUND TRIP FOR ALL THREE. It was already fetching the name; the address and the contact
     come off the same row, and a second query for them would be a second chance to be null. */
  const client = companyId
    ? (await supabase.from('companies').select('name, email, contact_person')
      .eq('id', companyId).maybeSingle()).data
    : null

  /*
   * AND THE PEOPLE AT IT. A second query because they are a second table, and it is asked only
   * where there is a client to ask about -- a batch ticket with no company reaches none of this.
   *
   * ADDRESSES ONLY. A contact with no email cannot be written to, and offering their name in a
   * recipient picker is a row that does nothing when it is chosen.
   */
  const people = companyId
    ? (await supabase.from('contacts')
      .select('first_name, last_name, job_title, email')
      .eq('company_id', companyId)
      .not('email', 'is', null)
      .order('first_name')).data ?? []
    : []

  const seen = new Set<string>()
  const clientPeople: { email: string; label: string }[] = []
  const add = (email: string | null | undefined, label: string) => {
    const clean = (email ?? '').trim().toLowerCase()
    if (!clean || seen.has(clean)) return
    seen.add(clean)
    clientPeople.push({ email: clean, label })
  }
  /* THE COMPANY'S OWN ADDRESS FIRST -- see clientPeople. Named for whoever the company record says
     to ask for, which is what the liaison knows them by. */
  add(client?.email as string | null, (client?.contact_person as string | null)
    ?? (client?.name as string | null) ?? 'the client')
  for (const c of people) {
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
    add(c.email as string | null, [name, c.job_title].filter(Boolean).join(' \u00b7 ') || 'at the client')
  }

  return {
    query: q,
    account: acc,
    batch,
    clientName: (client?.name as string | null) ?? null,
    clientEmail: (client?.email as string | null) ?? null,
    clientContact: (client?.contact_person as string | null) ?? null,
    clientPeople,
  }
}

export async function raiseQuery(input: {
  /** The account, for an ordinary query. Omitted when `handoverId` is given instead. */
  accountId?: string | null
  /**
   * The batch, for a query about a whole handover sheet.
   *
   * THE FIRM: "I think we should have a query per handover sheet." Fifty rows against one client,
   * each saying the same sentence about a different debtor, is a liaison's page made useless by
   * the thing meant to help them.
   */
  handoverId?: string | null
  description: string
  /**
   * What this escalation is. Defaults to a debtor's dispute, which is what the table was
   * originally for and is still the common case.
   */
  kind?: EscalationKind
  category?: string | null
  ownerId?: string | null
  /** Where it lands, which follows who it was given to. See {@link stageForAssignee}. */
  stage?: QueryStage
  chaseOn?: string | null
  raisedBy?: string | null
  raisedByName?: string | null
  /**
   * WHO THE TICKET IS ABOUT, for the sentence in the owner's notification only.
   *
   * Passed rather than looked up: this function is already holding an account id, and a second
   * round trip to name the debtor would be a fetch on the critical path of saving a dispute to
   * make a bell read better. Absent, the notice simply does not name them.
   */
  debtorName?: string | null
  /**
   * Whether to charge the debtor item 3.
   *
   * Defaults to true, because the ordinary case is a debtor query that Communications will take
   * up with someone else. It is false when you keep it yourself — writing down a dispute you are
   * going to answer at your own desk is the job, not a "necessary expense" recoverable from the
   * debtor, and charging for it would not survive being asked about.
   */
  charge?: boolean
  /**
   * HOW THE DISPUTE REACHED US, AND IT DECIDES WHICH SEQUENCE ANSWERS IT.
   *
   * THE FIRM: "creating a dispute from what a debtor said doesn't do anything. It shouldn't have a
   * workflow. But receiving an email with a written dispute, that... we need a way to start the
   * dispute workflow from the moment that we've received the email with the dispute."
   *
   *   verbal   the debtor said it. `alleged_on` is set and nothing else: stage A, which starts
   *            the sequence asking for it in writing by a date and, if nothing comes, sends the
   *            deemed-undisputed notice.
   *   written  we have it. `received_on` and `in_writing` as well: stage B, the real answer, and
   *            the collection sequences stop until the firm has given its finding.
   *
   * THESE THREE COLUMNS WERE NEVER WRITTEN. Both dispute sequences existed, both were unreachable,
   * and the firm raised a dispute and watched nothing happen. See workflow_start_on_dispute.
   *
   * NOT OFFERED ON THE OTHER TWO ESCALATIONS, and the database refuses them there anyway -- see
   * account_queries_dates_only_on_dispute. Nobody alleges an agent asking for help.
   */
  reached?: 'verbal' | 'written'
  /**
   * ON A REQUEST: WHAT is being asked for, from REQUEST_KINDS. Required there by the database and
   * by the box, because a board of requests that all read "see the description" cannot be sorted
   * or counted. Ignored on every other kind, which the database refuses outright
   * (account_queries_for_only_on_request).
   */
  requestFor?: string | null
  /** The day the debtor said it, where that is not today -- a call taken at half past four and
      logged the next morning. Defaults to today. */
  allegedOn?: string | null
}): Promise<{ query: AccountQuery; charge: ChargeResult | null }> {
  const isDispute = (input.kind ?? 'dispute') === 'dispute'
  /*
   * A DISPUTE SAYS WHAT IT IS ABOUT. The firm: "you should be able to say what is a dispute
   * about." Refused here rather than only in the box, because the box is not the only caller --
   * and refused BEFORE the insert, so the failure is a sentence in the firm's words rather than
   * the trigger's errcode arriving as a Postgres string. The trigger is still there: this is the
   * message, that is the guarantee.
   */
  if (classificationMissing(input.kind, input.category)) throw new Error(CLASSIFICATION_REQUIRED)
  /* AND "OTHER" IS NOT A CLASSIFICATION ON ITS OWN. Same rule the box draws, asked here so it
     holds on every path into the table. */
  if (explanationMissing(input.category, input.description)) {
    throw new Error('\u201cOther\u201d needs an explanation \u2014 say what the debtor is actually disputing.')
  }
  /*
   * ALLEGED IS ALWAYS SET ON A DISPUTE, WRITTEN OR NOT. A written dispute was alleged the day it
   * arrived if it was never alleged before it, and the deemed-undisputed notice quotes the date --
   * "On 5 October 2026 you told us that this account was disputed" -- so a null there is a
   * {{brace}} on a notice. The column's own comment says the same.
   */
  const alleged = isDispute ? (input.allegedOn || todayIso()) : null
  const written = isDispute && input.reached === 'written'
  const { data, error } = await supabase
    .from('account_queries')
    .insert({
      account_id: input.accountId ?? null,
      handover_id: input.handoverId ?? null,
      description: input.description.trim(),
      kind: input.kind ?? 'dispute',
      // Only a dispute is classified. The database refuses a category on the other two — see
      // account_queries_category_only_on_dispute — because a classification of "the debtor
      // objects because…" on an agent asking for help would mean nothing.
      category: (input.kind ?? 'dispute') === 'dispute' ? input.category?.trim() || null : null,
      owner_id: input.ownerId ?? null,
      stage: input.stage ?? 'agent',
      chase_on: input.chaseOn || null,
      raised_by: input.raisedBy ?? null,
      raised_by_name: input.raisedByName ?? null,
      alleged_on: alleged,
      /* BOTH, OR NEITHER. workflow_start_on_dispute reads either one, and a row carrying one of
         them is a row that says the dispute both has and has not arrived. */
      received_on: written ? todayIso() : null,
      in_writing: written,
      /* Only a request carries one, and only a request is allowed to -- decided here rather than
         trusted to the caller, the same way `category` is above. */
      request_for: (input.kind ?? 'dispute') === 'request' ? (input.requestFor?.trim() || null) : null,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  const q = toQuery(data)

  /*
   * A DEBTOR PAYS FOR A DISPUTE AND FOR NOTHING ELSE HERE.
   *
   * Item 3 recovers the time somebody else spent because the debtor objected. An agent asking a
   * team leader what to do is the firm supervising its own staff; a recommendation to sue is the
   * firm deciding how to run its business. Neither is a necessary expense of collecting from this
   * debtor, and billing one would not survive being asked about.
   *
   * Decided here rather than trusted to the caller, so a future screen that forgets to pass
   * `charge: false` still cannot raise the fee.
   */
  /*
   * AND A BATCH HAS NOBODY TO CHARGE. A sheet-level query is about a client's data, not a
   * debtor's objection -- there is no one account to raise a fee against and there must not be
   * one. This is the third lock on the same rule, after `charge: false` at the call site and
   * escalationChargeable('import') being false, and it is the one that cannot be forgotten.
   */
  const mayCharge = escalationChargeable(input.kind ?? 'dispute') && !!input.accountId
  const charge = (!mayCharge || input.charge === false) ? null : await chargeItem({
    accountId: input.accountId!,
    itemId: '3',
    actionCode: 'perusal',
    // "ONE" is what the firm calls item 3 -- Other Necessary Expenses. Their own shorthand,
    // on their own statements.
    description: 'ONE',
    createdBy: input.raisedBy ?? null,
  })

  /*
   * The account's own timeline gets it too, so a collector reading the history sees the dispute
   * where they read everything else, not only if they think to open a panel.
   *
   * ONLY WHERE THERE IS AN ACCOUNT. A sheet-level query has no timeline to write to -- account
   * notes are per account and a batch is not one. Its record is the query itself, which is why
   * it has a page of its own.
   */
  if (input.accountId) {
    await addNote({
      accountId: input.accountId,
      // Just what happened. The fee is already its own line on the timeline with its own amount,
      // and repeating it here made a two-line event into a five-line one.
      body: escalationNote(input.kind ?? 'dispute', q.description),
      authorName: input.raisedByName ?? null,
      createdBy: input.raisedBy ?? null,
      queryId: q.id,
      kind: 'query',
    })
  }

  /*
   * AND THE SEQUENCE THIS JUST STARTED GETS ITS DATES NOW.
   *
   * `workflow_start_on_dispute` creates the run in the database off the three columns above, and a
   * run arrives from a trigger with NO STEPS -- the dating needs the working-day calendar, which
   * lives in the app. Nothing called the planner here, so the firm raised a dispute and found a
   * workflow that had started and could never do anything: "it also doesn't show me the steps for
   * the dispute."
   *
   * DISPUTES ONLY. An agent asking a team leader for help and a query about a client's own sheet
   * start no sequence at all, and nudging on those would fire the account's due steps early for
   * nothing.
   *
   * LAST, AND IT CANNOT FAIL THE DISPUTE. Everything above is the firm's record of what the debtor
   * said; this is the part that reaches out. Fire and forget, with the six o'clock sweep behind it.
   */
  if (isDispute && input.accountId) void nudgeWorkflowsForAccount(input.accountId)

  /* AND WHOEVER IT WAS GIVEN TO IS TOLD. See tellTheOwner: nothing did, and the liaison's only
     signal was a badge on a menu item. */
  await tellTheOwner({
    ownerId: input.ownerId,
    actorId: input.raisedBy,
    queryId: q.id,
    kind: input.kind ?? 'dispute',
    requestFor: q.requestFor,
    debtorName: input.debtorName ?? null,
    raisedByName: input.raisedByName ?? null,
  })

  return { query: q, charge }
}

/**
 * TELL THE PERSON A TICKET HAS BECOME THEIRS.
 *
 * THE FIRM, signed in as the liaison a request had just been given to: "just check if it went to
 * the notifications." IT HAD NOT. Nicole's bell held fourteen notifications and every one of them
 * was an email; nothing anywhere told her a ticket was now hers to answer. The only signal was the
 * Disputes badge quietly moving from nought to one — a number on a menu item, which is not a thing
 * that reaches somebody who is looking at a different screen.
 *
 * THE BELL IS FOR WORK THAT HAS BECOME YOURS, which is exactly what this is: somebody has handed
 * you a question about a debtor and is waiting on your answer.
 *
 * IT NEVER FAILS THE THING IT IS ANNOUNCING. A ticket that saved and did not ring is a small
 * problem; a ticket that failed to save because a bell did not ring is a debtor's dispute lost.
 * The same reasoning handOutWrite applies to its own notices, and the same swallow.
 *
 * AND IT NEVER TELLS YOU ABOUT YOUR OWN PRESS. Giving a ticket to yourself — which a liaison
 * raising their own does — would otherwise ring your own bell for something you just did.
 */
async function tellTheOwner(input: {
  ownerId: string | null | undefined
  actorId: string | null | undefined
  queryId: string
  kind: EscalationKind
  requestFor?: string | null
  debtorName?: string | null
  raisedByName?: string | null
}): Promise<void> {
  const owner = input.ownerId
  if (!owner || owner === input.actorId) return
  const what = input.kind === 'request'
    ? (input.requestFor?.trim() || 'Information needed')
    : input.kind === 'dispute' ? 'A dispute' : 'A ticket'
  const about = input.debtorName?.trim() ? ` on ${input.debtorName.trim()}` : ''
  const from = input.raisedByName?.trim() ? ` from ${input.raisedByName.trim()}` : ''
  try {
    await supabase.rpc('notify_user', {
      p_user_id: owner,
      p_type: 'query.assigned',
      p_message: `${what}${about}${from} is waiting for you.`,
      /* STRAIGHT TO THE TICKET, because that is where every one of these is answered. A link to
         the board would make the reader find it again among everybody else's. */
      p_link: `/queries/${input.queryId}`,
    })
  } catch { /* see above: a bell that did not ring must not undo work that did happen. */ }
}

/**
 * What a status change costs the debtor.
 *
 * Two of the three transitions are chargeable work, and neither can be item 3 — that one is a
 * total for the account and raising the query already used it. They are charged as what they
 * actually are:
 *
 *   with_client  we write to the client about the dispute. Item 1a, "necessary ordinary letter,
 *                registered letter, facsimile or e-mail", R25. Per occurrence, so a query that
 *                has to be chased more than once charges each time.
 *   answered     the client's reply comes in and someone deals with it. Item 6, "correspondence
 *                received and attended to", R13.
 *
 * Closing a query costs nothing: deciding is not a further piece of correspondence.
 */
const CHARGE_ON_STAGE: Partial<Record<QueryStage, { itemId: string; actionCode: string; description: string }>> = {
  // Reaching the client is correspondence out; the client answering is correspondence in.
  // Moving from the agent to the liaison is internal and costs the debtor nothing.
  client: { itemId: '1a', actionCode: 'email_out', description: 'Query sent to client' },
  // Item 6 IS "correspondence received and attended to"; the longer sentence was this code
  // explaining to itself which correspondence it meant. On a statement it only added words.
  liaison: { itemId: '6', actionCode: 'email_in', description: 'Correspondence' },
}

/**
 * Moving a query along.
 *
 * `actorName` is who is really doing it, which may not be the owner — the team covers for each
 * other, and a history that credits the owner for someone else's work is a history that cannot
 * answer "who spoke to the client".
 */
export async function updateQuery(
  id: string,
  patch: {
    stage?: QueryStage
    ownerId?: string | null
    chaseOn?: string | null
    category?: string | null
    description?: string
  },
  /** `accountId` is null on a sheet-level query: there is no timeline and nobody to charge. */
  context: {
    accountId: string | null
    actorId: string | null
    actorName: string | null
    note?: string
    /** Who it is about, for the new owner's notification only. See tellTheOwner. */
    debtorName?: string | null
  },
): Promise<AccountQuery> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.stage !== undefined) {
    row.stage = patch.stage
    // Recorded once, the first time it goes out: how long a client has actually had it is the
    // question that matters when a query goes quiet.
    if (patch.stage === 'client') {
      row.sent_to_client_at = new Date().toISOString()
      row.sent_to_client_by = context.actorId
    }
  }
  if (patch.ownerId !== undefined) row.owner_id = patch.ownerId
  if (patch.chaseOn !== undefined) row.chase_on = patch.chaseOn || null
  if (patch.category !== undefined) row.category = patch.category?.trim() || null
  if (patch.description !== undefined) row.description = patch.description.trim()

  const { data, error } = await supabase.from('account_queries').update(row).eq('id', id).select('*').single()
  if (error) throw new Error(error.message)

  /* A batch has no account to charge, and a client's own data being wrong is not something any
     debtor pays for. The same rule as raiseQuery, in the other place a stage can move. */
  const chargeable = patch.stage && context.accountId ? CHARGE_ON_STAGE[patch.stage] : undefined
  if (chargeable) {
    await chargeItem({
      accountId: context.accountId!,
      itemId: chargeable.itemId,
      actionCode: chargeable.actionCode,
      description: chargeable.description,
      createdBy: context.actorId,
    })
  }

  if ((patch.stage || context.note) && context.accountId) {
    const body = context.note?.trim()
      || `Query moved: ${QUERY_STAGE_LABEL[patch.stage as QueryStage] ?? patch.stage}.`
    await addNote({
      accountId: context.accountId,
      body,
      authorName: context.actorName,
      createdBy: context.actorId,
      queryId: id,
      kind: 'query',
    })
  }

  /*
   * AND A TICKET HANDED ON TELLS WHOEVER IT WAS HANDED TO.
   *
   * The same gap as on raiseQuery, in the other place an owner changes: a liaison passing a
   * request to the liaison manager moved it off their own board and onto somebody else's, and the
   * somebody else was told nothing at all.
   *
   * ONLY WHERE THE OWNER ACTUALLY MOVED. `updateQuery` is also how a chase date, a stage and a
   * description are saved, and ringing a bell every time somebody edits a sentence is how a bell
   * stops being read. `patch.ownerId !== undefined` is the press that reassigned it.
   */
  const q = toQuery(data)
  if (patch.ownerId !== undefined && patch.ownerId) {
    await tellTheOwner({
      ownerId: patch.ownerId,
      actorId: context.actorId,
      queryId: id,
      kind: q.kind,
      requestFor: q.requestFor,
      debtorName: context.debtorName ?? null,
      raisedByName: context.actorName,
    })
  }
  return q
}

/**
 * WHEN A CLIENT GETS A NEW LIAISON, THEIR OPEN TICKETS GO WITH THEM.
 *
 * THE FIRM: "the same goes for the liaison. If the liaison for a specific client is changed, the
 * ticket goes to the new liaison."
 *
 * WHY THIS ONE IS A WRITE AND THE COLLECTOR'S HALF IS NOT. A ticket's `owner_id` is not "the
 * client's liaison" — it is whoever was given this particular ticket, which may be a team leader,
 * the liaison manager, or nobody. So it cannot be derived from the client the way the account's
 * current desk can. What CAN be said is that the tickets sitting with the OLD liaison were sitting
 * with them BECAUSE they were the liaison, and those are the ones that move.
 *
 * ------------------------------------------------------------------------------------------------
 * FOUR THINGS IT WILL NOT TOUCH, AND EACH IS A WAY THIS COULD DO HARM
 * ------------------------------------------------------------------------------------------------
 *
 *   A CLOSED TICKET. Its owner is part of the record of who answered it. Moving one would rewrite
 *   history to say somebody dealt with a dispute they have never seen.
 *
 *   A TICKET SOMEBODY ELSE HOLDS. Given to a team leader for a decision, or escalated to the
 *   liaison manager, it is with them for a reason that has nothing to do with who looks after the
 *   client. Only rows whose owner IS the departing liaison move.
 *
 *   AN UNOWNED TICKET. "Nobody yet — leave it unassigned" is an option on the box and means it sits
 *   on the board for whoever picks it up. Handing those to the new liaison would quietly assign
 *   work nobody had decided to give them.
 *
 *   ANOTHER CLIENT'S. Scoped through the accounts of THIS company, which is why the ids are read
 *   first rather than filtered in one statement — PostgREST has no join to filter an update by.
 *
 * AND THE NEW LIAISON IS TOLD, once per ticket, through the same bell everything else uses. A
 * handover of somebody's open work that arrives silently is a handover they discover from a client
 * asking why nobody answered.
 *
 * NEVER FATAL TO THE CHANGE ITSELF. The caller has already saved the new liaison on the client;
 * this is the consequence. Failing it would leave the firm unable to change a liaison because some
 * ticket somewhere would not move.
 */
export async function moveClientTicketsToLiaison(input: {
  companyId: string
  from: string | null | undefined
  to: string | null | undefined
  actor: { id: string | null; name: string | null }
}): Promise<{ moved: number }> {
  const { companyId, from, to } = input
  /* NOTHING TO DO where there was no liaison, where there is no new one, or where somebody saved
     the same name again -- and the last of those is the common one on a form with a Save button. */
  if (!from || !to || from === to) return { moved: 0 }

  const { data: accounts, error: accErr } = await supabase
    .from('debtor_accounts').select('id').eq('company_id', companyId)
  if (accErr) throw new Error(accErr.message)
  const ids = (accounts ?? []).map((a) => (a as { id: string }).id)
  if (ids.length === 0) return { moved: 0 }

  const { data, error } = await supabase
    .from('account_queries')
    .update({ owner_id: to, updated_at: new Date().toISOString() })
    .in('account_id', ids)
    .eq('owner_id', from)
    .neq('status', 'closed')
    .select('id, kind, request_for')
  if (error) throw new Error(error.message)

  const moved = (data ?? []) as { id: string; kind: string; request_for: string | null }[]
  for (const q of moved) {
    await tellTheOwner({
      ownerId: to,
      actorId: input.actor.id,
      queryId: q.id,
      kind: (q.kind ?? 'dispute') as EscalationKind,
      requestFor: q.request_for,
      raisedByName: input.actor.name,
    })
  }
  if (moved.length > 0) await refreshNavCounts()
  return { moved: moved.length }
}

/**
 * THE ONE OPEN DISPUTE ON AN ACCOUNT, OR NOTHING.
 *
 * THE FIRM: "there can only be one dispute at a time. A debtor can't have multiple disputes. He
 * can dispute multiple things in one dispute. But there should only be one dispute allowed to be
 * open at a specific time."
 *
 * `one_open_dispute_per_account` is the rule and it refuses a second loudly. THIS IS WHAT THE
 * SCREENS ASK so they never offer one: a button that appears to work and does not is worse than
 * one that is not there, and here the error would arrive after a collector had typed out what the
 * debtor said with the debtor still on the telephone.
 *
 * ONE FUNCTION BECAUSE TWO SCREENS RAISE A DISPUTE -- the Escalate box and the panel on the
 * account. Written out twice they drift, and the half that drifts is the one that offers a second
 * dispute the database then refuses.
 *
 * THE FIRST OF THEM, NOT A COUNT. An account that already has two (there are two on staging, from
 * before the rule) has one that is the answer, and any of them is the one to add to.
 */
export function openDisputeOn(queries: AccountQuery[]): AccountQuery | null {
  return queries.find((q) => q.kind === 'dispute' && q.status !== 'closed') ?? null
}

/**
 * THE WRITTEN DISPUTE HAS ARRIVED.
 *
 * THE FIRM: "we need a way to figure out, to start the dispute workflow from the moment that
 * we've received the email with the dispute."
 *
 * THIS IS THAT MOMENT, AND IT IS THE ONLY THING IT DOES. Setting `received_on` and `in_writing` is
 * what workflow_start_on_dispute reads: the sequence that was asking for the dispute in writing is
 * ended -- its deemed-undisputed notice must never reach a debtor whose dispute is on the firm's
 * desk -- the real one starts, and workflow_hold_account stops the collection sequences until the
 * firm has given its finding. All of that happens in the database off this one write.
 *
 * BOTH COLUMNS TOGETHER, in one update, for the reason the cancelled arrangement writes its cause
 * with its status: the trigger reads NEW, and a second update fires it against a row that still
 * says the dispute has not arrived.
 *
 * DATED TODAY RATHER THAN TAKEN FROM THE CALLER. The day a document reached the firm is the day
 * somebody opened it, and a back-dated receipt shortens a period the debtor is entitled to. If the
 * firm ever needs to record a letter that sat in a mailbox over a weekend, that is a correction
 * they make deliberately, not a default this hands anybody.
 */
export async function markDisputeReceived(
  id: string,
  context: { accountId: string | null; actorId: string | null; actorName: string | null },
): Promise<AccountQuery> {
  const { data, error } = await supabase
    .from('account_queries')
    .update({ received_on: todayIso(), in_writing: true })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  /* ON THE ACCOUNT'S OWN TIMELINE, because this is the event that stops the collection sequences
     and somebody reading the account tomorrow has to be able to see why. */
  if (context.accountId) {
    await addNote({
      accountId: context.accountId,
      body: 'The dispute was received in writing.',
      authorName: context.actorName,
      createdBy: context.actorId,
      queryId: id,
      kind: 'query',
    })
  }

  /* AND THE REAL SEQUENCE GETS ITS DATES NOW -- see raiseEscalation for why the trigger cannot do
     this itself. This is the one the firm watched start with nothing in it: day 1 of the dispute
     workflow is the acknowledgement to the debtor, and waiting for the sweep sends it a day late
     against a period the firm has ten business days to answer in. */
  if (context.accountId) void nudgeWorkflowsForAccount(context.accountId)

  await refreshNavCounts()
  return toQuery(data)
}

/**
 * Closing a query with a decision.
 *
 * The outcome is recorded, and `outcomeDone` says whether anybody has carried it out. A valid
 * dispute usually means an amount comes down or the account is withdrawn — both of which move
 * money or end a mandate, and neither of which this function does. Recording a decision and
 * performing it are different acts, and conflating them is how a balance changes with nobody
 * able to say who changed it.
 */
export async function closeQuery(
  id: string,
  decision: {
    outcome: QueryOutcome
    action?: string | null
    amount?: number | null
    /**
     * WHAT IT DID TO THE ACCOUNT, on an upheld dispute. Null on one that was not upheld.
     *
     * THE DATABASE READS THIS AND NOTHING ELSE. workflow_on_dispute_answered branches on it to
     * decide whether the sequence resumes, ends, or ends and may be re-issued -- so the free-text
     * `action` beside it stays what it always was, a note for a person.
     */
    effect?: QueryEffect | null
  },
  /** `accountId` is null on a sheet-level query: there is no account timeline to write to. */
  context: { accountId: string | null; actorId: string | null; actorName: string | null },
): Promise<AccountQuery> {
  const { data, error } = await supabase
    .from('account_queries')
    .update({
      status: 'closed',
      outcome: decision.outcome,
      outcome_action: decision.action?.trim() || null,
      outcome_amount: decision.amount ?? null,
      outcome_effect: decision.effect ?? null,
      closed_at: new Date().toISOString(),
      closed_by: context.actorId,
      closed_by_name: context.actorName,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  if (context.accountId) {
    const parts = [`Query closed — ${QUERY_OUTCOME_LABEL[decision.outcome].toLowerCase()}`]
    /* The effect on the ACCOUNT goes on the timeline in the firm's words, because it is the
       part that decides what happens next and the part somebody will be asked about. */
    if (decision.effect) parts.push(QUERY_EFFECT_LABEL[decision.effect])
    if (decision.action) parts.push(decision.action.trim())
    await addNote({
      accountId: context.accountId,
      body: parts.join('. '),
      authorName: context.actorName,
      createdBy: context.actorId,
      queryId: id,
      kind: 'query',
    })
  }

  // Closing one drops it off the badge; reassigning one moves it off mine and onto theirs.
  refreshNavCounts()
  return toQuery(data)
}

/** Marks the outcome as actually carried out — the amount reduced, the account withdrawn. */
export async function markOutcomeDone(
  id: string,
  context: { accountId: string; actorId: string | null; actorName: string | null },
): Promise<AccountQuery> {
  const { data, error } = await supabase
    .from('account_queries')
    .update({ outcome_done: true, updated_at: new Date().toISOString() })
    .eq('id', id).select('*').single()
  if (error) throw new Error(error.message)
  await addNote({
    accountId: context.accountId,
    body: 'Query outcome carried out.',
    authorName: context.actorName,
    createdBy: context.actorId,
    queryId: id,
    kind: 'query',
  })

  // Closing one drops it off the badge; reassigning one moves it off mine and onto theirs.
  refreshNavCounts()
  return toQuery(data)
}

/** The thread: the account's notes that belong to this query. */
export function notesForQuery(notes: AccountNote[], queryId: string): AccountNote[] {
  return notes.filter((n) => n.queryId === queryId)
}
