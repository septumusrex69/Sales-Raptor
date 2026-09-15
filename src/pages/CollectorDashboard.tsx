import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { StatTile } from '../components/ui/StatTile'
import { SalesMonthPicker } from '../components/ui/SalesMonthPicker'
import { UserAvatar } from '../components/ui/Avatar'
import { useAppStore } from '../store/AppStore'
import { useAuth } from '../store/AuthContext'
import { fetchCollectorPerformance } from '../lib/collectorStats.ts'
import {
  THRESHOLDS, band, overBookBy, scoreCollector, totalStats,
  type Band, type CollectorScore, type CollectorStats,
} from '../lib/collectorScore.ts'
import { bookCeilingOf } from '../lib/collectorGrade.ts'
import { getCurrentSalesMonth, getPreviousSalesMonth, type SalesMonthPeriod } from '../lib/salesMonth'
import { pctDelta } from '../lib/pctDelta'
import { formatCurrency } from '../data/mockData'

/** Who sees everybody rather than only themselves. */
const SEES_EVERYONE = ['Administrator', 'Sales Manager', 'Liaison Manager', 'Pre-legal Team Leader']

/**
 * How a collector is doing, on the firm's own month.
 *
 * THE PERIOD IS THE 11th TO THE 10th, not the calendar month, because that is the period the
 * firm reports to clients on and remits against. A dashboard on a different month from the
 * statements would have two true answers to "how much did we collect in September".
 *
 * WHAT IT REFUSES TO DO IS RANK ON RAND. Collected is the biggest number here and the one the
 * firm earns on, so it leads — but the figures that compare two collectors are payments per
 * hundred accounts, the promise-kept rate and coverage. A junior on 130 gym memberships cannot
 * produce a commercial collector's rand however well they work, and a leaderboard that says
 * otherwise keeps them on gym memberships for ever.
 */
