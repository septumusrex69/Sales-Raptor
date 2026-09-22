import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, FileUp, Loader2, Paperclip, Upload, X } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { ClientPicker } from '../ui/ClientPicker'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { parseCsv } from '../../lib/csv'
import { readXlsxRows } from '../../lib/xlsx'
import { readSingleCsvFromZip } from '../../lib/zip'
import { planHandover, type HandoverPlan } from '../../lib/handoverImport.ts'
import { matchDocuments, type MatchPlan } from '../../lib/documentMatch.ts'
import { HANDOVER_COLUMNS } from '../../lib/handoverSheet.ts'
import {
  acceptDraftRow, approveDraft, clearDraftRowDecision, discardDraft, fetchDraft, fetchOpenDrafts,
  rejectDraftRow, saveDraft, updateDraftRow,
  type HandoverDraft, type JudgedDraft,
} from '../../lib/handoverDraft'
import { canAccept, type Decision } from '../../lib/handoverDecision.ts'
import { fetchClientCommissionRate, fetchExistingAccounts } from '../../lib/accountBook'
import { formatCurrency } from '../../data/mockData'

const today = () => new Date().toISOString().slice(0, 10)

/**
 * EVERY COLUMN OF THE SHEET, IN THE SHEET'S OWN ORDER.
 *
 * THE FIRM: "I can see only limited information, not all the information that was on the sheet.
 * It should show me all of the information ... if there are missing fields like an address ...
 * there should just be nothing in there. All the fields of the handover sheet should pretty much
 * be in there. And it should show which data is wrong. So you should be able to scroll it."
 *
 * Six columns were shown and the other thirty-four were unreachable, so a row warned about an
 * empty address with nowhere on the screen to type one. An empty box says "nothing here" better
 * than a sentence under the table does, and it can be filled in.
 */
const SHOWN = HANDOVER_COLUMNS.map((c) => c.key)

/** A column's heading, by its key. Module level: the table and the decision list both need it. */
const label = (key: string) => HANDOVER_COLUMNS.find((c) => c.key === key)?.label ?? key

/*
 * NOTHING IS PINNED WHILE IT SCROLLS, and that is a retreat from something that looked better on
 * paper. Holding the row number and the reference still with `position: sticky` needs each pinned
 * cell's left offset to equal the measured width of everything before it; given a fixed offset it
 * drifts, and the pinned headings render ON TOP of the scrolled ones -- "ROW :LIACCOUNT NUMBER"
 * across the top of the table, which is what the first attempt actually drew. A plain scroll is
 * legible; a broken freeze is not.
 */

/** Marked with a star in the header, the same way the .xlsx marks them. */
const required = new Set(HANDOVER_COLUMNS.filter((c) => c.required).map((c) => c.key))

/**
 * The sheet as a GRID, header row and all.
 *
 * readXlsxRows rather than readXlsx, and parseCsv turned back into rows: the planner needs the
 * header because the header is what tells it which sheet this is and which way round the dates
 * go. Handed a list of objects keyed by heading, a repeated or blank heading has already been
 * collapsed and the evidence is gone.
 */
async function readSheet(file: File): Promise<(string | null)[][]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    return readXlsxRows(await file.arrayBuffer())
  }
  const text = name.endsWith('.zip')
    ? await readSingleCsvFromZip(await file.arrayBuffer())
    : await file.text()
  const rows = parseCsv(text)
  if (rows.length === 0) return []
  const keys = Object.keys(rows[0])
  return [keys, ...rows.map((r) => keys.map((k) => r[k] ?? ''))]
}

