import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, CreditCard, FileText, Filter, Loader2, Search, Users } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { rand } from '../../lib/money'
import {
  NEXT_STEP_LABEL, RUN_STATUS_LABEL,
  approveRun, buildRun, fetchBuildable, markRunPaid, fetchCycle, fetchTiles, fetchWorkQueue,
  fetchReleasedRunIds, fetchUnallocatedReceipts, isStagingDeployment, refreshRuns, resetRun,
  type Buildable, type Cycle, type CycleTiles, type RunStatus, type WorkQueueRow,
} from '../../lib/payover'
import { Modal } from '../../components/ui/Modal'
import {
  collectingState, defaultQueueTab, groupRunsByCycle, historyPayouts, parseQueueTab, payoutLabel, paysOnFor, periodLabel,
  queueTabOf, runPill, type PillTone, type QueueTab,
} from '../../lib/payoverGroups'
import { firmDay } from '../../lib/dateLabels'
import { supabase } from '../../lib/supabase'
import { fetchSettledRunIds } from '../../lib/clientBusinessReceipts'
import { sendAdviceForRuns } from '../../lib/remittanceEmail'
import { fetchPayoutsStatementOnly } from '../../lib/trust'
import { MarkPaidModal, type PayableRun } from './MarkPaidModal'
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

const PILL_TONE: Record<PillTone, string> = {
  collecting: 'bg-negative-100 text-negative-700',
  waiting: 'bg-amber-100 text-amber-800',
  ready: 'bg-sky-100 text-sky-800',
  review: 'bg-orange-100 text-orange-800',
  approved: 'bg-slate-200 text-slate-700',
  sent: 'bg-gold-100 text-gold-800',
  paid: 'bg-emerald-100 text-emerald-700',
  void: 'bg-slate-100 text-slate-400',
}

