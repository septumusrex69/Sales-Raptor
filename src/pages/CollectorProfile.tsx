import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Card } from '../components/ui/Card'
import { UserAvatar } from '../components/ui/Avatar'
import { SalesMonthPicker } from '../components/ui/SalesMonthPicker'
import { useAppStore } from '../store/AppStore'
import { useAuth } from '../store/AuthContext'
import { fetchCollectorDaily, fetchCollectorPerformance, type DailyTake } from '../lib/collectorStats.ts'
import {
  THRESHOLDS, band, scoreCollector, type Band, type CollectorStats,
} from '../lib/collectorScore.ts'
import { bookCeilingOf, monthTargetFor } from '../lib/collectorGrade.ts'
import {
  bucketByMonth, placeLabel, standings, trendAgainstAverage, type MonthTake,
} from '../lib/collectorTrend.ts'
import { monthPace, paceLine, standingLabel } from '../lib/collectionPace.ts'
import {
  getCurrentSalesMonth, listRecentSalesMonths, type SalesMonthPeriod,
} from '../lib/salesMonth'
import { resolveTarget } from '../lib/targets'
import { formatCurrency } from '../data/mockData'

const MONTHS_SHOWN = 12

/**
 * One collector's own page.
 *
 * WHAT THE FIRM ASKED FOR, and the reasoning is theirs: "each one should see their own thing, but
 * they should also be able to see the entire company's performance, and where they stand relative
 * to everybody else." So this page is not gated by role — an agent may open anybody's, the same
 * way the floor list is open to everybody. That is the firm's call about their own staff and they
 * gave the reason with it.
 *
 * IT RANKS ON RAND, AND SAYS WHAT RAND MEASURES. The firm asked for the ranking directly — "I
 * like the idea of actually ranking them in terms of how much rand they've collected" — and
 * answered the obvious objection themselves: "so the people know that if they're senior collectors
 * they get more work, it's not a pissing contest." That answer only works if the context is on
 * the screen beside the place, so the grade and the size of the book are never more than a line
 * away from the rand. A place on its own would be the pissing contest they are trying to avoid.
 *
 * Three places, not one, for the same reason: rand, how many people paid, and what the average
 * payment was. Those move independently and a collector who is third on rand and first on
 * payments is being told something useful about their own month.
 */