/**
 * A handover, read and held until somebody says it is right.
 *
 * THE FIRM, on what this had to do: "it will scan each handover to see if everything is fine ...
 * if it does not, some handovers should not be accepted, and it should show why. Then you should
 * be able to edit it in the handover state on Raptor, and when it's ready say approve handover."
 *
 * SO NOTHING HERE WRITES AN ACCOUNT UNTIL APPROVE. Reading the sheet creates a DRAFT — in the
 * database, at the firm's own instruction, because a two-hundred-row handover is an afternoon of
 * corrections and an afternoon in a browser tab is an afternoon one closed laptop away from
 * nothing. It also means the person who uploaded the sheet is not the only person who can finish
 * it, which on a big batch is what actually happens.
 *
 * THE VERDICT IS RECOMPUTED, NEVER STORED. Every read puts the rows back through planHandover, so
 * a corrected cell is judged by the code that judged the file — the screen cannot go on refusing
 * a row for something already fixed.
 */
export function HandoverImportCard({ forCompanyId }: { forCompanyId?: string | null } = {}) {
  const { companies, deals } = useAppStore()
  /* The approver's own session, so the corrections email goes out on their mailbox. */
  const { session } = useAuth()
  /* A CLIENT IS ONE WITH A CODE OR A WON DEAL, which is how CompanyDetail decides it too. A list
     of every company would offer the prospects a handover cannot come from. */
  const clients = useMemo(() => {
    const won = new Set(deals.filter((d) => d.stage === 'Won').map((d) => d.companyId))
    return companies.filter((c) => !!c.code || won.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [companies, deals])

  /*
   * THE CLIENT CAN ARRIVE WITH THE PERSON, from "Upload a batch" on that client's own page.
   *
   * Seeded in an effect rather than in useState, because `clients` comes out of AppStore and is
   * EMPTY on the first render while the tables load. Seeded from the initial value, the id would
   * be thrown away as unknown a moment before the client it names turns up.
   *
   * AND ONLY IF IT IS A CLIENT WE WOULD OFFER. A <select> whose value matches no <option> draws
   * blank while the state says otherwise -- the screen would show "Choose a client…" and the
   * Hold button would be enabled, which is the worst of both.
   */
  const [companyId, setCompanyId] = useState('')
  const [seeded, setSeeded] = useState(false)
  useEffect(() => {
    if (seeded || !forCompanyId || clients.length === 0) return
    if (clients.some((c) => c.id === forCompanyId)) setCompanyId(forCompanyId)
    setSeeded(true)
  }, [forCompanyId, clients, seeded])
  const [sheet, setSheet] = useState<File>()
  const [pdfs, setPdfs] = useState<File[]>([])
  const [plan, setPlan] = useState<HandoverPlan | null>(null)
  const [docs, setDocs] = useState<MatchPlan | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openDrafts, setOpenDrafts] = useState<HandoverDraft[]>([])
  const [draftId, setDraftId] = useState<string | null>(null)
  const [judged, setJudged] = useState<JudgedDraft | null>(null)
  const [done, setDone] = useState<string | null>(null)
  /** The queued draft whose Discard has been pressed once. */
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null)

  const refreshDrafts = useCallback(async () => {
    setOpenDrafts(await fetchOpenDrafts().catch(() => []))
  }, [])
  useEffect(() => { void refreshDrafts() }, [refreshDrafts])

  const load = useCallback(async (id: string) => {
    setBusy('Reading the handover')
    try {
      setJudged(await fetchDraft(id, today()))
      setDraftId(id)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }, [])

  /* ---------- reading the file ---------- */

  async function read() {
    if (!sheet) return
    setBusy('Reading the sheet'); setError(null); setDone(null)
    try {
      const rows = await readSheet(sheet)
      /*
        THE CLIENT'S BOOK, so "the same data has already been handed over" can be said before the
        sheet is held rather than after. Only where a client has been chosen -- the sheet can be
        read without one, and a book comparison with no client is a comparison against nothing.
        A failure to read it is not a failure to read the sheet: the duplicates within the file
        are still worth having.
      */
      const existingAccounts = companyId
        ? await fetchExistingAccounts(companyId).catch(() => [])
        : []
      const p = planHandover({ rows, existingAccounts, today: today() })
      setPlan(p)
      setDocs(pdfs.length
        ? matchDocuments({
          filenames: pdfs.map((f) => f.name),
          references: p.rows.map((r) => r.values.client_reference ?? '').filter(Boolean),
        })
        : null)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  /*
   * NO MANDATE, NO HANDOVER, at the firm's instruction: "a client needs a mandate before a
   * handover can be imported."
   *
   * A REFUSAL AND NOT A WARNING, because the consequence is not untidy data. Collecting on a book
   * the firm holds no signed mandate for is work it cannot lawfully charge for and cannot defend
   * if the debtor's attorney asks on whose authority the demand was issued -- and by then two
   * hundred accounts are open and letters have gone out.
   *
   * IT IS REFUSED HERE AND NOT ON THE FORM THAT CREATES THE CLIENT. A client is often loaded
   * while the mandate is still in the post, and a form that will not save without a date is a
   * form people fill in with a made-up one. The refusal belongs where the consequence is.
   */
  const client = clients.find((c) => c.id === companyId)
  const noMandate = !!client && !client.mandateSignedAt

  async function hold() {
    if (!plan || !sheet || !companyId || noMandate) return
    setBusy('Holding it in Raptor'); setError(null)
    try {
      const documentFor = new Map((docs?.matched ?? []).map((m) => [m.reference, m.filename]))
      const id = await saveDraft({ companyId, filename: sheet.name, plan, documentFor })
      setPlan(null); setDocs(null); setSheet(undefined); setPdfs([])
      await refreshDrafts()
      await load(id)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  /* ---------- working the draft ---------- */

  async function edit(rowId: string, key: string, value: string) {
    const row = judged?.rows.find((r) => r.id === rowId)
    if (!row) return
    const values = { ...row.values, [key]: value.trim() || null }
    /* Written first, then the whole draft re-read: the verdict comes from the database's copy of
       the row, so what the screen shows is what an approval would act on. */
    await updateDraftRow(rowId, { values })
    if (draftId) await load(draftId)
  }

  async function exclude(rowId: string, excluded: boolean) {
    await updateDraftRow(rowId, { excluded })
    if (draftId) await load(draftId)
  }

  /*
   * ACCEPT, REJECT, OR PUT IT BACK. One call each, in handoverDraft.ts, because rejecting has to
   * set BOTH the decision and `excluded` -- the decision is what the gate reads and `excluded` is
   * what the approval honours, and a row rejected in one but not the other would be rejected on
   * the screen and imported anyway.
   */
  async function decide(rowId: string, decision: Decision, note: string | null) {
    if (decision === 'accepted') await acceptDraftRow(rowId, note)
    else if (decision === 'rejected') await rejectDraftRow(rowId, note)
    else await clearDraftRowDecision(rowId)
    if (draftId) await load(draftId)
  }

  async function approve() {
    if (!judged) return
    setBusy('Opening the accounts'); setError(null)
    try {
      const result = await approveDraft({
        draftId: judged.draft.id,
        today: today(),
        /* THE CLIENT'S RATE, INHERITED RATHER THAN TYPED, and read fresh rather than off a
           company row in the store -- commission is the client's and a stale copy of it is an
           account invoiced at the wrong rate for the rest of its life. */
        commissionRate: await fetchClientCommissionRate(judged.draft.companyId).catch(() => null),
        onProgress: (n, total) => setBusy(`Opening the accounts — ${n} of ${total}`),
        /* So the corrections can be emailed to the liaison through this person's own mailbox.
           Missing, the import still runs and says the email did not go. */
        accessToken: session?.access_token ?? null,
      })
      setDone(`${result.created} accounts opened.`
        + (result.leftBehind ? ` ${result.leftBehind} left on the handover.` : '')
        /* A note that did not save is worth saying: the note IS the record of what was overridden
           and why, so losing one silently loses the reason an account was accepted. */
        + (result.corrections
          ? ` ${result.corrections} sent to the client liaison to correct.`
          : '')
        + (result.noteFailures.length
          ? ` ${result.noteFailures.length} note(s) could not be saved: ${result.noteFailures.join('; ')}`
          : '')
        /* A query that did not raise, or an email that did not go, is the client never hearing
           about it — so it is said on the screen rather than logged and lost. */
        + (result.correctionProblems.length ? ` ${result.correctionProblems.join(' ')}` : ''))
      setJudged(null); setDraftId(null)
      await refreshDrafts()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  /* ---------- the screen ---------- */

  /* One discard for both the open table and the queue below it, so the two cannot come to mean
     different things -- and so the list is refreshed either way. */
  async function discard(id: string) {
    setBusy('Discarding'); setError(null)
    try {
      await discardDraft(id)
      if (draftId === id) { setJudged(null); setDraftId(null) }
      await refreshDrafts()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  if (judged) return (
    <DraftTable
      judged={judged} busy={busy} error={error}
      onEdit={edit} onExclude={exclude} onApprove={approve} onDecide={decide}
      onBack={() => { setJudged(null); setDraftId(null) }}
      onDiscard={() => discard(judged.draft.id)} />
  )

  return (
    <Card>
      <CardHeader
        title="Import a handover"
        subtitle="The client's sheet and their PDFs. Nothing is written until you approve it." />

      {/*
        THE CLIENT IS PICKED, NOT READ. A handover sheet says what each debtor owes and never
        whose book it is -- "Client Division" on the old sheet was a person's name in the client's
        office. This is the control the firm asked for: "you can choose which client does the
        handover batch fall on."
      */}
      <label className="block mb-4">
        <span className="block text-xs font-medium text-slate-500 mb-1">Whose handover is this</span>
        <ClientPicker clients={clients} value={companyId} onChange={setCompanyId}
          placeholder="Search for a client by name or code…" />
      </label>

      <div className="space-y-3">
        <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-brand-300 cursor-pointer">
          <input type="file" accept=".csv,.zip,.xlsx,.xlsm" className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { setSheet(f); setPlan(null) } }} />
          <span className={`shrink-0 w-8 h-8 rounded-lg grid place-items-center ${sheet ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
            {sheet ? <CheckCircle2 size={16} /> : <FileUp size={16} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-slate-700">The handover sheet</span>
            <span className="block text-xs text-slate-400 truncate">
              {sheet ? sheet.name : 'Ours or the older one — whichever the client sent.'}
            </span>
          </span>
          <span className="text-xs font-medium text-brand-600 shrink-0">{sheet ? 'Change' : 'Choose'}</span>
        </label>

        {/* MANY AT ONCE, matched by their filenames. The firm: "uploading 200 handovers one by one
            is a tedious task." */}
        <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-brand-300 cursor-pointer">
          <input type="file" accept=".pdf" multiple className="sr-only"
            onChange={(e) => { setPdfs([...(e.target.files ?? [])]); setPlan(null) }} />
          <span className={`shrink-0 w-8 h-8 rounded-lg grid place-items-center ${pdfs.length ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
            <Paperclip size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-slate-700">Their PDFs, if there are any</span>
            <span className="block text-xs text-slate-400 truncate">
              {pdfs.length ? `${pdfs.length} files` : 'Select them all at once — each is matched by its filename.'}
            </span>
          </span>
          <span className="text-xs font-medium text-brand-600 shrink-0">{pdfs.length ? 'Change' : 'Choose'}</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-4">
        <button type="button" onClick={() => void read()} disabled={!sheet || !!busy}
          className="btn-primary inline-flex items-center gap-2">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
          {busy ?? 'Read the sheet'}
        </button>
        {plan && (
          <button type="button" onClick={() => void hold()} disabled={!companyId || !!busy || noMandate}
            title={companyId ? undefined : 'Choose which client this handover is from first'}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg
              bg-gold-400 text-navy-950 border border-gold-500 disabled:opacity-40">
            <Check size={15} /> Hold it in Raptor
          </button>
        )}
      </div>

      {/* Said the moment the client is chosen, not after the sheet has been read: somebody who
          has to go and find a mandate should not first spend ten minutes on the file. */}
      {noMandate && (
        <p className="text-sm text-negative-700 mt-3">
          {client?.name} has no signed mandate on record, so no handover can be imported for them.
          Add the date it was signed on the client first.
        </p>
      )}

      {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}
      {done && <p className="text-sm text-positive-700 mt-3">{done}</p>}

      {plan && <PlanSummary plan={plan} docs={docs} />}

      {openDrafts.length > 0 && (
        <div className="mt-5 pt-4 border-t border-slate-100">
          <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">
            Waiting to be approved
          </p>
          {/*
            A DIV HOLDING TWO BUTTONS, NOT ONE BUTTON HOLDING ANOTHER. This was a single <button>
            wrapping the whole row; a discard inside it would be a button inside a button, which
            no browser nests and which opens the draft on the way to throwing it away.
          */}
          <div className="space-y-1.5">
            {openDrafts.map((d) => (
              <div key={d.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-200">
                <button type="button" onClick={() => void load(d.id)}
                  className="flex-1 min-w-0 text-left">
                  <span className="block text-sm text-slate-700 truncate">{d.filename}</span>
                  <span className="block text-[11px] text-slate-400">
                    {clients.find((c) => c.id === d.companyId)?.name ?? 'Unknown client'}
                    {' · '}{new Date(d.createdAt).toLocaleDateString('en-ZA')}
                  </span>
                </button>
                <button type="button" onClick={() => void load(d.id)}
                  className="text-xs font-medium text-brand-600 hover:underline">Open</button>
                {/*
                  THE FIRM: "there's another sheet that was now queued for handover that I didn't
                  import and complete. I should be able to delete that." Nothing on this list
                  could be got rid of without opening it first.

                  ASKED TWICE, IN PLACE. A window.confirm on an iPad is a system dialog over the
                  app; the second press of the same button is the same gesture and stays on the
                  screen somebody is looking at. Nothing is destroyed either way -- discarding
                  marks the draft and leaves its rows, so a sheet thrown away by accident is a
                  question for somebody with database access rather than a lost afternoon.
                */}
                <button type="button" disabled={!!busy}
                  onClick={() => {
                    if (confirmDiscard !== d.id) { setConfirmDiscard(d.id); return }
                    setConfirmDiscard(null)
                    void discard(d.id)
                  }}
                  onBlur={() => setConfirmDiscard((c) => (c === d.id ? null : c))}
                  className={`text-xs font-medium ${confirmDiscard === d.id
                    ? 'text-negative-700 underline' : 'text-slate-400 hover:text-negative-600'}`}>
                  {confirmDiscard === d.id ? 'Sure?' : 'Discard'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}


/**
 * One row's problems, and the decision they are waiting on.
 *
 * THE FIRM: "you could say accept it, or reject it. You can also put in a note, for example to
 * the person working the account: the ID number is wrong, so the ID number needs to be
 * confirmed. So that goes on the notes or the main comment."
 *
 * THE NOTE IS TYPED BEFORE THE DECISION, not after it, because that is the order somebody thinks
 * in: they read what is wrong, write down what to do about it, and then say whether the account
 * goes in. Asked for afterwards it would be a second dialog on a decision already made, and it
 * would be skipped.
 *
 * ACCEPT IS NOT OFFERED ON A REFUSED ROW. There is nothing to accept -- no capital, or no date of
 * default, or no name to address a letter from. It is corrected in the table above or it is
 * rejected, and an Accept button on it would be offering to open a ledger that cannot be right.
 */
function DecisionRow({ row, busy, onAccept, onReject, onReopen }: {
  row: JudgedDraft['rows'][number]
  busy: string | null
  onAccept: (note: string | null) => Promise<void>
  onReject: (note: string | null) => Promise<void>
  onReopen: () => Promise<void>
}) {
  const [note, setNote] = useState(row.note ?? '')
  const decided = row.decision !== null
  const problems = row.planned?.problems ?? []
  const refused = row.planned?.refused === true

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${
      row.decision === 'rejected' ? 'border-slate-200 bg-slate-50'
        : row.decision === 'accepted' ? 'border-gold-300 bg-gold-50/40'
          : refused ? 'border-negative-300' : 'border-slate-200'}`}>
      <div className="flex items-baseline gap-2 mb-1">
        <span className={`text-xs font-medium tabular-nums shrink-0 ${
          refused ? 'text-negative-700' : 'text-slate-500'}`}>
          Row {row.line}
        </span>
        <span className="text-xs text-slate-400 truncate">
          {row.values.client_reference ?? 'no reference'}
          {row.values.name ? ` \u00b7 ${row.values.name}` : ''}
        </span>
        {decided && (
          <span className="ml-auto text-[11px] font-medium text-slate-500">
            {row.decision === 'accepted' ? 'Accepted' : 'Rejected'}
          </span>
        )}
      </div>

      <div className="space-y-0.5 mb-2">
        {problems.map((p, i) => (
          <p key={i} className={`text-xs ${p.level === 'refuse' ? 'text-negative-700' : 'text-slate-500'}`}>
            {p.level === 'refuse' && <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />}
            {/* The column, so a sentence can be traced to one of forty boxes without reading it
                twice. The cell is marked in the table as well; this is for somebody working down
                the list rather than across the row. */}
            {p.key && <span className="text-slate-400">{label(p.key)}: </span>}
            {p.message}
          </p>
        ))}
      </div>

      {decided ? (
        <div className="flex items-baseline gap-3">
          {row.note && <p className="text-xs text-slate-600 min-w-0 flex-1">{row.note}</p>}
          {/* THE WAY BACK. A decision recorded with no way to undo it is a typo nobody can fix,
              and putting the row back to undecided holds the approval again, which is correct. */}
          <button type="button" disabled={!!busy} onClick={() => void onReopen()}
            className="ml-auto text-[11px] font-medium text-slate-400 hover:text-slate-600 shrink-0">
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            value={note}
            disabled={!!busy}
            onChange={(e) => setNote(e.target.value)}
            placeholder="A note for whoever works this account \u2014 optional"
            className="w-full rounded border border-slate-200 px-2 py-1.5 text-[13px] mb-2
              focus:border-brand-500 focus:outline-none" />
          <div className="flex items-center gap-2">
            {canAccept(row) && (
              <button type="button" disabled={!!busy}
                onClick={() => void onAccept(note.trim() || null)}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5
                  rounded-lg bg-gold-400 text-navy-950 border border-gold-500">
                <Check size={13} /> Accept
              </button>
            )}
            <button type="button" disabled={!!busy}
              onClick={() => void onReject(note.trim() || null)}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5
                rounded-lg border border-slate-200 text-slate-600 hover:border-negative-300
                hover:text-negative-700">
              <X size={13} /> Reject
            </button>
            {refused && (
              <span className="text-[11px] text-slate-400">
                Correct it above, or reject it \u2014 it cannot be accepted as it stands.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** What the file turned out to be, before it is held. */
function PlanSummary({ plan, docs }: { plan: HandoverPlan; docs: MatchPlan | null }) {
  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-slate-600">{plan.note}</p>
      {plan.missingRequired.length > 0 && (
        <p className="text-sm text-negative-700">
          This sheet has no {plan.missingRequired.join(', ')}. Nothing can be imported from it.
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Handovers', value: plan.rows.length, note: 'rows with something in them' },
          { label: 'Ready', value: plan.ready.length, note: 'nothing wrong with them' },
          { label: 'Not accepted', value: plan.refused.length, note: 'reasons on each row' },
          { label: 'Capital', value: formatCurrency(plan.totalCapital), note: 'on the ready ones' },
        ].map((c) => (
          <div key={c.label} className="rounded-lg bg-slate-50 px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{c.label}</p>
            <p className="text-lg font-semibold text-slate-800 tabular-nums">
              {typeof c.value === 'number' ? c.value.toLocaleString('en-ZA') : c.value}
            </p>
            <p className="text-[11px] text-slate-500">{c.note}</p>
          </div>
        ))}
      </div>
      {/*
        A HEADING NOBODY RECOGNISED IS NAMED, never mapped by position. The cost of a wrong guess
        is a telephone number in the ID field, which is what the old sheet did on its own.
      */}
      {plan.unrecognised.length > 0 && (
        <p className="text-xs text-slate-500">
          Not recognised, so not imported: {plan.unrecognised.join(', ')}.
        </p>
      )}
      {docs && (
        <p className="text-xs text-slate-500">
          {docs.matched.length} PDFs matched to a handover
          {docs.unmatched.length > 0 && ` · ${docs.unmatched.length} could not be placed`}
          {docs.ambiguous.length > 0 && ` · ${docs.ambiguous.length} could belong to more than one`}
        </p>
      )}
    </div>
  )
}

/** The draft itself: every row, what is wrong with it, and the boxes to fix it in. */
function DraftTable({
  judged, busy, error, onEdit, onExclude, onApprove, onBack, onDiscard, onDecide,
}: {
  judged: JudgedDraft
  busy: string | null
  error: string | null
  onEdit: (rowId: string, key: string, value: string) => Promise<void>
  onExclude: (rowId: string, excluded: boolean) => Promise<void>
  onApprove: () => Promise<void>
  onDecide: (rowId: string, decision: Decision, note: string | null) => Promise<void>
  onBack: () => void
  onDiscard: () => Promise<void>
}) {
  return (
    <Card>
      <CardHeader
        title={judged.draft.filename}
        subtitle={`${judged.ready} ready · ${judged.refused} not accepted · `
          + `${formatCurrency(judged.totalCapital)} capital`}
        action={
          <button type="button" onClick={onBack}
            className="text-xs font-medium text-slate-500 hover:text-slate-700">Back</button>
        } />

      {/*
        APPROVE IS OFFERED WHILE ROWS ARE STILL REFUSED, and says how many it would leave behind.
        Refusing to let a batch in until every row is perfect is how a client waits a week for 194
        good accounts because six have no date of default. The refused rows stay on the draft with
        their reasons.
      */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/*
          HELD UNTIL EVERY PROBLEM HAS AN ANSWER, at the firm's instruction. It used to import
          whatever was importable and leave the rest behind, which made a warning advice somebody
          could scroll past -- and forty-five identical warnings under a table is advice everybody
          scrolls past.

          The COUNT comes off the gate rather than off `ready`, because the two have to agree: a
          button reading "Approve 44 handovers" on a draft that cannot be approved is the screen
          disagreeing with itself.
        */}
        <button type="button" onClick={() => void onApprove()}
          disabled={!!busy || !judged.gate.ready}
          title={judged.gate.why ?? undefined}
          className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg
            bg-gold-400 text-navy-950 border border-gold-500 disabled:opacity-40">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {busy ?? `Approve ${judged.gate.importing} `
            + `${judged.gate.importing === 1 ? 'handover' : 'handovers'}`}
        </button>
        {judged.gate.why && !busy && (
          <span className="text-xs text-negative-700">{judged.gate.why}</span>
        )}
        <button type="button" onClick={() => void onDiscard()} disabled={!!busy}
          className="ml-auto text-xs font-medium text-negative-700 hover:underline">
          Discard this handover
        </button>
      </div>

      {error && <p className="text-sm text-negative-700 mb-3">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="py-2 pr-2 font-medium">Row</th>
              {SHOWN.map((k) => (
                <th key={k} className="py-2 pr-2 font-medium whitespace-nowrap">
                  {label(k)}{required.has(k) && <span className="text-gold-600"> *</span>}
                </th>
              ))}
              <th className="py-2 pr-2 font-medium">PDF</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {judged.rows.map((row) => {
              return (
                <tr key={row.id}
                  className={`border-t border-slate-100 align-top ${row.excluded ? 'opacity-40' : ''}`}>
                  <td className="py-2 pr-2 text-slate-400 tabular-nums">{row.line}</td>
                  {SHOWN.map((k) => {
                    /*
                      THE CELL SAYS WHICH DATA IS WRONG, at the firm's asking. A problem carries
                      the column it is about, so the box itself is marked -- a refusal in red, a
                      warning in gold -- and the sentence under the table stops being the only
                      way to find out which of forty boxes it meant.
                    */
                    const worst = (row.planned?.problems ?? []).filter((pr) => pr.key === k)
                    const bad = worst.some((pr) => pr.level === 'refuse')
                    const iffy = !bad && worst.length > 0
                    return (
                      <td key={k} className="py-1.5 pr-2">
                        {/*
                          EDITED IN PLACE, on blur rather than on every keystroke: each save
                          re-reads the whole draft to re-judge it, and doing that per character
                          would be a request a letter.
                        */}
                        <input
                          defaultValue={row.values[k] ?? ''}
                          disabled={!!busy || row.excluded}
                          title={worst.map((pr) => pr.message).join(' ') || undefined}
                          onBlur={(e) => {
                            if (e.target.value.trim() === (row.values[k] ?? '')) return
                            void onEdit(row.id, k, e.target.value)
                          }}
                          className={`w-full min-w-[7rem] rounded border px-1.5 py-1 text-[13px]
                            focus:border-brand-500 focus:outline-none ${
                            bad ? 'border-negative-400 bg-negative-50'
                              : iffy ? 'border-gold-400 bg-gold-50'
                                : 'border-transparent hover:border-slate-200'}`} />
                      </td>
                    )
                  })}
                  <td className="py-2 pr-2 text-[11px] text-slate-400 truncate max-w-[9rem]">
                    {row.documentFilename ?? '—'}
                  </td>
                  <td className="py-2">
                    <button type="button" disabled={!!busy}
                      onClick={() => void onExclude(row.id, !row.excluded)}
                      title={row.excluded ? 'Put it back' : 'Leave this one out'}
                      className="text-slate-300 hover:text-negative-600">
                      <X size={14} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/*
        THE REASONS, UNDER THE TABLE RATHER THAN IN IT. A cell wide enough to hold "Date of default
        could be two different days" is a table nobody can read across; the row number ties them.
      */}
      {/*
        EACH ONE IS A DECISION, NOT A SENTENCE TO SCROLL PAST. THE FIRM: "currently you need to go
        down and read that, but then you have to go back up and remove the account if there is a
        problem ... it should be in a pending state, and the approving cannot happen if all of the
        bottom things have not been sorted out."

        So every row carrying a problem gets Accept or Reject here, where the reasons are, rather
        than sending somebody back up a forty-column table to find the × on the right line.
      */}
      <div className="mt-4 space-y-3">
        {judged.rows.filter((r) => (r.planned?.problems.length ?? 0) > 0).map((row) => (
          <DecisionRow key={row.id} row={row} busy={busy}
            onAccept={(note) => onDecide(row.id, 'accepted', note)}
            onReject={(note) => onDecide(row.id, 'rejected', note)}
            onReopen={() => onDecide(row.id, null, null)} />
        ))}
      </div>
    </Card>
  )
}