/* The word and colour come from the TAB as well as the status (runPill): see payoverGroups.ts. */
function Pill({ status, tab }: { status: RunStatus; tab: QueueTab }) {
  const p = runPill(status, tab)
  return (
    <span data-testid="run-pill" className={clsx('inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', PILL_TONE[p.tone])}>
      {p.label}
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
function Tile({ icon, label, value, note, to, accent, action }: {
  icon: ReactNode; label: string; value: string; note?: string; to?: string
  /** The one card that is a call to work (Ready to approve): tinted, with its action under it. */
  accent?: boolean; action?: ReactNode
}) {
  const body = (
    <div className="flex gap-3">
      <span className={clsx('mt-0.5 shrink-0', accent ? 'text-sky-700' : 'text-slate-500')}>{icon}</span>
      <div className="min-w-0">
        <div className={clsx('text-[13px] font-medium', accent ? 'text-sky-800' : 'text-slate-700')}>{label}</div>
        <div className="mt-1 text-[22px] font-semibold tabular-nums text-slate-800">{value}</div>
        {note && <div className="mt-0.5 text-xs text-slate-400">{note}</div>}
        {action}
      </div>
    </div>
  )
  const box = clsx('block rounded-xl border p-4 transition-colors',
    accent ? 'border-sky-100 bg-sky-50/60' : 'border-slate-100 bg-white')
  return to
    ? <Link to={to} className={clsx(box, 'hover:bg-slate-50')}>{body}</Link>
    : <div className={box}>{body}</div>
}

export function FinanceWorkQueue() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  /* FOUR TABS, ONE CYCLE EACH (S7, 12 Oct): Collecting, Waiting, To pay, History -- see queueTabOf.
     No ?tab= means "open on what is due" (defaultQueueTab), decided once the runs are in. */
  const tabParam = parseQueueTab(params.get('tab'))
  const [query, setQuery] = useState('')
  /* HISTORY'S MONTH, by payout day. Empty is the latest payout. A search ignores it and looks across
     every month (the firm: "go and find them"). */
  const [payout, setPayout] = useState('')
  const [statusFilter, setStatusFilter] = useState<RunStatus | ''>('')

  const [cycle, setCycle] = useState<Cycle | null>(null)
  const [tiles, setTiles] = useState<CycleTiles | null>(null)
  const [rows, setRows] = useState<WorkQueueRow[]>([])
  /* Runs below nil the client has paid into the business account -- "Paid to us", not "owes us". */
  const [settled, setSettled] = useState<Set<string>>(new Set())
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
  /* WHAT A BULK PRESS IS DOING NOW, in words: "Emailing 2 of 4 · Seabreeze Body Corporate". A spinner
     alone for most of a minute read as stuck (the firm, 11 Oct). */
  const [progress, setProgress] = useState<string | null>(null)
  /* Approved runs released for payout before their day (release_payover_run_early). */
  const [released, setReleased] = useState<Set<string>>(new Set())
  /* THE REAL UNMATCHED STATEMENT LINES (prompt 11): the tile said "Bank import unavailable" long
     after the import worked, beside a zero the database hard-coded. */
  const [unmatched, setUnmatched] = useState<{ count: number; amount: number } | null>(null)
  /* How long after a cycle closes it is paid (Trust settings); one month unless the firm changed it. */
  const [lag, setLag] = useState(1)
  /* MARK PAID, FROM HERE (the firm, 10 Oct: "the mark as paid button should ... just immediately
     show you that pop-up"). One run from its row, several from the bulk bar. Not offered at all
     where Trust settings say payments out are confirmed from the statement only. */
  const [paying, setPaying] = useState<PayableRun[] | null>(null)
  const [statementOnly, setStatementOnly] = useState(false)
  useEffect(() => { fetchPayoutsStatementOnly().then(setStatementOnly).catch(() => {}) }, [])

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
      setSettled(await fetchSettledRunIds().catch(() => new Set<string>()))
      setReleased(await fetchReleasedRunIds().catch(() => new Set<string>()))
      setUnmatched(await fetchUnallocatedReceipts()
        .then((u) => ({ count: u.length, amount: Math.round(u.reduce((t, x) => t + Math.abs(x.amount), 0) * 100) / 100 }))
        .catch(() => null))
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
    if (row.nextStep === 'paid' && !statementOnly && row.netPayover >= 0) {
      setPaying([{ id: row.runId, client: row.client, invoiceNumber: row.invoiceNumber, amount: row.netPayover }])
      return
    }
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

  /*
   * EVERY BULK PRESS ENDS, WHATEVER HAPPENS INSIDE IT. The busy flag used to be cleared on the last
   * line, after the reload -- so anything that threw on the way (a dropped connection on the iPad
   * above all) left the spinner turning for ever over work that had in fact been done, and the
   * only way out was another tab and back (the firm, 11 Oct). `finally` is what makes it end.
   */
  async function bulk(work: () => Promise<string>) {
    setBusy('bulk'); setError(null); setNote(null)
    try {
      setNote(await work())
      setPicked(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not finish. Reload to see what was done.')
    } finally {
      setProgress('Bringing the list up to date…')
      await load().catch(() => {})
      setProgress(null)
      setBusy(null)
    }
  }

  async function bulkApprove(ids: string[]) {
    await bulk(async () => {
      const failed: string[] = []
      for (const [i, id] of ids.entries()) {
        const r = rows.find((x) => x.runId === id)
        setProgress(`Approving ${i + 1} of ${ids.length}${r ? ` · ${r.client}` : ''}`)
        try { await approveRun(id) } catch (e) {
          failed.push(`${r?.client ?? 'A run'}: ${e instanceof Error ? e.message : 'could not be approved'}`)
        }
      }
      return `${ids.length - failed.length} approved${failed.length ? `; ${failed.length} not: ${failed.join('; ')}` : ''}.`
    })
  }

  async function bulkEmail(ids: string[]) {
    await bulk(async () => {
      const out = await sendAdviceForRuns(ids, (done, total, client) => {
        if (done < total) setProgress(`Emailing ${done + 1} of ${total}${client ? ` · ${client}` : ''}`)
      })
      return `Advice sent to ${out.sent.length} ${out.sent.length === 1 ? 'client' : 'clients'}`
        + `${out.skipped.length ? `; not sent: ${out.skipped.join('; ')}` : ''}.`
    })
  }

  /*
   * FINALISED, NOT ONLY PAID (the firm, 11 Oct, of MPG-2606 sitting under "Due today" for ever: "maybe
   * instead of paid, we should say finalised ... and move it there as well"). A run below nil has
   * nothing to pay and can never be marked paid; once its advice has gone (or the client paid the
   * shortfall into the business account) there is nothing left to do ON THE RUN. The money is not
   * forgotten: the next run opens with it as "Brought forward", and the client's statement and
   * Client balances carry it as owed to us until it is set off or paid. Approved and not yet sent
   * stays in Closed -- the advice telling them they owe us is still to go.
   */
  const isFinal = (r: WorkQueueRow) => r.status === 'paid'
    || (r.netPayover <= 0 && (r.status === 'sent' || (r.status === 'approved' && settled.has(r.runId))))
  const tabOf = (r: WorkQueueRow): QueueTab => queueTabOf(r, {
    final: isFinal(r), released: released.has(r.runId), openStart: cycle?.periodStart ?? null, today: cycle?.today ?? null, lagMonths: lag,
  })
  const byTab: Record<QueueTab, WorkQueueRow[]> = { collecting: [], waiting: [], topay: [], history: [] }
  for (const r of rows) byTab[tabOf(r)].push(r)
  const counts = { collecting: byTab.collecting.length, waiting: byTab.waiting.length, topay: byTab.topay.length, history: byTab.history.length }
  const tabShown: QueueTab = tabParam ?? defaultQueueTab(counts)
  const q = query.trim().toLowerCase()
  const payouts = historyPayouts(byTab.history, lag)
  const payoutShown = payout && payouts.includes(payout) ? payout : (payouts[0] ?? '')
  const shown = byTab[tabShown]
    .filter((r) => (!q || r.client.toLowerCase().includes(q) || (r.invoiceNumber ?? '').toLowerCase().includes(q))
      && (!statusFilter || r.status === statusFilter)
      /* History shows one payout at a time, unless a search is looking across all of them. */
      && (tabShown !== 'history' || !!q || paysOnFor(r.periodEnd, lag) === payoutShown))
  /* In cycles: the one that leaves soonest first (the firm, 8 Oct); History newest first. */
  const groups = groupRunsByCycle(shown, cycle?.periodStart ?? null, tabShown === 'history' ? 'paid' : 'open', lag, cycle?.today ?? null)
  /* THE OPEN CYCLE IS SHOWN EVEN EMPTY (the firm, 12 Oct: "There's nothing in running. I don't know
     why"). On the first day of a cycle nothing has been processed yet; a bare 0 read as broken. */
  const emptyCollecting = tabShown === 'collecting' && groups.length === 0 && !q && !statusFilter && !!cycle
  const isHistory = tabShown === 'history'
  const TAB_LABEL: Record<QueueTab, string> = { collecting: 'Collecting', waiting: 'Waiting', topay: 'To pay', history: 'History' }
  const pickedRows = rows.filter((r) => picked.has(r.runId))
    /* THE PAYOUT DAY (11 Oct): an approved run's advice and payment wait for payover_pays_on unless it
     was released early. A sent run went out already, so it is not held again. The database refuses
     the same; this is so the bar never offers what would be refused. */
  const paysOn = (r: WorkQueueRow) => paysOnFor(r.periodEnd, lag)
  const isDue = (r: WorkQueueRow) => r.status !== 'approved' || released.has(r.runId)
    || (!!cycle && cycle.today >= paysOn(r))
  /* APPROVED ON THE PAYOUT DAY, NOT BEFORE (the firm, 11 Oct: "only approve the previous month's
     payments ... you only approve it by the time that you pay it out"). Until then a closed run stays
     Ready and keeps taking in what is raised for it -- a withdrawal comes off THIS payout rather than
     sending an approved run back. Approving earlier is the run page's Approve early, with a reason. */
  const waitsForDay = (r: WorkQueueRow) => r.status === 'ready' && !stillOpen(r) && !!cycle && cycle.today < paysOn(r)
  const toApprove = pickedRows.filter((r) => r.status === 'ready' && !stillOpen(r) && !waitsForDay(r)).map((r) => r.runId)
  const approveLater = pickedRows.filter(waitsForDay)
  const readyNow = rows.filter((r) => r.status === 'ready' && !stillOpen(r) && !waitsForDay(r))
  const readyLater = rows.filter((r) => r.status === 'ready' && (stillOpen(r) || waitsForDay(r)))
  /* The soonest day any of them may be approved: the payout day, or for a running cycle its own. */
  const readyLaterDay = readyLater.map((r) => paysOn(r)).sort()[0] ?? null
  const scheduled = pickedRows.filter((r) => r.status === 'approved' && !isDue(r))
  const toEmail = pickedRows.filter((r) => r.status === 'approved' && isDue(r)).map((r) => r.runId)
  /* Only what is ready to pay: approved or sent, on its day, and not below nil -- a run below nil is
     the client owing us, and mark_payover_run_paid refuses it. */
  const toPay = statementOnly ? [] : pickedRows.filter((r) => (r.status === 'approved' || r.status === 'sent') && isDue(r) && r.netPayover >= 0)

  async function payRuns(refs: Record<string, string>, date: string) {
    const list = paying ?? []
    setPaying(null)
    await bulk(async () => {
      const failed: string[] = []
      for (const [i, r] of list.entries()) {
        setProgress(`Marking ${i + 1} of ${list.length} paid · ${r.client}`)
        try { await markRunPaid(r.id, refs[r.id].trim(), new Date(`${date}T12:00:00`).toISOString()) } catch (e) {
          failed.push(`${r.client}: ${e instanceof Error ? e.message : 'could not be marked paid'}`)
        }
      }
      return `${list.length - failed.length} marked paid${failed.length ? `; ${failed.length} not: ${failed.join('; ')}` : ''}.`
    })
  }
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-negative-50 px-4 py-3 text-sm text-negative-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/*
        FOUR CARDS, NOT A STRIP (the firm, 10 Oct, with a drawing). The cycle and cut-off line and
        the Needs review -> Ready -> Approved -> Sent -> Paid legend went: the legend explained the
        pills every row already wears, and the firm read it as noise ("I don't know what that ...
        is"). What the cut-off said lives in each cycle's band ("closes at midnight on 10 Oct").
        The last card is the one that is work, so it is tinted and says where to go.
      */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="run-tiles">
        <Tile icon={<CreditCard size={20} />} label="Money received" value={rand(tiles?.moneyReceived ?? 0)}
          note="Trust account, this cycle" to="/trust/payments" />
        <Tile icon={<Users size={20} />} label="Net due to clients" value={rand(tiles?.dueToClients ?? 0)}
          note="After commission, VAT and set-offs" />
        <Tile icon={<FileText size={20} />} label="Unmatched payments"
          value={unmatched ? `${unmatched.count} · ${rand(unmatched.amount)}` : '—'}
          note={unmatched === null ? 'Could not read the statement lines'
            : unmatched.count > 0 ? 'Statement lines with no account yet' : 'Every statement line is placed'}
          to="/trust/exceptions" />
        {/* ONLY WHAT CAN BE APPROVED NOW (prompt 11): it counted runs in the cycle still running, and
            -- since 11 Oct -- closed runs waiting for their payout day; neither can be approved. */}
        <Tile icon={<CheckCircle2 size={20} />} label="Ready to approve" accent
          value={String(readyNow.length)}
          note={readyLater.length > 0
            ? `${readyLater.length} more ready on ${fmtDay(readyLaterDay ?? '')}${(tiles?.needsReviewCount ?? 0) > 0 ? ` · ${tiles?.needsReviewCount} need review` : ''}`
            : (tiles?.needsReviewCount ?? 0) > 0 ? `${tiles?.needsReviewCount} more need review` : undefined}
          action={(
            <button type="button" data-testid="review-runs"
              onClick={() => {
                /* To the tab the ready runs are on -- those that may be approved now first -- showing only them. */
                const to: QueueTab = readyNow.length > 0 ? tabOf(readyNow[0])
                  : byTab.waiting.some((r) => r.status === 'ready') ? 'waiting' : 'collecting'
                setParams({ tab: to }, { replace: true })
                setStatusFilter('ready')
              }}
              className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-sky-700 hover:text-sky-900">
              Review runs <ArrowRight size={14} />
            </button>
          )} />
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-4 pt-3">
          <div className="flex gap-4">
            {(['collecting', 'waiting', 'topay', 'history'] as const).map((t) => {
              const count = counts[t]
              return (
                <button
                  key={t}
                  type="button"
                  data-testid={`tab-${t}`}
                  onClick={() => setParams({ tab: t }, { replace: true })}
                  className={clsx(
                    '-mb-px flex items-center gap-2 border-b-2 px-1 pb-2.5 pt-1 text-[13.5px] font-medium transition-colors',
                    tabShown === t ? 'border-navy-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700',
                  )}
                >
                  {TAB_LABEL[t]}
                  {/* Brackets kept for the reader of innerText; drawn as a pill. To pay holding
                      anything is the one that is work today, so it is tinted. */}
                  <span className={clsx('rounded-full px-2 py-px text-[11.5px]',
                    t === 'topay' && count > 0 ? 'bg-gold-100 text-gold-800' : 'bg-slate-100 text-slate-600')}>
                    <span className="sr-only">(</span>{count}<span className="sr-only">)</span>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 pb-2">
            {/* HISTORY, ONE PAYOUT AT A TIME (S7): "what went out on 11 Sep?". A search looks across
                every payout, so the picker steps aside while one is typed. */}
            {isHistory && payouts.length > 0 && (
              <label className={clsx('flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-600',
                q && 'opacity-50')}>
                <CalendarDays size={14} className="text-slate-400" />
                <select value={payoutShown} onChange={(e) => setPayout(e.target.value)} disabled={!!q}
                  aria-label="Payout month" data-testid="history-payout" className="bg-transparent outline-none">
                  {payouts.map((p) => <option key={p} value={p}>{payoutLabel(p)}</option>)}
                </select>
              </label>
            )}
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
              <Search size={14} className="text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={isHistory ? 'Client or run number…' : 'Search clients…'}
                aria-label="Search clients" className="w-44 bg-transparent text-[13px] outline-none placeholder:text-slate-400" />
            </label>
            {!isHistory && <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-600">
              <Filter size={14} className="text-slate-400" />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as RunStatus | '')}
                aria-label="Filter by status" className="bg-transparent outline-none">
                <option value="">All statuses</option>
                {(['needs_review', 'ready', 'approved', 'sent', 'paid'] as RunStatus[]).map((st) => (
                  <option key={st} value={st}>{RUN_STATUS_LABEL[st]}</option>
                ))}
              </select>
            </label>}
            {/*
              THE PRESS THAT MAKES A RUN AT ALL, for a cycle other than the running one. Staging
              only: in production the runs build themselves (refresh_payover_runs on open).
            */}
            {staging && (
              <button type="button" onClick={() => setBuilding(true)}
                className="text-[12px] font-medium text-slate-400 underline hover:text-slate-600">
                Build another cycle
              </button>
            )}
          </div>
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
            {!statementOnly && (
              <button type="button" data-testid="bulk-pay" disabled={busy !== null || toPay.length === 0}
                onClick={() => setPaying(toPay.map((r) => ({ id: r.runId, client: r.client, invoiceNumber: r.invoiceNumber, amount: r.netPayover })))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40">
                Mark paid {toPay.length}
              </button>
            )}
            <button type="button" onClick={() => setPicked(new Set())} className="text-slate-500 underline">Clear</button>
            {busy === 'bulk' && (
              <span className="inline-flex items-center gap-1.5 text-slate-600" data-testid="bulk-progress">
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />{progress ?? 'Working…'}
              </span>
            )}
            {busy !== 'bulk' && approveLater.length > 0 && (
              <span className="text-[12.5px] text-slate-500" data-testid="bulk-approve-later">
                {approveLater.length} approved on {fmtDay(paysOn(approveLater[0]))}, the payout day
              </span>
            )}
            {busy !== 'bulk' && scheduled.length > 0 && (
              <span className="text-[12.5px] text-slate-500" data-testid="bulk-scheduled">
                {scheduled.length} not yet due: advice and payment on {fmtDay(paysOn(scheduled[0]))}
              </span>
            )}
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
          <table className="w-full list-table whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="w-8 pl-4 py-2 font-medium">
                  <input type="checkbox" aria-label="Select every run shown"
                    checked={shown.length > 0 && shown.every((r) => picked.has(r.runId))}
                    onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((r) => r.runId)) : new Set())} />
                </th>
                <th className="px-2 py-2 font-medium">Client</th>
                <th className="px-2 py-2 font-medium">Run</th>
                {isHistory ? (
                  /* HISTORY READS WHAT WENT OUT (S7): how much, on what day, on which reference. */
                  <>
                    <th className="px-2 py-2 text-right font-medium" title="Collected by Bredell Ferreira into trust">Collected</th>
                    <th className="px-2 py-2 text-right font-medium">Paid out</th>
                    <th className="px-2 py-2 font-medium">Date paid</th>
                    <th className="px-2 py-2 font-medium">Reference</th>
                  </>
                ) : (
                  <>
                    <th className="px-2 py-2 text-right font-medium">Payments</th>
                    <th className="px-2 py-2 text-right font-medium" title="Collected by Bredell Ferreira into trust">Collected</th>
                    <th className="px-2 py-2 text-right font-medium">PTC set-off</th>
                    <th className="px-2 py-2 text-right font-medium">To pay</th>
                  </>
                )}
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">{isHistory ? '' : 'Next step'}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                  <Loader2 className="mx-auto w-5 h-5 animate-spin" />
                </td></tr>
              )}
              {!loading && emptyCollecting && cycle && (
                <>
                  <tr className="border-b border-slate-100" data-testid="cycle-group" data-tone="early">
                    <td colSpan={9} className="p-0">
                      <div className="flex flex-wrap items-center justify-between gap-x-4 border-l-4 border-l-slate-400 bg-slate-50 px-4 py-1.5">
                        <div className="flex flex-wrap items-center gap-x-2">
                          <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-[11.5px] font-bold uppercase tracking-wide text-slate-700">Collecting</span>
                          <span className="text-[13px] font-semibold text-slate-800">{periodLabel(cycle.periodStart, cycle.periodEnd)}</span>
                          <span className="text-[12.5px] text-slate-500">· {collectingState(cycle.periodEnd, lag)}</span>
                        </div>
                        <span className="text-[14px] font-semibold tabular-nums text-slate-800">{rand(0)}</span>
                      </div>
                    </td>
                  </tr>
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-400">
                    Nothing processed in this cycle yet. A client appears here, with its run built, as soon as a payment for it is approved.
                  </td></tr>
                </>
              )}
              {!loading && shown.length === 0 && !emptyCollecting && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">
                  {(q || statusFilter) ? 'No run on this tab matches the search or filter.'
                    : tabShown === 'history'
                    ? 'Nothing has been finalised yet: a run moves here once it is paid, or once a run where the client owes us has gone to them.'
                    : tabShown === 'waiting'
                      ? 'Nothing is waiting for its payout day. A cycle moves here at midnight on the 10th, when it closes.'
                      : 'Nothing is due to be paid. A closed cycle moves here on its payout day, the 11th.'}
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
                    <div className={clsx('flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 border-l-4 px-4 py-1.5',
                      g.tone === 'late' ? 'border-l-negative-500 bg-negative-50'
                        : g.tone === 'now' ? 'border-l-gold-500 bg-gold-50'
                          : g.tone === 'early' ? 'border-l-slate-400 bg-slate-50'
                            : 'border-l-positive-600 bg-positive-50')}>
                      {/* ONE LINE (the firm's drawing, 10 Oct): the word, the cycle, how many, and what
                          happens next, then the total at the right. */}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
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
                          <span className="text-[12.5px] text-slate-500">· {g.state}</span>
                        </div>
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
                  {isHistory ? (
                    <>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{rand(r.trustCapital)}</td>
                      <td className={clsx('px-2 py-1.5 text-right font-semibold tabular-nums', r.netPayover < 0 && 'text-negative-700')}>
                        {r.netPayover < 0 ? `owed us ${rand(-r.netPayover)}` : rand(r.netPayover)}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums text-slate-600" data-testid="history-paid-on">
                        {r.paidAt ? fmtDay(firmDay(r.paidAt)) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-slate-600" data-testid="history-reference">{r.eftReference ?? '—'}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{r.payments}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{rand(r.trustCapital)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                        {r.ptcSetOff ? `− ${rand(r.ptcSetOff)}` : '—'}
                      </td>
                      {/* Below nil is the client owing us (the firm, 10 Oct): said, not a minus sign. */}
                      <td className={clsx('px-2 py-1.5 text-right font-semibold tabular-nums', r.netPayover < 0 && 'text-negative-700')}>
                        {r.netPayover < 0 ? `owes us ${rand(-r.netPayover)}` : rand(r.netPayover)}
                      </td>
                    </>
                  )}
                  <td className="px-2 py-1.5"><Pill status={r.status} tab={tabOf(r)} /></td>
                  <td className="px-3 py-1.5">
                    {r.nextStep === 'approve' && stillOpen(r) ? (
                      /* ONE HEIGHT FOR EVERY RUN (the firm, 10 Oct: "make them all as big as the email
                         advice"). The words wear the button's own box -- its padding, its type and a
                         border nobody can see -- so a row reads the same height whichever it holds. */
                      <span className="inline-block whitespace-nowrap rounded-md border border-transparent px-2.5 py-1 text-[12px] font-medium text-slate-400" data-testid="still-open"
                        title="Approve early from the run, with a reason">
                        Open until {fmtDay(r.periodEnd)}
                      </span>
                    ) : r.nextStep === 'approve' && waitsForDay(r) ? (
                      <span className="inline-block whitespace-nowrap rounded-md border border-transparent px-2.5 py-1 text-[12px] font-medium text-slate-500" data-testid="approve-on-day"
                        title="Approved on its payout day; until then it takes in anything raised for this client. Approve early from the run, with a reason.">
                        Approve on {fmtDay(paysOn(r))}
                      </span>
                    ) : r.netPayover < 0 && settled.has(r.runId) ? (
                      <span className="inline-block whitespace-nowrap rounded-md border border-transparent px-2.5 py-1 text-[12px] font-medium text-emerald-700"
                        data-testid="paid-to-us" title="The client paid the shortfall into the business account">
                        Paid to us
                      </span>
                    ) : r.netPayover < 0 && isFinal(r) ? (
                      /* FINALISED BELOW NIL: what they owe has gone forward to their next run. */
                      <span className="inline-block whitespace-nowrap rounded-md border border-transparent px-2.5 py-1 text-[12px] font-medium text-negative-700"
                        data-testid="carried-forward" title="Brought forward as the opening line of this client's next run, and on their statement until it is set off or paid">
                        Carried to next run
                      </span>
                    ) : r.nextStep === 'paid' && r.netPayover < 0 ? (
                      /* A RUN BELOW NIL HAS NOTHING TO PAY: the client owes us, and it comes off their
                         next payover or they pay it into the business account. */
                      <span className="inline-block whitespace-nowrap rounded-md border border-transparent px-2.5 py-1 text-[12px] font-medium text-negative-700"
                        data-testid="owes-us">
                        Client owes us
                      </span>
                    ) : r.status === 'approved' && !isDue(r) ? (
                      /* SCHEDULED: approved, waiting for its payout day. Releasing it early is on the
                         run, with a reason -- the same place approving early is. */
                      <span className="inline-block whitespace-nowrap rounded-md border border-transparent px-2.5 py-1 text-[12px] font-medium text-slate-500"
                        data-testid="scheduled" title="The advice goes out and it is paid on its payout day. Release it early from the run, with a reason.">
                        Pays {fmtDay(paysOn(r))}
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

      {paying && (
        <MarkPaidModal runs={paying} onClose={() => setPaying(null)} onSave={payRuns} />
      )}
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
