import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Download, Loader2, Upload } from 'lucide-react'
import { Card, CardHeader } from '../../components/ui/Card'
import { useAuth } from '../../store/AuthContext'
import { formatDate } from '../../data/mockData'
import {
  ageInDays, closeQuery, fetchQuery, isStale,
  QUERY_OUTCOME_LABEL, QUERY_STAGE_LABEL,
  type QueryStage,
} from '../../lib/accountQueries'
import {
  acceptDraftRow, approveDraft, clearDraftRowDecision, discardDraft, fetchDraft,
  fetchDraftForHandover, followUpDraft, rejectDraftRow, startFollowUpDraft, updateDraftRow,
  type JudgedDraft,
} from '../../lib/handoverDraft'
import { DraftTable } from '../../components/settings/HandoverImportCard'
import { fetchClientCommissionRate } from '../../lib/accountBook'
import { HANDOVER_COLUMNS } from '../../lib/handoverSheet.ts'
import { givenFor } from '../../lib/importCorrections.ts'
import { ReplyAnswers } from '../../components/queries/ReplyAnswers'
import { fetchAccounts } from '../../lib/accountBook'
import { rejectedSheetName, rejectedSheetRows } from '../../lib/rejectedSheet.ts'
import { buildXlsx, downloadBytes, XLSX_MIME } from '../../lib/xlsxWrite.ts'

const TODAY = () => new Date().toISOString().slice(0, 10)

const STAGE_CHIP: Record<QueryStage, string> = {
  agent: 'bg-slate-100 text-slate-600',
  team_leader: 'bg-navy-700/[0.07] text-[var(--c-steel-deep)]',
  liaison: 'bg-navy-700/10 text-navy-700',
  client: 'bg-gold-100 text-[var(--c-gold-deep)]',
}

const label = (key: string) => HANDOVER_COLUMNS.find((c) => c.key === key)?.label ?? key

/**
 * One query, on its own page.
 *
 * THE FIRM: "a query should have a card, like the same as a deal, with the details of the query on
 * the inside ... if you click on that little query for this date's handover sheet, then it goes
 * in there."
 *
 * Until now a query had no page at all: the board and the client list both opened the ACCOUNT,
 * which answers a different question -- and for a query about a whole handover sheet it cannot
 * answer it, because there is no one account to open.
 *
 * THE DETAIL IS READ BACK, NOT STORED. For an import query the rows come off the frozen draft the
 * batch was imported from, re-judged by the same planner. That is deliberate: a description
 * copied onto the query at approval would be true on the day and slowly stop being true, while
 * the draft IS the record of what the client sent and what was corrected on the way in. One
 * record, read two ways.
 */
