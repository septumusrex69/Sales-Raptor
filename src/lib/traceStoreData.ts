/**
 * Reading and writing filed traces.
 *
 * The queries only; every rule lives in traceStore.ts, which imports nothing.
 */
import { supabase } from './supabase'
import { addContact, addNote, documentUrl } from './accountWorkspace'
import { chargePerusal } from './accountCharges.ts'
import {
  contactKindFor, linkedHow, linkedNumber, promotedNote, savesAs,
  type FiledTrace, type TraceItem, type TraceItemKind, type TraceOutcome,
} from './traceStore.ts'
import { clockNow } from './clock.ts'

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
  /* `pulled_by` IS WHO WORKED THE ROUND. It is who paid for the report and then went down its
     list, and it is the only person the data names -- see roundsSpentBy, which counts rounds per
     person because the firm's rule is per person: "if an individual has worked through a trace
     twice, it could go to the next person." */
  + 'company_status,contact_score,risk_score,enquired_on,document_id,pulled_by,created_at'

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
  pulledBy: r.pulled_by ?? null,
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
    outcome_at: input.outcome === null ? null : clockNow().toISOString(),
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
  /**
   * WHAT THIS PERSON IS TO THE CASE, in the collector's own words.
   *
   * THE FIRM: "if you save the person and their number as a next of kin, you should be able to
   * make a note -- what is the relationship to the case, what is the relation of this person to
   * the case."
   *
   * THE ONLY RELATIONSHIP A PROMOTED PERSON CARRIED WAS THE BUREAU'S. `linkedHow` reads whatever
   * XDS printed about how two records touch -- a shared address, a shared surname -- which is not
   * the same thing as "his sister, he stays there weekends, she takes messages". One is a data
   * match and the other is why you would ring her.
   *
   * IT GOES ON THE TIMELINE RATHER THAN INTO person_role, which is a label on a list and has to
   * stay short. A sentence belongs in the history.
   */
  relationship?: string | null
  actor?: { id: string | null; name: string | null }
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
  /*
   * A PERSON IS A NAME AND A NUMBER, AND THE NUMBER IS WHAT A CONTACT HOLDS.
   *
   * THE FIRM: "now here I've verified next of kins and I don't like see anybody here." They were
   * right, and the rows say why: four contacts of kind `other` whose VALUE is "Elise Ferreira"
   * and whose label is "Telephone · 0832537190". A linked person's finding carries the name in
   * `value` and the number in `label`, and this saved them exactly that way round -- so the
   * account's contact list held four names nobody can dial, and `otherPeople` (which groups on
   * person_name) could not see them at all because plain Save left person_name null.
   *
   * SO A LINKED PERSON IS TURNED THE RIGHT WAY UP HERE: their number becomes the contact, their
   * name becomes person_name, and what the bureau said connects them becomes their role. That is
   * what makes them appear under the debtor's details as a person, and what stops a collector
   * opening a call to somebody's sister as though she were the debtor.
   *
   * AND THE NEXT-OF-KIN BUTTON NOW ONLY SETS THE ROLE. Both buttons produce a real, dialable
   * contact; pressing the second one says what the relationship is rather than being the only way
   * to get a usable row.
   *
   * WHERE THERE IS NO NUMBER IN THE LABEL the finding stays as it was -- a person linked through
   * an address or an identity number is worth recording and there is nothing to ring.
   */
  const linkedTo = item.kind === 'link' ? linkedNumber(item.label) : null
  const personKind = linkedTo ? 'phone' : 'other'
  const contact = await addContact({
    accountId,
    kind: item.kind === 'link' ? personKind : (asNextOfKin ? 'other' : contactKindFor(item.kind)),
    value: linkedTo ?? item.value,
    personName: item.kind === 'link' ? item.value : (asNextOfKin ? item.value : subjectName),
    personRole: asNextOfKin ? 'Next of kin'
      : item.kind === 'link' ? (linkedHow(item.label) ?? 'Linked person')
        : null,
    label: item.label,
    /*
     * NEVER PRIMARY FROM HERE. Which number a collector rings first is a decision about the whole
     * account, made on the contact list where all of them are visible together — not a side
     * effect of promoting one finding out of a trace.
     */
    isPrimary: false,
    /*
     * SAVED IS CONFIRMED, at the firm's instruction: "if you save this person and their number,
     * it's automatically verified... it goes into a verified state unless you remove it from a
     * verified state." Going back to the account to tick it by hand was the step that got skipped.
     *
     * NOTHING KNOWN-BAD CAN GET HERE. canPromote already refuses a finding marked not theirs,
     * moved on, or disowned by the person the bureau linked -- which is what stops this putting a
     * dead detail on the contact list wearing a tick.
     */
    verified: true,
  })

  const { error } = await supabase.from('account_trace_items')
    .update({ promoted_contact_id: contact.id }).eq('id', item.id)
  if (error) throw new Error(error.message)

  /*
   * AND THE ACCOUNT'S OWN HISTORY GETS IT.
   *
   * LAST, AND IT CANNOT UNDO THE SAVE. The contact is on the account and the finding is marked
   * promoted either way; a note that would not write must not take those with it. Same swallow as
   * the main comment on a call and the bell on a ticket, and for the same reason.
   */
  try {
    await addNote({
      accountId,
      body: promotedNote({
        what: savesAs(item),
        value: linkedTo ?? item.value,
        personName: item.kind === 'link' ? item.value : (asNextOfKin ? item.value : null),
        personRole: asNextOfKin ? 'Next of kin' : (item.kind === 'link' ? linkedHow(item.label) : null),
        relationship: input.relationship ?? null,
      }),
      authorName: input.actor?.name ?? null,
      createdBy: input.actor?.id ?? null,
    })
  } catch (e) {
    console.error('[trace] the contact was saved but the timeline note was not:', e)
  }
}

/**
 * A URL for the report a trace was read out of.
 *
 * The trace stores which document it came from, and nothing else about it -- the storage path
 * lives on the document row. Two steps rather than one join: the path is the only thing wanted,
 * it is wanted once, on a click, and a join would put another column into a hand-written mapper
 * for the sake of a button.
 *
 * Signed for sixty seconds, like every other document in the app, because the bucket is private
 * and a permanent address to somebody's bureau profile is not a thing to hand out.
 */
export async function traceReportUrl(documentId: string, accountId?: string | null): Promise<string> {
  const { data, error } = await supabase.from('account_documents')
    .select('storage_path').eq('id', documentId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.storage_path) throw new Error('That report is no longer on the account.')
  const url = await documentUrl(data.storage_path)
  /*
   * AND READING IT IS A PERUSAL OF DOCUMENTS, once a day. The firm named this one: "limited to one
   * a day... this includes a trace and everything else." It is the same action code the documents
   * panel raises, so a collector who opened a statement this morning and the trace report this
   * afternoon is charged once -- which is the whole of "and everything else".
   *
   * AFTER THE URL, as everywhere: a report that cannot be opened has not been perused.
   */
  if (accountId) await chargePerusal({ accountId })
  return url
}
