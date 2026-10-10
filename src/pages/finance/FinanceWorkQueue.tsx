import { Fragment, useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { rand } from '../../lib/money'
import {
  NEXT_STEP_LABEL, RUN_STATUS_LABEL,
  approveRun, buildRun, fetchBuildable, fetchCycle, fetchTiles, fetchWorkQueue,
  isStagingDeployment, refreshRuns, resetRun,
  type Buildable, type Cycle, type CycleTiles, type RunStatus, type WorkQueueRow,
} from '../../lib/payover'
import { Modal } from '../../components/ui/Modal'
import { groupRunsByCycle, periodLabel } from '../../lib/payoverGroups'
import { supabase } from '../../lib/supabase'
import { sendAdviceForRuns } from '../../lib/remittanceEmail'
import { rand as randAmount } from '../../lib/money'

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
 * THE RUNS BUILD THEMSELVES (the firm, 8 Oct: "I don't even have to say go and build a run ...
 * it's basically automatically already built. And updated when necessary"). Opening the queue
 * calls refresh_payover_runs, which builds or rebuilds every client's run for this cycle and the
 * last; there is no Build button (staging keeps one, for testing other cycles).
 *
 * AND THEY ARE WORKED IN BULK: tick several, then Approve or Email advice. Each still goes through
 * the same function a single one does, and a row still opens the run to read before approving.
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
    <span className={clsx('inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', STATUS_TONE[status])}>
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
  /* THREE TABS, AS THE FIRM DREW THEM (10 Oct): RUNNING (still collecting), CLOSED (cut-off passed,
     waiting for its payover day -- an overdue one is here too, in red), PAID (the history). */
  const tabParam = params.get('tab')
  const tab: 'running' | 'closed' | 'paid' = tabParam === 'paid' ? 'paid' : tabParam === 'running' ? 'running' : 'closed'

  const [cycle, setCycle] = useState<Cycle | null>(null)
  const [tiles, setTiles] = useState<CycleTiles | null>(null)
  const [rows, setRows] = useState<WorkQueueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  /* THE BOX THAT BUILDS ONE. Until this existed the first run for a client could not be made at
     all, so this screen opened empty for ever and the remittance advice was unreachable. */
  const [building, setBuilding] = useState(false)
  /* Only to decide whether to DRAW the reset; every test control refuses on its own. */
  const [staging, setStaging] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [note, setNote] = useState<string | null>(null)
  /* How long after a cycle closes it is paid (Trust settings); one month unless the firm changed it. */
  const [lag, setLag] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      /* BUILT AND BROUGHT UP TO DATE FIRST, so what is listed is what the payments now say. A
         refresh that fails still shows the runs as they stand, with the reason. */
      await refreshRuns().catch((e: unknown) => setError(e instanceof Error ? e.message : 'The runs could not be brought up to date.'))
      const c = await fetchCycle()
      setCycle(c)
      /* THE WHOLE QUEUE, NOT ONE CYCLE. The firm asked for "a run in the current or last closed
         cycle": on the 11th the new cycle has nothing in it yet and last month's is what everybody
         is working, so filtering to today's period would open the screen empty every month end. */
      const [q, t, f] = await Promise.all([fetchWorkQueue(null), fetchTiles(c?.periodStart ?? null),
        supabase.from('firm_settings').select('payover_lag_months').limit(1).maybeSingle()])
      setLag(Number((f.data as { payover_lag_months?: number } | null)?.payover_lag_months ?? 1))
      setRows(q)
      setPicked((p) => new Set([...p].filter((id) => q.some((r) => r.runId === id))))
      setTiles(t)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the payover queue.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void isStagingDeployment().then(setStaging) }, [])

  async function onNextStep(row: WorkQueueRow) {
    /* THREE OF THE FOUR STEPS OPEN THE RUN rather than doing something here. Fixing exceptions,
       emailing the advice and recording an EFT all need something the queue does not have — which
       row, which address, which reference — and a button that half-does a job is worse than one
       that takes you to where the job is done. Approve is the exception: there is nothing to ask. */
    if (row.nextStep !== 'approve') { navigate(`/trust/runs/${row.runId}`); return }
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

  /* A RUN WHOSE CYCLE IS STILL OPEN IS APPROVED ONLY WITH A REASON, from the run itself (the firm,
     8 Oct). So a bulk approval leaves it out, and its row says where to do it. */
  const stillOpen = (r: WorkQueueRow) => !!cycle && r.periodEnd >= cycle.today

  async function bulkApprove(ids: string[]) {
    setBusy('bulk'); setError(null); setNote(null)
    const failed: string[] = []
    for (const id of ids) {
      try { await approveRun(id) } catch (e) {
        const r = rows.find((x) => x.runId === id)
        failed.push(`${r?.client ?? 'A run'}: ${e instanceof Error ? e.message : 'could not be approved'}`)
      }
    }
    setNote(`${ids.length - failed.length} approved${failed.length ? `; ${failed.length} not: ${failed.join('; ')}` : ''}.`)
    setPicked(new Set())
    await load()
    setBusy(null)
  }

  async function bulkEmail(ids: string[]) {
    setBusy('bulk'); setError(null); setNote(null)
    const out = await sendAdviceForRuns(ids)
    setNote(`Advice sent to ${out.sent.length} ${out.sent.length === 1 ? 'client' : 'clients'}`
      + `${out.skipped.length ? `; not sent: ${out.skipped.join('; ')}` : ''}.`)
    setPicked(new Set())
    await load()
    setBusy(null)
  }

  const isRunning = (r: WorkQueueRow) => !!cycle && r.periodStart >= cycle.periodStart
  const running = rows.filter((r) => r.status !== 'paid' && isRunning(r))
  const closed = rows.filter((r) => r.status !== 'paid' && !isRunning(r))
  const paid = rows.filter((r) => r.status === 'paid')
  /* Nothing to pay yet (mid-cycle, or after the 11th's payments went): open on Running instead. */
  const tabShown = tabParam === null && closed.length === 0 && running.length > 0 ? 'running' : tab
  const shown = tabShown === 'paid' ? paid : tabShown === 'running' ? running : closed
  /* In cycles: this month's first, then anything older still not paid (the firm, 8 Oct). */
  const groups = groupRunsByCycle(shown, cycle?.periodStart ?? null, tabShown === 'paid' ? 'paid' : 'open', lag)
  const pickedRows = rows.filter((r) => picked.has(r.runId))
  const toApprove = pickedRows.filter((r) => r.status === 'ready' && !stillOpen(r)).map((r) => r.runId)
  const toEmail = pickedRows.filter((r) => r.status === 'approved').map((r) => r.runId)
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-negative-50 px-4 py-3 text-sm text-negative-700">
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
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
              {(['needs_review', 'ready', 'approved', 'sent', 'paid'] as RunStatus[]).map((st, i) => (
                <span key={st} className="flex items-center gap-1.5">
                  {i > 0 && <ArrowRight className="w-3 h-3" />}
                  <Pill status={st} />
                </span>
              ))}
            </div>
            {/*
              THE PRESS THAT MAKES A RUN AT ALL, which nothing else in the app did.
              It is not "close the cycle": build_payover_run takes any cycle start and has never
              waited for a period to end, so this works on the 5th as well as the 11th. The firm
              asked because the queue was empty and there was nothing to press -- "where is the
              payover report?" -- and the answer was that the report has no run to hang off.
            */}
            {staging && (
              <button type="button" onClick={() => setBuilding(true)}
                className="text-[12.5px] font-medium text-slate-500 underline hover:text-slate-700">
                Build for another cycle (staging)
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 divide-y divide-slate-100 border-b border-slate-100 sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
          <Tile
            label="Money received"
            value={rand(tiles?.moneyReceived ?? 0)}
            note="Trust account, this cycle"
            to="/trust/payments"
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
            to="/trust/exceptions"
          />
        </div>

        <div className="flex gap-1 px-4 pt-3">
          {(['running', 'closed', 'paid'] as const).map((t) => (
            <button
              key={t}
              type="button"
              data-testid={`tab-${t}`}
              onClick={() => setParams(t === 'closed' ? {} : { tab: t }, { replace: true })}
              className={clsx(
                'rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                tabShown === t ? 'bg-slate-100 text-slate-800' : 'text-slate-500 hover:bg-slate-50',
              )}
            >
              {t === 'running' ? `Running (${running.length})` : t === 'closed' ? `Closed · to pay (${closed.length})` : `Paid (${paid.length})`}
            </button>
          ))}
        </div>

        {/* THE BULK BAR: only what each picked run is ready for, counted, so a button never offers
            an action that would be refused. */}
        {picked.size > 0 && (
          <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[13px]" data-testid="bulk-bar">
            <span className="text-slate-600">{picked.size} selected</span>
            <button type="button" disabled={busy !== null || toApprove.length === 0} onClick={() => void bulkApprove(toApprove)}
              className="rounded-lg bg-navy-900 px-3 py-1.5 font-medium text-white hover:bg-navy-800 disabled:opacity-40">
              Approve {toApprove.length}
            </button>
            <button type="button" disabled={busy !== null || toEmail.length === 0} onClick={() => void bulkEmail(toEmail)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40">
              Email advice {toEmail.length}
            </button>
            <button type="button" onClick={() => setPicked(new Set())} className="text-slate-500 underline">Clear</button>
            {busy === 'bulk' && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          </div>
        )}
        {note && <p className="mx-4 mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900" data-testid="bulk-note">{note}</p>}

        <div className="overflow-x-auto">
          {/*
            ONE LINE A CLIENT (the firm, 10 Oct: "exceptionally bulky"). The client cell carried the
            run number, the payment count AND the period, wrapped into six lines in a narrow column,
            while the group heading above it already says the period; an Exceptions column said "1 to
            fix" beside a button saying "Fix 1 exception". Now: name and run on one line each, the
            period only on the Paid tab (where the heading does not carry it), exceptions on the
            button only, and headings that fit on one line.
          */}
          <table className="w-full text-[12.5px] whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="w-8 pl-4 py-2 font-medium">
                  <input type="checkbox" aria-label="Select every run shown"
                    checked={shown.length > 0 && shown.every((r) => picked.has(r.runId))}
                    onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((r) => r.runId)) : new Set())} />
                </th>
                <th className="px-2 py-2 font-medium">Client</th>
                <th className="px-2 py-2 font-medium">Run</th>
                <th className="px-2 py-2 text-right font-medium">Payments</th>
                <th className="px-2 py-2 text-right font-medium" title="Collected by Bredell Ferreira into trust">Collected</th>
                <th className="px-2 py-2 text-right font-medium">PTC set-off</th>
                <th className="px-2 py-2 text-right font-medium">To pay</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Next step</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                  <Loader2 className="mx-auto w-5 h-5 animate-spin" />
                </td></tr>
              )}
              {!loading && shown.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">
                  {tabShown === 'paid'
                    ? 'Nothing has been paid over yet.'
                    : tabShown === 'running'
                      ? 'Nothing processed in this cycle yet. A client appears here, with its run built, as soon as a payment for it is approved.'
                      : 'Nothing is waiting to be paid. A cycle moves here at midnight on the 10th, when it closes.'}
                </td></tr>
              )}
              {!loading && groups.map((g) => (
                <Fragment key={g.key}>
                {/*
                  ONE BAND PER CYCLE, SAYING WHAT STATE ITS MONEY IS IN (the firm, 10 Oct: "is there a
                  clear distinction"). A coloured rule and a word -- Overdue, Closed, Running, Paid --
                  then the one sentence of what happens next and when, and the cycle's total.
                */}
                <tr className="border-b border-slate-100" data-testid="cycle-group" data-tone={g.tone}>
                  <td colSpan={9} className="p-0">
                    <div className={clsx('flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 border-l-4 px-4 py-2',
                      g.tone === 'late' ? 'border-l-negative-500 bg-negative-50'
                        : g.tone === 'now' ? 'border-l-gold-500 bg-gold-50'
                          : g.tone === 'early' ? 'border-l-slate-400 bg-slate-50'
                            : 'border-l-positive-600 bg-positive-50')}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={clsx('rounded-full px-2.5 py-0.5 text-[11.5px] font-bold uppercase tracking-wide',
                            g.tone === 'late' ? 'bg-negative-100 text-negative-700'
                              : g.tone === 'now' ? 'bg-gold-100 text-gold-800'
                                : g.tone === 'early' ? 'bg-slate-200 text-slate-700'
                                  : 'bg-positive-100 text-positive-700')}>
                            {g.title}
                          </span>
                          <span className="text-[13px] font-semibold text-slate-800">{periodLabel(g.periodStart, g.periodEnd)}</span>
                          <span className="text-[12.5px] text-slate-500">
                            · {g.runs.length} {g.runs.length === 1 ? 'client' : 'clients'}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[12.5px] text-slate-600">{g.state}</div>
                      </div>
                      <span className="text-[14px] font-semibold tabular-nums text-slate-800">{rand(g.total)}</span>
                    </div>
                  </td>
                </tr>
                {g.runs.map((r) => (
                <tr
                  key={r.runId}
                  onClick={() => navigate(`/trust/runs/${r.runId}`)}
                  className="cursor-pointer border-b border-slate-50 text-slate-700 hover:bg-slate-50"
                  data-testid="queue-run"
                >
                  <td className="w-8 pl-4 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${r.client}`} checked={picked.has(r.runId)}
                      onChange={() => toggle(r.runId)} />
                  </td>
                  <td className="px-2 py-1.5 font-medium text-slate-800 max-w-[16rem] truncate" title={r.client}>{r.client}</td>
                  <td className="px-2 py-1.5 text-slate-500">
                    {r.invoiceNumber}
                    {g.tone === 'done' && <span className="text-slate-400">{' · '}{fmtDay(r.periodStart)}–{fmtDay(r.periodEnd)}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{r.payments}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{rand(r.trustCapital)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                    {r.ptcSetOff ? `− ${rand(r.ptcSetOff)}` : '—'}
                  </td>
                  {/* Below nil is the client owing us (the firm, 10 Oct): said, not a minus sign. */}
                  <td className={clsx('px-2 py-1.5 text-right font-semibold tabular-nums', r.netPayover < 0 && 'text-negative-700')}>
                    {r.netPayover < 0 ? `owes us ${rand(-r.netPayover)}` : rand(r.netPayover)}
                  </td>
                  <td className="px-2 py-1.5"><Pill status={r.status} /></td>
                  <td className="px-3 py-1.5">
                    {r.nextStep === 'approve' && stillOpen(r) ? (
                      /* ONE HEIGHT FOR EVERY RUN (the firm, 10 Oct: "make them all as big as the email
                         advice"). The words wear the button's own box -- its padding, its type and a
                         border nobody can see -- so a row reads the same height whichever it holds. */
                      <span className="inline-block whitespace-nowrap rounded-md border border-transparent px-2.5 py-1 text-[12px] font-medium text-slate-400" data-testid="still-open"
                        title="Approve early from the run, with a reason">
                        Open until {fmtDay(r.periodEnd)}
                      </span>
                    ) : r.nextStep && (
                      <button
                        type="button"
                        disabled={busy === r.runId}
                        onClick={(e) => { e.stopPropagation(); void onNextStep(r) }}
                        className={clsx(
                          'whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-50',
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
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-xs text-slate-400">
          Click a row to open the run. Status only moves forward; an approved run cannot be edited,
          and a later correction goes into next month&rsquo;s run.
        </p>
      </Card>

      {building && cycle && (
        <BuildRunModal
          cycle={cycle}
          staging={staging}
          onClose={() => setBuilding(false)}
          onBuilt={async () => { await load() }}
          onOpen={(runId) => { setBuilding(false); navigate(`/trust/runs/${runId}`) }}
        />
      )}
    </div>
  )
}

/**
 * BUILDING A RUN, FOR ANY CYCLE.
 *
 * THE CYCLE IS A CHOICE, NOT TODAY'S. `build_payover_run` never waited for a period to close, so
 * the only thing stopping somebody building last month's -- or next month's, while testing -- was
 * that nothing asked which one. The firm: "do I need to wait for the 11th or whatever?" No.
 *
 * IT LISTS WHAT IS ACTUALLY THERE. A client with no money in the chosen cycle is not offered,
 * because a run built over nothing is an invoice for R0,00 that somebody then has to void -- and
 * until this week, voiding one held that cycle shut for good.
 */
function BuildRunModal({ cycle, staging, onClose, onBuilt, onOpen }: {
  cycle: Cycle
  staging: boolean
  onClose: () => void
  onBuilt: () => Promise<void>
  onOpen: (runId: string) => void
}) {
  const [periodStart, setPeriodStart] = useState(cycle.periodStart)
  const [rows, setRows] = useState<Buildable[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (start: string) => {
    setLoading(true); setError(null)
    try { setRows(await fetchBuildable(start)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not read that cycle.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load(periodStart) }, [load, periodStart])

  async function build(row: Buildable) {
    setBusy(row.companyId); setError(null)
    try {
      const runId = await buildRun(row.companyId, periodStart)
      await onBuilt()
      onOpen(runId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build that run.')
      setBusy(null)
    }
  }

  async function reset(row: Buildable) {
    if (!row.runId) return
    setBusy(row.companyId); setError(null)
    try { await resetRun(row.runId); await load(periodStart); await onBuilt() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not reset that run.') }
    finally { setBusy(null) }
  }

  return (
    <Modal title="Build a payover run" subtitle={cycleLabel(periodStart)} onClose={onClose} width={620}>
      <label className="block">
        <span className="text-xs font-medium text-slate-600">Which cycle?</span>
        <select value={periodStart} onChange={(e) => setPeriodStart(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px]">
          {cycleChoices(cycle.periodStart).map((c) => (
            <option key={c} value={c}>
              {cycleLabel(c)}{c === cycle.periodStart ? ' · the one running now' : ''}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-[11px] text-slate-400">
          A cycle runs from the 11th to the 10th. It does not have to have ended.
        </span>
      </label>

      {error && <p className="mt-3 text-sm text-negative-700">{error}</p>}

      {loading
        ? <p className="py-6 text-center text-[13px] text-slate-400">Reading that cycle&hellip;</p>
        : rows.length === 0
          ? (
            <p className="py-6 text-center text-[13px] text-slate-500">
              No client took any money in that cycle, so there is nothing to pay over.
            </p>
          )
          : (
            <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
              {rows.map((r) => (
                <li key={r.companyId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span className="font-medium text-slate-800">{r.client}</span>
                  <span className="text-[12.5px] tabular-nums text-slate-500">
                    {r.payments} {r.payments === 1 ? 'payment' : 'payments'} · {randAmount(r.received)}
                  </span>
                  {r.runId && (
                    <span className="text-[11.5px] text-slate-400">
                      {r.invoiceNumber} · {RUN_STATUS_LABEL[r.runStatus ?? 'needs_review']}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    {/*
                      A FINISHED RUN IS NOT REBUILT, IT IS RESET -- and only on staging, where the
                      database says so. On production this is simply absent, and reset_payover_run
                      refuses as well; an invoice a client has received stays an invoice.
                    */}
                    {staging && r.runId && r.runStatus && !['needs_review', 'ready'].includes(r.runStatus) && (
                      <button type="button" disabled={busy === r.companyId}
                        onClick={() => void reset(r)}
                        className="text-[12px] font-medium text-slate-400 underline underline-offset-2
                          hover:text-slate-700 disabled:opacity-40">
                        Reset it
                      </button>
                    )}
                    <button type="button" disabled={busy === r.companyId}
                      onClick={() => void build(r)}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-[12.5px]
                        font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40">
                      {r.runId ? 'Rebuild' : 'Build'}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
    </Modal>
  )
}

/**
 * THE CYCLES WORTH OFFERING: six back and one forward from the one running.
 *
 * FORWARD AS WELL, which is not a mistake. Nothing waits for a period to end, and the firm is
 * testing scenarios rather than closing a month -- building next cycle's run is how you check that
 * a payment captured today lands where you think it does.
 */
function cycleChoices(current: string): string[] {
  const [y, m] = current.split('-').map(Number)
  const out: string[] = []
  for (let i = 1; i >= -6; i--) {
    const d = new Date(y, m - 1 + i, 11)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-11`)
  }
  return out
}

/** "11 Sep – 10 Oct 2026", the way the firm says a cycle aloud. */
function cycleLabel(start: string): string {
  const s = new Date(`${start}T00:00:00`)
  const e = new Date(s.getFullYear(), s.getMonth() + 1, 10)
  const day = (d: Date, withYear: boolean) => d.toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}),
  })
  return `${day(s, false)} – ${day(e, true)}`
}

/** "11 Aug 2026" — the firm writes dates the way they read them aloud. */
function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}
