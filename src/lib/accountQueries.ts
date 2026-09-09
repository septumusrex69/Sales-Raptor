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
import { chargeItem, chargeMessage, type ChargeResult } from './accountCharges'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come back as untyped JSON from PostgREST. */

export type QueryStatus = 'open' | 'with_client' | 'answered' | 'closed'
export type QueryOutcome = 'valid' | 'partly_valid' | 'not_valid' | 'withdrawn'

export const QUERY_STATUS_LABEL: Record<QueryStatus, string> = {
  open: 'Open',
  with_client: 'With client',
  answered: 'Client answered',
  closed: 'Closed',
}

export const QUERY_OUTCOME_LABEL: Record<QueryOutcome, string> = {
  valid: 'Valid',
  partly_valid: 'Partly valid',
  not_valid: 'Not valid',
  withdrawn: 'Withdrawn by debtor',
}

/**
 * Optional, and short on purpose. The kinds are genuinely various — "it could be anything" — so
 * this groups the handful worth counting and stops. Anything else is just the description.
 */
export const QUERY_CATEGORIES = [
  'Already paid', 'Amount disputed', 'Goods or service', 'Not my account',
  'Prescribed', 'Under debt review', 'Other',
] as const

export interface AccountQuery {
  id: string
  accountId: string
  description: string
  category: string | null
  status: QueryStatus
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
    .neq('status', 'closed')
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
export async function raiseQuery(input: {
  accountId: string
  description: string
  category?: string | null
  ownerId?: string | null
  chaseOn?: string | null
  raisedBy?: string | null
  raisedByName?: string | null
  /**
   * Whether to charge the debtor item 3.
   *
   * Defaults to true, because the ordinary case is a debtor query that Communications will take
   * up with the client. It is false for an internal escalation — asking your own manager how to
   * handle an account is supervision, not a "necessary expense" recoverable from the debtor, and
   * charging for it would not survive being asked about.
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
    description: 'Query raised — other necessary expenses',
    createdBy: input.raisedBy ?? null,
  })

  // The account's own timeline gets it too, so a collector reading the history sees the dispute
  // where they read everything else, not only if they think to open a panel.
  await addNote({
    accountId: input.accountId,
    body: charge
      ? `Query raised: ${q.description}\n${chargeMessage(charge, '3')}`
      : `Query raised: ${q.description}\nNot charged to the debtor.`,
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
const CHARGE_ON_STATUS: Partial<Record<QueryStatus, { itemId: string; actionCode: string; description: string }>> = {
  with_client: { itemId: '1a', actionCode: 'email_out', description: 'Query sent to client' },
  answered: { itemId: '6', actionCode: 'email_in', description: 'Client response to query received and attended to' },
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
    status?: QueryStatus
    ownerId?: string | null
    chaseOn?: string | null
    category?: string | null
    description?: string
  },
  context: { accountId: string; actorId: string | null; actorName: string | null; note?: string },
): Promise<AccountQuery> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.status !== undefined) row.status = patch.status
  if (patch.ownerId !== undefined) row.owner_id = patch.ownerId
  if (patch.chaseOn !== undefined) row.chase_on = patch.chaseOn || null
  if (patch.category !== undefined) row.category = patch.category?.trim() || null
  if (patch.description !== undefined) row.description = patch.description.trim()

  const { data, error } = await supabase.from('account_queries').update(row).eq('id', id).select('*').single()
  if (error) throw new Error(error.message)

  let charge: ChargeResult | null = null
  const chargeable = patch.status ? CHARGE_ON_STATUS[patch.status] : undefined
  if (chargeable) {
    charge = await chargeItem({
      accountId: context.accountId,
      itemId: chargeable.itemId,
      actionCode: chargeable.actionCode,
      description: chargeable.description,
      createdBy: context.actorId,
    })
  }

  if (patch.status || context.note) {
    const body = context.note?.trim()
      || `Query moved to ${QUERY_STATUS_LABEL[patch.status as QueryStatus] ?? patch.status}.`
    await addNote({
      accountId: context.accountId,
      body: charge ? `${body}\n${chargeMessage(charge, chargeable!.itemId)}` : body,
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
