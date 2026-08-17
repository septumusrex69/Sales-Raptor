import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { ALL_COLUMNS, COLUMN_LABELS, type ColumnKey } from '../../lib/leadColumns'

export function LeadsColumnsMenu({
  visibleColumns,
  onChange,
  icon,
}: {
  visibleColumns: Record<ColumnKey, boolean>
  onChange: (next: Record<ColumnKey, boolean>) => void
  icon?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function toggle(key: ColumnKey) {
    onChange({ ...visibleColumns, [key]: !visibleColumns[key] })
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      >
        {icon} Columns
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-lg border border-slate-100 py-1.5 z-50 max-h-80 overflow-y-auto">
          {ALL_COLUMNS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            >
              <span
                className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${
                  visibleColumns[key] ? 'bg-brand-600 border-brand-600 text-white' : 'border-slate-300'
                }`}
              >
                {visibleColumns[key] && <Check size={11} />}
              </span>
              {COLUMN_LABELS[key]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
