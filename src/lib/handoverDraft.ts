/**
 * A handover sheet held in Raptor while somebody fixes it.
 *
 * THE FIRM: "it will scan each handover to see if everything is fine ... if it does not, some
 * handovers should not be accepted, and it should show why. Then you should be able to edit it in
 * the handover state on Raptor, and when it's ready say approve handover."
 *
 * WHY THE DRAFT IS IN THE DATABASE. A two-hundred-row handover is an afternoon of corrections. In
 * a browser tab that is an afternoon lost to a closed laptop, and it cannot be handed to somebody
 * else to finish — which on a big batch is exactly what happens, because the person who uploaded
 * the sheet is rarely the person who knows the client's own references.
 *
 * WHAT IS WRONG WITH A ROW IS NEVER STORED. Only the values are. planHandover works the verdict
 * out from them on every read, so a row cannot end up described by a judgement made before
 * somebody edited it — and the rules can be tightened without a migration to re-judge what is
 * already sitting in drafts.
 */
import { supabase } from './supabase'
import {
  planHandover, toDebtorInput, type HandoverPlan, type PlannedRow,
} from './handoverImport.ts'
import { HANDOVER_COLUMNS } from './handoverSheet.ts'
import { toAccountRow, toContactRows } from './newDebtor.ts'
import { createDebtorAccount } from './accountBook'

const DRAFT_COLUMNS = 'id, company_id, filename, sheet_kind, date_order, state, handover_id, '
  + 'approved_at, approved_by, created_by, created_at, updated_at'
const ROW_COLUMNS = 'id, draft_id, line, values, document_filename, excluded, created_at, updated_at'

export interface HandoverDraft {
  id: string
  companyId: string
  filename: string
  sheetKind: string | null
  dateOrder: string | null
  state: 'draft' | 'approved' | 'discarded'
  handoverId: string | null
  createdAt: string
}

export interface DraftRow {
  id: string
  line: number
  values: Record<string, string | null>
  documentFilename: string | null
  excluded: boolean
}

/** A draft and its rows, with every row judged fresh against the current rules. */
export interface JudgedDraft {
  draft: HandoverDraft
  rows: (DraftRow & { planned: PlannedRow })[]
  /** Rows that will become accounts: not excluded, and nothing refusing them. */
  ready: number
  refused: number
  totalCapital: number
}

const toDraft = (r: Record<string, unknown>): HandoverDraft => ({
  id: r.id as string,
  companyId: r.company_id as string,
  filename: r.filename as string,
  sheetKind: (r.sheet_kind as string | null) ?? null,
  dateOrder: (r.date_order as string | null) ?? null,
  state: r.state as HandoverDraft['state'],
  handoverId: (r.handover_id as string | null) ?? null,
  createdAt: r.created_at as string,
})

/**
 * Store a plan as a draft.
 *
 * THE WHOLE SHEET IS KEPT, refused rows and all. A row left out here is a row nobody can fix, and
 * the firm's instruction was the opposite: show why it was not accepted, then let it be edited.
 */
export async function saveDraft(input: {
  companyId: string
  filename: string
  plan: HandoverPlan
  /** filename by reference, from matchDocuments. */
  documentFor: Map<string, string>
}): Promise<string> {
  const { data: me } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('handover_drafts').insert({
    company_id: input.companyId,
    filename: input.filename,
    sheet_kind: input.plan.kind,
    date_order: input.plan.dates.order,
    created_by: me.user?.id ?? null,
  }).select('id').single()
  if (error) throw new Error(error.message)
  const draftId = data.id as string

  const rows = input.plan.rows.map((r) => ({
    draft_id: draftId,
    line: r.line,
    values: r.values,
    document_filename: input.documentFor.get(r.values.client_reference ?? '') ?? null,
  }))
  /* In chunks: a two-hundred-row sheet is one request, a five-thousand-row one is not, and
     PostgREST gives up on a payload long before Postgres does. */
  for (let i = 0; i < rows.length; i += 200) {
    const { error: rowError } = await supabase.from('handover_draft_rows').insert(rows.slice(i, i + 200))
    if (rowError) throw new Error(rowError.message)
  }
  return draftId
}

/** Every draft still waiting, newest first. */
export async function fetchOpenDrafts(): Promise<HandoverDraft[]> {
  const { data, error } = await supabase.from('handover_drafts')
    .select(DRAFT_COLUMNS).eq('state', 'draft').order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => toDraft(r as unknown as Record<string, unknown>))
}

/**
 * A draft, judged as it stands.
 *
 * THE ROWS ARE PUT BACK THROUGH planHandover rather than read as they were saved. That is what
 * makes an edit take effect: a corrected cell is judged by the same code that judged the file,
 * so the screen cannot say a row is refused for something somebody has already fixed.
 */
