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
import {
  nextReferences, toAccountRow, toContactRows, validateNewDebtor,
} from './newDebtor.ts'
import {
  noteForAccount, readiness, type Decision, type Readiness,
} from './handoverDecision.ts'
import { batchQueryDescription, correctionEmail } from './importCorrections.ts'
import { communicationsNotices } from './communicationsNotice.ts'
import { raiseQuery } from './accountQueries'
import { createDebtorAccount, fetchAccountReferences, fetchExistingAccounts } from './accountBook'
import { buildXlsx, toBase64, XLSX_MIME } from './xlsxWrite.ts'
import { rejectedSheetName, rejectedSheetRows } from './rejectedSheet.ts'

/* ONE LITERAL, not a concatenation: supabase-js types the result off this string, and split
   across a `+` every field comes back as GenericStringError. Learned on ROW_COLUMNS below. */
const DRAFT_COLUMNS = 'id, company_id, filename, sheet_kind, date_order, state, handover_id, from_query_id, approved_at, approved_by, created_by, created_at, updated_at'
/* ONE LITERAL, NOT A CONCATENATION. supabase-js types the result off this string, so split
   across a `+` every field came back as GenericStringError -- and check-select-columns.mjs is
   likewise happier reading a literal. */
const ROW_COLUMNS = 'id, draft_id, line, values, document_filename, excluded, decision, note, created_at, updated_at'

export interface HandoverDraft {
  id: string
  companyId: string
  filename: string
  sheetKind: string | null
  dateOrder: string | null
  state: 'draft' | 'approved' | 'discarded'
  handoverId: string | null
  /** The client query whose refused rows this was raised from, where it is a second go. */
  fromQueryId: string | null
  createdAt: string
}

export interface DraftRow {
  id: string
  line: number
  values: Record<string, string | null>
  documentFilename: string | null
  excluded: boolean
  /** Accepted or rejected by a person, where the row carried a problem. See handoverDecision.ts. */
  decision: Decision
  /** What to tell the collector who gets the account. */
  note: string | null
}

/** A draft and its rows, with every row judged fresh against the current rules. */
export interface JudgedDraft {
  draft: HandoverDraft
  rows: (DraftRow & { planned: PlannedRow })[]
  /** Rows that will become accounts: not excluded, and nothing refusing them. */
  ready: number
  refused: number
  totalCapital: number
  /** Whether it may be approved, and what is still waiting on a person. */
  gate: Readiness
}