export function CollectorProfile() {
  const { userId = '' } = useParams()
  const { users, teams, targets } = useAppStore()
  const { currentUser } = useAuth()
  const [period, setPeriod] = useState<SalesMonthPeriod>(() => getCurrentSalesMonth(new Date()))
  const [floor, setFloor] = useState<CollectorStats[] | null>(null)
  const [daily, setDaily] = useState<DailyTake[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const person = users.find((u) => u.id === userId)
  const isMe = currentUser?.id === userId

  /* The twelve months behind this one, oldest first — the x-axis of the chart. */
  const months = useMemo(
    () => listRecentSalesMonths(period.end, MONTHS_SHOWN),
    [period],
  )

  useEffect(() => {
    let cancelled = false
    setFloor(null); setDaily(null); setError(null)
    void Promise.all([
      /* The whole floor, because a place needs everybody to be a place at all. */
      fetchCollectorPerformance(period.start, period.end),
      /* A year of days in one round trip; the bucketing into the firm's months happens here. */
      fetchCollectorDaily(userId, months[0].start, period.end),
    ])
      .then(([all, days]) => {
        if (cancelled) return
        setFloor(all); setDaily(days)
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [userId, period, months])

  const stats = floor?.find((r) => r.userId === userId) ?? null
  const score = stats ? scoreCollector(stats) : null

  const pace = useMemo(() => monthPace(period.start, period.end, new Date()), [period])
  const target = useMemo(() => monthTargetFor({
    set: resolveTarget(targets, 'user', userId, 'collected', period.key)?.targetValue ?? null,
    grade: person?.collectorGrade ?? null,
    collects: (stats?.inPlayAccounts ?? 0) > 0 || (stats?.collected ?? 0) > 0,
  }), [targets, userId, period.key, person, stats])
  const line = stats ? paceLine(stats.collected, target.target, pace) : null

  /*
   * THREE SEPARATE RANKINGS, computed over everybody who worked a book this month. Somebody with
   * no book at all is not "last" — they are not in the race, and including them would pad every
   * denominator with people who were never running.
   */
  const running = useMemo(
    () => (floor ?? []).filter((r) => r.inPlayAccounts > 0 || r.collected > 0),
    [floor],
  )
  const byRand = useMemo(() => standings(running, (r) => r.collected), [running])
  const byPayments = useMemo(() => standings(running, (r) => r.payments), [running])
  const byAverage = useMemo(
    () => standings(running, (r) => (r.payments > 0 ? r.collected / r.payments : 0)),
    [running],
  )

  const trend = useMemo<MonthTake[]>(
    () => (daily ? bucketByMonth(daily, months) : []),
    [daily, months],
  )
  const against = trendAgainstAverage(trend)

  if (!person) {
    return (
      <Card>
        <p className="text-sm text-slate-600">That collector is not on the system.</p>
        <Link to="/performance" className="text-xs text-brand-600 hover:underline">
          Back to Collections
        </Link>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link to="/performance"
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500 mt-0.5">
            <ArrowLeft size={16} />
          </Link>
          <UserAvatar userId={person.id} size={40} />
          <div>
            <h1 className="text-lg font-semibold text-slate-800">
              {isMe ? 'My collections' : person.name}
            </h1>
            <p className="text-xs text-slate-400">
              {/*
                THE GRADE AND THE BOOK, BESIDE THE NAME AND ABOVE EVERY PLACE ON THIS PAGE. This is
                the firm's own answer to their own worry: a senior collector is given the bigger
                accounts, so their rand is partly the book they were handed. Said once, at the top,
                where somebody reads it before they read a number.
              */}
              {person.collectorGrade ?? 'Ungraded'} collector
              {person.teamId && ` · ${teams.find((t) => t.id === person.teamId)?.name ?? ''}`}
              {stats && ` · ${stats.inPlayAccounts.toLocaleString('en-ZA')} accounts on the book`}
            </p>
          </div>
        </div>
        <SalesMonthPicker value={period} onChange={setPeriod} referenceDate={new Date()} />
      </div>

      {error && (
        <Card className="border-rose-200"><p className="text-sm text-rose-700">{error}</p></Card>
      )}

      {floor === null ? (
        <div className="p-10 grid place-items-center text-slate-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : !score || !stats ? (
        <Card>
          <p className="text-sm text-slate-600">
            {person.name} has no collections figures for {period.label}.
          </p>
          <p className="text-xs text-slate-400 mt-1">
            A collector appears here once they hold a book or money has been credited to them.
          </p>
        </Card>
      ) : (
        <>
          {/* ---------- where they stand ---------- */}
          <Card padded={false}>
            <p className="px-4 pt-3 text-[11px] uppercase tracking-wide text-slate-400">
              On the floor this month
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 pt-2">
              <Place label="Collected" value={formatCurrency(stats.collected)}
                place={placeLabel(byRand.get(userId))} />
              <Place label="Payments" value={stats.payments.toLocaleString('en-ZA')}
                place={placeLabel(byPayments.get(userId))} />
              <Place label="Average payment"
                value={score.averagePayment === null ? '—' : formatCurrency(score.averagePayment)}
                place={placeLabel(byAverage.get(userId))} />
            </div>
            <p className="px-4 pb-3 text-[11px] text-slate-400">
              Out of {running.length} collectors working a book in {period.label}. A place on rand
              is partly a place on the book somebody was given &mdash; the figures further down
              compare people on the same footing whatever they were handed.
            </p>
          </Card>

          {/* ---------- the month against target ---------- */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Collected" value={formatCurrency(stats.collected)}
              note={line?.target != null ? `of ${formatCurrency(line.target)}` : 'no target set'} />
            <Tile label="Achieved"
              value={line?.achieved == null ? '—' : `${(line.achieved * 100).toFixed(1)}%`}
              note={line ? standingLabel(line.standing) : undefined}
              tone={line?.standing === 'critical' ? 'bad'
                : line?.standing === 'behind' ? 'warn'
                  : line?.standing === 'no-target' ? undefined : 'good'} />
            <Tile label="Still needed"
              value={line?.stillNeeded == null ? '—' : formatCurrency(line.stillNeeded)}
              note={line?.neededADay == null ? undefined : `${formatCurrency(line.neededADay)} a day`} />
            <Tile label="Book value" value={formatCurrency(stats.inPlayValue)}
              note={`${stats.inPlayAccounts.toLocaleString('en-ZA')} accounts, ceiling ${bookCeilingOf(person.bookCeiling).toLocaleString('en-ZA')}`} />
          </div>

          {/* ---------- twelve months ---------- */}
          <TrendCard months={trend} target={target.target} against={against} loading={daily === null} />

          {/* ---------- promises ---------- */}
          <Card padded={false}>
            <p className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-slate-400">
              Promises to pay
              <span className="block normal-case tracking-normal text-slate-400 text-xs mt-0.5">
                Taken in {period.label}. A promise not yet due is neither kept nor broken, so the
                kept rate is over the ones that have come due.
              </span>
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 pt-2">
              <Measure label="Taken" value={stats.promisesMade} />
              <Measure label="Kept" value={stats.promisesKept} tone="good" />
              <Measure label="Broken" value={stats.promisesBroken} tone={stats.promisesBroken > 0 ? 'bad' : undefined} />
              <Measure label="Still to come"
                value={Math.max(0, stats.promisesMade - score.promisesResolved)} />
            </div>
            <div className="px-4 pb-4">
              <Rate label="Kept" value={score.promiseKeptRate}
                note={`${stats.promisesKept} of ${score.promisesResolved} resolved`}
                tone={band(score.promiseKeptRate, THRESHOLDS.promiseKeptRate)} />
            </div>
          </Card>

          {/* ---------- how the day is spent ---------- */}
          <Card padded={false}>
            <p className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-slate-400">
              How the day is spent
              <span className="block normal-case tracking-normal text-slate-400 text-xs mt-0.5">
                {score.actions.toLocaleString('en-ZA')} actions across{' '}
                {stats.accountsTouched.toLocaleString('en-ZA')} of{' '}
                {stats.inPlayAccounts.toLocaleString('en-ZA')} accounts.
              </span>
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 pt-2">
              <Measure label="Calls" value={stats.calls}
                note={`${stats.callsAnswered} answered`} />
              <Measure label="Emails" value={stats.emailsSent} />
              <Measure label="SMS" value={stats.smsSent} />
              <Measure label="Notes written" value={stats.notesWritten}
                note="Their own words. Notes Raptor writes itself are not counted." />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 pb-4">
              <Rate label="Calls answered" value={score.callAnswerRate}
                note={`${stats.callsAnswered} of ${stats.calls} calls`}
                tone={band(score.callAnswerRate, THRESHOLDS.callAnswerRate)} />
              <Rate label="Book reached" value={score.coverage}
                note={`${stats.accountsTouched.toLocaleString('en-ZA')} of ${stats.inPlayAccounts.toLocaleString('en-ZA')} accounts worked at least once`}
                tone={band(score.coverage, THRESHOLDS.coverage)} />
            </div>
            {/*
              SAID, NOT LEFT BLANK. The firm asked for WhatsApp beside the calls and SMS, and
              Raptor does not send or record one — there is no table, no integration, nothing.
              A tile reading "WhatsApp 0" would be a lie that looks like a quiet month.
            */}
            <p className="px-4 pb-3 text-[11px] text-slate-400">
              WhatsApp is not counted here: Raptor does not send or store WhatsApp messages, so
              there is nothing to count. (A promise can be noted as having come in over WhatsApp;
              that is a note on one promise, not a channel.) These are the channels Raptor carries.
            </p>
          </Card>

          {/* ---------- traces ---------- */}
          <Card padded={false}>
            <p className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-slate-400">
              Traces
              <span className="block normal-case tracking-normal text-slate-400 text-xs mt-0.5">
                Pulling a trace costs the firm money and produces a list of numbers and addresses.
                Working it is ringing them and recording what happened &mdash; two different things,
                often a month apart.
              </span>
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 pt-2">
              <Measure label="Pulled" value={stats.tracesPulled} note="in this month" />
              <Measure label="Leads found" value={stats.traceLeads}
                note="numbers, addresses, employers" />
              <Measure label="Worked" value={stats.tracesWorked}
                note="tried and an outcome recorded" />
              <Measure label="Verified" value={stats.tracesVerified} tone="good"
                note="turned out to be right" />
            </div>
            <div className="px-4 pb-4">
              <Rate label="Of what they tried, how much was real" value={score.traceHitRate}
                note={`${stats.tracesVerified} of ${stats.tracesWorked} findings`}
                tone={band(score.traceHitRate, THRESHOLDS.traceHitRate)} />
              <p className="text-[11px] text-slate-400 mt-1.5">
                Measured over what they tried, never over what the bureau printed. A trace comes
                back with eleven numbers and most are stale by construction &mdash; judging somebody
                on all eleven would be judging the bureau.
              </p>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

/* ---------- pieces ---------- */

function Place({ label, value, place }: { label: string; value: string; place: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-slate-800 mt-0.5">{value}</p>
      <p className="text-xs font-medium text-[var(--c-gold-deep)] tabular-nums">{place}</p>
    </div>
  )
}

function Tile({ label, value, note, tone }: {
  label: string; value: string; note?: string; tone?: 'good' | 'warn' | 'bad'
}) {
  const colour = tone === 'bad' ? 'text-rose-700' : tone === 'warn' ? 'text-amber-700'
    : tone === 'good' ? 'text-emerald-700' : 'text-slate-800'
  return (
    <Card>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums mt-1 ${colour}`}>{value}</p>
      {note && <p className="text-xs text-slate-400 mt-1">{note}</p>}
    </Card>
  )
}

function Measure({ label, value, note, tone }: {
  label: string; value: number; note?: string; tone?: 'good' | 'bad'
}) {
  const colour = tone === 'bad' ? 'text-rose-700' : tone === 'good' ? 'text-emerald-700' : 'text-slate-800'
  return (
    <div>
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className={`text-xl font-semibold tabular-nums mt-0.5 ${colour}`}>
        {value.toLocaleString('en-ZA')}
      </p>
      {note && <p className="text-[11px] text-slate-400">{note}</p>}
    </div>
  )
}

/**
 * A rate, with a bar and the fraction it came from.
 *
 * A null is "no figure", not a bad one. Somebody with no promises resolved has not achieved a
 * kept rate of nought, and a red 0% in their first week is a lie the screen tells about them.
 */
function Rate({ label, value, note, tone = 'unknown' }: {
  label: string; value: number | null; note: string; tone?: Band
}) {
  const colour = value === null ? 'bg-slate-300'
    : tone === 'good' ? 'bg-emerald-500'
      : tone === 'fair' ? 'bg-amber-400'
        : tone === 'poor' ? 'bg-rose-500' : 'bg-slate-400'
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-sm font-semibold tabular-nums text-slate-800">
          {value === null ? '—' : `${Math.round(value * 100)}%`}
        </p>
      </div>
      <div className="h-1.5 rounded-full bg-slate-200 mt-1 overflow-hidden">
        <div className={`h-full rounded-full ${colour}`}
          style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
      </div>
      <p className="text-[11px] text-slate-400 mt-1 tabular-nums">{note}</p>
    </div>
  )
}

const INK = 'var(--c-navy)'
const GOLD = 'var(--c-gold-deep)'

/**
 * Twelve months of collections.
 *
 * ONE MEASURE, ONE SCALE. The sales trend card next door explains at length why two y-axes in one
 * frame is the most reliable way to make a chart lie; the same applies here, so payments and
 * promises are not drawn on top of the rand. The only second thing on this chart is the target,
 * as a flat line, which shares the rand axis honestly.
 *
 * A MONTH WITH NOTHING IN IT IS STILL DRAWN. Omitting it would run the line straight through the
 * gap and tell a collector their takings held up through a month they were on leave.
 */
function TrendCard({ months, target, against, loading }: {
  months: MonthTake[]
  target: number | null
  against: number | null
  loading: boolean
}) {
  const data = months.map((m) => ({
    /* "Sep" alone repeats every twelve months; the year is what makes a long axis readable. */
    name: m.label.replace(/^(\w{3})\w*\s(\d{2})(\d{2})$/, '$1 $3'),
    full: m.label,
    collected: m.collected,
    empty: m.empty,
  }))
  return (
    <Card padded={false}>
      <div className="px-4 pt-3 pb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[11px] uppercase tracking-wide text-slate-400">
          Collections, last {months.length} months
          <span className="block normal-case tracking-normal text-slate-400 text-xs mt-0.5">
            The firm&rsquo;s months, 11th to the 10th. A month with nothing in it is still drawn.
          </span>
        </p>
        {against !== null && (
          <p className="text-xs tabular-nums">
            <span className="text-slate-400">This month against the average of the rest: </span>
            <span className={`font-semibold ${against >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {against >= 0 ? '+' : '−'}{Math.abs(Math.round(against * 100))}%
            </span>
          </p>
        )}
      </div>
      <div className="h-56 px-2 pb-3">
        {loading ? (
          <div className="h-full grid place-items-center text-slate-400">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--c-grey-lighter, #eef2f6)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--c-grey-light)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--c-grey-light)' }} tickLine={false} axisLine={false}
                width={64} tickFormatter={(v: number) => formatCurrency(v)} />
              <Tooltip content={<TrendTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
              {target !== null && target > 0 && (
                /* Labelled inside the frame: on the right it is clipped by the chart's own edge
                   and reads as "ta", which looks like a rendering bug rather than a target. */
                <ReferenceLine y={target} stroke={GOLD} strokeDasharray="4 4"
                  label={{ value: 'target', position: 'insideTopLeft', fontSize: 10, fill: GOLD }} />
              )}
              <Bar dataKey="collected" radius={[3, 3, 0, 0]}>
                {data.map((d) => (
                  /* Past target in green, so a month that beat it reads at a glance. */
                  <Cell key={d.full}
                    fill={target !== null && target > 0 && d.collected >= target ? 'var(--c-green, #10b981)' : INK} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}

function TrendTooltip({ active, payload }: {
  active?: boolean
  payload?: { payload: { full: string; collected: number; empty: boolean } }[]
}) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-3 py-2 text-xs">
      <p className="font-semibold text-slate-700">{point.full}</p>
      <p className="text-slate-500">
        {point.empty ? 'Nothing collected' : formatCurrency(point.collected)}
      </p>
    </div>
  )
}
