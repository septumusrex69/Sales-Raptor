import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { resolveTarget } from '../lib/targets'
import {
  monthPace, paceLine, standingLabel, teamTotal,
  type MonthPace, type PaceLine, type PaceStanding,
} from '../lib/collectionPace.ts'
import { formatCurrency } from '../data/mockData'
import type { ID, Target, Team, User } from '../types'

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
  const { users, teams, targets } = useAppStore()
  const { currentUser } = useAuth()
  const [period, setPeriod] = useState<SalesMonthPeriod>(() => getCurrentSalesMonth(new Date()))
  const [rows, setRows] = useState<CollectorStats[] | null>(null)
  const [previous, setPrevious] = useState<CollectorStats[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const seesEveryone = SEES_EVERYONE.includes(currentUser?.role ?? '')

  /*
   * The month in WORK DAYS, which is how the firm reads every percentage on this screen. Read
   * once per render from a single `new Date()` so the header, the tiles and both tables cannot
   * disagree about what day it is halfway down the page.
   */
  const pace = useMemo(() => monthPace(period.start, period.end, new Date()), [period])

  /** What a person was set for this month. Undefined target, not nought — see `paceLine`. */
  const targetFor = useCallback(
    (userId: ID): number | null =>
      resolveTarget(targets, 'user', userId, 'collected', period.key)?.targetValue ?? null,
    [targets, period.key],
  )

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

  /*
   * The target the header is read against. A collector sees their own; a team leader sees the
   * floor's, which is the sum of the people's rather than a figure typed in separately — a total
   * a team leader cannot take apart again and explain to the person it is made of is no use to
   * them. `teamTotal` also reports how many of the people actually have one set, because a floor
   * target built from nineteen of twenty-eight collectors is understated and must say so.
   */
  const floor = useMemo(
    () => teamTotal((rows ?? []).map((r) => ({ collected: r.collected, target: targetFor(r.userId) }))),
    [rows, targetFor],
  )
  const shownTarget = seesEveryone ? floor.target : targetFor(currentUser?.id ?? '')
  const line = shown ? paceLine(shown.collected, shownTarget, pace) : null

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
            The firm's own month header, in the firm's own terms. Everything below it that is
            expressed as a percentage of target is meaningless without it: 10% collected is
            exactly on pace on the second working day and a crisis on the eighteenth.
          */}
          <PaceCard
            pace={pace}
            line={line}
            note={
              seesEveryone && floor.withTarget > 0 && floor.withTarget < floor.members
                ? `The floor target is the sum of ${floor.withTarget} of ${floor.members} collectors' own targets — ${floor.members - floor.withTarget === 1 ? 'one has' : `${floor.members - floor.withTarget} have`} none set, so it is short by their share.`
                : undefined
            }
          />

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
            <>
              <TeamTable rows={rows} users={users} teams={teams} targets={targets}
                periodKey={period.key} pace={pace} targetFor={targetFor} />
              <EveryoneCard rows={rows} users={users} pace={pace} targetFor={targetFor} />
            </>
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
function FairTable({ rows, users }: { rows: CollectorStats[]; users: { id: string; name: string }[] }) {
  const scored = useMemo(
    () => rows.map(scoreCollector).sort((a, b) => (b.paymentsPerHundred ?? -1) - (a.paymentsPerHundred ?? -1)),
    [rows],
  )
  return (
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
  )
}

/* ---------- pace against target ---------- */

