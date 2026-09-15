import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { publicHolidays } from '../../lib/workingDays.ts'
import {
  calendarStrip, dayLoad, dayLoadSentence, firstDayWithRoom, shiftDate,
  type DayLoad, type DayLoadLevel,
} from '../../lib/diaryPriority.ts'
import { fetchDayLoads, type DayLoads } from '../../lib/diary.ts'

/**
 * Choosing the day an account comes back.
 *
 * THE COUNT IS SHOWN BEFORE THE CHOICE, NOT AFTER. That is the whole design. A number that
 * appears once you have already picked the 5th tells you that you have overbooked yourself and
 * leaves you to work out which other day is better; a grid with the count on every day lets you
 * pick the 6th in the first place.
 *
 * The book this replaces is the argument for it. One agent came across from Swordfish carrying
 * 44 accounts diarised onto a single date — and every one of them was still open and overdue
 * weeks later, because 44 accounts is not a day's work and nobody could see that when they were
 * being booked one at a time.
 *
 * Weekends and South African public holidays are shown but cannot be chosen: there is nobody at
 * a desk, and five accounts in the imported book are diarised onto a Saturday.
 */

const LEVEL_STYLE: Record<DayLoadLevel, string> = {
  free: 'bg-white border-slate-200 text-slate-700 hover:border-slate-300',
  filling: 'bg-[var(--tint-gold)] border-[var(--c-gold)]/30 text-[var(--c-gold-dark)] hover:border-[var(--c-gold)]',
  full: 'bg-[var(--tint-rust)] border-[var(--c-rust)]/40 text-[var(--c-rust)] hover:border-[var(--c-rust)]',
  over: 'bg-[var(--tint-rust-deep)] border-[var(--c-rust-deep)]/50 text-[var(--c-rust-deep)] hover:border-[var(--c-rust-deep)]',
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function DiaryDatePicker({ ownerId, capacity, value, onChange, weeks = 3, today, showLoad = true, onLoad }: {
  /** Whose diary the counts are for. Null counts the unassigned pile. */
  ownerId: string | null
  /** This person's accounts-per-day, or null for the firm default. */
  capacity: number | null | undefined
  value: string
  onChange: (date: string) => void
  weeks?: number
  /** 'YYYY-MM-DD'. Passed in rather than read from the clock so it can be tested. */
  today: string
  /**
   * Show how full each day is.
   *
   * On for the diary, where the count IS the point — the firm's own requirement was seeing what
   * a day already holds before adding to it. Off for a reminder, which books nothing: a number
   * under the date there would say a reminder adds to the day's load, and it does not. Same
   * calendar either way, because two calendars drift apart inside a month.
   */
  showLoad?: boolean
  /**
   * How full the chosen day is, reported back as it changes.
   *
   * The counts are fetched in here, so a box that wants to say something about the day the
   * agent has landed on — "that day is already full, book it anyway?" — has no other way to
   * know. Fired on a change of day or of counts, never on every render.
   */
  onLoad?: (load: DayLoad) => void
}) {
  // Which stretch of weeks is on screen. Starts on the week the chosen date falls in.
  const [from, setFrom] = useState(() => calendarStrip(value || today, 1)[0])
  const [loads, setLoads] = useState<DayLoads | null>(null)
  const [loading, setLoading] = useState(true)

  const days = useMemo(() => calendarStrip(from, weeks), [from, weeks])

  useEffect(() => {
    let cancelled = false
    if (!showLoad) { setLoads(new Map()); setLoading(false); return }
    setLoading(true)
    fetchDayLoads({ ownerId, from: days[0], to: days[days.length - 1] })
      .then((l) => { if (!cancelled) setLoads(l) })
      // A picker that cannot count is still a picker. Showing no numbers is better than
      // showing a modal that will not open.
      .catch(() => { if (!cancelled) setLoads(new Map()) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [ownerId, days, showLoad])

  // Holiday names, so a greyed-out Thursday says "Heritage Day" rather than nothing.
  const holidays = useMemo(() => {
    const years = new Set(days.map((d) => Number(d.slice(0, 4))))
    const all = new Map<string, string>()
    for (const y of years) for (const [date, name] of publicHolidays(y)) all.set(date, name)
    return all
  }, [days])

  const loadFor = (date: string): DayLoad =>
    dayLoad({ date, booked: loads?.get(date) ?? 0, capacity })

  const chosen = loadFor(value)
  const suggestion = loads ? firstDayWithRoom(today, loads, capacity) : null

  /*
   * Report the chosen day upward, but only once the counts have actually arrived.
   *
   * Reporting the pre-fetch state would tell the caller every day is empty, and a warning that
   * says "nothing booked" and then silently becomes "already full" a moment later is worse than
   * no warning. The ref is what stops a re-render firing this again with the same figures.
   */
  const reported = useRef('')
  useEffect(() => {
    if (!onLoad || loading) return
    const key = `${chosen.date}:${chosen.booked}:${chosen.capacity}`
    if (reported.current === key) return
    reported.current = key
    onLoad(chosen)
  }, [onLoad, loading, chosen])

  return (
    /*
      Capped rather than fluid. Left to fill its container the cells stretch into wide, empty
      boxes with a lone digit in them — the grid stops reading as a month and starts reading as
      a toolbar. 32rem is about the width of the modal it lives in, so in practice the cap never
      bites; it is there for the day somebody drops this on a page.
    */
    <div className="max-w-[32rem]">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={() => setFrom(shiftDate(from, -7 * weeks))}
          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          title="Earlier weeks">
          <ChevronLeft size={16} />
        </button>
        <span className="text-xs font-medium text-slate-500">
          {monthSpan(days)}
          {loading && <Loader2 size={11} className="inline ml-1.5 animate-spin" />}
        </span>
        <button type="button" onClick={() => setFrom(shiftDate(from, 7 * weeks))}
          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          title="Later weeks">
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((d) => (
          <span key={d} className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 text-center">
            {d.slice(0, 1)}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((date) => {
          const load = loadFor(date)
          const holiday = holidays.get(date)
          const past = date < today
          const disabled = load.closed || past
          const selected = date === value

          return (
            <button
              key={date}
              type="button"
              disabled={disabled}
              onClick={() => onChange(date)}
              title={disabled
                ? (holiday ?? (past ? 'Already gone' : 'Nobody is at a desk'))
                : showLoad ? `${longDate(date)} — ${dayLoadSentence(load)}` : longDate(date)}
              className={[
                'rounded-lg border px-1 py-1.5 text-center transition-colors',
                disabled
                  ? 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed'
                  : LEVEL_STYLE[load.level],
                selected ? 'ring-2 ring-navy-900 ring-offset-1' : '',
              ].join(' ')}
            >
              <span className="block text-sm font-semibold leading-none">{Number(date.slice(8, 10))}</span>
              {/*
                The number under the date is the point of the control, so it holds its line even
                at zero — a column of counts that appears and disappears is harder to scan than
                one with a dash in it.
              */}
              {showLoad && (
                <span className="block text-[10px] leading-none mt-1 tabular-nums">
                  {disabled ? '·' : load.booked || '–'}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/*
        One sentence about the day that is actually chosen. The grid shows the shape; this says
        what it means, because "18" means nothing to somebody who has never seen their capacity.
      */}
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm text-slate-700">
          <span className="font-medium">{longDate(value)}</span>
          {showLoad && <span className="text-slate-400"> · {dayLoadSentence(chosen)}</span>}
        </span>
        {/*
          Offered, never imposed. An agent who told the debtor "the fifth" gets the fifth even
          if it is full — they made a promise and the app does not get to overrule it.
        */}
        {showLoad && suggestion && suggestion !== value && (chosen.level === 'full' || chosen.level === 'over') && (
          <button type="button" onClick={() => onChange(suggestion)}
            className="text-xs font-medium text-[var(--c-steel)] hover:underline">
            {shortDate(suggestion)} has room
          </button>
        )}
      </div>
    </div>
  )
}

/* ---------- dates as words ---------- */

const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-ZA', { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))

export const longDate = (date: string) => fmt(date, { weekday: 'long', day: 'numeric', month: 'long' })
export const shortDate = (date: string) => fmt(date, { day: 'numeric', month: 'short' })

function monthSpan(days: string[]): string {
  const first = fmt(days[0], { month: 'long', year: 'numeric' })
  const last = fmt(days[days.length - 1], { month: 'long', year: 'numeric' })
  if (first === last) return first
  // Across a month end, drop the repeated year: "September – October 2026".
  const [fm, fy] = first.split(' ')
  const [lm, ly] = last.split(' ')
  return fy === ly ? `${fm} – ${lm} ${ly}` : `${first} – ${last}`
}
