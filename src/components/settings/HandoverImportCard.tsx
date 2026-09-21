import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, FileUp, Loader2, Paperclip, Upload, X } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { inputClass } from '../ui/Modal'
import { useAppStore } from '../../store/AppStore'
import { parseCsv } from '../../lib/csv'
import { readXlsxRows } from '../../lib/xlsx'
import { readSingleCsvFromZip } from '../../lib/zip'
import { planHandover, type HandoverPlan } from '../../lib/handoverImport.ts'
import { matchDocuments, type MatchPlan } from '../../lib/documentMatch.ts'
import { HANDOVER_COLUMNS } from '../../lib/handoverSheet.ts'
import {
  approveDraft, discardDraft, fetchDraft, fetchOpenDrafts, saveDraft, updateDraftRow,
  type HandoverDraft, type JudgedDraft,
} from '../../lib/handoverDraft'
import { fetchClientCommissionRate } from '../../lib/accountBook'
import { formatCurrency } from '../../data/mockData'

const today = () => new Date().toISOString().slice(0, 10)

/** The columns worth showing in the table. The rest are reached by opening a row. */
const SHOWN = ['client_reference', 'name', 'capital', 'default_date', 'cell_1', 'id_number']

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
export function HandoverImportCard() {
  const { companies, deals } = useAppStore()
  /* A CLIENT IS ONE WITH A CODE OR A WON DEAL, which is how CompanyDetail decides it too. A list
     of every company would offer the prospects a handover cannot come from. */
  const clients = useMemo(() => {
    const won = new Set(deals.filter((d) => d.stage === 'Won').map((d) => d.companyId))
    return companies.filter((c) => !!c.code || won.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [companies, deals])

  const [companyId, setCompanyId] = useState('')
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
      const p = planHandover({ rows, today: today() })
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
      })
      setDone(`${result.created} accounts opened.`
        + (result.leftBehind ? ` ${result.leftBehind} left on the handover.` : ''))
      setJudged(null); setDraftId(null)
      await refreshDrafts()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  /* ---------- the screen ---------- */

  if (judged) return (
    <DraftTable
      judged={judged} busy={busy} error={error}
      onEdit={edit} onExclude={exclude} onApprove={approve}
      onBack={() => { setJudged(null); setDraftId(null) }}
      onDiscard={async () => {
        await discardDraft(judged.draft.id)
        setJudged(null); setDraftId(null); await refreshDrafts()
      }} />
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
        <select className={inputClass} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          <option value="">Choose a client…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
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
          <div className="space-y-1.5">
            {openDrafts.map((d) => (
              <button key={d.id} type="button" onClick={() => void load(d.id)}
                className="w-full flex items-center gap-3 text-left px-3 py-2 rounded-lg
                  border border-slate-200 hover:border-gold-400 hover:bg-gold-50">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-slate-700 truncate">{d.filename}</span>
                  <span className="block text-[11px] text-slate-400">
                    {clients.find((c) => c.id === d.companyId)?.name ?? 'Unknown client'}
                    {' · '}{new Date(d.createdAt).toLocaleDateString('en-ZA')}
                  </span>
                </span>
                <span className="text-xs font-medium text-brand-600">Open</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
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
function DraftTable({ judged, busy, error, onEdit, onExclude, onApprove, onBack, onDiscard }: {
  judged: JudgedDraft
  busy: string | null
  error: string | null
  onEdit: (rowId: string, key: string, value: string) => Promise<void>
  onExclude: (rowId: string, excluded: boolean) => Promise<void>
  onApprove: () => Promise<void>
  onBack: () => void
  onDiscard: () => Promise<void>
}) {
  const label = (key: string) => HANDOVER_COLUMNS.find((c) => c.key === key)?.label ?? key
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
        <button type="button" onClick={() => void onApprove()} disabled={!!busy || judged.ready === 0}
          className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg
            bg-gold-400 text-navy-950 border border-gold-500 disabled:opacity-40">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {busy ?? `Approve ${judged.ready} handovers`}
        </button>
        {judged.refused > 0 && !busy && (
          <span className="text-xs text-slate-500">
            {judged.refused} would be left on this handover to fix.
          </span>
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
              {SHOWN.map((k) => <th key={k} className="py-2 pr-2 font-medium">{label(k)}</th>)}
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
                  {SHOWN.map((k) => (
                    <td key={k} className="py-1.5 pr-2">
                      {/*
                        EDITED IN PLACE, on blur rather than on every keystroke: each save re-reads
                        the whole draft to re-judge it, and doing that per character would be a
                        request a letter.
                      */}
                      <input
                        defaultValue={row.values[k] ?? ''}
                        disabled={!!busy || row.excluded}
                        onBlur={(e) => {
                          if (e.target.value.trim() === (row.values[k] ?? '')) return
                          void onEdit(row.id, k, e.target.value)
                        }}
                        className="w-full min-w-[7rem] rounded border border-transparent px-1.5 py-1
                          text-[13px] hover:border-slate-200 focus:border-brand-500 focus:outline-none" />
                    </td>
                  ))}
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
      <div className="mt-4 space-y-1.5">
        {judged.rows.filter((r) => !r.excluded && (r.planned?.problems.length ?? 0) > 0).map((row) => (
          <div key={row.id} className="flex gap-2 text-xs">
            <span className={`shrink-0 tabular-nums ${row.planned?.refused ? 'text-negative-700' : 'text-slate-400'}`}>
              Row {row.line}
            </span>
            <span className="min-w-0">
              {(row.planned?.problems ?? []).map((p, i) => (
                <span key={i} className={`block ${p.level === 'refuse' ? 'text-negative-700' : 'text-slate-500'}`}>
                  {p.level === 'refuse' && <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />}
                  {p.message}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