/** A ratio as the firm writes it. One decimal, because 0.8% and 1.2% are different problems. */
const pctText = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(1)}%`)
/** The gap always carries its sign: "+9.9%" is ahead of pace and "-6.9%" is behind it. */
const gapText = (v: number | null): string =>
  v === null ? '—' : `${v >= 0 ? '+' : '−'}${(Math.abs(v) * 100).toFixed(1)}%`
const moneyText = (v: number | null): string => (v === null ? '—' : formatCurrency(v))

const STANDING_STYLE: Record<PaceStanding, string> = {
  met: 'bg-emerald-100 text-emerald-800',
  'on-track': 'bg-emerald-50 text-emerald-700',
  behind: 'bg-amber-50 text-amber-800',
  critical: 'bg-rose-50 text-rose-700',
  'no-target': 'bg-slate-100 text-slate-500',
}

function StatusPill({ standing }: { standing: PaceStanding }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${STANDING_STYLE[standing]}`}>
      {standingLabel(standing)}
    </span>
  )
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'behind' | 'ahead' }) {
  const colour = tone === 'behind' ? 'text-rose-700' : tone === 'ahead' ? 'text-emerald-700' : 'text-slate-800'
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${colour}`}>{value}</p>
    </div>
  )
}

/**
 * The month, in work days — the firm's own sheet header.
 *
 * Shown whether or not a target has been set, because the work-day count is a fact about the
 * month that a team leader plans around on its own. The target half appears only once there is
 * a target: a row of dashes teaches nobody anything, and an invented nought would be worse.
 */
function PaceCard({ pace, line, note }: { pace: MonthPace; line: PaceLine | null; note?: string }) {
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3">
        <Fact label="Work days" value={pace.workDays.toLocaleString('en-ZA')} />
        <Fact label="Worked" value={pace.daysWorked.toLocaleString('en-ZA')} />
        <Fact label="Left" value={pace.finished ? 'Month closed' : pace.daysLeft.toLocaleString('en-ZA')} />
        <Fact label="Expected pace" value={pctText(pace.expected)} />
        {line && line.target !== null && (
          <>
            <span className="hidden sm:block h-8 w-px bg-slate-100" aria-hidden />
            <Fact label="Target" value={moneyText(line.target)} />
            <Fact label="Achieved" value={pctText(line.achieved)} />
            <Fact label="Gap vs pace" value={gapText(line.gap)}
              tone={(line.gap ?? 0) < 0 ? 'behind' : 'ahead'} />
            <Fact label="Still needed" value={moneyText(line.stillNeeded)} />
            <Fact label="Needed a day" value={moneyText(line.neededADay)} />
            <StatusPill standing={line.standing} />
          </>
        )}
      </div>
      {line && line.target === null && (
        <p className="px-4 pb-3 -mt-1 text-xs text-slate-400">
          No collection target set for this month. A team leader sets one in Settings &rarr;
          Targets, per person or per team.
        </p>
      )}
      {note && <p className="px-4 pb-3 -mt-1 text-xs text-amber-700">{note}</p>}
    </Card>
  )
}

type EveryoneView = 'fair' | 'target'

/**
 * Everyone, two ways, and the toggle is the point.
 *
 * The firm keeps two sheets for two questions and so does this card. "Fair comparison" ranks on
 * figures that survive being given a different book, and is the one that should decide who is
 * promoted. "Needing attention" is their daily pace sheet — lowest percentage of target first —
 * and it is a list of who to go and stand next to this morning, not a ranking of collectors.
 * Merging them into one table would produce thirteen columns and quietly let rand rank people
 * again, which the whole of collectorScore.ts exists to prevent.
 */
function EveryoneCard({ rows, users, pace, targetFor }: {
  rows: CollectorStats[]
  users: User[]
  pace: MonthPace
  targetFor: (id: ID) => number | null
}) {
  const [view, setView] = useState<EveryoneView>('fair')
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3 pb-2">
        <p className="text-[11px] uppercase tracking-wide text-slate-400">
          Everyone
          <span className="block normal-case tracking-normal text-slate-400 text-xs mt-0.5 max-w-xl">
            {view === 'fair'
              ? 'Ordered by payments per hundred accounts, not by rand — otherwise whoever holds the biggest book is always top and nothing is learnt.'
              : 'Lowest percentage of target first. This is who needs help today; it is not a ranking of collectors — a small book cannot produce a big one’s rand however well it is worked.'}
          </span>
        </p>
        <div className="flex rounded-lg border border-slate-200 p-0.5 shrink-0">
          {([['fair', 'Fair comparison'], ['target', 'Needing attention']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                view === id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {view === 'fair'
        ? <FairTable rows={rows} users={users} />
        : <TargetTable rows={rows} users={users} pace={pace} targetFor={targetFor} />}
    </Card>
  )
}

function TargetTable({ rows, users, pace, targetFor }: {
  rows: CollectorStats[]
  users: User[]
  pace: MonthPace
  targetFor: (id: ID) => number | null
}) {
  const lines = useMemo(() => {
    const out = rows.map((r) => ({
      userId: r.userId,
      name: users.find((u) => u.id === r.userId)?.name ?? 'Unknown',
      line: paceLine(r.collected, targetFor(r.userId), pace),
    }))
    /*
     * Worst first, and everybody with no target set at the bottom. Sorting a null achieved as a
     * nought would put people nobody has given a figure to at the top of a list headed "needing
     * attention" — which is a real problem, but a different one, and it would push the collector
     * who is genuinely at 0.8% of R100 000 off the top of the screen.
     */
    return out.sort((a, b) => {
      if (a.line.achieved === null || b.line.achieved === null) {
        return Number(a.line.achieved === null) - Number(b.line.achieved === null)
      }
      return a.line.achieved - b.line.achieved
    })
  }, [rows, users, pace, targetFor])

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
            <th className="px-4 py-2 font-medium">Collector</th>
            <th className="px-3 py-2 font-medium text-right">Target</th>
            <th className="px-3 py-2 font-medium text-right">Collected</th>
            <th className="px-3 py-2 font-medium text-right">Achieved</th>
            <th className="px-3 py-2 font-medium text-right">Gap vs pace</th>
            <th className="px-3 py-2 font-medium text-right">Still needed</th>
            <th className="px-3 py-2 font-medium text-right">Needed a day</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(({ userId, name, line }) => (
            <tr key={userId} className="border-b border-slate-50 last:border-0">
              <td className="px-4 py-2">
                <span className="flex items-center gap-2">
                  <UserAvatar userId={userId} size={22} />
                  <span className="text-slate-700">{name}</span>
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-500">{moneyText(line.target)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatCurrency(line.collected)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-800">{pctText(line.achieved)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${
                line.gap === null ? 'text-slate-400' : line.gap < 0 ? 'text-rose-700' : 'text-emerald-700'
              }`}>
                {gapText(line.gap)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-600">{moneyText(line.stillNeeded)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-600">{moneyText(line.neededADay)}</td>
              <td className="px-3 py-2"><StatusPill standing={line.standing} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Teams, the firm's other daily sheet.
 *
 * A team's target is whatever was SET for the team, and only the sum of its members' when it has
 * none of its own — the same precedence the sales dashboard uses, and for the same reason: "the
 * team must collect two and a half million" and "each of you must collect eighty thousand" are
 * both real instructions and neither follows from the other.
 *
 * Collectors with no team are shown as their own line rather than dropped. Two of the firm's own
 * thirty clerks have a blank team on their sheet, and a floor total that quietly excludes them
 * is a floor total that does not add up.
 */
function TeamTable({ rows, users, teams, targets, periodKey, pace, targetFor }: {
  rows: CollectorStats[]
  users: User[]
  teams: Team[]
  targets: Target[]
  periodKey: string
  pace: MonthPace
  targetFor: (id: ID) => number | null
}) {
  const lines = useMemo(() => {
    const byTeam = new Map<string, { collected: number; target: number | null }[]>()
    for (const r of rows) {
      const teamId = users.find((u) => u.id === r.userId)?.teamId ?? ''
      const bucket = byTeam.get(teamId) ?? []
      bucket.push({ collected: r.collected, target: targetFor(r.userId) })
      byTeam.set(teamId, bucket)
    }
    return [...byTeam.entries()]
      .map(([teamId, members]) => {
        const total = teamTotal(members)
        const own = teamId
          ? resolveTarget(targets, 'team', teamId, 'collected', periodKey)?.targetValue ?? null
          : null
        return {
          teamId,
          name: teamId ? teams.find((t) => t.id === teamId)?.name ?? 'Unknown team' : 'No team',
          total,
          /* The team's own figure is used whole; the summed one carries the "n of m" caveat. */
          fromMembers: own === null,
          line: paceLine(total.collected, own ?? total.target, pace),
        }
      })
      .sort((a, b) => {
        if (a.line.achieved === null || b.line.achieved === null) {
          return Number(a.line.achieved === null) - Number(b.line.achieved === null)
        }
        return a.line.achieved - b.line.achieved
      })
  }, [rows, users, teams, targets, periodKey, pace, targetFor])

  if (lines.length === 0) return null

  return (
    <Card padded={false}>
      <p className="px-4 pt-3 pb-2 text-[11px] uppercase tracking-wide text-slate-400">
        Teams
        <span className="block normal-case tracking-normal text-slate-400 text-xs mt-0.5 max-w-xl">
          Each team against what its people were set. A team with no target of its own is totalled
          from its members, and says how many of them have one.
        </span>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
              <th className="px-4 py-2 font-medium">Team</th>
              <th className="px-3 py-2 font-medium text-right">People</th>
              <th className="px-3 py-2 font-medium text-right">Target</th>
              <th className="px-3 py-2 font-medium text-right">Collected</th>
              <th className="px-3 py-2 font-medium text-right">Achieved</th>
              <th className="px-3 py-2 font-medium text-right">Still needed</th>
              <th className="px-3 py-2 font-medium text-right">Needed a day</th>
              <th className="px-3 py-2 font-medium text-right">Needed a week</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ teamId, name, total, fromMembers, line }) => (
              <tr key={teamId || 'none'} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-2 text-slate-700">
                  {name}
                  {fromMembers && total.withTarget > 0 && total.withTarget < total.members && (
                    <span className="block text-[11px] text-amber-700">
                      Target from {total.withTarget} of {total.members}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{total.members}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{moneyText(line.target)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatCurrency(line.collected)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-800">{pctText(line.achieved)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{moneyText(line.stillNeeded)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{moneyText(line.neededADay)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{moneyText(line.neededAWeek)}</td>
                <td className="px-3 py-2"><StatusPill standing={line.standing} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
