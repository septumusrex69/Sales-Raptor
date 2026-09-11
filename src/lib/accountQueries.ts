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
import { addNote, type AccountNote } from './accountWorkspace'
import { chargeItem, type ChargeResult } from './accountCharges'

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
  canSendToClient, stageForAssignee,
  CAN_SEND_TO_CLIENT, QUERY_OUTCOME_LABEL,
  type DisputeStage as QueryStage, type QueryOutcome,
} from './disputeCategories'

export {
  canSendToClient, stageForAssignee,
  CAN_SEND_TO_CLIENT, QUERY_OUTCOME_LABEL,
}
export type { QueryStage, QueryOutcome }

/**
 * Who is being waited on.
 *
 * These read as "awaiting X" rather than "with X" for a reason the firm put plainly: once you have
 * escalated a dispute, being told it is *with* the liaison tells you nothing you did not do
 * yourself a second ago. What you actually want to know is that the ball is not in your court and
 * whose court it is in.
 *
 * `agent` is the exception and stays "with", because nobody is being waited on — it is sitting
 * with the collections desk, which is where it started.
 */
export const QUERY_STAGE_LABEL: Record<QueryStage, string> = {
  agent: 'With the agent',
  team_leader: 'Awaiting team leader',
  liaison: 'Awaiting liaison',
  client: 'Awaiting client',
}

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
  accountId: string
  description: string
  category: string | null
  status: QueryStatus
  stage: QueryStage
  sentToClientAt: string | null
  ownerId: string | null
  raisedByName: string | null
  raisedAt: string
  chaseOn: string | null
  outcome: QueryOutcome | null
  outcomeAction: string | null
  outcomeAmount: number | null
  outcomeDone: boolean
  closedAt: string | null
  closedByName: string | null
}

const toQuery = (r: any): AccountQuery => ({
  id: r.id,
  accountId: r.account_id,
  description: r.description,
  category: r.category,
  status: r.status,
  stage: (r.stage ?? 'agent') as QueryStage,
  sentToClientAt: r.sent_to_client_at ?? null,
  ownerId: r.owner_id,
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
    .select('*, debtor_accounts(account_number, debtor_first_name, debtor_surname, company_id)')
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
      .select('*, debtor_accounts(account_number, debtor_first_name, debtor_surname, company_id)')
      .eq('status', 'open').order('raised_at', { ascending: true }),
    supabase.from('account_queries')
      .select('*, debtor_accounts(account_number, debtor_first_name, debtor_surname, company_id)')
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
  const { data, error } = await supabase
    .from('account_queries')
    .select('*, debtor_accounts!inner(account_number, debtor_first_name, debtor_surname, company_id)')
    .eq('debtor_accounts.company_id', companyId)
    .order('raised_at', { ascending: false })
  if (error) throw new Error(error.message)
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((r: any) => {
    const a = r.debtor_accounts ?? {}
    return {
      ...toQuery(r),
      accountNumber: a.account_number ?? null,
      debtorName: [a.debtor_first_name, a.debtor_surname].filter(Boolean).join(' ') || 'Unnamed debtor',
      companyId: a.company_id ?? null,
    }
  })
}

export async function raiseQuery(input: {
  accountId: string
  description: string
  category?: string | null
  ownerId?: string | null
  /** Where it lands, which follows who it was given to. See {@link stageForAssignee}. */
  stage?: QueryStage
  chaseOn?: string | null
  raisedBy?: string | null
  raisedByName?: string | null
  /**
   * Whether to charge the debtor item 3.
   *
   * Defaults to true, because the ordinary case is a debtor query that Communications will take
   * up with someone else. It is false when you keep it yourself — writing down a dispute you are
   * going to answer at your own desk is the job, not a "necessary expense" recoverable from the
   * debtor, and charging for it would not survive being asked about.
   */
  charge?: boolean
}): Promise<{ query: AccountQuery; charge: ChargeResult | null }> {
  const { data, error } = await supabase
    .from('account_queries')
    .insert({
      account_id: input.accountId,
      description: input.description.trim(),
      category: input.category?.trim() || null,
      owner_id: input.ownerId ?? null,
      stage: input.stage ?? 'agent',
      chase_on: input.chaseOn || null,
      raised_by: input.raisedBy ?? null,
      raised_by_name: input.raisedByName ?? null,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  const q = toQuery(data)

  const charge = input.charge === false ? null : await chargeItem({
    accountId: input.accountId,
    itemId: '3',
    actionCode: 'perusal',
    // "ONE" is what the firm calls item 3 -- Other Necessary Expenses. Their own shorthand,
    // on their own statements.
    description: 'ONE',
    createdBy: input.raisedBy ?? null,
  })

  // The account's own timeline gets it too, so a collector reading the history sees the dispute
  // where they read everything else, not only if they think to open a panel.
  await addNote({
    accountId: input.accountId,
    // Just what happened. The fee is already its own line on the timeline with its own amount,
    // and repeating it here made a two-line event into a five-line one.
    body: `Dispute raised: ${q.description}`,
    authorName: input.raisedByName ?? null,
    createdBy: input.raisedBy ?? null,
    queryId: q.id,
    kind: 'query',
  })
  return { query: q, charge }
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
  context: { accountId: string; actorId: string | null; actorName: string | null; note?: string },
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

  const chargeable = patch.stage ? CHARGE_ON_STAGE[patch.stage] : undefined
  if (chargeable) {
    await chargeItem({
      accountId: context.accountId,
      itemId: chargeable.itemId,
      actionCode: chargeable.actionCode,
      description: chargeable.description,
      createdBy: context.actorId,
    })
  }

  if (patch.stage || context.note) {
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
  decision: { outcome: QueryOutcome; action?: string | null; amount?: number | null },
  context: { accountId: string; actorId: string | null; actorName: string | null },
): Promise<AccountQuery> {
  const { data, error } = await supabase
    .from('account_queries')
    .update({
      status: 'closed',
      outcome: decision.outcome,
      outcome_action: decision.action?.trim() || null,
      outcome_amount: decision.amount ?? null,
      closed_at: new Date().toISOString(),
      closed_by: context.actorId,
      closed_by_name: context.actorName,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  const parts = [`Query closed — ${QUERY_OUTCOME_LABEL[decision.outcome].toLowerCase()}`]
  if (decision.action) parts.push(decision.action.trim())
  await addNote({
    accountId: context.accountId,
    body: parts.join('. '),
    authorName: context.actorName,
    createdBy: context.actorId,
    queryId: id,
    kind: 'query',
  })
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
  return toQuery(data)
}

/** The thread: the account's notes that belong to this query. */
export function notesForQuery(notes: AccountNote[], queryId: string): AccountNote[] {
  return notes.filter((n) => n.queryId === queryId)
}
