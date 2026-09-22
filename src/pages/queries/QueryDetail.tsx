import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react'
import { Card, CardHeader } from '../../components/ui/Card'
import { useAuth } from '../../store/AuthContext'
import { formatDate } from '../../data/mockData'
import {
  ageInDays, closeQuery, fetchQuery, isStale,
  QUERY_OUTCOME_LABEL, QUERY_STAGE_LABEL,
  type QueryStage,
} from '../../lib/accountQueries'
import { fetchDraftForHandover, type JudgedDraft } from '../../lib/handoverDraft'
import { HANDOVER_COLUMNS } from '../../lib/handoverSheet.ts'
import { givenFor } from '../../lib/importCorrections.ts'

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
  const { currentUser } = useAuth()
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchQuery>>>(null)
  const [draft, setDraft] = useState<JudgedDraft | null>(null)
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
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

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
        rows={notBroughtIn} />
      <RowTable
        title="Brought in, but the client must confirm"
        intro="These are open and being worked while we wait."
        rows={toConfirm} />
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
function RowTable({ title, intro, rows }: {
  title: string
  intro: string
  rows: JudgedDraft['rows']
}) {
  /* Nothing at all is not worth a heading. An empty table under "the client must send these
     again" reads as a list that failed to load. */
  if (rows.length === 0) return null
  return (
    <Card padded={false}>
      <div className="p-5 pb-3">
        <CardHeader title={title} subtitle={intro} />
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
