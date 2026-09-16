/**
 * Reading and writing filed traces.
 *
 * The queries only; every rule lives in traceStore.ts, which imports nothing.
 */
import { supabase } from './supabase'
import { addContact } from './accountWorkspace'
import {
  contactKindFor,
  type FiledTrace, type TraceItem, type TraceItemKind, type TraceOutcome,
} from './traceStore.ts'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come back as untyped JSON from PostgREST. */

const toItem = (r: any): TraceItem => ({
  id: r.id,
  traceId: r.trace_id,
  accountId: r.account_id,
  kind: r.kind as TraceItemKind,
  value: r.value,
  label: r.label ?? null,
  peopleLinked: r.people_linked === null || r.people_linked === undefined ? null : Number(r.people_linked),
  seenOn: r.seen_on ?? null,
  amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
  status: r.status ?? null,
  outcome: (r.outcome as TraceOutcome | null) ?? null,
  outcomeAt: r.outcome_at ?? null,
  outcomeNote: r.outcome_note ?? null,
  promotedContactId: r.promoted_contact_id ?? null,
})

const TRACE_COLUMNS =
  'id,account_id,subject_kind,director_id,report_kind,subject_name,id_number,registration_number,'
  + 'company_status,contact_score,risk_score,enquired_on,document_id,created_at'

const ITEM_COLUMNS =
  'id,trace_id,account_id,kind,value,label,people_linked,seen_on,amount,status,outcome,'
  + 'outcome_at,outcome_note,promoted_contact_id'

const toTrace = (r: any, items: TraceItem[]): FiledTrace => ({
  id: r.id,
  accountId: r.account_id,
  subjectKind: r.subject_kind,
  directorId: r.director_id ?? null,
  reportKind: r.report_kind ?? null,
  subjectName: r.subject_name ?? null,
  idNumber: r.id_number ?? null,
  registrationNumber: r.registration_number ?? null,
  companyStatus: r.company_status ?? null,
  contactScore: r.contact_score ?? null,
  riskScore: r.risk_score ?? null,
  enquiredOn: r.enquired_on ?? null,
  documentId: r.document_id ?? null,
  createdAt: r.created_at,
  items,
})

/**
 * Every trace filed on an account, newest first, with its findings.
 *
 * Two queries rather than an embed, for the same reason as the directorships: a nested shape is
 * one more thing a hand-written mapper has to know about, and this codebase has already lost a
 * column that way.
 */
export async function fetchTraces(accountId: string): Promise<FiledTrace[]> {
  const { data, error } = await supabase.from('account_traces')
    .select(TRACE_COLUMNS).eq('account_id', accountId).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  const traces = data ?? []
  if (traces.length === 0) return []

  const items = await supabase.from('account_trace_items')
    .select(ITEM_COLUMNS).in('trace_id', traces.map((t: any) => t.id))
  if (items.error) throw new Error(items.error.message)

  const byTrace = new Map<string, TraceItem[]>()
  for (const row of (items.data ?? []).map(toItem)) {
    const list = byTrace.get(row.traceId)
    if (list) list.push(row); else byTrace.set(row.traceId, [row])
  }
  return traces.map((t: any) => toTrace(t, byTrace.get(t.id) ?? []))
}

/** Every finding on an account, across all its traces. What the panel summarises. */
export async function fetchTraceItems(accountId: string): Promise<TraceItem[]> {
  const { data, error } = await supabase.from('account_trace_items')
    .select(ITEM_COLUMNS).eq('account_id', accountId)
  if (error) throw new Error(error.message)
  return (data ?? []).map(toItem)
}

/**
 * What happened when somebody tried it.
 *
 * Passing null clears the outcome, which is the firm's "you can unverify it" — somebody marked a
 * number verified, a later call proved otherwise, and the honest state is back to untried rather
 * than a wrong claim left standing.
 */
export async function recordTraceOutcome(input: {
  itemId: string
  outcome: TraceOutcome | null
  note?: string | null
  actor: { id: string | null }
}): Promise<void> {
  const { error } = await supabase.from('account_trace_items').update({
    outcome: input.outcome,
    outcome_at: input.outcome === null ? null : new Date().toISOString(),
    outcome_by: input.outcome === null ? null : input.actor.id,
    outcome_note: input.note?.trim() || null,
  }).eq('id', input.itemId)
  if (error) throw new Error(error.message)
}

/**
 * Putting a finding on the account's principal details.
 *
 * TWO WRITES AND THE LINK BETWEEN THEM. The contact is created, and the finding records which
 * contact it became — so the trace can show that this number has already earned its place, and
 * pressing the button twice cannot put it on the list twice.
 *
 * The LABEL says where it came from. A number that arrived off a director's profile is the
 * director's number, and a collector ringing it needs to open with the right name.
 */
export async function promoteTraceItem(input: {
  item: TraceItem
  accountId: string
  /** Whose profile it came off, for the label. Null where the trace was of the debtor. */
  subjectName: string | null
  /** The firm's "add a contact person from the next of kin as a next of kin". */
  asNextOfKin?: boolean
}): Promise<void> {
  const { item, accountId, subjectName, asNextOfKin } = input

  /*
   * WHOSE IT IS GOES IN ITS OWN COLUMN NOW, not into the label.
   *
   * It was crammed into the label because there was nowhere else for it, and a label is free text
   * that nothing can group by — so a company's contact list was a flat run of numbers with names
   * buried in their captions. person_name is what lets the account screen show them under the
   * person a collector has to ask for.
   *
   * A NEXT OF KIN IS THEIR OWN PERSON. The name on the row is the relative's, not the debtor's,
   * and their role is the relationship — which is what stops somebody opening the call as though
   * they were talking to the debtor.
   */
  const contact = await addContact({
    accountId,
    kind: asNextOfKin ? 'other' : contactKindFor(item.kind),
    value: item.value,
    personName: asNextOfKin ? item.value : subjectName,
    personRole: asNextOfKin ? 'Next of kin' : null,
    label: asNextOfKin ? item.label : item.label,
    /*
     * NEVER PRIMARY FROM HERE. Which number a collector rings first is a decision about the whole
     * account, made on the contact list where all of them are visible together — not a side
     * effect of promoting one finding out of a trace.
     */
    isPrimary: false,
  })

  const { error } = await supabase.from('account_trace_items')
    .update({ promoted_contact_id: contact.id }).eq('id', item.id)
  if (error) throw new Error(error.message)
}
