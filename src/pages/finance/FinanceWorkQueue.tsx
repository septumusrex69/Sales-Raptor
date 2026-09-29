import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { FinanceTabs } from './FinanceTabs'
import { rand } from '../../lib/money'
import {
  NEXT_STEP_LABEL, RUN_STATUS_LABEL,
  approveRun, fetchCycle, fetchTiles, fetchWorkQueue,
  type Cycle, type CycleTiles, type RunStatus, type WorkQueueRow,
} from '../../lib/payover'

/**
 * THE PAYOVER WORK QUEUE — THE FIRST SCREEN OF THE FINANCE SECTION.
 *
 * Prompt 7 replaced the Overview that prompt 5 asked for, and the reason is in the shape: this is
 * the screen the team opens every month to find out what to do, not a set of figures to read.
 * One row per client, the amount and the next step obvious, and the allocation maths one click
 * away rather than on the page.
 *
 * ONE BUTTON PER ROW, AND ITS WORDS COME FROM THE DATABASE. The firm asked for exactly one next
 * step per client -- "Fix N exceptions", "Approve", "Email advice", "Mark paid" -- and which one
 * it is depends on a ladder that the closer, the approver and this screen all have to agree
 * about. So the ladder is in SQL and this draws what it says. Written here as well, the copy on
 * the button is the one that would go stale, and it is the one somebody presses.
 *
 * PAID RUNS DROP TO THEIR OWN TAB, on the firm's instruction. A finished payover is not work, and
 * a queue that keeps showing it is a queue people learn to scroll past.
 */

const STATUS_TONE: Record<RunStatus, string> = {
  needs_review: 'bg-amber-100 text-amber-800',
  ready: 'bg-sky-100 text-sky-800',
  approved: 'bg-slate-200 text-slate-700',
  sent: 'bg-gold-100 text-gold-800',
  paid: 'bg-emerald-100 text-emerald-700',
  void: 'bg-slate-100 text-slate-400',
}

function Pill({ status }: { status: RunStatus }) {
  return (
    <span className={clsx('inline-block rounded-full px-2.5 py-1 text-[11.5px] font-semibold whitespace-nowrap', STATUS_TONE[status])}>
      {RUN_STATUS_LABEL[status]}
    </span>
  )
}

/**
 * The four figures above the queue.
 *
 * EACH ONE OPENS THE LIST BEHIND IT, because a number nobody can get to the rows of is a number
 * people stop believing. "Unmatched payments" is honestly zero: it counts trust-account payments
 * no account matches, which arrive from a bank statement import Raptor does not have yet, and
 * every payment in the database is already keyed to an account because that is the only way one
 * can be captured. Shown rather than dropped, so the tile is there the day the import is.
 */
function Tile({ label, value, note, tone, to }: {
  label: string; value: string; note: string; tone?: 'warn'; to?: string
}) {
  const body = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">{label}</div>
      <div className={clsx('mt-1 text-[21px] font-medium tabular-nums', tone === 'warn' ? 'text-amber-700' : 'text-slate-800')}>{value}</div>
      <div className="mt-0.5 text-xs text-slate-400">{note}</div>
    </>
  )
  return to
    ? <Link to={to} className="block p-4 hover:bg-slate-50 transition-colors">{body}</Link>
    : <div className="p-4">{body}</div>
}

