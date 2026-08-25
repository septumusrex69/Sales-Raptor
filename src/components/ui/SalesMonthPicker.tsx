import { useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  type SalesMonthPeriod,
  getCurrentSalesMonth,
  getPreviousSalesMonth,
  getNextSalesMonth,
  getLastNSalesMonthsRange,
  getYTDRange,
  getAllTimeRange,
} from '../../lib/salesMonth'

type PresetKey = 'allTime' | 'current' | 'previous' | 'historical' | 'last3' | 'last6' | 'last12' | 'ytd' | 'custom'

const PRESET_LABELS: Record<PresetKey, string> = {
  allTime: 'All Time',
  current: 'Current Sales Month',
  previous: 'Previous Sales Month',
  historical: 'Select Historical Sales Month',
  last3: 'Last 3 Sales Months',
  last6: 'Last 6 Sales Months',
  last12: 'Last 12 Sales Months',
  ytd: 'Year to Date',
  custom: 'Custom Date Range',
}

function formatDateInput(d: Date) {
  return d.toISOString().slice(0, 10)
}

export function SalesMonthPicker({
  value,
  onChange,
  referenceDate,
}: {
  value: SalesMonthPeriod
  onChange: (period: SalesMonthPeriod) => void
  referenceDate: Date
}) {
  const current = getCurrentSalesMonth(referenceDate)
  const [preset, setPreset] = useState<PresetKey>('current')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  function applyPreset(next: PresetKey) {
    setPreset(next)
    if (next === 'allTime') onChange(getAllTimeRange(referenceDate))
    else if (next === 'current') onChange(current)
    else if (next === 'previous') onChange(getPreviousSalesMonth(current))
    else if (next === 'historical') onChange(getPreviousSalesMonth(current))
    else if (next === 'last3') onChange(getLastNSalesMonthsRange(referenceDate, 3))
    else if (next === 'last6') onChange(getLastNSalesMonthsRange(referenceDate, 6))
    else if (next === 'last12') onChange(getLastNSalesMonthsRange(referenceDate, 12))
    else if (next === 'ytd') onChange(getYTDRange(referenceDate))
    else if (next === 'custom') {
      setCustomStart(formatDateInput(current.start))
      setCustomEnd(formatDateInput(referenceDate))
    }
  }

  function applyCustomRange(startStr: string, endStr: string) {
    if (!startStr || !endStr) return
    const start = new Date(`${startStr}T00:00:00`)
    const end = new Date(`${endStr}T23:59:59.999`)
    if (start > end) return
    onChange({
      start,
      end,
      label: 'Custom Range',
      rangeLabel: `${start.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })} – ${end.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}`,
      key: `custom-${startStr}-${endStr}`,
    })
  }

  const isInProgress = preset === 'current' && value.key === current.key

  return (
    <div className="flex items-start gap-3">
      <div>
        <div className="flex items-center gap-2">
          <select
            value={preset}
            onChange={(e) => applyPreset(e.target.value as PresetKey)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 outline-none font-medium"
          >
            {(Object.keys(PRESET_LABELS) as PresetKey[]).map((k) => (
              <option key={k} value={k}>
                {PRESET_LABELS[k]}
              </option>
            ))}
          </select>
          {preset === 'historical' && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onChange(getPreviousSalesMonth(value))}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                aria-label="Previous Sales Month"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                onClick={() => onChange(getNextSalesMonth(value))}
                disabled={value.key >= current.key}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:pointer-events-none"
                aria-label="Next Sales Month"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-1.5 mt-1.5">
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
      </div>
      <div className="flex items-center gap-1.5 text-xs text-slate-500 border-l border-slate-200 pl-3 py-1">
        <Calendar size={13} className="text-slate-400 shrink-0" />
        <div>
          <p className="font-semibold text-slate-700 text-[13px] leading-tight flex items-center gap-1.5">
            {value.label}
            {isInProgress && (
              <span className="font-medium text-[9.5px] uppercase tracking-wide text-[#b28e34] bg-[#f7f4eb] px-1.5 py-0.5 rounded">In progress</span>
            )}
          </p>
          <p className="text-[11px] text-slate-400 leading-tight">{value.rangeLabel}</p>
        </div>
      </div>
    </div>
  )
}
