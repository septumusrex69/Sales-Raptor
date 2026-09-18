import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarClock, Download, Loader2, Search, Users } from 'lucide-react'
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
import { bookCeilingOf, monthTargetFor } from '../lib/collectorGrade.ts'
import { getCurrentSalesMonth, getPreviousSalesMonth, type SalesMonthPeriod } from '../lib/salesMonth'
import { pctDelta } from '../lib/pctDelta'
import { resolveTarget } from '../lib/targets'
import {
  dayKey, monthPace, paceLine, previousWorkingDay, standingLabel, targetLaps, teamTotal,
  type MonthPace, type PaceLine, type PaceStanding,
} from '../lib/collectionPace.ts'
import { placeLabel, standings } from '../lib/collectorTrend.ts'
import { CollectionsHero } from '../components/collections/CollectionsHero'
import { formatCurrency } from '../data/mockData'
import type { ID, Target, Team, User } from '../types'

/** What a person's target is, and whether anybody actually chose it. */
interface ResolvedTarget { target: number | null; origin: 'set' | 'grade' }

/**
 * Collections — the firm's daily performance report.
 *
 * THE PERIOD IS THE 11th TO THE 10th, not the calendar month, because that is the period the
 * firm reports to clients on and remits against. A dashboard on a different month from the
 * statements would have two true answers to "how much did we collect in September".
 *
 * IT IS READ AS AT A DAY, which is the other half of what makes it the firm's report rather than
 * a dashboard. Their own sheet is headed "Date: 14/09/2026" and every percentage on it is read
 * against how far into the month's WORK DAYS that date is. Being able to move that date back is
 * what lets a team leader answer "where were we on Friday" without keeping a copy of Friday's
 * spreadsheet.
 *
 * WHAT IT REFUSES TO DO IS RANK PEOPLE ON RAND. Rand collected leads, because the firm earns on
 * it and the month is run on it — but the list is never SORTED by it. A junior on 130 gym
 * memberships cannot produce a commercial collector's rand however well they work, and a
 * leaderboard that says otherwise keeps them on gym memberships for ever. The figures that
 * compare two collectors fairly are further down, in their own card.
 */
