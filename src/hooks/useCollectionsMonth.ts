import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { useAuth } from '../store/AuthContext'
import { fetchCollectorPerformance } from '../lib/collectorStats.ts'
import { scoreCollector, totalStats, type CollectorScore, type CollectorStats } from '../lib/collectorScore.ts'
import { monthTargetFor } from '../lib/collectorGrade.ts'
import { getCurrentSalesMonth, getPreviousSalesMonth, type SalesMonthPeriod } from '../lib/salesMonth'
import { resolveTarget } from '../lib/targets'
import {
  dayKey, monthPace, paceLine, previousWorkingDay, teamTotal,
  type MonthPace, type PaceLine, type TeamTotal,
} from '../lib/collectionPace.ts'
import type { HeroFigures } from '../components/collections/CollectionsHero'
import type { ID, Team } from '../types'

/**
 * THE MONTH'S COLLECTIONS FIGURES, WORKED OUT IN ONE PLACE.
 *
 * TWO SCREENS NOW SHOW THE SAME NUMBERS. The company dashboard leads with what the firm has
 * collected — the firm: "the main thing ultimately is how much we've collected, because we work
 * on commission" — and the collections dashboard shows the same month with the floor's tables
 * under it. The firm is explicit that this repetition is wanted: "we can repeat the same
 * figures."
 *
 * REPEATED ON PURPOSE IS NOT THE SAME AS WORKED OUT TWICE. Written out on both pages, the period
 * arithmetic, the working-day pace, the sum of everybody's targets and the comparison with the
 * previous working day would be two implementations of the same eleven decisions — and the
 * failure would not be a wrong screen, it would be the company dashboard and the collections
 * dashboard quietly disagreeing about what the firm collected this month. That is the same
 * reasoning as applyAccountFilters: one builder, both callers.
 *
 * IT OWNS THE CONTROLS TOO, because the period, the as-at day and the team filter are what decide
 * what every figure below them MEANS. A control kept on the page and the arithmetic kept here is
 * how a screen ends up showing one team's list against the whole floor's headline.
 */
export interface ResolvedTarget { target: number | null; origin: 'set' | 'grade' }

export interface CollectionsMonth {
  /* ---- the controls, and what they currently say ---- */
  period: SalesMonthPeriod
  setPeriod: (p: SalesMonthPeriod) => void
  /** The day the report is read as at, always inside the period. */
  asAt: Date
  asAtKey: string | null
  setAsAtKey: (key: string | null) => void
  teamId: string
  setTeamId: (id: string) => void
  /** Teams that actually have somebody collecting, so the filter offers nothing empty. */
  teamOptions: Team[]

  /* ---- what came back ---- */
  /** Null while loading. The rows for the period, before the team filter. */
  rows: CollectorStats[] | null
  error: string | null
  /** Everything below is already through the team filter. */
  shownRows: CollectorStats[]
  shownToday: CollectorStats[]
  score: CollectorScore | null
  priorScore: CollectorScore | null
  /** The signed-in person's own row, unfiltered — their month is theirs whatever the filter says. */
  mine: CollectorStats | null

  /* ---- the month, as the firm reads it ---- */
  pace: MonthPace
  floor: TeamTotal
  line: PaceLine | null
  myLine: PaceLine | null
  collectedToday: number
  targetFor: (userId: ID, collects: boolean) => ResolvedTarget
  teamOf: (userId: ID) => string

  /** The four figures the hero is drawn from, assembled once. */
  figures: HeroFigures
  /** What to call the day being read, for anything else that needs to say it. */
  asAtLabel: string
}

export function useCollectionsMonth(): CollectionsMonth {
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
   * The month in WORK DAYS, as at the day being read. Every percentage is read against it: ten
   * per cent collected is exactly on pace on the second working day and a crisis on the
   * eighteenth, and without this a screen cannot tell the two apart.
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
  const myLine = mine ? paceLine(mine.collected, myTarget, pace) : null

  /** Teams that actually have somebody collecting, so the filter offers nothing empty. */
  const teamOptions = useMemo(() => {
    const present = new Set((rows ?? []).map((r) => teamOf(r.userId)))
    return teams.filter((t) => present.has(t.id))
  }, [rows, teams, teamOf])

  const asAtLabel = isToday(asAt) ? 'Collected today' : `Collected on ${shortDay(asAt)}`

  const figures: HeroFigures = {
    today: collectedToday,
    todayLabel: asAtLabel,
    /* Null rather than a fabricated percentage where the day before brought in nothing — every
       increase on nought is infinite, and "+100%" would be the screen inventing one. */
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
  }

  return {
    period, setPeriod, asAt, asAtKey, setAsAtKey, teamId, setTeamId, teamOptions,
    rows, error, shownRows, shownToday, score, priorScore, mine,
    pace, floor, line, myLine, collectedToday, targetFor, teamOf,
    figures, asAtLabel,
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/* Written out rather than through Intl: en-ZA renders September as "Sept", which is neither the
   full month nor a normal abbreviation, and this codebase has been bitten by it before. */
const shortDay = (d: Date): string => `${d.getDate()} ${MONTHS[d.getMonth()]}`
const isToday = (d: Date): boolean => dayKey(d) === dayKey(new Date())