export function FinanceWorkQueue() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'paid' ? 'paid' : 'open'

  const [cycle, setCycle] = useState<Cycle | null>(null)
  const [tiles, setTiles] = useState<CycleTiles | null>(null)
  const [rows, setRows] = useState<WorkQueueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const c = await fetchCycle()
      setCycle(c)
      /* THE WHOLE QUEUE, NOT ONE CYCLE. The firm asked for "a run in the current or last closed
         cycle": on the 11th the new cycle has nothing in it yet and last month's is what everybody
         is working, so filtering to today's period would open the screen empty every month end. */
      const [q, t] = await Promise.all([fetchWorkQueue(null), fetchTiles(c?.periodStart ?? null)])
      setRows(q)
      setTiles(t)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the payover queue.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function onNextStep(row: WorkQueueRow) {
    /* THREE OF THE FOUR STEPS OPEN THE RUN rather than doing something here. Fixing exceptions,
       emailing the advice and recording an EFT all need something the queue does not have — which
       row, which address, which reference — and a button that half-does a job is worse than one
       that takes you to where the job is done. Approve is the exception: there is nothing to ask. */
    if (row.nextStep !== 'approve') { navigate(`/finance/runs/${row.runId}`); return }
    setBusy(row.runId)
    setError(null)
    try {
      await approveRun(row.runId)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve that run.')
    } finally {
      setBusy(null)
    }
  }

  const open = rows.filter((r) => r.status !== 'paid')
  const paid = rows.filter((r) => r.status === 'paid')
  const shown = tab === 'paid' ? paid : open

  return (
    <div className="space-y-4">
      <FinanceTabs />
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-rust-50 px-4 py-3 text-sm text-rust-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-slate-100 px-4 py-3.5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">Cycle</div>
            <div className="font-medium text-slate-800">
              {cycle ? `${fmtDay(cycle.periodStart)} – ${fmtDay(cycle.periodEnd)}` : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">Cut-off</div>
            <div className="font-medium text-slate-800">
              {cycle ? `${fmtDay(cycle.periodEnd)}, midnight · ${cycle.daysLeft} ${cycle.daysLeft === 1 ? 'day' : 'days'}` : '—'}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
            {(['needs_review', 'ready', 'approved', 'sent', 'paid'] as RunStatus[]).map((st, i) => (
              <span key={st} className="flex items-center gap-1.5">
                {i > 0 && <ArrowRight className="w-3 h-3" />}
                <Pill status={st} />
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 divide-y divide-slate-100 border-b border-slate-100 sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
          <Tile
            label="Money received"
            value={rand(tiles?.moneyReceived ?? 0)}
            note="Trust account, this cycle"
            to="/finance"
          />
          <Tile
            label="Due to clients"
            value={rand(tiles?.dueToClients ?? 0)}
            note="After commission, VAT and set-offs"
          />
          <Tile
            label="Unmatched payments"
            value={`${tiles?.unmatchedCount ?? 0} · ${rand(tiles?.unmatchedAmount ?? 0)}`}
            note="Bank import not built yet, so nothing can be unmatched"
          />
          <Tile
            label="Waiting for action"
            value={`${tiles?.waitingCount ?? 0} ${(tiles?.waitingCount ?? 0) === 1 ? 'payover' : 'payovers'}`}
            note={`${tiles?.needsReviewCount ?? 0} need review, ${tiles?.readyCount ?? 0} ready to approve`}
            tone={(tiles?.waitingCount ?? 0) > 0 ? 'warn' : undefined}
            to="/finance/exceptions"
          />
        </div>

        <div className="flex gap-1 px-4 pt-3">
          {(['open', 'paid'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setParams(t === 'open' ? {} : { tab: 'paid' }, { replace: true })}
              className={clsx(
                'rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                tab === t ? 'bg-slate-100 text-slate-800' : 'text-slate-500 hover:bg-slate-50',
              )}
            >
              {t === 'open' ? `Working (${open.length})` : `Paid (${paid.length})`}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px]">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11.5px] font-medium uppercase tracking-[0.06em] text-slate-400">
                <th className="px-4 py-2.5">Client</th>
                <th className="px-4 py-2.5 text-right">Collected by BF</th>
                <th className="px-4 py-2.5 text-right">PTC set-off</th>
                <th className="px-4 py-2.5 text-right">Amount to pay</th>
                <th className="px-4 py-2.5">Exceptions</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Next step</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  <Loader2 className="mx-auto w-5 h-5 animate-spin" />
                </td></tr>
              )}
              {!loading && shown.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                  {tab === 'paid'
                    ? 'Nothing has been paid over yet.'
                    : 'No payovers to work. The cycle closes itself at five past midnight on the 11th.'}
                </td></tr>
              )}
              {!loading && shown.map((r) => (
                <tr
                  key={r.runId}
                  onClick={() => navigate(`/finance/runs/${r.runId}`)}
                  className="cursor-pointer border-b border-slate-50 text-sm hover:bg-slate-50"
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800">{r.client}</div>
                    <div className="text-xs text-slate-400">
                      {r.invoiceNumber} · {r.payments} {r.payments === 1 ? 'payment' : 'payments'}
                      {' · '}{fmtDay(r.periodStart)}–{fmtDay(r.periodEnd)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{rand(r.trustCapital)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                    {r.ptcSetOff ? `− ${rand(r.ptcSetOff)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{rand(r.netPayover)}</td>
                  <td className="px-4 py-3">
                    {r.exceptions > 0
                      ? <span className="inline-block rounded-full bg-amber-100 px-2.5 py-1 text-[11.5px] font-semibold text-amber-800">{r.exceptions} to fix</span>
                      : <span className="text-xs text-slate-400">None</span>}
                  </td>
                  <td className="px-4 py-3"><Pill status={r.status} /></td>
                  <td className="px-4 py-3">
                    {r.nextStep && (
                      <button
                        type="button"
                        disabled={busy === r.runId}
                        onClick={(e) => { e.stopPropagation(); void onNextStep(r) }}
                        className={clsx(
                          'whitespace-nowrap rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors disabled:opacity-50',
                          r.nextStep === 'approve'
                            ? 'bg-navy-900 text-white hover:bg-navy-800'
                            : 'border border-slate-200 text-slate-700 hover:bg-slate-100',
                        )}
                      >
                        {r.nextStep === 'fix' && r.exceptions > 0
                          ? `Fix ${r.exceptions} ${r.exceptions === 1 ? 'exception' : 'exceptions'}`
                          : NEXT_STEP_LABEL[r.nextStep] ?? 'Open'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-xs text-slate-400">
          Click a row to open the run. Status only moves forward; an approved run cannot be edited,
          and a later correction goes into next month&rsquo;s run.
        </p>
      </Card>
    </div>
  )
}

/** "11 Aug 2026" — the firm writes dates the way they read them aloud. */
function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}