export function QueryDetail() {
  const { id } = useParams<{ id: string }>()
  const { currentUser, session } = useAuth()
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchQuery>>>(null)
  const [draft, setDraft] = useState<JudgedDraft | null>(null)
  /**
   * The client's own reference to the account it opened.
   *
   * READ OFF THE BOOK, not off the draft: the draft says what was sent, and an answer has to be
   * written to the account that actually exists. A row that opened none is absent here, which is
   * exactly what tells the screen it has nowhere to put that answer.
   */
  const [openedFor, setOpenedFor] = useState<Map<string, string>>(new Map())
  /**
   * The second go at the rows that could not be opened.
   *
   * THE FIRM: "this ticket for a handover that is in an awaiting state should show all of the
   * details like it's ready for an import, and when the details is changed it can be approved
   * and imported." A NEW draft, never the frozen original -- see startFollowUpDraft.
   */
  const [followUp, setFollowUp] = useState<JudgedDraft | null>(null)
  const [imported, setImported] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true); setError(null)
    try {
      const found = await fetchQuery(id)
      setData(found)
      /*
       * Only for a batch, and never fatal. A draft that has been tidied away leaves the query
       * readable rather than the page broken -- the query's own words still say what it is about.
       */
      if (found?.batch) {
        setDraft(await fetchDraftForHandover(found.batch.id, TODAY()).catch(() => null))
        /* The whole batch in one page: a handover is hundreds at the most, and a second page
           here would mean an answer silently having nowhere to go. */
        const opened = await fetchAccounts({ handoverId: found.batch.id, pageSize: 2000 })
          .catch(() => ({ accounts: [], total: 0 }))
        setOpenedFor(new Map(opened.accounts
          .filter((a) => a.clientReference)
          .map((a) => [a.clientReference as string, a.id])))
        /* Read, never raised: opening a ticket must not create anything. The button does that. */
        setFollowUp(await followUpDraft(found.query.id, TODAY()).catch(() => null))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  /*
   * THE SAME HANDLERS THE IMPORT SCREEN USES, against the same library functions. The table is
   * shared; wiring it to a second set of writes here is how the two screens would come to mean
   * different things by the same button.
   *
   * Every one re-reads the draft afterwards rather than patching state: the verdict on a row is
   * never stored, it is recomputed from the values, so a screen that edited its own copy would
   * show a row still refused for something already fixed.
   */
  const reload = useCallback(async (draftId: string) => {
    setFollowUp(await fetchDraft(draftId, TODAY()))
  }, [])

  async function raiseFollowUp() {
    if (!data?.batch) return
    setBusy(true); setError(null)
    try {
      setFollowUp(await startFollowUpDraft({
        queryId: data.query.id, handoverId: data.batch.id, today: TODAY(),
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  async function importFollowUp() {
    if (!followUp) return
    setBusy(true); setError(null)
    try {
      const result = await approveDraft({
        draftId: followUp.draft.id,
        today: TODAY(),
        /* THE CLIENT'S RATE, read fresh rather than off a row in memory: commission is the
           client's, and a stale copy of it is an account invoiced at the wrong rate for life. */
        commissionRate: await fetchClientCommissionRate(followUp.draft.companyId).catch(() => null),
        accessToken: session?.access_token ?? null,
      })
      setImported(`${result.created} accounts opened.`
        + (result.leftBehind ? ` ${result.leftBehind} left behind.` : '')
        + (result.correctionProblems.length ? ` ${result.correctionProblems.join(' ')}` : ''))
      setFollowUp(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  async function close(outcome: 'valid' | 'not_valid') {
    if (!data) return
    setBusy(true); setError(null)
    try {
      await closeQuery(data.query.id, { outcome }, {
        accountId: data.query.accountId,
        actorId: currentUser?.id ?? null,
        actorName: currentUser?.name ?? null,
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  if (loading) {
    return <div className="py-16 grid place-items-center text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
  }
  if (!data) {
    return <Card><p className="text-sm text-slate-500">That query is no longer there.</p></Card>
  }

  const q = data.query
  const stale = isStale(q, TODAY())
  /*
   * THE TWO GROUPS THE EMAIL USES, AND THE SAME WORDS. A client holding the email and a liaison
   * holding this page have to be able to talk to each other about the same rows, so "not brought
   * in" means the same thing in both places.
   */
  const rows = draft?.rows ?? []
  const notBroughtIn = rows.filter((r) => (r.excluded || r.planned?.refused)
    && (r.planned?.problems.length ?? 0) > 0)
  const toConfirm = rows.filter((r) => !r.excluded && !r.planned?.refused
    && (r.planned?.problems.length ?? 0) > 0)

  return (
    <div className="space-y-4">
      <Link to={data.batch ? `/companies/${data.batch.companyId}` : `/accounts/${q.accountId}`}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> {data.clientName ?? 'Back'}
      </Link>

      <Card>
        <CardHeader
          title={data.batch
            ? (data.batch.reference ?? 'One handover sheet')
            : `Query on ${data.account?.debtorName ?? 'an account'}`}
          subtitle={data.batch
            ? `Handover brought in ${formatDate(data.batch.receivedAt)}${data.clientName ? ` for ${data.clientName}` : ''}.`
            : data.account?.accountNumber ?? undefined}
          action={
            <span className={`text-[11px] px-2 py-1 rounded ${
              q.status === 'closed' ? 'bg-slate-100 text-slate-500' : STAGE_CHIP[q.stage]}`}>
              {q.status === 'closed'
                ? (q.outcome ? QUERY_OUTCOME_LABEL[q.outcome] : 'Closed')
                : QUERY_STAGE_LABEL[q.stage]}
            </span>
          }
        />

        <p className="text-sm text-slate-700 whitespace-pre-wrap wrap-anywhere mt-3">{q.description}</p>

        <dl className="grid gap-3 mt-4 sm:grid-cols-3">
          <Fact label="Raised" value={`${formatDate(q.raisedAt)}${q.raisedByName ? ` by ${q.raisedByName}` : ''}`} />
          <Fact label={q.status === 'closed' ? 'Closed' : 'Age'}
            value={q.status === 'closed' ? formatDate(q.closedAt ?? q.raisedAt) : `${ageInDays(q)} days`} />
          {/* The chase date is the only thing on this page that can be WRONG rather than merely
              old, so it is the one that gets a colour. */}
          <Fact label="Chase" tone={stale ? 'bad' : undefined}
            value={q.chaseOn ? formatDate(q.chaseOn) : 'Not set'} />
        </dl>

        {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}

        {q.status !== 'closed' && (
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-100">
            <button type="button" disabled={busy} onClick={() => void close('valid')}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-gold-400 text-navy-950 border border-gold-500 disabled:opacity-50">
              The client has answered
            </button>
            <button type="button" disabled={busy} onClick={() => void close('not_valid')}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-50">
              Close without an answer
            </button>
          </div>
        )}
      </Card>

      {data.batch && !draft && (
        <Card><p className="text-sm text-slate-400">
          The sheet this came from is no longer on file, so the rows cannot be listed.
        </p></Card>
      )}

      <RowTable
        title="Not brought in — the client must send these again"
        intro="No account was opened for these, so nothing is being done on them."
        rows={notBroughtIn}
        /*
         * THE SHEET, AGAIN, FROM HERE. THE FIRM: "it should also be in the query ticket, and once
         * the query has been resolved it can be erased."
         *
         * BUILT WHEN IT IS ASKED FOR, never stored. A copy written beside the draft would be a
         * second record of the same thing, would go stale the moment a row was corrected, and
         * would be the thing that has to be erased. Generated from the frozen draft there is
         * nothing to erase and nothing that can disagree with it -- and when the query closes the
         * page stops offering it rather than something having to go and delete a file.
         */
        download={q.status === 'closed' || !draft ? null : () => {
          downloadBytes(
            rejectedSheetName(data.batch?.reference ?? 'handover'),
            buildXlsx('To correct', rejectedSheetRows(notBroughtIn.map((r) => ({
              values: r.values, problems: r.planned?.problems ?? [],
            })))),
            XLSX_MIME,
          )
        }} />
      <RowTable
        title="Brought in, but the client must confirm"
        intro="These are open and being worked while we wait."
        rows={toConfirm} />

      {/*
        THE SECOND GO, IN THE TICKET. THE FIRM: "this ticket for a handover that is in an awaiting
        state should show all of the details like it's ready for an import, and when the details
        is changed it can be approved and imported."

        THE SAME TABLE THE IMPORT SCREEN DRAWS, against the same library functions -- drawn twice
        it would drift, and the failure would not be two tables looking different but one of them
        judging a row by rules the other had moved on from.
      */}
      {followUp && (
        <DraftTable
          judged={followUp}
          busy={busy ? 'Working' : null}
          error={error}
          backLabel="Put it away"
          onBack={() => setFollowUp(null)}
          onEdit={async (rowId, key, value) => {
            const row = followUp.rows.find((r) => r.id === rowId)
            if (!row) return
            /* Written first, then the whole draft re-read: a row's verdict comes from the
               database's copy of it, so what the screen shows is what an approval would act on. */
            await updateDraftRow(rowId, { values: { ...row.values, [key]: value.trim() || null } })
            await reload(followUp.draft.id)
          }}
          onExclude={async (rowId, excluded) => {
            await updateDraftRow(rowId, { excluded })
            await reload(followUp.draft.id)
          }}
          onDecide={async (rowId, decision, note) => {
            if (decision === 'accepted') await acceptDraftRow(rowId, note)
            else if (decision === 'rejected') await rejectDraftRow(rowId, note)
            else await clearDraftRowDecision(rowId)
            await reload(followUp.draft.id)
          }}
          onApprove={importFollowUp}
          onDiscard={async () => {
            await discardDraft(followUp.draft.id)
            setFollowUp(null)
          }} />
      )}

      {/*
        RAISED BY A BUTTON, never by opening the ticket. Creating a draft as a side effect of
        looking at a page is how somebody ends up with one they did not ask for -- and a draft
        sitting in "waiting to be approved" that nobody started is a queue nobody trusts.
      */}
      {!followUp && q.status !== 'closed' && data.batch && notBroughtIn.length > 0 && (
        <Card>
          <CardHeader
            title="Import these once the client has corrected them"
            subtitle={`${notBroughtIn.length} ${notBroughtIn.length === 1 ? 'account' : 'accounts'} `
              + 'could not be opened. Their details come across as they were sent, so they can be '
              + 'corrected here and imported without the client re-sending the whole sheet.'} />
          {imported && <p className="text-sm text-positive-700 mt-3">{imported}</p>}
          {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}
          <button type="button" disabled={busy} onClick={() => void raiseFollowUp()}
            className="mt-3 inline-flex items-center gap-2 text-sm font-medium px-4 py-2
              rounded-lg bg-gold-400 text-navy-950 border border-gold-500 disabled:opacity-40">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            Correct these and import them
          </button>
        </Card>
      )}

      {/*
        THE OTHER HALF OF THE COLUMN WE ASKED THEM TO FILL IN. Offered only while the query is
        open: once it is closed the answers are already on the accounts, and a paste box on a
        finished query invites somebody to write a month-old correction over a newer one.
      */}
      {q.status !== 'closed' && data.batch && (
        <ReplyAnswers accountFor={(ref) => (ref ? openedFor.get(ref) ?? null : null)} />
      )}
    </div>
  )
}

function Fact({ label: name, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{name}</dt>
      <dd className={`text-sm ${tone === 'bad' ? 'text-negative-700' : 'text-slate-700'}`}>{value}</dd>
    </div>
  )
}

/**
 * The rows, as the email lists them.
 *
 * ONE PROBLEM PER LINE, not one per row: a row with three things wrong is three things the client
 * has to fix, and folding them into one line is how the third gets missed.
 */
function RowTable({ title, intro, rows, download }: {
  title: string
  intro: string
  rows: JudgedDraft['rows']
  /** Offered where these rows can go back to the client as a sheet. Null on a closed query. */
  download?: (() => void) | null
}) {
  /* Nothing at all is not worth a heading. An empty table under "the client must send these
     again" reads as a list that failed to load. */
  if (rows.length === 0) return null
  return (
    <Card padded={false}>
      <div className="p-5 pb-3">
        <CardHeader title={title} subtitle={intro}
          action={download ? (
            <button type="button" onClick={download}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline">
              <Download size={13} /> Send these back to the client
            </button>
          ) : undefined} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-5 py-2 font-medium">Their reference</th>
              <th className="px-3 py-2 font-medium">Debtor</th>
              <th className="px-3 py-2 font-medium">Field</th>
              <th className="px-3 py-2 font-medium">Their sheet says</th>
              <th className="px-3 py-2 pr-5 font-medium">What we need</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((row) => (row.planned?.problems ?? []).map((p, i) => (
              <tr key={`${row.id}:${i}`} className="border-t border-slate-100 align-top">
                <td className="px-5 py-2 whitespace-nowrap text-slate-600">
                  {row.values.client_reference ?? '—'}
                </td>
                <td className="px-3 py-2 text-slate-600">{row.values.name ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600">{p.key ? label(p.key) : '—'}</td>
                <td className="px-3 py-2 text-slate-600">
                  {givenFor({ reference: null, name: null, note: null, values: row.values, problems: [] }, p.key)}
                </td>
                <td className={`px-3 py-2 pr-5 ${p.level === 'refuse' ? 'text-negative-700' : 'text-slate-600'}`}>
                  {p.level === 'refuse' && <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />}
                  {p.message}
                </td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
