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
import { nextReferences, toAccountRow, toContactRows } from './newDebtor.ts'
import {
  noteForAccount, readiness, type Decision, type Readiness,
} from './handoverDecision.ts'
import { correctionDescription, correctionEmail } from './importCorrections.ts'
import { raiseQuery } from './accountQueries'
import { createDebtorAccount, fetchAccountReferences, fetchExistingAccounts } from './accountBook'

const DRAFT_COLUMNS = 'id, company_id, filename, sheet_kind, date_order, state, handover_id, '
  + 'approved_at, approved_by, created_by, created_at, updated_at'
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

export async function updateDraftRow(
  id: string,
  patch: {
    values?: Record<string, string | null>
    excluded?: boolean
    decision?: Decision
    note?: string | null
  },
): Promise<void> {
  const { error } = await supabase.from('handover_draft_rows').update({
    ...(patch.values ? { values: patch.values } : {}),
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
): Promise<string | null> {
  try {
    const res = await fetch('/api/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ to, subject: mail.subject, bodyHtml: mail.bodyHtml }),
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
  for (const row of going) {
    const debtor = toDebtorInput(row.values)
    if (!debtor.accountNumber.trim()) {
      debtor.accountNumber = generated[nextGenerated] ?? ''
      nextGenerated += 1
    }
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
  if (corrections.length > 0 || notBroughtIn.length > 0) {
    /* The liaison is whoever looks after the CLIENT, which is the company's account owner —
       the same person AccountDetail shows under "Client liaison". */
    const { data: company } = await supabase
      .from('companies').select('name, account_owner_id')
      .eq('id', judged.draft.companyId).maybeSingle()

    for (const [i, row] of corrections.entries()) {
      const accountId = openedFor.get(row.reference ?? '')
      if (!accountId) continue
      try {
        await raiseQuery({
          accountId,
          description: correctionDescription(row),
          kind: 'import',
          /* WITH THE LIAISON, because it is the client who has to answer it and only a liaison
             may put a query in front of a client. */
          stage: 'liaison',
          ownerId: (company?.account_owner_id as string | null) ?? null,
          raisedBy: me.user?.id ?? null,
          raisedByName: 'Handover import',
          /* NEVER. A dispute raises Annexure B item 3 because the DEBTOR's objection caused the
             work. A client's sheet being wrong is not something a debtor pays for. */
          charge: false,
        })
      } catch (e) {
        problems.push(`${row.reference ?? `row ${i + 1}`}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    const liaisonId = (company?.account_owner_id as string | null) ?? null
    const liaisonEmail = liaisonId
      ? (await supabase.from('profiles').select('email')
        .eq('id', liaisonId).maybeSingle()).data?.email as string | undefined
      : undefined

    const mail = correctionEmail({
      clientName: (company?.name as string | null) ?? 'this client',
      filename: judged.draft.filename,
      today: input.today,
      broughtIn: created,
      toConfirm: corrections,
      notBroughtIn,
      labelFor: (key) => HANDOVER_COLUMNS.find((c) => c.key === key)?.label ?? key,
    })

    if (!liaisonEmail) {
      /* SAID, NOT SWALLOWED. A client with no liaison on it is a real gap, and the person who
         just ran the import is the one who can fix it. */
      problems.push('No client liaison on this client, so nobody was emailed the corrections.')
    } else if (input.accessToken) {
      const sent = await sendCorrectionEmail(input.accessToken, liaisonEmail, mail)
      if (sent) problems.push(sent)
    } else {
      problems.push('Not signed in to a mailbox, so the corrections were not emailed.')
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
  }
}
