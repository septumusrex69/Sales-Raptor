import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Download, Loader2, Search } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { StatTile } from '../components/ui/StatTile'
import { UserAvatar } from '../components/ui/Avatar'
import { useAppStore } from '../store/AppStore'
import { useAuth } from '../store/AuthContext'
import {
  THRESHOLDS, band, overBookBy, scoreCollector,
  type Band, type CollectorScore, type CollectorStats,
} from '../lib/collectorScore.ts'
import { bookCeilingOf } from '../lib/collectorGrade.ts'
import { getPreviousSalesMonth, type SalesMonthPeriod } from '../lib/salesMonth'
import { pctDelta } from '../lib/pctDelta'
import { resolveTarget } from '../lib/targets'
import {
  dayKey, paceLine, standingLabel, targetLaps, teamTotal,
  type MonthPace, type PaceLine, type PaceStanding,
} from '../lib/collectionPace.ts'
import { placeLabel, standings } from '../lib/collectorTrend.ts'
import { DashboardHero } from '../components/dashboard/DashboardHero'
import { MonthControls } from '../components/collections/MonthControls'
import { MonthProgress, pctText } from '../components/collections/MonthProgress'
import { useCollectionsMonth } from '../hooks/useCollectionsMonth'
import { formatCurrency } from '../data/mockData'
import type { ID, Target, Team, User } from '../types'
import { canLeadCollections } from '../lib/permissions'
import { fetchCarriedNewAccounts } from '../lib/diary.ts'
import { lateForLeaders } from '../lib/newAccounts.ts'
import { todayIso } from '../lib/diaryPriority.ts'

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

  /*
   * THE MONTH COMES FROM THE SHARED HOOK, not from a second copy of the arithmetic.
   *
   * The company dashboard leads with these same figures, at the firm's instruction — "we can
   * repeat the same figures" — and a period, a working-day pace and a sum of everybody's targets
   * written out on both screens is two implementations of eleven decisions. The failure would not
   * be a wrong page; it would be the company dashboard and this one disagreeing about what the
   * firm collected this month. See useCollectionsMonth.
   */
  const month = useCollectionsMonth()
  const {
    period, asAt, rows, error,
    shownRows, shownToday, score, priorScore, mine,
    pace, floor, line, myLine, targetFor,
  } = month

  const myPlace = useMemo(
    () => standings(
      shownRows.filter((r) => r.inPlayAccounts > 0 || r.collected > 0),
      (r) => r.collected,
    ).get(currentUser?.id ?? ''),
    [shownRows, currentUser],
  )

  const mayLeadHere = canLeadCollections(currentUser?.role)

  /*
   * NEW ACCOUNTS NOBODY HAS TOUCHED, for the person carrying them and for whoever leads them.
   *
   * The firm: "if there is a new account and the section 129 is not triggered within 24 hours of
   * loading, then it should be reported to the team leader and flagged for the agent as well…
   * it should be on their dashboard."
   *
   * ON ITS OWN, NOT PART OF THE MONTH'S FIGURES. Everything else on this screen is money over a
   * period and moves when the period picker moves; this is a fact about right now that no choice
   * of month changes, so it is fetched once against today and left alone.
   */
  const [carried, setCarried] = useState<Awaited<ReturnType<typeof fetchCarriedNewAccounts>> | null>(null)
  useEffect(() => {
    let cancelled = false
    /* A dashboard that will not draw because one panel could not load is worse than the panel
       being missing, so this failure stays inside itself. */
    fetchCarriedNewAccounts(todayIso())
      .then((rows) => { if (!cancelled) setCarried(rows) })
      .catch(() => { if (!cancelled) setCarried([]) })
    return () => { cancelled = true }
  }, [])

  const late = useMemo(
    () => (carried ? lateForLeaders(carried, todayIso()) : []),
    [carried],
  )
  const mineLate = late.find((l) => l.ownerId === currentUser?.id) ?? null
  /* Somebody else's problem to act on, so only what a leader may see — and never their own row
     twice. `late` is already worst-first: longest waiting, not most. */
  const othersLate = useMemo(
    () => (mayLeadHere ? late.filter((l) => l.ownerId !== currentUser?.id) : []),
    [late, mayLeadHere, currentUser],
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

  return (
    <div className="space-y-4">
      {/*
        THE ORDINARY BRAND BAND, AND THAT IS THE POINT.

        This screen used to wear the photograph. The firm moved it to the company dashboard whole
        — "I want the epicness of the collections dashboard, that picture that we made. That
        should be the main. When you open the company, you should see epicness" — and then: "all
        of the other dashboards can just have the other hero section. There should only be one
        very special page." So there is exactly one, and every department screen, this one
        included, wears the same band as the rest of Raptor. Landing on the company dashboard has
        to feel like arriving somewhere, and it cannot if four screens look the same.

        THE CONTROLS STAY IN THE BAND. A number read under the wrong period, or under somebody
        else's team, is not slightly wrong — it is about a different month or a different floor.
        They belong in the same frame as the figures they qualify, which is why they are in the
        hero here exactly as they are in the hero on the company screen, drawn by one component.
      */}
      <DashboardHero title="Collections" eyebrow="Bredell Ferreira · The floor"
        subtitle={`${period.label} · read as at ${shortDay(asAt)}`}>
        <MonthControls month={month} />
        {rows && rows.length > 0 && (
          <ExportButton rows={shownRows} today={shownToday} users={users} teams={teams}
            pace={pace} asAt={asAt} period={period} targetFor={targetFor} />
        )}
      </DashboardHero>

      {/*
        THE SAME FOUR FIGURES THE COMPANY DASHBOARD LEADS WITH, repeated here at the firm's
        instruction — "we can repeat the same figures". They come off the same hook, so the two
        screens cannot drift; what changes is only how they are drawn, because a tile over a
        photograph and a tile on a page are the same fact in two frames.
      */}
      <div data-qa="collections-figures" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile size="secondary" label={month.figures.todayLabel}
          value={moneyText(month.figures.today)}
          pctChange={month.figures.changeOnPrevious === null
            ? undefined : month.figures.changeOnPrevious * 100}
          compareLabel={month.figures.previousLabel ? `vs ${month.figures.previousLabel}` : undefined}
          hint="What came in on the day being read." />
        <StatTile size="secondary" label="Collected this period"
          value={moneyText(month.figures.collected)}
          hint={month.figures.target === null
            ? 'No target set for this period.'
            : `${pctText(month.figures.achieved)} of ${moneyText(month.figures.target)}.`} />
        <StatTile size="secondary"
          label={month.figures.againstPace === null ? 'Against pace'
            : month.figures.againstPace >= 0 ? 'Ahead of pace' : 'Behind pace'}
          value={month.figures.againstPace === null ? '—' : moneyText(Math.abs(month.figures.againstPace))}
          hint={month.figures.expectedByNow === null
            ? 'Nothing to measure against yet.'
            : `Expected by now ${moneyText(month.figures.expectedByNow)}.`} />
        <StatTile size="secondary" label="Needed per working day"
          value={moneyText(month.figures.neededADay)}
          hint={month.figures.stillNeeded === null
            ? 'No target set for this period.'
            : `${moneyText(month.figures.stillNeeded)} still to find.`} />
      </div>

      {/*
        THE MONTH BAR, back as a card of its own now that there is no panel for it to sit inside.
        The same element the company dashboard draws in the hero's glass, in its light colours —
        one implementation, because a second "how far through the month are we" is a second answer
        to that question.
      */}
      <MonthProgress pace={pace} line={line}
        note={floor.withTarget < floor.members
          ? `${floor.members - floor.withTarget} of ${floor.members} have no target, so the total is short by their share.`
          : undefined} />

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

      {/*
        NEW ACCOUNTS NOBODY HAS WORKED.

        ABOVE THE MONTH'S FIGURES, because it is the only thing on this screen somebody has to do
        something about TODAY. Everything under it is money over a period, and a period is a thing
        you read; this is a thing you act on.

        TWO AUDIENCES, ONE PANEL. A collector is told about their own; a team leader is told about
        the floor's, worst first — and "worst" is longest waiting, not most, because five accounts
        sitting a week is a problem and twenty that landed yesterday is a busy Tuesday.

        AND NOTHING AT ALL WHEN THERE IS NOTHING. CLAUDE.md: a warning that fires when nothing is
        wrong is worse than no warning, because people stop reading it.
      */}
      {(mineLate || othersLate.length > 0) && (
        <Card className="border-amber-200 bg-amber-50/60">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-700" />
            <div className="min-w-0 space-y-2">
              {mineLate && (
                <p className="text-sm text-amber-900">
                  <span className="font-medium">
                    {mineLate.carried === 1
                      ? 'A new account is waiting on you.'
                      : `${mineLate.carried} new accounts are waiting on you.`}
                  </span>{' '}
                  {mineLate.worst === 1
                    ? 'Carried since yesterday.'
                    : `The oldest has been carried ${mineLate.worst} working days.`}{' '}
                  <Link to="/diary" className="underline underline-offset-2 hover:text-amber-700">
                    They are at the top of your diary.
                  </Link>
                </p>
              )}
              {othersLate.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-amber-900">
                    New accounts not yet worked, by collector
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {othersLate.map((row) => (
                      <li key={row.ownerId} className="text-sm text-amber-900">
                        <Link to={`/performance/${row.ownerId}`}
                          className="font-medium underline underline-offset-2 hover:text-amber-700">
                          {users.find((u) => u.id === row.ownerId)?.name ?? 'Somebody'}
                        </Link>
                        {' — '}
                        {row.carried === 1 ? '1 account' : `${row.carried} accounts`}
                        {', oldest '}
                        {row.worst === 1 ? 'since yesterday' : `${row.worst} working days`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
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

/** The gap always carries its sign: "+9.9%" is ahead of pace and "-6.9%" is behind it. */
const gapText = (v: number | null): string =>
  v === null ? '—' : `${v >= 0 ? '+' : '−'}${(Math.abs(v) * 100).toFixed(1)}%`
const moneyText = (v: number | null): string => (v === null ? '—' : formatCurrency(v))

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/* Written out rather than through Intl: en-ZA renders September as "Sept", which is neither the
   full month nor a normal abbreviation, and this codebase has been bitten by it before. */
const shortDay = (d: Date): string => `${d.getDate()} ${MONTHS[d.getMonth()]}`

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

/* ---------- the clerks ---------- */

interface ClerkLine {
  userId: ID
  name: string
  team: string
  /**
   * Shown under the name on every row of the ranking.
   *
   * Not decoration: it is half the firm's answer to why ranking on rand is not "a pissing
   * contest" -- a senior collector is given the bigger accounts. See ClerkTable.
   */
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
 * Everybody, ranked, against their target.
 *
 * ONE TABLE, NOT THREE. It carried three tabs -- All clerks, Needs attention, Ranking -- and the
 * firm folded them into one: "remove the ranking page, remove the needs attention page and put
 * everything at the all clerks page." Both of the other two were a sort and a filter over the
 * same rows, and a tab that only reorders what you are already looking at costs a click to learn
 * nothing. Needs attention is the bottom of a ranked list, and the pill on the row says so
 * anyway; its count survives in the footer, which is where it was actually read from.
 *
 * RANKED, WITH THE GRADE AND THE BOOK ON THE ROW. The firm asked for the ranking -- "I like the
 * idea of actually ranking them in terms of how much rand they've collected" -- and answered the
 * obvious objection in the same breath: "so the people know that if they're senior collectors
 * they get more work, it's not a pissing contest." That answer only holds while the grade and the
 * number of accounts are on the row beside the rand. They were the Ranking tab's own columns and
 * they are the reason it was allowed to exist, so they came across with it: the grade under the
 * name, the book in its own column. Ranking the roster and leaving them behind would be the one
 * version of this the firm explicitly did not ask for.
 *
 * Places are shared by ties, the way a results board does -- see `standings`.
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
  const [search, setSearch] = useState('')

  const lines = useMemo(
    () => clerkLines({ rows, today, users, teams, pace, targetFor }),
    [rows, today, users, teams, pace, targetFor],
  )

  /*
   * Places computed over EVERYBODY, not over what the search box happens to show. A place that
   * moved when somebody typed a letter would not be a place.
   *
   * Somebody with no book and nothing collected is left out rather than ranked last. They are not
   * last at anything -- they have not been given anything to be last at -- and their row shows a
   * dash instead.
   */
  const places = useMemo(
    () => standings(lines.filter((l) => l.accounts > 0 || l.line.collected > 0),
      (l) => l.line.collected),
    [lines],
  )

  /** How many are behind their own pace. The number the Needs attention tab used to carry. */
  const behind = useMemo(
    () => lines.filter((l) => l.line.standing === 'behind' || l.line.standing === 'critical').length,
    [lines],
  )

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const matching = needle
      ? lines.filter((l) => l.name.toLowerCase().includes(needle) || l.team.toLowerCase().includes(needle))
      : lines
    /* Rand collected, highest first -- the order the ranking was, now the order of the roster.
       Ties fall back to the name so the list does not reshuffle itself between loads. */
    return [...matching].sort(
      (a, b) => b.line.collected - a.line.collected || a.name.localeCompare(b.name, 'en-ZA'),
    )
  }, [lines, search])

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 pb-2">
        <p className="text-[11px] uppercase tracking-wide text-slate-400">Clerk performance</p>
        <label className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clerks&hellip;"
            className="rounded-lg border border-slate-200 pl-7 pr-2 py-1.5 text-sm w-48 text-slate-700" />
        </label>
      </div>

      {/*
        THE RANKING CARRIES ITS OWN CONTEXT. It said this when it was a tab of its own and it says
        it louder now that the whole roster is ordered this way: the rand is partly the book
        somebody was handed, and the row carries what they were handed so the two can be read
        together.
      */}
      <p className="px-4 pb-2 -mt-1 text-xs text-slate-400 max-w-3xl">
        Ranked on rand collected, with the grade and the size of the book beside it. A senior
        collector is given the bigger accounts, so part of their rand is the book they were handed
        &mdash; read the two together. Payments and the average payment move independently of the
        total, which is why they are here.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
              {/*
                THE FIRM'S OWN ORDER, and it is not the order this table had. Who they are, what
                they were set, what they have done, and only then how that reads as a percentage
                and a status: "number, clerk, team, then target, then today, then period to date,
                then the number of payment, then the average payment, then the achieved, and then
                it can go to gap needed per day status."
              */}
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-2.5 py-2 font-medium whitespace-nowrap">Clerk</th>
              <th className="px-2.5 py-2 font-medium whitespace-nowrap">Team</th>
              <th className="px-2.5 py-2 font-medium text-right">Target</th>
              <th className="px-2.5 py-2 font-medium text-right">Today</th>
              <th className="px-2.5 py-2 font-medium text-right">Period to date</th>
              <th className="px-2.5 py-2 font-medium text-right">Accounts</th>
              <th className="px-2.5 py-2 font-medium text-right">Payments</th>
              <th className="px-2.5 py-2 font-medium text-right">Average payment</th>
              <th className="px-2.5 py-2 font-medium text-right">Achieved</th>
              <th className="px-2.5 py-2 font-medium text-right">Gap vs pace</th>
              <th className="px-2.5 py-2 font-medium text-right">Needed / day</th>
              <th className="px-2.5 py-2 font-medium whitespace-nowrap">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.userId}
                className={`border-b border-slate-50 last:border-0 ${
                  /* Your own row, out of thirty. Nothing louder than a tint: it is a marker, not
                     a status, and colouring it like one would read as something being wrong. */
                  l.userId === me ? 'bg-gold-50' : ''
                }`}>
                <td className="px-3 py-2 tabular-nums font-semibold text-slate-700">
                  {places.get(l.userId)
                    ? places.get(l.userId)?.place
                    : (
                      <span className="font-normal text-slate-300"
                        title="No book and nothing collected, so no place on the ranking.">
                        &mdash;
                      </span>
                    )}
                </td>
                <td className="px-2.5 py-2 whitespace-nowrap">
                  <Link to={`/performance/${l.userId}`}
                    className="flex items-center gap-2 group">
                    <UserAvatar userId={l.userId} size={22} />
                    <span className="min-w-0">
                      <span className="block text-slate-700 group-hover:underline">
                        {l.name}
                        {l.userId === me && <span className="ml-1 text-[10px] text-slate-400">(you)</span>}
                      </span>
                      {/*
                        UNDER THE NAME RATHER THAN IN A COLUMN OF ITS OWN. It has to be on the row
                        -- it is half the firm's answer to "it's not a pissing contest" -- and the
                        table is thirteen columns wide already. A grade is one word and it belongs
                        to the person, not to the figures.
                      */}
                      <span className="block text-[10px] text-slate-400">{l.grade}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-2.5 py-2 text-slate-500 whitespace-nowrap">{l.team}</td>
                <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap text-slate-500">
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
                <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap text-slate-600">
                  {l.today > 0 ? formatCurrency(l.today) : '—'}
                </td>
                <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap font-medium text-slate-800">
                  {formatCurrency(l.line.collected)}
                </td>
                <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap text-slate-600">
                  {l.accounts.toLocaleString('en-ZA')}
                </td>
                <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap text-slate-600">
                  {l.payments.toLocaleString('en-ZA')}
                </td>
                <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap text-slate-600">
                  {/* A dash, not R0. Somebody who took no payments has no average — see clerkLines. */}
                  {l.averagePayment === null ? '—' : formatCurrency(l.averagePayment)}
                </td>
                <td className="px-2.5 py-2 text-right whitespace-nowrap">
                  <span className="inline-flex items-center gap-2 justify-end">
                    <span className="tabular-nums font-medium text-slate-800">{pctText(l.line.achieved)}</span>
                    {/* Narrower than the teams table's. With thirteen columns on the row, thirty
                        pixels of bar is thirty pixels the status pill does not have. */}
                    <ProgressBar achieved={l.line.achieved} width="w-16" />
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
                <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap text-slate-600">
                  {moneyText(l.line.neededADay)}
                </td>
                <td className="px-2.5 py-2 whitespace-nowrap"><StatusPill standing={l.line.standing} /></td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={13} className="px-4 py-6 text-center text-sm text-slate-400">
                  Nobody matches that.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-[11px] text-slate-400">
        Showing {shown.length} of {lines.length} clerks.
        {/*
          WHAT THE NEEDS ATTENTION TAB WAS ACTUALLY FOR. The tab is gone and the number is not:
          how many people are behind is the one thing it told you that a ranked list does not,
          and it was read off the tab rather than out of it. Silent at nought, because a line
          saying "0 are behind their pace" every day is a line people stop seeing.
        */}
        {behind > 0 && (
          <> {behind === 1 ? 'One clerk is' : `${behind} clerks are`} behind their pace.</>
        )}
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
    /*
     * THE THREE NEW COLUMNS GO ON THE END, not into the firm's on-screen order.
     *
     * The table now shows the book, the number of payments and the average payment, and a report
     * of that table that leaves them out is a report somebody has to go back to the screen for.
     * But this file is opened in a spreadsheet that has been kept for months, and moving a column
     * moves every formula pointing at it. Appending costs nothing and breaks nothing.
     */
    const head = [
      'Clerk', 'Team', 'Today', 'Period to date', 'Target', 'Target from',
      'Achieved %', 'Gap vs pace %', 'Still needed', 'Needed per day', 'Status',
      'Grade', 'Accounts', 'Payments', 'Average payment',
    ]
    const body = lines.map((l) => [
      l.name, l.team, l.today, l.line.collected, l.line.target,
      l.origin === 'set' ? 'set' : 'grade',
      l.line.achieved === null ? null : (l.line.achieved * 100).toFixed(1),
      l.line.gap === null ? null : (l.line.gap * 100).toFixed(1),
      l.line.stillNeeded, l.line.neededADay === null ? null : Math.round(l.line.neededADay),
      standingLabel(l.line.standing),
      l.grade, l.accounts, l.payments,
      /* Blank, not 0. Nobody took a payment, so there is no average -- and a 0 in a column a
         spreadsheet averages would drag the floor's figure down with a number that is not one. */
      l.averagePayment === null ? null : Math.round(l.averagePayment),
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
          Ordered by payments per hundred accounts. The table above ranks on rand, which is
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
