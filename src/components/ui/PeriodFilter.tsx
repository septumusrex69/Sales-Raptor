import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  getAllTimeRange,
  getCurrentSalesMonth,
  getLastNSalesMonthsRange,
  getNextSalesMonth,
  getPreviousSalesMonth,
  getSalesMonthForYearMonth,
  getYTDRange,
  type SalesMonthPeriod,
} from '../../lib/salesMonth'
import { getToday, getThisWeek, buildCustomDateRange } from '../../lib/dateRange'

type PresetKey = 'all-time' | 'today' | 'this-week' | 'this-month' | 'last-month' | 'last-3-months' | 'ytd' | 'month' | 'custom'

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'this-month', label: 'This Sales Month' },
  { key: 'last-month', label: 'Last Sales Month' },
  { key: 'last-3-months', label: 'Last 3 Sales Months' },
  { key: 'ytd', label: 'Year to Date' },
  { key: 'today', label: 'Today' },
  { key: 'this-week', label: 'This Week' },
  { key: 'all-time', label: 'All Time' },
  { key: 'custom', label: 'Custom Range' },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDateInput(d: Date) {
  return d.toISOString().slice(0, 10)
}

/** "1–30 Sep 2026" rather than "1 Sep 2026 – 30 Sep 2026" — the month and year said once. */
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
 * One date control, counting in Sales Months everywhere.
 *
 * The business's month runs the 11th to the 10th, and every figure in Raptor is counted on it —
 * except that this page used to filter on calendar months, so a lead created on 15 September was
 * "September" here and "October" on the dashboard. Same lead, two months, depending which page
 * you had open. This control is built on the Sales Month engine the rest of the app already
 * uses, so the answer is the same wherever it is asked.
 *
 * The range is always spelled out beside the name, because "October" meaning 11 Sep – 10 Oct is
 * exactly the sort of thing that is obvious to the person who set it up and surprising to
 * everybody else.
 *
 * Two ways in, because there are two questions. The presets answer "how are we doing lately",
 * which is what someone wants most days. The month grid answers "what happened in June", which
 * needs a specific month by name rather than a number of steps backwards from now.
 */
export function PeriodFilter({
  period,
  onChange,
  referenceDate,
  align = 'right',
}: {
  period: SalesMonthPeriod
  onChange: (period: SalesMonthPeriod) => void
  referenceDate: Date
  align?: 'left' | 'right'
}) {
  const [preset, setPreset] = useState<PresetKey>('this-month')
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(() => referenceDate.getFullYear())
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

  const currentKey = useMemo(() => getCurrentSalesMonth(referenceDate).key, [referenceDate])

  function applyPreset(next: PresetKey) {
    setPreset(next)
    if (next === 'all-time') onChange(getAllTimeRange(referenceDate))
    else if (next === 'today') onChange(getToday(referenceDate))
    else if (next === 'this-week') onChange(getThisWeek(referenceDate))
    else if (next === 'this-month') onChange(getCurrentSalesMonth(referenceDate))
    else if (next === 'last-month') onChange(getPreviousSalesMonth(getCurrentSalesMonth(referenceDate)))
    else if (next === 'last-3-months') onChange(getLastNSalesMonthsRange(referenceDate, 3))
    else if (next === 'ytd') onChange(getYTDRange(referenceDate))
    else if (next === 'custom') {
      setCustomStart(formatDateInput(period.start))
      setCustomEnd(formatDateInput(referenceDate))
      return
    }
    setOpen(false)
  }

  function applyMonth(monthIndex: number) {
    setPreset('month')
    onChange(getSalesMonthForYearMonth(year, monthIndex + 1))
    setOpen(false)
  }

  function applyCustomRange(startStr: string, endStr: string) {
    const range = buildCustomDateRange(startStr, endStr)
    if (range) onChange(range)
  }

  // Only a single Sales Month can be stepped: "last 3 months" has no next one.
  const steppable = preset === 'this-month' || preset === 'last-month' || preset === 'month'
  const faceLabel = preset === 'month' || preset === 'this-month' || preset === 'last-month' ? period.label : (PRESETS.find((p) => p.key === preset)?.label ?? 'Custom')

  return (
    <div ref={ref} className="relative">
      <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white">
        {steppable && (
          <button
            type="button"
            onClick={() => {
              setPreset('month')
              onChange(getPreviousSalesMonth(period))
            }}
            className="px-1.5 py-2 text-slate-400 hover:text-slate-600 rounded-l-lg hover:bg-slate-50"
            aria-label="Previous sales month"
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
          <span className="text-slate-700">{faceLabel}</span>
          <span className="text-slate-400">&middot; {compactRange(period.start, period.end)}</span>
          <ChevronDown size={14} className="text-slate-400" />
        </button>
        {steppable && (
          <button
            type="button"
            onClick={() => {
              setPreset('month')
              onChange(getNextSalesMonth(period))
            }}
            className="px-1.5 py-2 text-slate-400 hover:text-slate-600 rounded-r-lg hover:bg-slate-50"
            aria-label="Next sales month"
          >
            <ChevronRight size={15} />
          </button>
        )}
      </div>

      {open && (
        <div
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-2 w-[19rem] bg-white rounded-xl shadow-lg border border-slate-100 py-1.5 z-50`}
        >
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p.key)}
              className={`w-full text-left px-3.5 py-1.5 text-sm hover:bg-slate-50 ${
                preset === p.key ? 'text-brand-700 font-semibold bg-brand-50/60' : 'text-slate-600'
              }`}
            >
              {p.label}
            </button>
          ))}

          {preset === 'custom' && (
            <div className="flex items-center gap-1.5 px-3.5 pt-2 pb-1">
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

          <div className="mt-1.5 pt-2 border-t border-slate-100 px-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Pick a sales month</span>
              <span className="inline-flex items-center gap-0.5">
                <button type="button" onClick={() => setYear((y) => y - 1)} className="p-1 rounded text-slate-400 hover:bg-slate-100" aria-label="Previous year">
                  <ChevronLeft size={13} />
                </button>
                <span className="text-xs font-semibold text-slate-600 tabular-nums w-10 text-center">{year}</span>
                <button type="button" onClick={() => setYear((y) => y + 1)} className="p-1 rounded text-slate-400 hover:bg-slate-100" aria-label="Next year">
                  <ChevronRight size={13} />
                </button>
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1 pb-2">
              {MONTHS.map((m, i) => {
                const key = `${year}-${String(i + 1).padStart(2, '0')}`
                const selected = preset !== 'custom' && period.key === key
                const isCurrent = key === currentKey
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => applyMonth(i)}
                    title={`${m} ${year} — ${compactRange(getSalesMonthForYearMonth(year, i + 1).start, getSalesMonthForYearMonth(year, i + 1).end)}`}
                    className={`text-xs font-medium py-1.5 rounded-lg ${
                      selected
                        ? 'bg-brand-600 text-white'
                        : isCurrent
                          ? 'border border-brand-200 text-brand-700 hover:bg-brand-50'
                          : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {m}
                  </button>
                )
              })}
            </div>
            <p className="text-[10.5px] text-slate-400 pb-2 leading-snug">
              A sales month runs the 11th to the 10th, and is named for the month it ends in.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