const toDraft = (r: Record<string, unknown>): HandoverDraft => ({
  id: r.id as string,
  companyId: r.company_id as string,
  filename: r.filename as string,
  sheetKind: (r.sheet_kind as string | null) ?? null,
  dateOrder: (r.date_order as string | null) ?? null,
  state: r.state as HandoverDraft['state'],
  handoverId: (r.handover_id as string | null) ?? null,
  fromQueryId: (r.from_query_id as string | null) ?? null,
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
/**
 * The draft a batch was imported from, read back after the fact.
 *
 * THE RECORD OF WHAT WAS WRONG, and the reason a sheet-level query needs no copy of it. The draft
 * is frozen once approved -- it is the only record of what was corrected on the way in -- so
 * reading it back is reading the file as it was imported rather than a description of it written
 * on the day and true only then.
 */
export async function fetchDraftForHandover(
  handoverId: string,
  today: string,
): Promise<JudgedDraft | null> {
  const { data, error } = await supabase
    .from('handover_drafts').select('id').eq('handover_id', handoverId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return fetchDraft(data.id as string, today)
}

/**
 * A SECOND GO AT THE ROWS THAT COULD NOT BE OPENED.
 *
 * THE FIRM: "in the query ticket, specifically this ticket for a handover that is in an awaiting
 * state, it should show all of the details like it's ready for an import, and when the details is
 * changed it can be approved and imported."
 *
 * A NEW DRAFT, NOT THE OLD ONE REOPENED. An approved draft is frozen because it is the only
 * record of what the client sent and what was corrected on the way in -- editing a refused row
 * back into it would rewrite that record. The refused rows are COPIED into a fresh draft, which
 * then goes through exactly the path every other sheet goes through: the same planner, the same
 * gate, the same approval, its own batch, its own references.
 *
 * ONE PER QUERY, enforced by a unique index rather than by this reading first and then writing.
 * Two people opening the same ticket at once is an ordinary Tuesday, and a check-then-insert
 * would give them a draft each.
 */
export async function followUpDraft(
  queryId: string, today: string,
): Promise<JudgedDraft | null> {
  const { data, error } = await supabase
    .from('handover_drafts').select('id').eq('from_query_id', queryId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return fetchDraft(data.id as string, today)
}

/**
 * Raise that second go, from the rows the original could not open.
 *
 * Returns the existing one where there already is one, so pressing the button twice -- or two
 * people pressing it at once -- lands on the same draft rather than making another.
 */
export async function startFollowUpDraft(input: {
  queryId: string
  /** The batch the original sheet became, which is what leads back to its draft. */
  handoverId: string
  today: string
}): Promise<JudgedDraft | null> {
  const already = await followUpDraft(input.queryId, input.today)
  if (already) return already

  const original = await fetchDraftForHandover(input.handoverId, input.today)
  if (!original) throw new Error('The sheet this came from is no longer on file.')

  /* THE SAME TEST THE EMAIL AND THE TICKET USE for "not brought in", so the three cannot come to
     mean different things: thrown out or refused, and something actually wrong with it. */
  const refused = original.rows.filter((r) => (r.excluded || r.planned?.refused)
    && (r.planned?.problems.length ?? 0) > 0)
  if (refused.length === 0) return null

  const { data: me } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('handover_drafts').insert({
    company_id: original.draft.companyId,
    /* Named for the sheet it came out of, because a liaison looking at the queue a week later
       has to tell it from the original at a glance. */
    filename: `${original.draft.filename.replace(/\.[^.]+$/, '')} \u2014 corrected`,
    sheet_kind: original.draft.sheetKind,
    date_order: original.draft.dateOrder,
    from_query_id: input.queryId,
    created_by: me.user?.id ?? null,
  }).select('id').single()
  if (error) throw new Error(error.message)
  const draftId = data.id as string

  /*
   * LINE NUMBERS RENUMBERED FROM 2, not carried across. Every message about a row says "Row 7",
   * and 7 on this sheet would be 7 on a sheet nobody is looking at. Two is the first row under a
   * header, which is what the original's numbering means as well.
   */
  const rows = refused.map((r, i) => ({
    draft_id: draftId,
    line: i + 2,
    values: r.values,
    document_filename: r.documentFilename,
  }))
  for (let i = 0; i < rows.length; i += 200) {
    const { error: rowError } = await supabase
      .from('handover_draft_rows').insert(rows.slice(i, i + 200))
    if (rowError) throw new Error(rowError.message)
  }
  return fetchDraft(draftId, input.today)
}

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
    decision: ((r.decision as Decision | null) ?? null),
    note: (r.note as string | null) ?? null,
  }))

  /*
   * THE BOOK IS READ AGAIN HERE, not carried over from when the file was read.
   *
   * The verdict is recomputed on every read, so every INPUT to it has to be present on every read
   * too -- given the accounts only when the sheet was first read, the duplicate warning would
   * appear once and then quietly vanish the next time somebody opened the draft, which is the
   * same class of bug as a stored verdict and rather harder to see.
   */
  const draft = toDraft(d as unknown as Record<string, unknown>)
  const existingAccounts = await fetchExistingAccounts(draft.companyId).catch(() => [])

  /* Rebuilt as a sheet -- header row and all -- so the judging goes through exactly the path a
     file does, including the file-wide date order. Two paths to a verdict would eventually
     disagree, and the one that disagreed would be the one nobody was looking at. */
  const keys = HANDOVER_COLUMNS.map((c) => c.key)
  const plan = planHandover({
    rows: [keys, ...stored.map((r) => keys.map((k) => r.values[k] ?? ''))],
    existingAccounts,
    today,
  })

  const rows = stored.map((r, i) => ({ ...r, planned: plan.rows[i] }))
  const live = rows.filter((r) => !r.excluded)
  return {
    draft,
    rows,
    ready: live.filter((r) => !r.planned?.refused).length,
    refused: live.filter((r) => r.planned?.refused).length,
    totalCapital: live.filter((r) => !r.planned?.refused)
      .reduce((t, r) => t + (r.planned?.capital ?? 0), 0),
    gate: readiness(rows),
  }
}