export async function fetchDraft(id: string, today: string): Promise<JudgedDraft | null> {
  const [{ data: d, error: de }, { data: rs, error: re }] = await Promise.all([
    supabase.from('handover_drafts').select(DRAFT_COLUMNS).eq('id', id).maybeSingle(),
    supabase.from('handover_draft_rows').select(ROW_COLUMNS).eq('draft_id', id).order('line'),
  ])
  if (de) throw new Error(de.message)
  if (re) throw new Error(re.message)
  if (!d) return null

  const stored: DraftRow[] = (rs ?? []).map((r) => ({
    id: r.id as string,
    line: r.line as number,
    values: (r.values ?? {}) as Record<string, string | null>,
    documentFilename: (r.document_filename as string | null) ?? null,
    excluded: r.excluded as boolean,
  }))

  /* Rebuilt as a sheet -- header row and all -- so the judging goes through exactly the path a
     file does, including the file-wide date order. Two paths to a verdict would eventually
     disagree, and the one that disagreed would be the one nobody was looking at. */
  const keys = HANDOVER_COLUMNS.map((c) => c.key)
  const plan = planHandover({
    rows: [keys, ...stored.map((r) => keys.map((k) => r.values[k] ?? ''))],
    today,
  })

  const rows = stored.map((r, i) => ({ ...r, planned: plan.rows[i] }))
  const live = rows.filter((r) => !r.excluded)
  return {
    draft: toDraft(d as unknown as Record<string, unknown>),
    rows,
    ready: live.filter((r) => !r.planned?.refused).length,
    refused: live.filter((r) => r.planned?.refused).length,
    totalCapital: live.filter((r) => !r.planned?.refused)
      .reduce((t, r) => t + (r.planned?.capital ?? 0), 0),
  }
}

export async function updateDraftRow(
  id: string, patch: { values?: Record<string, string | null>; excluded?: boolean },
): Promise<void> {
  const { error } = await supabase.from('handover_draft_rows').update({
    ...(patch.values ? { values: patch.values } : {}),
    ...(patch.excluded === undefined ? {} : { excluded: patch.excluded }),
  }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function discardDraft(id: string): Promise<void> {
  const { error } = await supabase.from('handover_drafts').update({ state: 'discarded' }).eq('id', id)
  if (error) throw new Error(error.message)
}


/**
 * Turn a draft into accounts.
 *
 * THROUGH THE SAME PATH AS THE BY-HAND FORM. toAccountRow and createDebtorAccount are what "Add
 * debtor" uses, and an import that built its own insert would eventually differ from it in one
 * field nobody thought about — in duplum stamped or not, the opening balance, the status a new
 * account starts in. One path, so there is one answer.
 *
 * REFUSED ROWS ARE LEFT BEHIND, NOT SILENTLY SKIPPED. They stay on the draft with their reasons,
 * which is the difference between a batch that imported 194 of 200 and told you which six, and
 * one that said "done".
 *
 * NOT A TRANSACTION, AND IT CANNOT BE from the browser. So the batch is created FIRST and every
 * account points at it: a run that dies half way leaves a batch holding the accounts that did
 * land, which is a thing somebody can look at, rather than orphans nobody can find.
 */
export async function approveDraft(input: {
  draftId: string
  today: string
  commissionRate: number | null
  onProgress?: (done: number, total: number) => void
}): Promise<{ handoverId: string; created: number; leftBehind: number }> {
  const judged = await fetchDraft(input.draftId, input.today)
  if (!judged) throw new Error('That draft is no longer there.')
  if (judged.draft.state !== 'draft') throw new Error('That handover has already been approved.')

  const going = judged.rows.filter((r) => !r.excluded && !r.planned?.refused)
  if (going.length === 0) throw new Error('Nothing on this handover can be imported yet.')

  const { data: me } = await supabase.auth.getUser()
  const { data: batch, error: batchError } = await supabase.from('handovers').insert({
    company_id: judged.draft.companyId,
    received_at: new Date().toISOString(),
    capital_amount: judged.totalCapital,
    accounts_count: going.length,
    reference: judged.draft.filename,
    notes: `Imported from ${judged.draft.filename}.`,
    logged_by: me.user?.id ?? null,
  }).select('id').single()
  if (batchError) throw new Error(batchError.message)
  const handoverId = batch.id as string

  let created = 0
  for (const row of going) {
    const debtor = toDebtorInput(row.values)
    await createDebtorAccount(
      toAccountRow(debtor, judged.draft.companyId, handoverId, input.commissionRate),
      (accountId) => toContactRows(debtor, accountId),
    )
    created += 1
    input.onProgress?.(created, going.length)
  }

  await supabase.from('handover_drafts').update({
    state: 'approved',
    handover_id: handoverId,
    approved_at: new Date().toISOString(),
    approved_by: me.user?.id ?? null,
  }).eq('id', input.draftId)

  return { handoverId, created, leftBehind: judged.rows.length - created }
}
