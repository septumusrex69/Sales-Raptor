import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { publicHolidays } from '../../lib/workingDays.ts'
import { longDate, monthSpan } from '../../lib/dayWords.ts'
import {
  NO_DAY_COUNT, dayCountSentence, shiftDay, weekStrip, type DayCount,
} from '../../lib/dayPlan.ts'
import { DayGrid, type DayCell } from '../ui/DayGrid'

/**
 * CHOOSING A DAY FOR A TASK, WITH THE DAY'S LOAD ALREADY ON IT.
 *
 * THE FIRM, on the Add Task box: "it asks you when, but it should look like a rediarisation almost
 * thing, to show you how many meetings do you have for a specific day." The box had an
 * `<input type="date">` -- a field that will accept the 8th just as readily when the 8th already
 * holds four client meetings, which is exactly the state the diary's own picker exists to prevent.
 *
 * TWO JOBS, ONE CONTROL. It also answers the other half of the same conversation -- "in the tasks,
 * maybe I should be able to search for a specific day for my tasks" -- because choosing a day to
 * LOOK at and choosing a day to BOOK onto want the same thing in front of them. `allowPast` is the
 * only difference: you can look back at last Tuesday and you cannot book onto it.
 *
 * ------------------------------------------------------------------------------------------------
 * IT COUNTS AND DOES NOT JUDGE
 * ------------------------------------------------------------------------------------------------
 *
 * No "full", no "over", no red. The diary colours a day against the firm's 50-a-day standard; a
 * day of meetings and tasks has no such number and the firm has not been asked for one. A ceiling
 * invented here would put a warning on the screen that fires when nothing is wrong, and people
 * stop reading those -- including the ones that matter.
 *
 * What it does mark is a day NOBODY IS AT A DESK: a weekend or a public holiday is tinted and
 * named, and still choosable. That is the deliberate difference from the diary, which refuses
 * them outright -- an account cannot come back on a Saturday because nobody will be there to work
 * it, but a person may perfectly well need a reminder about Monday's trip written against the
 * Sunday, and a meeting a client books on a public holiday is still a meeting.
 *
 * THE COUNTS ARE HANDED IN, NOT FETCHED. The caller already has the two lists -- the tasks from
 * AppStore and the meetings from the calendar's own fetch -- and dayCounts walks them once. A
 * second fetch in here would also be a second answer to "what is on the 8th", which is the drift
 * dayPlan.ts exists to refuse.
 */
export function TaskDayPicker({
  value, onChange, counts, today, weeks = 3, allowPast = false, note,
}: {
  /** 'YYYY-MM-DD', or '' where nothing has been chosen yet. */
  value: string
  onChange: (day: string) => void
  counts: Map<string, DayCount>
  /** 'YYYY-MM-DD'. Passed in rather than read from the clock so it can be tested. */
  today: string
  weeks?: number
  /** True where looking back is the point — the filter on the task list, not the Add box. */
  allowPast?: boolean
  /**
   * A caveat under the grid, where the figures do not cover everything.
   *
   * ONE REAL CASE: a task being given to somebody else. Their tasks are in the shared store and
   * their MEETINGS are not — a calendar event belongs to one person and RLS scopes it to them —
   * so the count is tasks only, and the box says so rather than showing a number that silently
   * leaves out the thing the firm asked to see.
   */
  note?: string
}) {
  const [from, setFrom] = useState(() => weekStrip(value || today, 1)[0])
  const days = useMemo(() => weekStrip(from, weeks), [from, weeks])

  /* Holiday names, so a tinted Thursday says "Heritage Day" rather than just looking different. */
  const holidays = useMemo(() => {
    const years = new Set(days.map((d) => Number(d.slice(0, 4))))
    const all = new Map<string, string>()
    for (const y of years) for (const [date, name] of publicHolidays(y)) all.set(date, name)
    return all
  }, [days])

  const countFor = (day: string) => counts.get(day) ?? NO_DAY_COUNT

  const cellFor = (date: string): DayCell => {
    const c = countFor(date)
    const holiday = holidays.get(date)
    const weekday = new Date(`${date}T12:00:00`).getDay()
    const closed = holiday !== undefined || weekday === 0 || weekday === 6
    const past = date < today
    /*
      A CLOSED DAY IS TINTED, NOT DISABLED -- see the header. The tint is the diary's gold, which
      on that screen means "filling up"; here it means "nobody is in", and the tooltip is what
      tells them apart. Same palette, because two calendars in one app using different greys for
      the same Saturday reads as one of them being broken.
    */
    const tone = closed
      ? 'bg-[var(--tint-gold)] border-[var(--c-gold)]/30 text-[var(--c-gold-dark)] hover:border-[var(--c-gold)]'
      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
    return {
      count: c.total,
      tone,
      disabled: past && !allowPast,
      title: [
        longDate(date),
        holiday ?? (closed ? 'Nobody is at a desk' : null),
        past && !allowPast ? 'Already gone' : dayCountSentence(c),
      ].filter(Boolean).join(' — '),
    }
  }

  const chosen = countFor(value)

  return (
    <div className="max-w-[32rem]">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={() => setFrom(shiftDay(from, -7 * weeks))}
          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          title="Earlier weeks">
          <ChevronLeft size={16} />
        </button>
        <span className="text-xs font-medium text-slate-500">{monthSpan(days)}</span>
        <button type="button" onClick={() => setFrom(shiftDay(from, 7 * weeks))}
          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          title="Later weeks">
          <ChevronRight size={16} />
        </button>
      </div>

      <DayGrid days={days} value={value} onChange={onChange} cellFor={cellFor} />

      {/*
        ONE SENTENCE ABOUT THE DAY ACTUALLY CHOSEN. The grid shows the shape, this says what it
        means -- and until a day is chosen it says nothing at all rather than describing a date
        nobody picked.
      */}
      {value && (
        <p className="mt-3 text-sm text-slate-700">
          <span className="font-medium">{longDate(value)}</span>
          <span className="text-slate-400"> · {dayCountSentence(chosen)}</span>
        </p>
      )}
      {note && <p className="mt-1 text-[11px] text-slate-400">{note}</p>}
    </div>
  )
}