export function CollectorDashboard() {
  const { users } = useAppStore()
  const { currentUser } = useAuth()
  const [period, setPeriod] = useState<SalesMonthPeriod>(() => getCurrentSalesMonth(new Date()))
  const [rows, setRows] = useState<CollectorStats[] | null>(null)
  const [previous, setPrevious] = useState<CollectorStats[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const seesEveryone = SEES_EVERYONE.includes(currentUser?.role ?? '')

  useEffect(() => {
    let cancelled = false
    setRows(null); setError(null)
    const prior = getPreviousSalesMonth(period)
    void Promise.all([
      fetchCollectorPerformance(period.start, period.end),
      fetchCollectorPerformance(prior.start, prior.end),
    ])
      .then(([now, before]) => {
        if (cancelled) return
        setRows(now); setPrevious(before)
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [period])

  const mine = rows?.find((r) => r.userId === currentUser?.id) ?? null
  const minePrior = previous?.find((r) => r.userId === currentUser?.id) ?? null

  /*
   * An agent sees their own figures; a team leader sees the firm's, with everybody listed. Both
   * read the same numbers — visibility here is about whose totals lead the page, not about
   * hiding anything, which the firm settled early.
   */
  const shown = seesEveryone && rows ? totalStats(rows) : mine
  const shownPrior = seesEveryone && previous ? totalStats(previous) : minePrior
  const score = shown ? scoreCollector(shown) : null
  const priorScore = shownPrior ? scoreCollector(shownPrior) : null

  const ceiling = bookCeilingOf(currentUser?.bookCeiling)
  const over = mine ? overBookBy(mine, ceiling) : 0

  /*
   * pctDelta, not arithmetic of my own. StatTile prints the number it is given verbatim, so a
   * raw ratio renders as "0.6666666666666666%" — and the helper already handles the zero prior
   * period by returning null, which the tile says in words rather than as a fabricated 100%.
   */
  const pct = (now: number, before: number | undefined) =>
    (before === undefined ? undefined : pctDelta(now, before))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">
            {seesEveryone ? 'Collections' : 'My collections'}
          </h1>
          <p className="text-xs text-slate-400">{period.rangeLabel}</p>
        </div>
        <SalesMonthPicker value={period} onChange={setPeriod} referenceDate={new Date()} />
      </div>

      {/*
        THE NOTICE A COLLECTOR ACTUALLY SEES. It also appears on the Collectors table in Settings,
        which a collector never opens — so "your book is over" said only there is said to nobody.
      */}
      {over > 0 && (
        <Card className="border-amber-200 bg-amber-50/60">
          <p className="flex items-start gap-2 text-sm text-amber-800">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>
              <span className="font-medium">
                Your book is {over.toLocaleString('en-ZA')} accounts over.
              </span>{' '}
              You are carrying {mine?.inPlayAccounts.toLocaleString('en-ZA')} against a ceiling of{' '}
              {ceiling.toLocaleString('en-ZA')}. Speak to your team leader — nothing is blocked,
              but you will be given little new work until it comes down.
            </span>
          </p>
        </Card>
      )}

      {error && (
        <Card className="border-rose-200">
          <p className="text-sm text-rose-700">{error}</p>
        </Card>
      )}

      {rows === null ? (
        <div className="p-10 grid place-items-center text-slate-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : !score ? (
        <Card>
          <p className="text-sm text-slate-600">You do not have a collections book yet.</p>
          <p className="text-xs text-slate-400 mt-1">
            A team leader sets your grade and allocates accounts in Settings → Users → Collectors.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              accent="gold"
              label="Collected"
              value={formatCurrency(score.collected)}
              compareLabel={`vs ${getPreviousSalesMonth(period).label}`}
              pctChange={pct(score.collected, priorScore?.collected)}
              hint="Payments received in this period, on accounts held at the time the money came in. Reversed payments are excluded."
            />
            <StatTile
              label="Payments"
              value={score.payments.toLocaleString('en-ZA')}
              compareLabel={`vs ${getPreviousSalesMonth(period).label}`}
              pctChange={pct(score.payments, priorScore?.payments)}
              hint="How many debtors actually paid, regardless of size."
            />
            {/*
              ONE FACT PER TILE. "560 · R4 460 000" was two, and it wrapped onto two lines at
              every width — and the obvious fix, borrowing the comparison line for the second
              figure, needs a pctChange, which would print a confident "0%" that means nothing.
              Average payment moves down to the secondary row instead.
            */}
            <StatTile
              label="Accounts"
              value={score.inPlayAccounts.toLocaleString('en-ZA')}
              hint="In play right now. Written-off and frozen accounts do not count against a book."
            />
            <StatTile
              label="Book value"
              value={formatCurrency(score.inPlayValue)}
              hint="Capital outstanding across the accounts in play."
            />
          </div>

          {/*
            The second row is the one that compares people fairly, and it says so. Kept apart from
            the money above rather than mixed in with it, because the two answer different
            questions and a collector should be able to tell which is which.
          */}
          <Card padded={false}>
            <p className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-slate-400">
              How the work is going
              <span className="block normal-case tracking-normal text-slate-400 text-xs mt-0.5">
                These compare fairly across unlike books. Rand collected does not — it measures the
                book as much as the collector.
              </span>
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 pt-2">
              <Measure label="Promises kept" value={score.promiseKeptRate} asPercent
                note={`${score.promisesKept} of ${score.promisesResolved} resolved · ${score.promisesMade} taken`}
                tone={band(score.promiseKeptRate, THRESHOLDS.promiseKeptRate)}
                hint="Of the promises that have come due. One not yet due is neither kept nor broken." />
              <Measure label="Book reached" value={score.coverage} asPercent
                note={`${score.accountsTouched.toLocaleString('en-ZA')} of ${score.inPlayAccounts.toLocaleString('en-ZA')} accounts`}
                tone={band(score.coverage, THRESHOLDS.coverage)}
                hint="Distinct accounts worked at least once this period, over the whole book." />
              <Measure label="Payments per 100" value={score.paymentsPerHundred}
                note={`${score.payments} from ${score.inPlayAccounts.toLocaleString('en-ZA')} accounts`}
                hint="The fairest single figure across books of very different sizes." />
              <Measure label="Calls answered" value={score.callAnswerRate} asPercent
                note={`${score.callsAnswered} of ${score.calls} calls`}
                tone={band(score.callAnswerRate, THRESHOLDS.callAnswerRate)}
                hint="How often somebody picked up. Low usually means the numbers need tracing." />
            </div>
          </Card>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatTile size="secondary" label="Average payment"
              value={score.averagePayment === null ? '—' : formatCurrency(score.averagePayment)}
              hint="Collected divided by the number of payments." />
            <StatTile size="secondary" label="Calls" value={score.calls.toLocaleString('en-ZA')} />
            <StatTile size="secondary" label="Emails" value={score.emailsSent.toLocaleString('en-ZA')} />
            <StatTile size="secondary" label="SMS" value={score.smsSent.toLocaleString('en-ZA')} />
            <StatTile size="secondary" label="Notes written" value={score.notesWritten.toLocaleString('en-ZA')}
              hint="Your own words. Notes Raptor composes itself are not counted." />
          </div>

          {seesEveryone && rows.length > 0 && (
            <CollectorTable rows={rows} users={users} />
          )}
        </>
      )}
    </div>
  )
}

function Measure({ label, value, note, tone = 'unknown', asPercent, hint }: {
  label: string
  value: number | null
  note: string
  tone?: Band
  asPercent?: boolean
  hint?: string
}) {
  /*
   * A null is "no figure", not a bad one. Somebody with no promises resolved has not achieved a
   * kept rate of nought, and a red 0% on their first week is a lie the screen tells about them.
   */
  const text = value === null
    ? '—'
    : asPercent ? `${Math.round(value * 100)}%` : value.toFixed(1)
  const colour = value === null ? 'text-slate-400'
    : tone === 'good' ? 'text-emerald-700'
      : tone === 'fair' ? 'text-amber-700'
        : tone === 'poor' ? 'text-rose-700'
          : 'text-slate-800'
  return (
    <div title={hint}>
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className={`text-xl font-semibold tabular-nums mt-0.5 ${colour}`}>{text}</p>
      <p className="text-[11px] text-slate-400 tabular-nums">{note}</p>
    </div>
  )
}

/** Everyone, for a team leader. Ordered by the book-independent figure, never by rand. */
function CollectorTable({ rows, users }: { rows: CollectorStats[]; users: { id: string; name: string }[] }) {
  const scored = useMemo(
    () => rows.map(scoreCollector).sort((a, b) => (b.paymentsPerHundred ?? -1) - (a.paymentsPerHundred ?? -1)),
    [rows],
  )
  return (
    <Card padded={false}>
      <p className="px-4 pt-3 pb-2 text-[11px] uppercase tracking-wide text-slate-400">
        Everyone
        <span className="block normal-case tracking-normal text-slate-400 text-xs mt-0.5">
          Ordered by payments per hundred accounts, not by rand — otherwise whoever holds the
          biggest book is always top and nothing is learnt.
        </span>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
              <th className="px-4 py-2 font-medium">Collector</th>
              <th className="px-3 py-2 font-medium text-right">Book</th>
              <th className="px-3 py-2 font-medium text-right">Collected</th>
              <th className="px-3 py-2 font-medium text-right">Payments</th>
              <th className="px-3 py-2 font-medium text-right">Per 100</th>
              <th className="px-3 py-2 font-medium text-right">Kept</th>
              <th className="px-3 py-2 font-medium text-right">Reached</th>
              <th className="px-3 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {scored.map((s: CollectorScore) => (
              <tr key={s.userId} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-2">
                  <span className="flex items-center gap-2">
                    <UserAvatar userId={s.userId} size={22} />
                    <span className="text-slate-700">
                      {users.find((u) => u.id === s.userId)?.name ?? 'Unknown'}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                  {s.inPlayAccounts.toLocaleString('en-ZA')}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatCurrency(s.collected)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{s.payments}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-800">
                  {s.paymentsPerHundred === null ? '—' : s.paymentsPerHundred.toFixed(1)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                  {s.promiseKeptRate === null ? '—' : `${Math.round(s.promiseKeptRate * 100)}%`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                  {s.coverage === null ? '—' : `${Math.round(s.coverage * 100)}%`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{s.actions.toLocaleString('en-ZA')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
