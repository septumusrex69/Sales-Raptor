import { useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight, Columns3 } from 'lucide-react'
import {
  getAdjacentCalendarMonth,
  getLastCalendarMonth,
  getLastNCalendarMonths,
  getThisCalendarMonth,
  getThisCalendarYear,
  getThisWeek,
  getToday,
  buildCustomDateRange,
} from '../../lib/dateRange'
import type { SalesMonthPeriod } from '../../lib/salesMonth'
import type { ColumnKey } from '../../lib/leadColumns'
import { LeadsColumnsMenu } from './LeadsColumnsMenu'

type PresetKey = 'today' | 'this-week' | 'this-month' | 'last-month' | 'last-3-months' | 'this-year' | 'custom'

const PRESETS: { key: PresetKey; label: string }[] = [
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

export function LeadsPeriodBar({
  period,
  onChange,
  referenceDate,
  visibleColumns,
  onChangeColumns,
}: {
  period: SalesMonthPeriod
  onChange: (period: SalesMonthPeriod) => void
  referenceDate: Date
  visibleColumns: Record<ColumnKey, boolean>
  onChangeColumns: (next: Record<ColumnKey, boolean>) => void
}) {
  const [preset, setPreset] = useState<PresetKey>('this-month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  function applyPreset(next: PresetKey) {
    setPreset(next)
    if (next === 'today') onChange(getToday(referenceDate))
    else if (next === 'this-week') onChange(getThisWeek(referenceDate))
    else if (next === 'this-month') onChange(getThisCalendarMonth(referenceDate))
    else if (next === 'last-month') onChange(getLastCalendarMonth(referenceDate))
    else if (next === 'last-3-months') onChange(getLastNCalendarMonths(referenceDate, 3))
    else if (next === 'this-year') onChange(getThisCalendarYear(referenceDate))
    else if (next === 'custom') {
      setCustomStart(formatDateInput(period.start))
      setCustomEnd(formatDateInput(referenceDate))
    }
  }

  function applyCustomRange(startStr: string, endStr: string) {
    const range = buildCustomDateRange(startStr, endStr)
    if (range) onChange(range)
  }

  const isMonthly = preset === 'this-month' || preset === 'last-month'

  return (
    <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-lg px-3.5 py-2.5">
      <div className="flex items-center gap-1.5 text-sm">
        <Calendar size={15} className="text-slate-400 shrink-0" />
        <span className="font-medium text-slate-700">{period.rangeLabel}</span>
        {isMonthly && (
          <div className="flex items-center gap-0.5 ml-1">
            <button
              type="button"
              onClick={() => onChange(getAdjacentCalendarMonth(period, -1))}
              className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Previous month"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              onClick={() => onChange(getAdjacentCalendarMonth(period, 1))}
              className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Next month"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => applyPreset(p.key)}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg ${
              preset === p.key ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={customStart}
            onChange={(e) => {
              setCustomStart(e.target.value)
              applyCustomRange(e.target.value, customEnd)
            }}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => {
              setCustomEnd(e.target.value)
              applyCustomRange(customStart, e.target.value)
            }}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none"
          />
        </div>
      )}

      <div className="ml-auto">
        <LeadsColumnsMenu visibleColumns={visibleColumns} onChange={onChangeColumns} icon={<Columns3 size={14} />} />
      </div>
    </div>
  )
}
