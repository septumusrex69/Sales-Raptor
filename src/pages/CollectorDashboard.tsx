import { DashboardPanes } from '../components/dashboard/DashboardPanes'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { saveFile } from '../lib/fileSave'
import { Link } from 'react-router-dom'
import { AlertTriangle, Download, Loader2, Search } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { StatTile } from '../components/ui/StatTile'
import { UserAvatar } from '../components/ui/Avatar'
import { useAppStore } from '../store/AppStore'
import { useAuth } from '../store/AuthContext'
import {
  THRESHOLDS, band, overBookBy, scoreCollector, totalStats,
  type Band, type CollectorScore, type CollectorStats,
} from '../lib/collectorScore.ts'
import { bookCeilingOf } from '../lib/collectorGrade.ts'
import type { SalesMonthPeriod } from '../lib/salesMonth'
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
import { lateForLeaders, lateSummary } from '../lib/newAccounts.ts'
import { todayIso } from '../lib/diaryPriority.ts'
import { LATE_NEW_ACCOUNTS_PATH } from '../lib/accountFilters.ts'
import { clockNow } from '../lib/clock.ts'

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
    period, asAt, teamId, rows, error,
    shownRows, shownToday, score, mine, mineToday,
    pace, floor, line, myLine, targetFor, teamOf, measured,
  } = month

  const myPlace = useMemo(
    () => standings(
      shownRows.filter((r) => r.inPlayAccounts > 0 || r.collected > 0),
      (r) => r.collected,
    ).get(currentUser?.id ?? ''),
    [shownRows, currentUser],
  )

  const mayLeadHere = canLeadCollections(currentUser)

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
  /*
   * THE FLOOR'S, AS ONE WARNING -- and only for whoever leads collections (canLeadCollections: the
   * team leaders and the call centre manager), as the list it replaced was. Stephan, 29 Oct: "I
   * think this should live within the team leader space and also within the call center manager.
   * But making a long ... list like that is stupid."
   *
   * THE WHOLE FLOOR, the leader's own included. The list left the leader's own row out because
   * their name twice would have them chasing themselves; a count is not a name, and a count that
   * quietly left some accounts out would disagree with the list its link opens -- which is built
   * from the same entries by the same function (lateSummary / lateAccountIds).
   */
  const floorLate = useMemo(
    () => (mayLeadHere && carried ? lateSummary(carried, todayIso()) : null),
    [carried, mayLeadHere],
  )

  const ceiling = bookCeilingOf(currentUser?.bookCeiling)
  const over = mine ? overBookBy(mine, ceiling) : 0

  /*
   * ---------- THE THREE LEVELS ----------
   *
   * The firm, of every department: "their own statistics is important, their team statistics is
   * important, and their department statistics is important for them to see."
   *
   * SO THE SCREEN IS READ DOWNWARDS, DEPARTMENT FIRST. It used to open with the floor's totals
   * and then mix the person in among them -- the measures card and the four tiles under it are
   * the FLOOR's, drawn in the same shape a collector reads as their own, and nothing on the page
   * said which was which. Three named levels cost nothing and answer that question before it is
   * asked.
   *
   * COMPUTED HERE, NOT IN THE SHARED HOOK. useCollectionsMonth holds what both dashboards read --
   * the period, the pace, the floor's total -- and a team's line and a person's are this screen's
   * alone. Same lib functions either way, so nothing is a second implementation of anything.
   */
  const myTeamId = currentUser?.teamId ?? ''
  const myTeam = teams.find((t) => t.id === myTeamId) ?? null

  /* Everybody on my team, out of the WHOLE floor rather than the filtered view: my team is my
     team whatever the picker above is set to, and a leader inspecting another team should not
     see their own section change under them. */
  const teamRows = useMemo(
    () => (myTeamId ? (rows ?? []).filter((r) => teamOf(r.userId) === myTeamId) : []),
    [rows, myTeamId, teamOf],
  )
  const teamStats = teamRows.length > 0 ? totalStats(teamRows) : null
  const teamTargets = useMemo(
    () => teamTotal(teamRows.map((r) => ({
      collected: r.collected,
      target: targetFor(r.userId, r.inPlayAccounts > 0 || r.collected > 0).target,
    }))),
    [teamRows, targetFor],
  )
  const teamLine = teamStats ? paceLine(teamStats.collected, teamTargets.target, pace) : null

  /*
   * WHERE MY TEAM SITS AMONG THE TEAMS, on rand collected -- the same figure the teams table is
   * ordered on. Collectors with no team are left out rather than counted as a team: "No team" is
   * a gap in the records, and ranking it against Team Alpha would put a filing mistake on the
   * board as a competitor.
   */
  const teamPlace = useMemo(() => {
    const totals = new Map<string, number>()
    for (const r of rows ?? []) {
      const id = teamOf(r.userId)
      if (!id) continue
      totals.set(id, (totals.get(id) ?? 0) + r.collected)
    }
    const lines = [...totals].map(([userId, collected]) => ({ userId, collected }))
    return standings(lines, (t) => t.collected).get(myTeamId)
  }, [rows, teamOf, myTeamId])

  /* My team, ranked on rand like the floor is -- and my own row marked, because a list of eight
     names is one a person reads looking for themselves. */
  const teamPeople = useMemo(() => teamRows
    .map((r) => ({
      row: r,
      name: users.find((u) => u.id === r.userId)?.name ?? 'Somebody',
      line: paceLine(r.collected, targetFor(r.userId, r.inPlayAccounts > 0 || r.collected > 0).target, pace),
    }))
    .sort((a, b) => b.row.collected - a.row.collected || a.name.localeCompare(b.name, 'en-ZA')),
    [teamRows, users, targetFor, pace])

  /* My own month, scored the same way the floor's is. scoreCollector is the one place the derived
     measures are worked out, so mine and the floor's cannot be computed differently. */
  const myScore = mine ? scoreCollector(mine) : null

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

        TWO AUDIENCES, ONE PANEL. A collector is told about their own and sent to their diary; a
        team leader is told about the floor's as ONE LINE and sent to the accounts. It was a list
        of every collector carrying any -- fifteen lines on the staging floor -- and Stephan, 29 Oct:
        "making a long ... list like that is stupid. Maybe you can just show a warning and say,
        okay, you know, these accounts are not being worked. Click on them and it's filtered in the
        account section." Who is behind is one click further, on a list that can reallocate them.

        AND NOTHING AT ALL WHEN THERE IS NOTHING. CLAUDE.md: a warning that fires when nothing is
        wrong is worse than no warning, because people stop reading it.
      */}
      {(mineLate || floorLate) && (
        <Card className="border-amber-200 bg-amber-50/60">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-700" />
            <div className="min-w-0 space-y-1.5">
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
              {floorLate && (
                <p data-testid="late-new-accounts" className="text-sm text-amber-900">
                  <span className="font-semibold">
                    {floorLate.accounts === 1
                      ? '1 new account not yet worked'
                      : `${floorLate.accounts.toLocaleString('en-ZA')} new accounts not yet worked`}
                  </span>
                  {floorLate.collectors === 1 ? ', on one collector' : `, across ${floorLate.collectors} collectors`}
                  {' — '}
                  {floorLate.worst === 1 ? 'carried since yesterday.' : `the oldest ${floorLate.worst} working days.`}{' '}
                  <Link to={LATE_NEW_ACCOUNTS_PATH} data-testid="late-new-accounts-link"
                    className="ml-1 whitespace-nowrap font-medium underline underline-offset-2 hover:text-amber-700">
                    Show them &rarr;
                  </Link>
                </p>
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
            THE THREE LEVELS -- the floor, your team, you -- and then the detail, in the order and for
            the reasons the firm gave ("their own statistics is important, their team statistics is
            important, and their department statistics is important"). Why each level is where it is
            is said where the levels are drawn (Level, below).

            IN THE THREE ARRANGEMENTS (S9, 20 Oct), like every department dashboard. Each level's
            heading is a row across the page, so a level is arranged on its own and never borrows a
            column from the next: in Wide the floor's fair measures sit beside its counts, the team's
            summary beside its ranked list, your summary beside your activity. The four figures and
            the month bar stay across the page in all three.

            THE TEAM ONLY WHERE THERE IS ONE, AND IT DOES NOT FOLLOW THE TEAM PICKER: the call centre
            manager leads every team and belongs to none, and a leader looking at another team must
            not find their own section describing somebody else's people.
          */}
          <DashboardPanes layoutKey="raptor.dashboard.collections.layout" panes={[
            /* ============================ 1. THE DEPARTMENT ============================ */
            { id: 'level-floor', kind: 'full', node: (
              <Level title="The floor" why={teamId
              ? `${teams.find((t) => t.id === teamId)?.name ?? 'One team'}, ${period.label}`
              : `Every collector, ${period.label}`} />
            ) },
            /* THE SAME FOUR FIGURES THE COMPANY DASHBOARD LEADS WITH ("we can repeat the same figures"),
               off the same hook (useCollectionsMonth), so the two screens cannot drift. */
            /* THE SAME FOUR FIGURES THE COMPANY DASHBOARD LEADS WITH ("we can repeat the same figures"),
               off the same hook (useCollectionsMonth), so the two screens cannot drift. */
            { id: 'floor-figures', kind: 'full', node: (
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
            ) },
            /* THE MONTH BAR: the company dashboard's own element in its light colours -- one answer to
               "how far through the month are we". */
            /* THE MONTH BAR: the company dashboard's own element in its light colours -- one answer to
               "how far through the month are we". */
            { id: 'floor-progress', kind: 'full', node: (
              <MonthProgress pace={pace} line={line} measured={measured}
              note={floor.withTarget < floor.members
                ? `${floor.members - floor.withTarget} of ${floor.members} have no target, so the total is short by their share.`
                : undefined} />
            ) },
            /* The fair measures, THE FLOOR'S and labelled so; the same four appear under "You" with the
               person's own figures in them.

               THE AVERAGE PAYMENT AND THE BOOK'S VALUE RIDE UNDER THEM. They were two of eight tiles
               squeezed into the right-hand third, where "R 6 000 000" ran out of its box and the
               payments tile wrapped "208% vs October 2026" down four lines. Payments and Accounts
               went with the tiles because they are already here -- in "37 from 1 200 accounts"
               under Payments per 100 -- and the same figure twice in one card is a figure somebody
               checks twice. These two are said nowhere else on the floor, so they stay. */
            { id: 'floor-measures', kind: 'wide', node: (
              <Measures score={score} caption="Across the whole floor. These compare fairly over
              unlike books; rand collected does not — it measures the book as much as the collector."
              footer={(
                <div className="flex flex-wrap gap-x-8 gap-y-2 border-t border-slate-100 px-4 py-2.5">
                  <Fact label="Average payment"
                    value={score.averagePayment === null ? '—' : formatCurrency(score.averagePayment)} />
                  <Fact label="Book value" value={formatCurrency(score.inPlayValue)} />
                </div>
              )} />
            ) },
            /* ACTIONS, ONE CARD. Stephan, 29 Oct, of the eight tiles that were here: "that just looks
               weird there. Calls, SMSs, notes written, you know, actions, you can put actions there
               or something like that ... how many actions we make in a day, in a month". */
            { id: 'floor-actions', node: (
              <ActionsCard testId="floor-actions" title="Actions on the floor"
                day={totalStats(shownToday)} period={score}
                dayLabel={dayLabelOf(asAt)} periodLabel={period.label} />
            ) },
            /* ============================== 2. YOUR TEAM ============================== */
            !!(myTeam && teamStats && teamLine) && { id: 'level-team', kind: 'full', node: (
              <Level title={`Your team — ${myTeam!.name}`}
              /* The place is only said where there is something to be placed against: "1st of
                 1" on a floor with one team is not a standing, it is arithmetic about nothing. */
              why={`${teamPeople.length === 1 ? '1 collector' : `${teamPeople.length} collectors`}${
                teamPlace && teamPlace.outOf > 1
                  ? ` · ${placeLabel(teamPlace)} on rand collected` : ''}`} />
            ) },
            !!(myTeam && teamStats && teamLine) && { id: 'team-summary', kind: 'wide', node: (
              <Card padded={false}>
                <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3">
                  <Fact label="Collected" value={formatCurrency(teamStats.collected)} />
                  <Fact label="Target" value={moneyText(teamTargets.target)} />
                  <Fact label="Of target" value={pctText(teamLine.achieved)} />
                  <Fact label="Gap vs pace" value={gapText(teamLine.gap)} />
                  <Fact label="Needed a day" value={moneyText(teamLine.neededADay)} />
                  {teamLine.target !== null && <StatusPill standing={teamLine.standing} />}
                </div>
                {/*
                  Said where the total is read rather than in a footnote: a team target is the sum
                  of the people's own, so one person without a target makes the whole line short by
                  their share — and a leader comparing two teams has no way to see that otherwise.
                */}
                {teamTargets.withTarget < teamTargets.members && (
                  <p className="px-4 pb-3 -mt-1 text-xs text-amber-700">
                    {teamTargets.members - teamTargets.withTarget} of {teamTargets.members} have no
                    target set, so the team's is short by their share.
                  </p>
                )}
              </Card>
            ) },
            !!(myTeam && teamStats && teamLine) && { id: 'team-list', node: (
              <Card padded={false}>
                <ul className="divide-y divide-slate-100">
                  {teamPeople.map(({ row, name, line: theirs }, i) => (
                    <li key={row.userId}
                      className={`flex items-center gap-x-4 px-4 py-1.5 text-[12.5px] whitespace-nowrap ${
                        row.userId === currentUser?.id ? 'bg-amber-50/50' : 'hover:bg-slate-50'}`}>
                      <span className="w-5 shrink-0 tabular-nums text-slate-400">{i + 1}</span>
                      <Link to={`/performance/${row.userId}`}
                        className="min-w-[10rem] max-w-[16rem] truncate font-medium text-slate-800 hover:underline" title={name}>
                        {name}
                        {row.userId === currentUser?.id && (
                          <span className="ml-1.5 text-[11px] font-normal text-slate-400">(you)</span>
                        )}
                      </Link>
                      <span className="tabular-nums text-slate-700">{formatCurrency(row.collected)}</span>
                      <span className="tabular-nums text-slate-500">{pctText(theirs.achieved)}</span>
                      <ProgressBar achieved={theirs.achieved} />
                      <span className="ml-auto"><StatusPill standing={theirs.standing} /></span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) },
            /* ================================= 3. YOU ================================= */
            /* THE PERSON READING IT, with their own measures: "they should see their own thing, but they
               should also be able to see the entire company's performance". */
            /* THE PERSON READING IT, with their own measures: "they should see their own thing, but they
               should also be able to see the entire company's performance". */
            !!(mine && myLine && myScore) && { id: 'level-you', kind: 'full', node: (
              <Level title="You" why={`Your own month · ${period.label}`} />
            ) },
            !!(mine && myLine && myScore) && { id: 'you-summary', kind: 'wide', node: (
              <Card padded={false}>
                <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3">
                  <Fact label="Collected" value={formatCurrency(mine.collected)} />
                  <Fact label="Of target" value={pctText(myLine.achieved)} />
                  <Fact label="Gap vs pace" value={gapText(myLine.gap)} />
                  <Fact label="Needed a day" value={moneyText(myLine.neededADay)} />
                  <Fact label="Payments" value={mine.payments.toLocaleString('en-ZA')} />
                  <Fact label="On the floor" value={placeLabel(myPlace)} />
                  {myLine.target !== null && <StatusPill standing={myLine.standing} />}
                  <Link to={`/performance/${mine.userId}`}
                    className="ml-auto text-xs font-medium text-brand-600 hover:underline">
                    My twelve months &rarr;
                  </Link>
                </div>
              </Card>
            ) },
            !!(mine && myLine && myScore) && { id: 'you-measures', kind: 'wide', node: (
              <Measures score={myScore} caption="Yours, on the same four measures the floor is read
              on above — so the comparison is like for like rather than two different sums." />
            ) },
            /* The same card as the floor's, with the person's own day and month in it. */
            !!(mine && myLine && myScore) && { id: 'you-activity', node: (
              <ActionsCard testId="you-actions" title="Your actions"
                day={mineToday ?? totalStats([])} period={myScore}
                dayLabel={dayLabelOf(asAt)} periodLabel={period.label} />
            ) },
            /* A leader or a manager with no book of their own: said once, plainly. */
            !(mine && myLine && myScore) && { id: 'no-book-of-your-own', kind: 'full', node: (
              <p className="px-1 text-xs text-slate-400">
                You have no accounts of your own this period, so there is no personal level to show.
              </p>
            ) },
            /* ========================= THE FLOOR, IN DETAIL: reference, so last ========================= */
            shownRows.length > 0 && { id: 'level-detail', kind: 'full', node: (
              <Level title="The floor, in detail" why="Every team and every collector, ranked" />
            ) },
            shownRows.length > 0 && { id: 'team-table', kind: 'wide', node: (
              <TeamTable rows={shownRows} users={users} teams={teams} targets={targets}
              periodKey={period.key} pace={pace} targetFor={targetFor} />
            ) },
            shownRows.length > 0 && { id: 'clerk-table', kind: 'wide', node: (
              <CollectorTable rows={shownRows} today={shownToday} users={users} teams={teams}
              pace={pace} targetFor={targetFor} me={currentUser?.id ?? null} />
            ) },
          ]} />
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
/* The day the report is read as at, as the Actions card heads its column: "Today" when it is,
   the date when somebody has moved the as-at back -- a column called Today holding Friday's
   calls would be the card lying about which day it is. */
const dayLabelOf = (d: Date): string => (dayKey(d) === dayKey(clockNow()) ? 'Today' : shortDay(d))

/**
 * ACTIONS, IN A DAY AND IN THE PERIOD -- one card where there were eight tiles.
 *
 * Stephan, 29 Oct, looking at Calls, Emails, SMS and Notes written squeezed into a column beside
 * "How the work is going": "that just looks weird there ... actions, you can put actions there or
 * something like that ... how many actions we make in a day, in a month". So it is a small table,
 * the four kinds down and the day and the period across, with the total under them.
 *
 * NO ARITHMETIC OF ITS OWN. The day is the same collector_performance read as the period, for the
 * day being read (useCollectionsMonth's shownToday); the total is scoreCollector's `actions`, the
 * figure the collectors table carries per person, so the floor's total and the rows under it are
 * one sum. A Card rather than tiles because it is read as a table: the eye goes along a row.
 */
function ActionsCard({ testId, title, day, period, dayLabel, periodLabel }: {
  testId: string
  title: string
  day: CollectorStats
  period: CollectorStats
  dayLabel: string
  periodLabel: string
}) {
  const dayScore = scoreCollector(day)
  const periodScore = scoreCollector(period)
  const lines: { label: string; day: number; period: number; hint?: string }[] = [
    { label: 'Calls', day: day.calls, period: period.calls },
    { label: 'Emails', day: day.emailsSent, period: period.emailsSent },
    { label: 'SMS', day: day.smsSent, period: period.smsSent },
    { label: 'Notes written', day: day.notesWritten, period: period.notesWritten,
      hint: 'Work somebody typed. Notes Raptor composes itself are not counted.' },
  ]
  const n = (v: number) => v.toLocaleString('en-ZA')
  return (
    <div data-testid={testId}><Card padded={false}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-slate-400">
            <th className="px-4 pt-3 pb-1.5 text-left font-medium">{title}</th>
            <th className="px-3 pt-3 pb-1.5 text-right font-medium whitespace-nowrap">{dayLabel}</th>
            <th className="px-4 pt-3 pb-1.5 text-right font-medium whitespace-nowrap" title={periodLabel}>
              This period
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.label} className="border-t border-slate-50" title={l.hint}>
              <td className="px-4 py-1.5 text-slate-600">{l.label}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{n(l.day)}</td>
              <td className="px-4 py-1.5 text-right tabular-nums text-slate-700">{n(l.period)}</td>
            </tr>
          ))}
          <tr className="border-t border-slate-200">
            <td className="px-4 py-2 font-medium text-slate-800">All actions</td>
            <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">{n(dayScore.actions)}</td>
            <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-800">{n(periodScore.actions)}</td>
          </tr>
        </tbody>
      </table>
    </Card></div>
  )
}

const STANDING_STYLE: Record<PaceStanding, string> = {
  met: 'bg-emerald-100 text-emerald-800',
  'on-track': 'bg-emerald-50 text-emerald-700',
  behind: 'bg-amber-50 text-amber-800',
  critical: 'bg-rose-50 text-rose-700',
  'no-target': 'bg-slate-100 text-slate-500',
}

/**
 * THE HEADING ON ONE OF THE THREE LEVELS.
 *
 * The firm asked for a department's figures, a team's and a person's on one screen, and the thing
 * that makes that readable is not the figures — it is saying whose each block is. This screen
 * already drew the FLOOR's promise-kept rate in exactly the shape a collector reads as their own,
 * and a person cannot tell those apart by looking harder.
 *
 * Deliberately plainer than a Card: a heading over a group, not another box around it. Three more
 * boxes on a screen that already has eleven would make the levels harder to see, not easier.
 */
function Level({ title, why }: { title: string; why: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-3">
      <h2 className="text-base font-bold text-slate-800">{title}</h2>
      <p className="text-xs text-slate-400">{why}</p>
    </div>
  )
}

/**
 * The four figures that compare fairly across unlike books, drawn for whoever they are about.
 *
 * ONE COMPONENT, TWO LEVELS. The floor's copy and the person's are the same four measures on the
 * same thresholds; written out twice they would eventually be two different definitions of
 * "promises kept" on one screen, which is the failure this codebase keeps meeting in other
 * shapes. The caption is what says whose they are.
 */
function Measures({ score, caption, footer }: {
  score: CollectorScore
  caption: string
  /** Anything said about the same level that is not one of the four, under them. */
  footer?: ReactNode
}) {
  return (
    <Card padded={false}>
      <p className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-slate-400">
        How the work is going
        <span className="block normal-case tracking-normal text-slate-400 text-xs mt-0.5">
          {caption}
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
      {footer}
    </Card>
  )
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
  /** The fair measures, scoreCollector's -- the one place they are worked out. */
  score: CollectorScore
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
      score: scoreCollector(r),
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
 * Every collector, ranked, in ONE table.
 *
 * TWO TABLES BECAME ONE (29 Oct). There was a clerk sheet (ranked on rand, target, pace) and under
 * it "How people compare" (payments per hundred, promises kept, book reached, actions). Stephan:
 * "it's the same information ... we can have like one there, like put the top collector at the top
 * who's collected the most for the month already, amount of payments, you know, the average
 * payment, and just have one part of that. It's not necessary to have all of them." So: ranked on
 * collected, top collector first, with the payments and the average beside the rand, and the fair
 * figures that survive being handed a different book on the same row -- payments per hundred,
 * promises kept and actions; "book reached" stays in the floor's measures card, because a
 * fourteenth column put the table behind a sideways scrollbar at 1440 and Stephan's own words were
 * "it's not necessary to have all of them". Gap vs pace and needed a
 * day left the screen (the status pill says which side of the line somebody is; the export still
 * carries both), and so did "today", which the floor's own figures lead with.
 *
 * AND IT WAS THREE TABS BEFORE IT WAS TWO TABLES -- All clerks, Needs attention, Ranking -- folded
 * by the firm: "remove the ranking page, remove the needs attention page and put everything at the
 * all clerks page." Needs attention survives as the count in the footer.
 *
 * RANKED, WITH THE GRADE AND THE BOOK ON THE ROW. The firm asked for the ranking -- "I like the
 * idea of actually ranking them in terms of how much rand they've collected" -- and answered the
 * obvious objection in the same breath: "so the people know that if they're senior collectors
 * they get more work, it's not a pissing contest." That answer only holds while the grade and the
 * number of accounts are on the row beside the rand, so they stay: the grade beside the name, the
 * book in its own column -- and payments per hundred on the same row, because it is the figure
 * that answers the objection in numbers.
 *
 * Places are shared by ties, the way a results board does -- see `standings`. The figures are
 * clerkLines' and scoreCollector's; nothing here is worked out twice.
 */
function CollectorTable({ rows, today, users, teams, pace, targetFor, me }: {
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
    /* Collected, highest first -- "put the top collector at the top who's collected the most for
       the month already". Ties fall back to the name so the list does not reshuffle between loads. */
    return [...matching].sort(
      (a, b) => b.line.collected - a.line.collected || a.name.localeCompare(b.name, 'en-ZA'),
    )
  }, [lines, search])

  const pctOf = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
  const num = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap'

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 pb-2">
        <p className="text-[11px] uppercase tracking-wide text-slate-400">Collectors</p>
        <label className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search collectors&hellip;"
            className="rounded-lg border border-slate-200 pl-7 pr-2 py-1.5 text-sm w-48 text-slate-700" />
        </label>
      </div>

      {/*
        THE RANKING CARRIES ITS OWN CONTEXT: the rand is partly the book somebody was handed, and
        the row carries what they were handed so the two can be read together.
      */}
      <p className="px-4 pb-2 -mt-1 text-xs text-slate-400 max-w-4xl">
        Ranked on rand collected, the month the firm is run on, with the grade and the size of the
        book beside it. A senior
        collector is given the bigger accounts, so part of their rand is the book they were handed
        &mdash; read the two together. Payments per 100 accounts and promises kept
        survive being given a different book; they are the figures that should decide who is promoted.
      </p>

      <div className="overflow-x-auto">
        <table data-testid="collector-table" className="w-full list-table whitespace-nowrap">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-100">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">Collector</th>
              <th className="px-2 py-2 font-medium">Team</th>
              <th className="px-2 py-2 font-medium text-right">Collected</th>
              <th className="px-2 py-2 font-medium text-right">Target</th>
              <th className="px-2 py-2 font-medium text-right">Achieved</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-2 py-2 font-medium text-right">Payments</th>
              {/* "Average", with the full name on hover: the header was wider than any figure under
                  it, and fifty pixels here is what keeps the row off a sideways scrollbar. */}
              <th className="px-2 py-2 font-medium text-right" title="Average payment">Average</th>
              <th className="px-2 py-2 font-medium text-right" title="Accounts in play on their desk">Book</th>
              <th className="px-2 py-2 font-medium text-right" title="Payments per hundred accounts on the book">Per 100</th>
              <th className="px-2 py-2 font-medium text-right" title="Promises kept, of those that have come due">Kept</th>
              <th className="px-3 py-2 font-medium text-right" title="Calls, emails, SMS and notes written">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.userId}
                className={`border-b border-slate-50 last:border-0 hover:bg-slate-50 ${
                  /* Your own row, out of thirty. Nothing louder than a tint: it is a marker, not
                     a status, and colouring it like one would read as something being wrong. */
                  l.userId === me ? 'bg-gold-50' : ''
                }`}>
                <td className="px-3 py-1.5 tabular-nums font-semibold text-slate-700">
                  {places.get(l.userId)
                    ? places.get(l.userId)?.place
                    : (
                      <span className="font-normal text-slate-300"
                        title="No book and nothing collected, so no place on the ranking.">
                        &mdash;
                      </span>
                    )}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <Link to={`/performance/${l.userId}`}
                    className="flex items-center gap-2 group">
                    <UserAvatar userId={l.userId} size={18} />
                    <span className="min-w-0 max-w-[12rem] truncate" title={`${l.name} · ${l.grade}`}>
                      <span className="text-slate-700 group-hover:underline">{l.name}</span>
                      {l.userId === me && <span className="ml-1 text-[10px] text-slate-400">(you)</span>}
                      {/* BESIDE THE NAME, in grey: one word that belongs to the person, and half the
                          firm's answer to "it's not a pissing contest". One thin line a row. */}
                      <span className="text-slate-400"> &middot; {l.grade}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap max-w-[9rem] truncate" title={l.team}>{l.team}</td>
                <td className={`${num} font-medium text-slate-800`}>{formatCurrency(l.line.collected)}</td>
                <td className={`${num} text-slate-500`}>
                  {moneyText(l.line.target)}
                  {/*
                    WHERE THE FIGURE CAME FROM. A team leader looking at thirty targets has to be
                    able to tell the ones somebody chose from the ones the grade supplied.
                  */}
                  {l.line.target !== null && l.origin === 'grade' && (
                    <span className="ml-1 text-[10px] text-slate-400">from grade</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">
                  <span className="inline-flex items-center gap-2 justify-end">
                    <span className="tabular-nums font-medium text-slate-800">{pctText(l.line.achieved)}</span>
                    <ProgressBar achieved={l.line.achieved} width="w-12" />
                  </span>
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap"><StatusPill standing={l.line.standing} /></td>
                <td className={`${num} text-slate-600`}>{l.payments.toLocaleString('en-ZA')}</td>
                <td className={`${num} text-slate-600`}>
                  {/* A dash, not R0. Somebody who took no payments has no average — see clerkLines. */}
                  {l.averagePayment === null ? '—' : formatCurrency(l.averagePayment)}
                </td>
                <td className={`${num} text-slate-600`}>{l.accounts.toLocaleString('en-ZA')}</td>
                <td className={`${num} font-medium text-slate-800`}>
                  {l.score.paymentsPerHundred === null ? '—' : l.score.paymentsPerHundred.toFixed(1)}
                </td>
                <td className={`${num} text-slate-600`}>{pctOf(l.score.promiseKeptRate)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap text-slate-600">
                  {l.score.actions.toLocaleString('en-ZA')}
                </td>
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
        Showing {shown.length} of {lines.length} collectors.
        {/*
          WHAT THE NEEDS ATTENTION TAB WAS ACTUALLY FOR: how many people are behind. Silent at
          nought, because a line saying "0 are behind their pace" every day is one people stop seeing.
        */}
        {behind > 0 && (
          <> {behind === 1 ? 'One collector is' : `${behind} collectors are`} behind their pace.</>
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
    /* Saved, not drawn over the page, on an iPad too (fileSave.ts). */
    void saveFile(blob, `collections-${dayKey(asAt)}.csv`)
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
        <table className="w-full list-table whitespace-nowrap">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-100">
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
              <tr key={teamId || 'none'} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-1.5 text-slate-700">
                  {name}
                  {fromMembers && total.withTarget > 0 && total.withTarget < total.members && (
                    <span className="ml-1.5 text-[11px] text-amber-700">
                      &middot; Target from {total.withTarget} of {total.members}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{total.members}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{moneyText(line.target)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{formatCurrency(line.collected)}</td>
                <td className="px-3 py-1.5 text-right">
                  <span className="inline-flex items-center gap-2 justify-end">
                    <span className="tabular-nums font-medium text-slate-800">{pctText(line.achieved)}</span>
                    <ProgressBar achieved={line.achieved} />
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{moneyText(line.stillNeeded)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{moneyText(line.neededADay)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{moneyText(line.neededAWeek)}</td>
                <td className="px-3 py-1.5"><StatusPill standing={line.standing} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
