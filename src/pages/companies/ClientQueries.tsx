import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Card, CardHeader } from '../../components/ui/Card'
import { formatDate } from '../../data/mockData'
import {
  ageInDays, fetchQueriesForClient, isStale,
  QUERY_OUTCOME_LABEL, QUERY_STAGE_LABEL, type QueryStage, type QueueRow,
} from '../../lib/accountQueries'

const TODAY = new Date().toISOString().slice(0, 10)

const STAGE_CHIP: Record<QueryStage, string> = {
  agent: 'bg-slate-100 text-slate-600',
  liaison: 'bg-brand-100 text-brand-600',
  client: 'bg-gold-100 text-gold-600',
}

/**
 * This client's queries and disputes.
 *
 * Its own section rather than a line among the notes. A liaison opening Accelerate Fitness wants
 * one question answered — what is outstanding with them — and a note stream cannot answer it,
 * because a note has no state and nothing to count.
 *
 * The rows are the accounts' queries, read through the client rather than stored on it. A dispute
 * belongs to the debt it disputes; this is a second way of reading the same record, not a second
 * copy of it.
 */
export function ClientQueries({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<QueueRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetchQueriesForClient(companyId)
        if (!cancelled) setRows(r)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { cancelled = true }
  }, [companyId])

  if (error) return <Card className="border-negative-100 bg-negative-50"><p className="text-sm text-negative-700">{error}</p></Card>
  if (!rows) {
    return <Card><div className="py-6 grid place-items-center text-slate-400"><Loader2 size={18} className="animate-spin" /></div></Card>
  }

  /*
   * Only disputes that have left the agent.
   *
   * A debtor arguing with a collector is not the client's business, and a client page that listed
   * every one of them would bury the handful that actually need answering. A dispute appears here
   * the moment it is escalated to the liaison, which is the point at which somebody outside the
   * collections desk has to do something about it.
   *
   * Stage carries over when a dispute closes, so one that was resolved by the agent stays hidden
   * and one that reached the liaison stays visible — no extra column needed to remember it.
   */
  const escalated = rows.filter((q) => q.stage !== 'agent')
  const open = escalated.filter((q) => q.status === 'open')
  const closed = escalated.filter((q) => q.status === 'closed')
  const withClient = open.filter((q) => q.stage === 'client')
  const shown = showClosed ? closed : open

  return (
    <Card padded={false}>
      <div className="p-5 pb-0">
        <CardHeader
          title="Disputes on this client's book"
          subtitle={
            open.length === 0
              ? 'Nothing has been escalated to the liaison on this client.'
              : `${open.length} open${withClient.length ? `, ${withClient.length} waiting on this client` : ''}.`
          }
          action={
            closed.length > 0 ? (
              <button onClick={() => setShowClosed((v) => !v)} className="text-xs text-brand-600 hover:underline">
                {showClosed ? `Show ${open.length} open` : `Show ${closed.length} closed`}
              </button>
            ) : undefined
          }
        />
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-slate-400 py-8 text-center">
          {showClosed ? 'Nothing closed yet.' : 'Nothing escalated to the liaison on this client.'}
        </p>
      ) : (
        <div className="divide-y divide-slate-50">
          {shown.map((q) => {
            const stale = isStale(q, TODAY)
            return (
              <div key={q.id} className="px-5 py-3 flex flex-wrap items-start gap-x-4 gap-y-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-800 line-clamp-3 wrap-anywhere">{q.description}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    <Link to={`/accounts/${q.accountId}`} className="text-brand-600 hover:underline">
                      {q.debtorName}
                    </Link>
                    {q.accountNumber && <> · {q.accountNumber}</>}
                    {q.category && <> · {q.category}</>}
                    {q.raisedByName && <> · raised by {q.raisedByName}</>}
                  </p>
                  {q.outcomeAction && (
                    <p className="text-[11px] text-slate-500 mt-0.5">Outcome: {q.outcomeAction}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {q.status === 'open' ? (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${STAGE_CHIP[q.stage]}`}>
                      {QUERY_STAGE_LABEL[q.stage]}
                    </span>
                  ) : q.outcome ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                      {QUERY_OUTCOME_LABEL[q.outcome]}
                    </span>
                  ) : null}
                  <p className={`text-[11px] mt-0.5 ${stale ? 'text-negative' : 'text-slate-400'}`}>
                    {q.status === 'closed'
                      ? formatDate(q.closedAt ?? q.raisedAt)
                      : stale ? `chase — ${formatDate(q.chaseOn!)}` : `${ageInDays(q)} days old`}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
