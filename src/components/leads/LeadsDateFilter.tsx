import { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  getAdjacentCalendarMonth,
  getAllTime,
  getLastCalendarMonth,
  getLastNCalendarMonths,
  getThisCalendarMonth,
  getThisCalendarYear,
  getThisWeek,
  getToday,
  buildCustomDateRange,
} from '../../lib/dateRange'
import type { SalesMonthPeriod } from '../../lib/salesMonth'

type PresetKey = 'all-time' | 'today' | 'this-week' | 'this-month' | 'last-month' | 'last-3-months' | 'this-year' | 'custom'

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'all-time', label: 'All Time' },
  { key: 'today', label: 'Today' },
  { key: 'this-week', label: 'This Week' },
  { key: 'this-month', label: 'This Month' },
  { key: 'last-month', label: 'Last Month' },
  { key: 'last-3-months', label: 'Last 3 Months' },
  { key: 'this-year', label: 'This Year' },
  { key: 'custom', label: 'Custom Range' },
]

function formatDateInput(d: Date) {
  return d.toISOString().slice(0, 10)
}

/**
 * "1–30 Sep 2026" rather than "1 Sep 2026 – 30 Sep 2026".
 *
 * The long form is 23 characters, which was enough to push this control and Add Lead onto a
 * second row on an iPad — costing a band of the page to repeat a month and a year the reader
 * has already been told once.
 */
function compactRange(start: Date, end: Date): string {
  const day = (d: Date) => d.getDate()
  const mon = (d: Date) => d.toLocaleString('en-ZA', { month: 'short' })
  const yr = (d: Date) => d.getFullYear()
  if (yr(start) !== yr(end)) return `${day(start)} ${mon(start)} ${yr(start)} – ${day(end)} ${mon(end)} ${yr(end)}`
  if (mon(start) !== mon(end)) return `${day(start)} ${mon(start)} – ${day(end)} ${mon(end)} ${yr(end)}`
  if (day(start) === day(end)) return `${day(start)} ${mon(end)} ${yr(end)}`
  return `${day(start)}–${day(end)} ${mon(end)} ${yr(end)}`
}

/**
 * The date range as one control instead of a row of eight buttons.
 *
 * Nine presets laid out flat cost a full row of the page permanently in order to show eight
 * options nobody is choosing between right now — the answer is almost always the one already
 * selected. Collapsed into a button that states the current range, it costs a single control
 * and the choices are still one tap away.
 *
 * The month arrows stay on the face of the button rather than inside the menu: stepping back a
 * month is the one thing people do repeatedly, and burying it behind a menu would trade a row
 * of height for two extra taps every time.
 */
export function LeadsDateFilter({
  period,
  onChange,
  referenceDate,
}: {
  period: SalesMonthPeriod
  onChange: (period: SalesMonthPeriod) => void
  referenceDate: Date
}) {
  const [preset, setPreset] = useState<PresetKey>('this-month')
  const [open, setOpen] = useState(false)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function applyPreset(next: PresetKey) {
    setPreset(next)
    if (next === 'all-time') onChange(getAllTime(referenceDate))
    else if (next === 'today') onChange(getToday(referenceDate))
    else if (next === 'this-week') onChange(getThisWeek(referenceDate))
    else if (next === 'this-month') onChange(getThisCalendarMonth(referenceDate))
    else if (next === 'last-month') onChange(getLastCalendarMonth(referenceDate))
    else if (next === 'last-3-months') onChange(getLastNCalendarMonths(referenceDate, 3))
    else if (next === 'this-year') onChange(getThisCalendarYear(referenceDate))
    else if (next === 'custom') {
      setCustomStart(formatDateInput(period.start))
      setCustomEnd(formatDateInput(referenceDate))
      return
    }
    setOpen(false)
  }

  function applyCustomRange(startStr: string, endStr: string) {
    const range = buildCustomDateRange(startStr, endStr)
    if (range) onChange(range)
  }

  const presetLabel = PRESETS.find((p) => p.key === preset)?.label ?? 'Custom'
  const isMonthly = preset === 'this-month' || preset === 'last-month'

  return (
    <div ref={ref} className="relative">
      <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white">
        {isMonthly && (
          <button
            type="button"
            onClick={() => onChange(getAdjacentCalendarMonth(period, -1))}
            className="px-1.5 py-2 text-slate-400 hover:text-slate-600 rounded-l-lg hover:bg-slate-50"
            aria-label="Previous month"
          >
            <ChevronLeft size={15} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-2.5 py-2 text-slate-600 hover:bg-slate-50 whitespace-nowrap"
        >
          <CalendarDays size={15} className="text-slate-400 shrink-0" />
          <span className="text-slate-700">{presetLabel}</span>
          <span className="text-slate-400">&middot; {compactRange(period.start, period.end)}</span>
          <ChevronDown size={14} className="text-slate-400" />
        </button>
        {isMonthly && (
          <button
            type="button"
            onClick={() => onChange(getAdjacentCalendarMonth(period, 1))}
            className="px-1.5 py-2 text-slate-400 hover:text-slate-600 rounded-r-lg hover:bg-slate-50"
            aria-label="Next month"
          >
            <ChevronRight size={15} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-60 bg-white rounded-xl shadow-lg border border-slate-100 py-1.5 z-50">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p.key)}
              className={`w-full text-left px-3.5 py-2 text-sm hover:bg-slate-50 ${
                preset === p.key ? 'text-brand-700 font-semibold bg-brand-50/60' : 'text-slate-600'
              }`}
            >
              {p.label}
            </button>
          ))}
          {preset === 'custom' && (
            <div className="flex items-center gap-1.5 px-3.5 pt-2 pb-1 border-t border-slate-100 mt-1">
              <input
                type="date"
                value={customStart}
                onChange={(e) => {
                  setCustomStart(e.target.value)
                  applyCustomRange(e.target.value, customEnd)
                }}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none min-w-0 flex-1"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => {
                  setCustomEnd(e.target.value)
                  applyCustomRange(customStart, e.target.value)
                }}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none min-w-0 flex-1"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