/**
 * Set ONE cell on a draft row.
 *
 * NOT `updateDraftRow({ values })`, and the difference is the whole point. That writes the whole
 * `values` object, which the caller has to build by merging into its own copy of the row -- and
 * every edit re-reads and re-judges the draft, so that copy is one round trip old. Two edits to
 * one row in quick succession therefore lost the first: it saved, the warning cleared, and the
 * second write put the old value back. THE FIRM: "I changed the contact details in the handover
 * sheet ... and then the ticket went away, but now it tells me that it has not gone away."
 *
 * The merge happens in the database against the row as it stands -- see set_draft_row_value.
 *
 * THE KEY IS CHECKED AGAINST THE COLUMN LIST, not because an unknown one is dangerous -- the
 * planner reads named keys and ignores the rest -- but because it would be written, stored, and
 * silently do nothing for ever. A typo should fail where it is made.
 */
export async function setDraftRowValue(
  rowId: string, key: string, value: string,
): Promise<void> {
  if (!HANDOVER_COLUMNS.some((c) => c.key === key)) {
    throw new Error(`"${key}" is not a handover column.`)
  }
  const { error } = await supabase.rpc('set_draft_row_value', {
    p_row_id: rowId, p_key: key, p_value: value,
  })
  if (error) throw new Error(error.message)
}

/**
 * Everything about a row EXCEPT its cells.
 *
 * `values` is deliberately not settable here. A whole-object write is what lost an edit; cells go
 * through setDraftRowValue, which merges in the database.
 */
export async function updateDraftRow(
  id: string,
  patch: {
    excluded?: boolean
    decision?: Decision
    note?: string | null
  },
): Promise<void> {
  const { error } = await supabase.from('handover_draft_rows').update({
    ...(patch.excluded === undefined ? {} : { excluded: patch.excluded }),
    ...(patch.decision === undefined ? {} : { decision: patch.decision }),
    ...(patch.note === undefined ? {} : { note: patch.note }),
  }).eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Reject a row: one call, because the two things it sets must never disagree.
 *
 * `excluded` is what approveDraft honours, so a row rejected without it would be rejected on the
 * screen and imported anyway -- the worst possible split. The decision is what the gate reads and
 * what says a person has been here.
 */
export async function rejectDraftRow(id: string, note: string | null): Promise<void> {
  await updateDraftRow(id, { decision: 'rejected', excluded: true, note })
}

/** Accept a row despite its problems, with a note for whoever gets the account. */
export async function acceptDraftRow(id: string, note: string | null): Promise<void> {
  await updateDraftRow(id, { decision: 'accepted', excluded: false, note })
}

/** Put a row back to undecided, which blocks approval again. */
export async function clearDraftRowDecision(id: string): Promise<void> {
  await updateDraftRow(id, { decision: null, excluded: false })
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
/**
 * Send the corrections to the liaison, and say what went wrong rather than throwing.
 *
 * THE APPROVER'S OWN MAILBOX, which is what /api/email/send uses -- an internal note from the
 * person who ran the import to the colleague who looks after the client.
 *
 * NOT sendAccountEmail. That path charges Annexure B item 1 against the account, and this message
 * is to a colleague about a client's typing. CLAUDE.md: fees are charged on accounts only, and a
 * debtor never pays for their creditor's data.
 */
async function sendCorrectionEmail(
  accessToken: string, to: string, mail: { subject: string; bodyHtml: string },
  /**
   * The refused rows as the client's own sheet, where there were any.
   *
   * THE FIRM: "those ones that were rejected, they should be attached in the email sent to the
   * client liaison. Only the rejected ones." A client sent a list of problems has to go back to
   * their own spreadsheet and find each row again; a client sent their sheet back with only the
   * refused rows on it corrects the cells and sends it on.
   */
  attachment: { filename: string; contentType: string; content: string } | null,
): Promise<string | null> {
  try {
    const res = await fetch('/api/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        to, subject: mail.subject, bodyHtml: mail.bodyHtml,
        ...(attachment ? { attachments: [attachment] } : {}),
      }),
    })
    if (res.ok) return null
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return `The corrections could not be emailed to ${to}: ${body.error ?? res.statusText}`
  } catch (e) {
    return `The corrections could not be emailed to ${to}: ${e instanceof Error ? e.message : String(e)}`
  }
}