export function CollectorDashboard() {
  const { users, teams, targets } = useAppStore()
  const { currentUser } = useAuth()
  const [period, setPeriod] = useState<SalesMonthPeriod>(() => getCurrentSalesMonth(new Date()))
  /* Null means "the latest day this period has", which is today for the month in progress and
     the last day of it for a month that has closed. Cleared whenever the period changes. */
  const [asAtKey, setAsAtKey] = useState<string | null>(null)
  const [teamId, setTeamId] = useState<string>('')
  const [rows, setRows] = useState<CollectorStats[] | null>(null)
  const [todayRows, setTodayRows] = useState<CollectorStats[] | null>(null)
  const [previous, setPrevious] = useState<CollectorStats[] | null>(null)
  const [beforeRows, setBeforeRows] = useState<CollectorStats[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  /*
   * The day the report is read as at, kept inside the period whatever is asked for.
   *
   * A date outside the month would produce a report with more work days behind it than the month
   * has, or none at all, and every percentage on the screen would be nonsense rather than wrong
   * in a way somebody could spot.
   */
  const asAt = useMemo(() => {
    const latest = new Date() > period.end ? period.end : new Date()
    if (!asAtKey) return latest
    const picked = new Date(`${asAtKey}T12:00:00`)
    if (Number.isNaN(picked.getTime())) return latest
    if (picked < period.start) return period.start
    return picked > latest ? latest : picked
  }, [asAtKey, period])

  /* The instant the period's figures are counted up to: the end of the day being read. */
  const asAtEnd = useMemo(() => {
    const end = new Date(asAt)
    end.setHours(23, 59, 59, 999)
    return end > period.end ? period.end : end
  }, [asAt, period.end])

  const dayStart = useMemo(() => {
    const start = new Date(asAt)
    start.setHours(0, 0, 0, 0)
    return start
  }, [asAt])

  /*
   * The working day before the one being read, so the hero's comparison is not a Monday against
   * a Sunday. Null on the rare day that has none within reach — see previousWorkingDay.
   */
  const beforeDay = useMemo(() => {
    const key = previousWorkingDay(dayKey(asAt))
    if (!key) return null
    const start = new Date(`${key}T00:00:00`)
    const end = new Date(`${key}T23:59:59.999`)
    return { key, start, end }
  }, [asAt])

  useEffect(() => {
    let cancelled = false
    setRows(null); setError(null)
    const prior = getPreviousSalesMonth(period)
    void Promise.all([
      fetchCollectorPerformance(period.start, asAtEnd),
      /* The day on its own, for "collected today". The firm's sheet leads with it and so does
         theirs: the first question every morning is what came in yesterday. */
      fetchCollectorPerformance(dayStart, asAtEnd),
      fetchCollectorPerformance(prior.start, prior.end),
      beforeDay
        ? fetchCollectorPerformance(beforeDay.start, beforeDay.end)
        : Promise.resolve([] as CollectorStats[]),
    ])
      .then(([now, day, before, dayBefore]) => {
        if (cancelled) return
        setRows(now); setTodayRows(day); setPrevious(before); setBeforeRows(dayBefore)
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [period, asAtEnd, dayStart, beforeDay])

  /*
   * The month in WORK DAYS, as at the day being read. Every percentage below is read against it:
   * ten per cent collected is exactly on pace on the second working day and a crisis on the
   * eighteenth, and without this the screen cannot tell the two apart.
   */
  const pace = useMemo(() => monthPace(period.start, period.end, asAt), [period, asAt])

  /** What a person was set, or what their grade says before anybody sets anything. */
  const targetFor = useCallback((userId: ID, collects: boolean): ResolvedTarget => {
    const set = resolveTarget(targets, 'user', userId, 'collected', period.key)?.targetValue ?? null
    const grade = users.find((u) => u.id === userId)?.collectorGrade ?? null
    return monthTargetFor({ set, grade, collects })
  }, [targets, users, period.key])

  /* A collector's own team, for the filter and for the team roll-up. */
  const teamOf = useCallback(
    (userId: ID): string => users.find((u) => u.id === userId)?.teamId ?? '',
    [users],
  )

  /*
   * THE TEAM FILTER NARROWS EVERYTHING BELOW IT, including the totals at the top. A filter that
   * changed the table and left the headline figures showing the whole floor would have a team
   * leader reading their team's list against the firm's numbers.
   */
  const shownRows = useMemo(
    () => (rows ?? []).filter((r) => !teamId || teamOf(r.userId) === teamId),
    [rows, teamId, teamOf],
  )
  const shownToday = useMemo(
    () => (todayRows ?? []).filter((r) => !teamId || teamOf(r.userId) === teamId),
    [todayRows, teamId, teamOf],
  )

  const mine = rows?.find((r) => r.userId === currentUser?.id) ?? null

  /*
   * An agent sees their own figures; a team leader sees the floor's, with everybody listed. Both
   * read the same numbers — visibility here is about whose totals lead the page, not about
   * hiding anything, which the firm settled early.
   */
  const shown = rows ? totalStats(shownRows) : null
  const shownPrior = previous ? totalStats(previous) : null
  const score = shown ? scoreCollector(shown) : null
  const priorScore = shownPrior ? scoreCollector(shownPrior) : null

  const collectedToday = shownToday.reduce((t, r) => t + r.collected, 0)
  /*
   * The day before, through the same team filter as everything else — otherwise a team leader
   * filtered to one team would see their team's day compared with the whole floor's.
   */
  const collectedBefore = (beforeRows ?? [])
    .filter((r) => !teamId || teamOf(r.userId) === teamId)
    .reduce((t, r) => t + r.collected, 0)

  /*
   * The target the headline is read against: the sum of the people's own, never a figure typed in
   * separately. A total a team leader cannot take apart again and explain to the person it is
   * made of is no use to them.
   */
  const floor = useMemo(
    () => teamTotal(shownRows.map((r) => ({
      collected: r.collected,
      target: targetFor(r.userId, r.inPlayAccounts > 0 || r.collected > 0).target,
    }))),
    [shownRows, targetFor],
  )
  const myTarget = targetFor(currentUser?.id ?? '', (mine?.inPlayAccounts ?? 0) > 0).target
  const line = shown ? paceLine(shown.collected, floor.target, pace) : null
  /* The agent's own month, for the strip under the floor's — and their place on it. */
  const myLine = mine ? paceLine(mine.collected, myTarget, pace) : null
  const myPlace = useMemo(
    () => standings(
      shownRows.filter((r) => r.inPlayAccounts > 0 || r.collected > 0),
      (r) => r.collected,
    ).get(currentUser?.id ?? ''),
    [shownRows, currentUser],
  )

  const ceiling = bookCeilingOf(currentUser?.bookCeiling)
  const over = mine ? overBookBy(mine, ceiling) : 0

  /*
   * pctDelta, not arithmetic of my own. StatTile prints the number it is given verbatim, so a
   * raw ratio renders as "0.6666666666666666%" — and the helper already handles the zero prior
   * period by returning null, which the tile says in words rather than as a fabricated 100%.
   */
  const pct = (now: number, before: number | undefined) =>
    (before === undefined ? undefined : pctDelta(now, before))

  /** Teams that actually have somebody collecting, so the filter offers nothing empty. */
  const teamOptions = useMemo(() => {
    const present = new Set((rows ?? []).map((r) => teamOf(r.userId)))
    return teams.filter((t) => present.has(t.id))
  }, [rows, teams, teamOf])

  return (
    <div className="space-y-4">
      {/*
        THE HERO IS THE REPORT'S OWN HEADER, to the firm's design: the four figures the floor is
        run on, over the three controls that decide what those figures mean. Those controls used
        to sit in a card of their own below the title, and a number read under the wrong one of
        them is not slightly wrong — it is about somebody else, or about a different month. They
        belong in the same frame as the figures they qualify.

        EVERY FIGURE ON IT COMES FROM THE SAME QUERY AS THE TABLES UNDERNEATH. The mockup carried
        round numbers; a hero that shows a figure nothing else on the page produces is decoration,
        and people stop reading decoration.
      */}
      <CollectionsHero
        figures={{
          today: collectedToday,
          todayLabel: isToday(asAt) ? 'Collected today' : `Collected on ${shortDay(asAt)}`,
          /* Null rather than a fabricated percentage where the day before brought in nothing —
             every increase on nought is infinite, and "+100%" would be the screen inventing one. */
          changeOnPrevious: beforeRows === null || collectedBefore <= 0
            ? null
            : collectedToday / collectedBefore - 1,
          previousLabel: beforeDay === null ? null
            : beforeDay.key === dayKey(new Date(asAt.getTime() - 86400000))
              ? 'yesterday' : shortDay(beforeDay.start),
          collected: score?.collected ?? 0,
          target: line?.target ?? null,
          achieved: line?.achieved ?? null,
          againstPace: line?.target == null ? null : line.collected - line.target * line.expected,
          expectedByNow: line?.target == null ? null : line.target * line.expected,
          neededADay: line?.neededADay ?? null,
          stillNeeded: line?.stillNeeded ?? null,
        }}
        filters={
          /*
            DRAWN AS TEXT, NOT AS A ROW OF FIELDS. The firm's own design has this line reading
            "Collection period: 11 Sep – 10 Oct 2026 | As at: 18 Sep 2026 | All teams" with an
            icon in front of each — three facts, not three boxes. The chrome comes off in the
            .hero-controls skin rather than here, so the shared SalesMonthPicker is untouched on
            the eight other screens that render it; the affordance does not come off with it,
            because the skin puts the box back on hover and focus.
          */
          <>
            <SalesMonthPicker value={period} onChange={(p) => { setPeriod(p); setAsAtKey(null) }}
              referenceDate={new Date()} variant="dark" />
            <span className="hidden sm:block h-4 w-px bg-white/20" />
            <span className="flex items-center gap-2 text-xs text-white/60">
              <CalendarClock size={14} className="shrink-0 text-white/50" />
              <label htmlFor="collections-as-at">As at</label>
              <input id="collections-as-at" type="date" value={dayKey(asAt)}
                onChange={(e) => setAsAtKey(e.target.value || null)}
                min={dayKey(period.start)}
                max={dayKey(new Date() > period.end ? period.end : new Date())}
                aria-label="Read the report as at"
                className="rounded-lg border border-white/15 bg-white/10 px-2 py-1.5 text-xs text-white [color-scheme:dark]" />
            </span>
            {teamOptions.length > 0 && (
              <>
                <span className="hidden sm:block h-4 w-px bg-white/20" />
                <span className="flex items-center gap-2 text-xs text-white/60">
                  <Users size={14} className="shrink-0 text-white/50" />
                  <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
                    aria-label="Team"
                    className="rounded-lg border border-white/15 bg-white/10 px-2 py-1.5 text-xs text-white [color-scheme:dark]">
                    <option value="">All teams</option>
                    {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </span>
              </>
            )}
          </>
        }
        action={rows && rows.length > 0 ? (
          <ExportButton rows={shownRows} today={shownToday} users={users} teams={teams}
            pace={pace} asAt={asAt} period={period} targetFor={targetFor} />
        ) : undefined}
        /*
          THE MONTH BAR MOVES INTO THE PANEL, at the firm's instruction — it was "another bulky
          white card immediately underneath". Rendered here rather than inside the hero so that
          the arithmetic stays in the one place that already does it: this is the same element
          that used to sit below, with its colours changed.
        */
        progress={<MonthProgress pace={pace} line={line} tone="dark"
          note={floor.withTarget < floor.members
            ? `${floor.members - floor.withTarget} of ${floor.members} have no target, so the total is short by their share.`
            : undefined} />}
      />

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
            A team leader sets your grade and allocates accounts in Settings &rarr; Users &rarr;
            Collectors.
          </p>
        </Card>
      ) : (
        <>
          {/*
            THE OTHER HALF OF THE ANSWER. The headline above is the company's; this is the person
            reading it. The firm wanted both on one screen rather than behind a toggle — "they
            should see their own thing, but they should also be able to see the entire company's
            performance, and where they stand relative to everybody else."
          */}
          {mine && myLine && (
            <Card padded={false}>
              <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Your month</p>
                <Fact label="Collected" value={formatCurrency(mine.collected)} />
                <Fact label="Of target" value={pctText(myLine.achieved)} />
                <Fact label="Payments" value={mine.payments.toLocaleString('en-ZA')} />
                <Fact label="On the floor" value={placeLabel(myPlace)} />
                {myLine.target !== null && <StatusPill standing={myLine.standing} />}
                <Link to={`/performance/${mine.userId}`}
                  className="ml-auto text-xs font-medium text-brand-600 hover:underline">
                  Open my dashboard &rarr;
                </Link>
              </div>
            </Card>
          )}

          {shownRows.length > 0 && (
            <>
              <TeamTable rows={shownRows} users={users} teams={teams} targets={targets}
                periodKey={period.key} pace={pace} targetFor={targetFor} />
              <ClerkTable rows={shownRows} today={shownToday} users={users} teams={teams}
                pace={pace} targetFor={targetFor} me={currentUser?.id ?? null} />
            </>
          )}

          {/*
            The card that compares people fairly, and it says so. Kept apart from the money above
            rather than mixed in with it, because the two answer different questions and a
            collector should be able to tell which is which.
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

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile size="secondary" label="Payments"
              value={score.payments.toLocaleString('en-ZA')}
              compareLabel={`vs ${getPreviousSalesMonth(period).label}`}
              pctChange={pct(score.payments, priorScore?.payments)}
              hint="How many debtors actually paid, regardless of size." />
            <StatTile size="secondary" label="Average payment"
              value={score.averagePayment === null ? '—' : formatCurrency(score.averagePayment)}
              hint="Collected divided by the number of payments." />
            <StatTile size="secondary" label="Accounts"
              value={score.inPlayAccounts.toLocaleString('en-ZA')}
              hint="In play right now. Written-off and frozen accounts do not count against a book." />
            <StatTile size="secondary" label="Book value"
              value={formatCurrency(score.inPlayValue)}
              hint="Capital outstanding across the accounts in play." />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile size="secondary" label="Calls" value={score.calls.toLocaleString('en-ZA')} />
            <StatTile size="secondary" label="Emails" value={score.emailsSent.toLocaleString('en-ZA')} />
            <StatTile size="secondary" label="SMS" value={score.smsSent.toLocaleString('en-ZA')} />
            <StatTile size="secondary" label="Notes written" value={score.notesWritten.toLocaleString('en-ZA')}
              hint="Your own words. Notes Raptor composes itself are not counted." />
          </div>

          {shownRows.length > 0 && <FairTable rows={shownRows} users={users} />}
        </>
      )}
    </div>
  )
}

/* ---------- reading the numbers ---------- */

/** A ratio as the firm writes it. One decimal, because 0.8% and 1.2% are different problems. */
const pctText = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(1)}%`)
/** The gap always carries its sign: "+9.9%" is ahead of pace and "-6.9%" is behind it. */
const gapText = (v: number | null): string =>
  v === null ? '—' : `${v >= 0 ? '+' : '−'}${(Math.abs(v) * 100).toFixed(1)}%`
const moneyText = (v: number | null): string => (v === null ? '—' : formatCurrency(v))

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/* Written out rather than through Intl: en-ZA renders September as "Sept", which is neither the
   full month nor a normal abbreviation, and this codebase has been bitten by it before. */
const shortDay = (d: Date): string => `${d.getDate()} ${MONTHS[d.getMonth()]}`
const isToday = (d: Date): boolean => dayKey(d) === dayKey(new Date())

const STANDING_STYLE: Record<PaceStanding, string> = {
  met: 'bg-emerald-100 text-emerald-800',
  'on-track': 'bg-emerald-50 text-emerald-700',
  behind: 'bg-amber-50 text-amber-800',
  critical: 'bg-rose-50 text-rose-700',
  'no-target': 'bg-slate-100 text-slate-500',
}

/** A label and its figure, side by side. The shape the personal strip is made of. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-slate-800">{value}</p>
    </div>
  )
}

function StatusPill({ standing }: { standing: PaceStanding }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${STANDING_STYLE[standing]}`}>
      {standingLabel(standing)}
    </span>
  )
}

/**
 * The progress bar, and it laps.
 *
 * THE FIRM'S OWN IDEA: "when somebody has exceeded their target, the bar that's there starts
 * over, but now it's a different colour." A bar pinned at 100% says somebody is past target and
 * nothing else — a collector at 260% and one at 101% look identical on a screen whose whole job
 * is to show who is carrying the month. Past target the bar starts again in green, and the count
 * of whole targets behind them is printed beside it.
 *
 * The arithmetic is in targetLaps, which is pure and checked. Here it is only drawn.
 */
function ProgressBar({ achieved, width = 'w-24' }: { achieved: number | null; width?: string }) {
  const { fill, laps, over } = targetLaps(achieved)
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block ${width} h-1.5 rounded-full bg-slate-200 overflow-hidden align-middle`}>
        <span
          className={`block h-full rounded-full ${over ? 'bg-emerald-500' : 'bg-gold-400'}`}
          style={{ width: `${Math.round(fill * 100)}%` }}
        />
      </span>
      {/* Only where it means something. "×1" on everybody past target would be noise. */}
      {laps > 1 && <span className="text-[11px] font-medium text-emerald-700">&times;{laps}</span>}
    </span>
  )
}

/**
 * The month on one bar, with the day's pace marked on it.
 *
 * THE MARKER IS THE POINT. A bar alone says 36% and leaves the reader to work out whether that is
 * good; the line at 30% says it is ahead, on the day it is being read. It is the same comparison
 * the status pills make, drawn once for the whole floor.
 */
function MonthProgress({ pace, line, note, tone = 'light' }: {
  pace: MonthPace
  line: PaceLine | null
  note?: string
  /**
   * 'dark' renders it inside the Collections hero's glass panel rather than as a card of its own.
   *
   * A VARIANT RATHER THAN A SECOND COMPONENT, deliberately. The month bar is the same three facts
   * wherever it is drawn — what was achieved, what was expected by now, how many days are left —
   * and a second implementation for the dark panel is a second place for those to disagree with
   * the tables underneath. Only the colours change; every figure comes from the same pace object.
   */
  tone?: 'light' | 'dark'
}) {
  const { fill, laps, over } = targetLaps(line?.achieved ?? null)
  const marker = Math.min(100, Math.round(pace.expected * 100))
  const dark = tone === 'dark'

  const body = (
    <>
      <div className="px-4 pt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className={dark ? 'text-sm text-white/60' : 'text-sm text-slate-500'}>
          Monthly progress{' '}
          <span className={`font-semibold tabular-nums ${dark ? 'text-white' : 'text-slate-800'}`}>
            {line?.achieved === null || line?.achieved === undefined
              ? 'no target set'
              : `${pctText(line.achieved)} achieved`}
          </span>
          {laps > 0 && (
            <span className={`ml-2 text-xs font-medium ${dark ? 'text-[#3ecf8e]' : 'text-emerald-700'}`}>
              {laps === 1 ? 'past target' : `${laps} targets over`}
            </span>
          )}
        </p>
        <p className={`text-xs tabular-nums ${dark ? 'text-white/45' : 'text-slate-400'}`}>
          {pace.daysWorked} of {pace.workDays} working days completed
          {pace.finished ? ' · month closed' : ` · ${pace.daysLeft} remaining`}
        </p>
      </div>
      <div className="px-4 pt-3 pb-1">
        {/* Thinner on the dark panel, at the firm's instruction: over a photograph a 10px bar
            reads as a widget, and the figure beside it is what anybody actually reads. */}
        <div className={`relative rounded-full ${dark ? 'h-1.5 bg-white/12' : 'h-2.5 bg-slate-200'}`}>
          <div className={`h-full rounded-full ${
            over ? (dark ? 'bg-[#3ecf8e]' : 'bg-emerald-500') : (dark ? 'bg-[#d8b76b]' : 'bg-gold-400')
          }`} style={{ width: `${Math.round(fill * 100)}%` }} />
          {/* Hidden once the month is over: there is no pace left to keep, only a result. */}
          {!pace.finished && (
            <div className={`absolute inset-y-[-3px] w-px ${dark ? 'bg-white/55' : 'bg-slate-500'}`}
              style={{ left: `${marker}%` }} />
          )}
        </div>
      </div>
      <div className="px-4 pb-3 relative h-4">
        {!pace.finished && (
          <span className={`absolute text-[11px] tabular-nums -translate-x-1/2 whitespace-nowrap ${
            dark ? 'text-white/45' : 'text-slate-500'
          }`} style={{ left: `calc(${marker}% + 1rem)` }}>
            {marker}% expected by now
          </span>
        )}
      </div>
      {note && (
        <p className={`px-4 pb-3 -mt-1 text-xs ${dark ? 'text-[#e4c68a]' : 'text-amber-700'}`}>{note}</p>
      )}
    </>
  )

  return dark ? <div>{body}</div> : <Card padded={false}>{body}</Card>
}

/* ---------- the clerks ---------- */

type ClerkView = 'all' | 'attention' | 'rand'

interface ClerkLine {
  userId: ID
  name: string
  team: string
  /** Shown beside every place on the ranking. See the note on the ranking tab. */
  grade: string
  accounts: number
  payments: number
  averagePayment: number | null
  today: number
  line: PaceLine
  origin: 'set' | 'grade'
}

function clerkLines(input: {
  rows: CollectorStats[]
  today: CollectorStats[]
  users: User[]
  teams: Team[]
  pace: MonthPace
  targetFor: (id: ID, collects: boolean) => ResolvedTarget
}): ClerkLine[] {
  const { rows, today, users, teams, pace, targetFor } = input
  return rows.map((r) => {
    const user = users.find((u) => u.id === r.userId)
    const { target, origin } = targetFor(r.userId, r.inPlayAccounts > 0 || r.collected > 0)
    return {
      userId: r.userId,
      name: user?.name ?? 'Unknown',
      team: teams.find((t) => t.id === user?.teamId)?.name ?? 'No team',
      grade: user?.collectorGrade ?? 'Ungraded',
      accounts: r.inPlayAccounts,
      payments: r.payments,
      /* Null, not nought: somebody who took no payments has no average, and a R0 average would
         sort them above a collector who took one small one. */
      averagePayment: r.payments > 0 ? r.collected / r.payments : null,
      today: today.find((d) => d.userId === r.userId)?.collected ?? 0,
      line: paceLine(r.collected, target, pace),
      origin,
    }
  })
}

/**
 * Sort a list of people by how far behind they are, worst first.
 *
 * Everybody with no target sits at the bottom. Sorting a null achieved as a nought would put
 * people nobody has given a figure to at the top of a list headed "needs attention" — which is a
 * real problem, but a different one, and it would push the collector who is genuinely at 0.8% of
 * R100 000 off the top of the screen.
 */
function worstFirst<T extends { line: PaceLine }>(a: T, b: T): number {
  if (a.line.achieved === null || b.line.achieved === null) {
    return Number(a.line.achieved === null) - Number(b.line.achieved === null)
  }
  return a.line.achieved - b.line.achieved
}

/**
 * Everybody, against their target.
 *
 * TWO TABS, NOT THREE. The firm dropped "Target reached" — a filtered list of the people who are
 * fine is a list nobody opens twice, and the pill on the row already says it. What is left is the
 * roster and the people to go and stand next to this morning.
 *
 * THE ROSTER IS ALPHABETICAL, NOT RANKED. Sorting it by rand would quietly make it a leaderboard
 * on the one figure that measures the book somebody was handed rather than the person — which is
 * what the whole of collectorScore.ts exists to prevent. Needs attention sorts by percentage of
 * that person's OWN target, which survives being given a different book.
 */
function ClerkTable({ rows, today, users, teams, pace, targetFor, me }: {
  rows: CollectorStats[]
  today: CollectorStats[]
  users: User[]
  teams: Team[]
  pace: MonthPace
  targetFor: (id: ID, collects: boolean) => ResolvedTarget
  /** The person reading, so their own row stands out of a list of thirty. */
  me: ID | null
}) {
  const [view, setView] = useState<ClerkView>('all')
  const [search, setSearch] = useState('')
  const ranking = view === 'rand'

  const lines = useMemo(
    () => clerkLines({ rows, today, users, teams, pace, targetFor }),
    [rows, today, users, teams, pace, targetFor],
  )

  /*
   * Places computed over EVERYBODY, not over what the search box happens to show. A place that
   * moved when somebody typed a letter would not be a place.
   */
  const places = useMemo(
    () => standings(lines.filter((l) => l.accounts > 0 || l.line.collected > 0),
      (l) => l.line.collected),
    [lines],
  )

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const matching = needle
      ? lines.filter((l) => l.name.toLowerCase().includes(needle) || l.team.toLowerCase().includes(needle))
      : lines
    if (view === 'attention') {
      /* Behind their own pace, in either band. Somebody at or past pace is not "needing
         attention" however small their rand, and a list that included them would not be read. */
      return matching
        .filter((l) => l.line.standing === 'behind' || l.line.standing === 'critical')
        .sort(worstFirst)
    }
    if (view === 'rand') return [...matching].sort((a, b) => b.line.collected - a.line.collected)
    return [...matching].sort((a, b) => a.name.localeCompare(b.name, 'en-ZA'))
  }, [lines, view, search])

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 pb-2">
        <div className="flex items-center gap-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Clerk performance</p>
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            {([['all', 'All clerks'], ['attention', 'Needs attention'], ['rand', 'Ranking']] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setView(id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  view === id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-700'
                }`}>
                {label}
                {id === 'attention' && (
                  <span className="ml-1.5 tabular-nums opacity-70">
                    {lines.filter((l) => l.line.standing === 'behind' || l.line.standing === 'critical').length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        <label className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clerks&hellip;"
            className="rounded-lg border border-slate-200 pl-7 pr-2 py-1.5 text-sm w-48 text-slate-700" />
        </label>
      </div>

      {/*
        THE RANKING CARRIES ITS OWN CONTEXT, and that is the whole reason it is allowed to exist.
        The firm asked for it — "I like the idea of actually ranking them in terms of how much
        rand they've collected" — and answered the obvious objection in the same breath: "so the
        people know that if they're senior collectors they get more work, it's not a pissing
        contest." That answer only holds if the grade and the size of the book are on the row
        beside the rand, which is why this view carries both and the others do not.
      */}
      {ranking && (
        <p className="px-4 pb-2 -mt-1 text-xs text-slate-400 max-w-2xl">
          Ordered by rand collected, with the grade and the book beside it. A senior collector is
          given the bigger accounts, so part of their rand is the book they were handed &mdash;
          read the two together. Payments and the average payment are here for the same reason:
          they move independently of the total.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
              {ranking && <th className="px-4 py-2 font-medium">Place</th>}
              <th className={`${ranking ? 'px-3' : 'px-4'} py-2 font-medium`}>Clerk</th>
              <th className="px-3 py-2 font-medium">Team</th>
              {ranking ? (
                <>
                  <th className="px-3 py-2 font-medium">Grade</th>
                  <th className="px-3 py-2 font-medium text-right">Accounts</th>
                  <th className="px-3 py-2 font-medium text-right">Collected</th>
                  <th className="px-3 py-2 font-medium text-right">Payments</th>
                  <th className="px-3 py-2 font-medium text-right">Average payment</th>
                </>
              ) : (
                <>
                  <th className="px-3 py-2 font-medium text-right">Today</th>
                  <th className="px-3 py-2 font-medium text-right">Period to date</th>
                  <th className="px-3 py-2 font-medium text-right">Target</th>
                  <th className="px-3 py-2 font-medium text-right">Achieved</th>
                  <th className="px-3 py-2 font-medium text-right">Gap vs pace</th>
                  <th className="px-3 py-2 font-medium text-right">Needed / day</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((l, at) => (
              <tr key={l.userId}
                className={`border-b border-slate-50 last:border-0 ${
                  /* Your own row, out of thirty. Nothing louder than a tint: it is a marker, not
                     a status, and colouring it like one would read as something being wrong. */
                  l.userId === me ? 'bg-gold-50' : ''
                }`}>
                {ranking && (
                  <td className="px-4 py-2 tabular-nums font-semibold text-slate-700">
                    {/* Ties share a place, the way a results board does — see `standings`. */}
                    {places.get(l.userId)?.place ?? at + 1}
                  </td>
                )}
                <td className={`${ranking ? 'px-3' : 'px-4'} py-2`}>
                  <Link to={`/performance/${l.userId}`}
                    className="flex items-center gap-2 group">
                    <UserAvatar userId={l.userId} size={22} />
                    <span className="text-slate-700 group-hover:underline">{l.name}</span>
                    {l.userId === me && <span className="text-[10px] text-slate-400">(you)</span>}
                  </Link>
                </td>
                <td className="px-3 py-2 text-slate-500">{l.team}</td>
                {ranking ? (
                  <>
                    <td className="px-3 py-2 text-slate-500">{l.grade}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {l.accounts.toLocaleString('en-ZA')}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-800">
                      {formatCurrency(l.line.collected)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {l.payments.toLocaleString('en-ZA')}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {l.averagePayment === null ? '—' : formatCurrency(l.averagePayment)}
                    </td>
                  </>
                ) : (
                  <>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                  {l.today > 0 ? formatCurrency(l.today) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                  {formatCurrency(l.line.collected)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                  {moneyText(l.line.target)}
                  {/*
                    WHERE THE FIGURE CAME FROM. A team leader looking at thirty targets has to be
                    able to tell the ones somebody chose from the ones the grade supplied —
                    otherwise the first time one looks wrong, nobody can say whether it was set
                    wrong or never set at all.
                  */}
                  {l.line.target !== null && l.origin === 'grade' && (
                    <span className="block text-[10px] text-slate-400">from grade</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="inline-flex items-center gap-2 justify-end">
                    <span className="tabular-nums font-medium text-slate-800">{pctText(l.line.achieved)}</span>
                    <ProgressBar achieved={l.line.achieved} />
                  </span>
                </td>
                {/*
                  THE GAP IN PERCENTAGE POINTS, beside the percentage it is a gap from. The pill
                  says which band somebody is in; this says how far from the line they are, which
                  is the difference between a conversation and a warning.
                */}
                <td className={`px-3 py-2 text-right tabular-nums ${
                  l.line.gap === null ? 'text-slate-400' : l.line.gap < 0 ? 'text-rose-700' : 'text-emerald-700'
                }`}>
                  {gapText(l.line.gap)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                  {moneyText(l.line.neededADay)}
                </td>
                <td className="px-3 py-2"><StatusPill standing={l.line.standing} /></td>
                  </>
                )}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={ranking ? 8 : 9} className="px-4 py-6 text-center text-sm text-slate-400">
                  {view === 'attention'
                    ? 'Nobody is behind their pace right now.'
                    : 'Nobody matches that.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-[11px] text-slate-400">
        Showing {shown.length} of {lines.length} clerks.
        {' '}A target with no figure set follows the collector&rsquo;s grade; a team leader can set
        one per person in Settings &rarr; Targets.
      </p>
    </Card>
  )
}

/**
 * The day's report, as a file.
 *
 * CSV rather than a PDF, because the firm already keeps this in a spreadsheet and what they do
 * with it next is sort it and send it on. Built in the browser: there is no new endpoint, which
 * matters because Vercel's Hobby plan caps this project at twelve functions and it is at twelve.
 *
 * Nothing leaves the browser. The rows are already on the screen; this writes them to a file on
 * the reader's own machine and no server sees them — which is the right posture for a list of
 * named people and what they have collected.
 */
function ExportButton({ rows, today, users, teams, pace, asAt, period, targetFor }: {
  rows: CollectorStats[]
  today: CollectorStats[]
  users: User[]
  teams: Team[]
  pace: MonthPace
  asAt: Date
  period: SalesMonthPeriod
  targetFor: (id: ID, collects: boolean) => ResolvedTarget
}) {
  function save() {
    const lines = clerkLines({ rows, today, users, teams, pace, targetFor }).sort(
      (a, b) => a.name.localeCompare(b.name, 'en-ZA'),
    )
    /* Quoted and doubled, because a team called "Smit, Botha & Seun" would otherwise become two
       columns and shift every figure on the row one to the left. */
    const cell = (v: string | number | null) =>
      v === null ? '' : `"${String(v).replace(/"/g, '""')}"`
    const head = [
      'Clerk', 'Team', 'Today', 'Period to date', 'Target', 'Target from',
      'Achieved %', 'Gap vs pace %', 'Still needed', 'Needed per day', 'Status',
    ]
    const body = lines.map((l) => [
      l.name, l.team, l.today, l.line.collected, l.line.target,
      l.origin === 'set' ? 'set' : 'grade',
      l.line.achieved === null ? null : (l.line.achieved * 100).toFixed(1),
      l.line.gap === null ? null : (l.line.gap * 100).toFixed(1),
      l.line.stillNeeded, l.line.neededADay === null ? null : Math.round(l.line.neededADay),
      standingLabel(l.line.standing),
    ])
    /*
      The header says what the figures are OF. A file called "collections.csv" with no period and
      no as-at date in it is a file nobody can file, and a month later nobody can tell two of them
      apart.
    */
    const preamble = [
      ['Bredell Ferreira — collections daily report'],
      ['Collection period', period.rangeLabel],
      ['As at', dayKey(asAt)],
      ['Working days', `${pace.daysWorked} of ${pace.workDays}`],
      ['Expected pace', `${Math.round(pace.expected * 100)}%`],
      [],
    ]
    const csv = [...preamble.map((r) => r.map(cell).join(',')), head.map(cell).join(','),
      ...body.map((r) => r.map(cell).join(','))].join('\r\n')

    /* A BOM, so Excel opens it as UTF-8. Without it "Keamogetse" is fine and every R sign and
       every en dash in a team name arrives as mojibake. */
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = `collections-${dayKey(asAt)}.csv`
      a.click()
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  return (
    /*
      OUTLINED, NOT FILLED. A solid gold button on a photograph is the brightest thing on the
      screen, and the brightest thing on this screen should be a figure. The firm asked for
      "gold outlined or muted gold — not bright yellow"; it fills on hover, so it still reads as
      the one thing here that does something.
    */
    <button type="button" onClick={save}
      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg
        border border-[#c9a04f]/60 text-[#e4c68a] hover:bg-[#c9a04f]/15 hover:border-[#c9a04f]">
      <Download size={13} /> Export daily report
    </button>
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

/**
 * How people compare, for a team leader.
 *
 * ORDERED BY THE BOOK-INDEPENDENT FIGURE, NEVER BY RAND, and kept as its own card below the
 * money rather than as a tab beside it. Rand collected measures the book somebody was handed at
 * least as much as it measures them: a junior on 130 gym memberships cannot produce a commercial
 * collector's rand however well they work. These are the figures that survive being given a
 * different book, and they are the ones that should decide who is promoted.
 */
function FairTable({ rows, users }: { rows: CollectorStats[]; users: { id: string; name: string }[] }) {
  const scored = useMemo(
    () => rows.map(scoreCollector).sort((a, b) => (b.paymentsPerHundred ?? -1) - (a.paymentsPerHundred ?? -1)),
    [rows],
  )
  return (
    <Card padded={false}>
      <p className="px-4 pt-3 pb-2 text-[11px] uppercase tracking-wide text-slate-400">
        How people compare
        <span className="block normal-case tracking-normal text-slate-400 text-xs mt-0.5 max-w-xl">
          Ordered by payments per hundred accounts. The Ranking tab above orders on rand, which is
          the month the firm is run on; these are the figures that survive being given a different
          book, and they are the ones that should decide who is promoted.
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
  targetFor: (id: ID, collects: boolean) => ResolvedTarget
}) {
  const lines = useMemo(() => {
    const byTeam = new Map<string, { collected: number; target: number | null }[]>()
    for (const r of rows) {
      const teamId = users.find((u) => u.id === r.userId)?.teamId ?? ''
      const bucket = byTeam.get(teamId) ?? []
      bucket.push({
        collected: r.collected,
        target: targetFor(r.userId, r.inPlayAccounts > 0 || r.collected > 0).target,
      })
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
      .sort(worstFirst)
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
                <td className="px-3 py-2 text-right">
                  <span className="inline-flex items-center gap-2 justify-end">
                    <span className="tabular-nums font-medium text-slate-800">{pctText(line.achieved)}</span>
                    <ProgressBar achieved={line.achieved} />
                  </span>
                </td>
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