export async function approveDraft(input: {
  draftId: string
  today: string
  commissionRate: number | null
  onProgress?: (done: number, total: number) => void
  /**
   * The signed-in session's token, so the corrections can be emailed to the liaison through the
   * approver's own mailbox — the same /api/email/send everything else goes out on. Optional: a
   * missing token does not stop an import, it stops the email and says so.
   */
  accessToken?: string | null
}): Promise<{
  handoverId: string
  created: number
  leftBehind: number
  /** Queries raised, and anything that went wrong telling the client. */
  corrections: number
  correctionProblems: string[]
  /** References whose note did not save. Reported rather than swallowed: the note IS the record
   *  of what was overridden, so losing one silently loses the reason an account was accepted. */
  noteFailures: string[]
  /**
   * The refused rows as the client's own sheet, for the screen to hand straight to the person.
   *
   * THE FIRM: "it should also be downloaded automatically for the user." Null when nothing was
   * refused -- an empty sheet landing in somebody's Downloads is a file they have to open to
   * find out it says nothing.
   */
  refusedSheet: { filename: string; contentType: string; bytes: Uint8Array } | null
}> {
  const judged = await fetchDraft(input.draftId, input.today)
  if (!judged) throw new Error('That draft is no longer there.')
  if (judged.draft.state !== 'draft') throw new Error('That handover has already been approved.')

  /*
   * THE GATE IS CHECKED HERE TOO, not only on the button.
   *
   * The screen disables approve while a row is undecided, and a screen is not a rule: a stale tab
   * whose draft somebody else has since edited would post an approval the firm's own condition
   * says must not happen. Same function, so the two cannot come to different answers.
   */
  if (!judged.gate.ready) {
    throw new Error(judged.gate.why ?? 'This handover is not ready to approve.')
  }

  const going = judged.rows.filter((r) => !r.excluded && !r.planned?.refused)
  if (going.length === 0) throw new Error('Nothing on this handover can be imported yet.')

  const { data: me } = await supabase.auth.getUser()

  /*
   * OUR REFERENCE, GENERATED HERE, because nothing else was going to.
   *
   * THE FIRM: "it didn't generate reference numbers for Raptor. I see the client ref, but I don't
   * see the Raptor reference." `toDebtorInput` reads an `account_number` column off the sheet,
   * and a client's sheet has no reason to carry ours -- so every account on the first real import
   * opened with none. The reference is what a debtor quotes when they pay and what the duplicate
   * check compares, so 45 accounts with none reported 45 duplicates "of an account with no
   * reference" the next time the file was read.
   *
   * READ AND ASSIGNED IN ONE PASS, off the book as it stands a moment before the first insert.
   * Two people approving two handovers for one client in the same minute could still collide;
   * that is a real race and the wrong place to solve it -- the fix is a unique index on
   * (company_id, account_number), which is a migration and a decision about the 14 imported
   * clients whose references may already repeat. Left to the firm rather than assumed.
   *
   * A REFERENCE ON THE SHEET WINS. A client who does carry ours is telling us which account this
   * is, and generating over it would open a second account for a debt already on the book.
   */
  const [onBook, { data: client }] = await Promise.all([
    fetchAccountReferences(judged.draft.companyId).catch(() => []),
    supabase.from('companies').select('code').eq('id', judged.draft.companyId).maybeSingle(),
  ])
  const needing = going.filter((r) => !(r.values.account_number ?? '').trim()).length
  const generated = nextReferences(onBook, (client?.code as string | null) ?? null, needing)

  let created = 0
  let nextGenerated = 0
  /** Which account each row opened, by the client's reference, for the queries raised below. */
  const openedFor = new Map<string, string>()
  const accepted = going
  /** References whose note did not save, reported rather than swallowed. */
  const noteFailures: string[] = []
  /** References opened on a substituted date of default, for the note to Communications. */
  const substituted: string[] = []

  /*
   * ---------------------------------------------------------------- built and checked FIRST
   *
   * EVERY ROW IS TURNED INTO AN ACCOUNT AND CHECKED BEFORE ANYTHING IS WRITTEN, and the batch is
   * not created until they all pass.
   *
   * This used to insert the batch, then open the accounts one at a time, and a row the database
   * refused threw straight out of here -- leaving the batch and however many accounts had already
   * gone in, with the draft still sitting in the queue as though nothing had happened. Pressing
   * Approve again opened them all a second time. It happened to the firm twice in two minutes on
   * one sheet: two batches, five accounts each, the same five references on the book twice, and
   * the only sign of it was an error message about a date.
   *
   * A half-import is worse than a failed one in every way that matters. The failure is a sentence
   * on a screen; the half is duplicate ledgers, duplicate references, and a client invoiced twice
   * for the same debt.
   */
  const built = going.map((row) => {
    const debtor = toDebtorInput(row.values, row.planned?.defaultDate ?? null)
    /*
     * THE SUBSTITUTE DATE, WHERE THE PLANNER SET ONE. THE FIRM: "when it's accepted it will be
     * minimum 30 days before handover -- let's make it default three months before handover."
     *
     * Applied HERE rather than inside toDebtorInput, because the substitute is a fact about the
     * DAY THE HANDOVER CAME IN and toDebtorInput knows only the row. It is also why the draft's
     * own `values` are left alone: that is what the client sent, it is what they have to correct,
     * and overwriting it would erase the thing the query is about.
     *
     * handoverDate as well as the ledger's opening date -- they are one field on an account, and
     * splitting them here would open the ledger on one date and count prescription from another.
     */
    if (row.planned?.defaultDateUsed) {
      debtor.handoverDate = row.planned.defaultDateUsed
      substituted.push(row.values.client_reference ?? `row ${row.line}`)
    }
    if (!debtor.accountNumber.trim()) {
      debtor.accountNumber = generated[nextGenerated] ?? ''
      nextGenerated += 1
    }
    return { row, debtor }
  })

  /*
   * AND CHECKED BY THE SAME FUNCTION THE BY-HAND FORM USES, so the two cannot come to different
   * answers about what an account may be opened on. A row that gets here having passed the
   * planner and still fails this is a rule one of them has and the other has not -- worth saying
   * out loud rather than discovering as a database error halfway through a batch.
   */
  const unopenable = built
    .map(({ row, debtor }) => ({
      row,
      problems: validateNewDebtor(debtor, input.today).map((p) => p.message),
    }))
    .filter((x) => x.problems.length > 0)
  if (unopenable.length > 0) {
    throw new Error(
      `${unopenable.length === 1 ? 'One row cannot' : `${unopenable.length} rows cannot`} open an `
      + 'account, so nothing on this handover was imported. '
      + unopenable.slice(0, 4).map((x) => `Row ${x.row.line}: ${x.problems.join(' ')}`).join(' ')
      + (unopenable.length > 4 ? ` And ${unopenable.length - 4} more.` : ''),
    )
  }

  /*
   * NOW the batch, with every account it is about to hold known to be openable. Created before
   * the first of them on purpose: an insert that dies halfway leaves accounts that at least point
   * at something findable, which is the lesser of the two bad endings.
   */
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

  for (const { row, debtor } of built) {
    const account = await createDebtorAccount(
      toAccountRow(debtor, judged.draft.companyId, handoverId, input.commissionRate),
      (id) => toContactRows(debtor, id),
    )
    /*
     * THE NOTE, ON THE ACCOUNT. THE FIRM: "a note from admin -- the handover was accepted, but
     * the ID number is incorrect, or there are no email addresses. That's overwritten the flag
     * the account gave. Show it to them."
     *
     * Written AFTER the account rather than inside it: a note that fails is worth reporting and
     * is not worth losing an account over, and account_notes has no update or delete policy --
     * once it is there it is there, which is the point of putting it there.
     */
    const note = noteForAccount(row)
    if (account.id && note) {
      await supabase.from('account_notes').insert({
        account_id: account.id,
        body: note,
        author_name: 'Handover import',
        created_by: me.user?.id ?? null,
        source: 'import',
      }).then(({ error }) => {
        if (error) noteFailures.push(`${row.values.client_reference ?? `row ${row.line}`}: ${error.message}`)
      })
    }
    openedFor.set(row.values.client_reference ?? `#${created}`, account.id)
    created += 1
    input.onProgress?.(created, going.length)
  }

  /*
   * ---------------------------------------------------------------- the client's side of it
   *
   * THE FIRM: "if it was accepted with mistakes it should create a client query ... it'll go on
   * the client's account that there is an import correction needed, and all of the problems would
   * be listed on there, and that would be flagged at the client liaison. Also an email will be
   * created and sent to the client liaison with the problems."
   *
   * AFTER THE ACCOUNTS, AND NEVER AT THEIR EXPENSE. The accounts are the import; the queries and
   * the email are how the client is told. A query that fails to raise is worth reporting and is
   * not worth losing 194 opened accounts over, so everything below collects its failures rather
   * than throwing.
   */
  const asCorrection = (r: JudgedDraft['rows'][number]) => ({
    reference: r.values.client_reference,
    name: r.values.name,
    problems: (r.planned?.problems ?? []).map((p) => ({
      key: p.key, message: p.message, level: p.level,
    })),
    values: r.values,
    note: r.note,
  })

  /* OPENED, BUT SOMETHING ON THEM NEEDS CONFIRMING. These get a query, because there is an
     account to hang one on. */
  const corrections = accepted
    .filter((r) => (r.planned?.problems.length ?? 0) > 0)
    .map(asCorrection)

  /*
   * AND THE ONES THAT DID NOT COME IN AT ALL, which were missing from this entirely.
   *
   * THE FIRM: "there were more ones that I didn't accept that should have been on this email."
   * The email was built from the accounts that WERE opened, so a handover where eight rows were
   * rejected told the client about none of them — the accounts they most need to fix and re-send
   * were the ones we said nothing about.
   *
   * THEY GET NO QUERY, AND CANNOT: a query hangs off an account and these opened none. The email
   * is the only way the client hears about them, which is why it is no longer skipped when the
   * only thing wrong with a handover is the rows that were thrown out of it.
   */
  const notBroughtIn = judged.rows
    .filter((r) => (r.excluded || r.planned?.refused) && (r.planned?.problems.length ?? 0) > 0)
    .map(asCorrection)

  const problems: string[] = []
  /*
   * Declared out here so the screen can hand it to whoever ran the import. THE FIRM: "it should
   * also be downloaded automatically for the user."
   */
  let refusedSheet: { filename: string; contentType: string; bytes: Uint8Array } | null = null
  /* The liaison is whoever looks after the CLIENT, which is the company's account owner — the
     same person AccountDetail shows under "Client liaison". Read once: the corrections email
     needs it, and so does the notice to Communications below, which is outside that block. */
  const { data: company } = await supabase
    .from('companies').select('name, contact_person, account_owner_id')
    .eq('id', judged.draft.companyId).maybeSingle()

  if (corrections.length > 0 || notBroughtIn.length > 0) {

    /*
     * ONE QUERY FOR THE SHEET, NOT ONE PER ROW.
     *
     * THE FIRM: "let's say there's a handover sheet of 500 imports and 50 of them have problems.
     * Now there'll be 50 different individual queries. I think we should have a query per
     * handover sheet."
     *
     * It raised one per corrected account, which on a real batch is a liaison's client page
     * turned into fifty copies of the same sentence about fifty different debtors -- and fifty
     * things to chase and close separately when the client answers all of them in one reply.
     *
     * AGAINST THE BATCH, WHICH IS THE THING IT IS ABOUT. That is also what finally lets the rows
     * that were NOT opened be part of it: they have no account, so under the old shape they could
     * have no query at all and the email was the only way the client ever heard about them.
     */
    try {
      await raiseQuery({
        handoverId,
        description: batchQueryDescription({
          filename: judged.draft.filename,
          toConfirm: corrections.length,
          notBroughtIn: notBroughtIn.length,
        }),
        kind: 'import',
        /* WITH THE LIAISON, because it is the client who has to answer it and only a liaison
           may put a query in front of a client. */
        stage: 'liaison',
        ownerId: (company?.account_owner_id as string | null) ?? null,
        raisedBy: me.user?.id ?? null,
        raisedByName: 'Handover import',
        /* NEVER, and now it cannot be: a batch has no account to charge. A dispute raises
           Annexure B item 3 because the DEBTOR's objection caused the work; a client's sheet
           being wrong is not something any debtor pays for. */
        charge: false,
      })
    } catch (e) {
      problems.push(`The client query was not raised: ${e instanceof Error ? e.message : String(e)}`)
    }

    const liaisonId = (company?.account_owner_id as string | null) ?? null
    const liaisonEmail = liaisonId
      ? (await supabase.from('profiles').select('email')
        .eq('id', liaisonId).maybeSingle()).data?.email as string | undefined
      : undefined

    const mail = correctionEmail({
      clientName: (company?.name as string | null) ?? 'this client',
      /* Whom the liaison will be forwarding it to. Absent, the greeting simply says "Good day,". */
      contactName: (company?.contact_person as string | null) ?? null,
      filename: judged.draft.filename,
      today: input.today,
      broughtIn: created,
      toConfirm: corrections,
      notBroughtIn,
      labelFor: (key) => HANDOVER_COLUMNS.find((c) => c.key === key)?.label ?? key,
    })

    /*
     * THE SHEET OF REFUSED ROWS, built once and used three ways: attached to the liaison's email,
     * handed back to whoever ran the import, and offered again from the query.
     *
     * NOTHING IS STORED. The firm asked for it to be attached, downloaded, on the ticket, and
     * "once the query has been resolved it can be erased" -- and a file generated from the frozen
     * draft each time satisfies all four without a stored copy to go stale or to erase. The draft
     * IS the record of what the client sent; a file written beside it would be a second one.
     */
    refusedSheet = notBroughtIn.length > 0
      ? {
        filename: rejectedSheetName(judged.draft.filename),
        contentType: XLSX_MIME,
        bytes: buildXlsx('To correct', rejectedSheetRows(notBroughtIn)),
      }
      : null

    if (!liaisonEmail) {
      /* SAID, NOT SWALLOWED. A client with no liaison on it is a real gap, and the person who
         just ran the import is the one who can fix it. */
      problems.push('No client liaison on this client, so nobody was emailed the corrections.')
    } else if (input.accessToken) {
      const sent = await sendCorrectionEmail(input.accessToken, liaisonEmail, mail,
        refusedSheet
          ? {
            filename: refusedSheet.filename,
            contentType: refusedSheet.contentType,
            content: toBase64(refusedSheet.bytes),
          }
          : null)
      if (sent) problems.push(sent)
    } else {
      problems.push('Not signed in to a mailbox, so the corrections were not emailed.')
    }
  }

  /*
   * ---- AND COMMUNICATIONS IS TOLD, where a date of default was substituted ----
   *
   * THE FIRM: "still send a notification ... send it to the communications department."
   *
   * AFTER THE ACCOUNTS ARE OPEN, and never fatal. A notice about accounts that did not open is a
   * lie; a notifications table that refuses must not undo an import that worked. The account's
   * own note carries the same fact independently -- noteForAccount prints every problem under
   * whatever was typed, and the substitution IS one of those problems -- so a bell that fails
   * loses the prompt and not the record.
   *
   * Every member of every Communications team, because the question is about a client rather
   * than a desk and a notice to one person waits while they are on leave.
   */
  if (substituted.length > 0) {
    try {
      const { data: comms } = await supabase
        .from('profiles').select('id, teams!inner(kind)').eq('teams.kind', 'Communications')
      const notices = communicationsNotices({
        department: (comms ?? []).map((r) => r.id as string),
        references: substituted,
        clientName: (company?.name as string | null) ?? 'this client',
        handoverId,
        actorId: me.user?.id ?? null,
      })
      for (const n of notices) {
        await supabase.rpc('notify_user', {
          p_user_id: n.userId, p_type: n.type, p_message: n.message, p_link: n.link,
        })
      }
      /* SAID ON THE SCREEN WHEN NOBODY WAS TOLD. A department with no members is a real gap and
         the person who just ran the import is the one who can raise it. */
      if (notices.length === 0) {
        problems.push(`${substituted.length} account(s) opened on a substituted date of default, `
          + 'but there is nobody on a Communications team to tell.')
      }
    } catch (e) {
      problems.push('Communications was not notified about the substituted dates of default: '
        + `${e instanceof Error ? e.message : String(e)}`)
    }
  }

  await supabase.from('handover_drafts').update({
    state: 'approved',
    handover_id: handoverId,
    approved_at: new Date().toISOString(),
    approved_by: me.user?.id ?? null,
  }).eq('id', input.draftId)

  return {
    handoverId,
    created,
    leftBehind: judged.rows.length - created,
    noteFailures,
    corrections: corrections.length + notBroughtIn.length,
    correctionProblems: problems,
    refusedSheet,
  }
}

