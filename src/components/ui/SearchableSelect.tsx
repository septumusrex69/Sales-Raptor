import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'

export interface SearchableOption {
  id: string
  label: string
  /** Secondary line — a code, a parent client, anything that separates two similar names. */
  hint?: string
}

/**
 * A picker you can type into.
 *
 * A plain dropdown is fine for five options and useless for fifty: you're left scrolling a
 * list you already know the answer to. This keeps the same shape as a select when closed and
 * filters as you type when open, so the number of clients stops being a reason not to use it.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Search…',
  emptyLabel = 'Nothing matches',
  ariaLabel,
}: {
  value: string
  onChange: (id: string) => void
  options: SearchableOption[]
  placeholder?: string
  emptyLabel?: string
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find((o) => o.id === value)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q))
  }, [options, query])

  useEffect(() => {
    if (!open) return
    // The search field is the whole point of opening it, so put the caret there.
    inputRef.current?.focus()
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function choose(id: string) {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="w-full flex items-center justify-between gap-2 text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-left outline-none focus:border-brand-500"
      >
        <span className={selected ? 'text-slate-700 truncate' : 'text-slate-400 truncate'}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={14} className="text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 bg-white rounded-xl shadow-lg border border-slate-100 z-50 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="flex-1 min-w-0 text-sm outline-none bg-transparent"
              // The picker sits inside forms; Enter here should pick, never submit.
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                if (matches.length > 0) choose(matches[0].id)
              }}
            />
          </div>
          <div role="listbox" className="max-h-56 overflow-y-auto py-1">
            {matches.map((o) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={o.id === value}
                onClick={() => choose(o.id)}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-start gap-2"
              >
                <Check size={14} className={`mt-0.5 shrink-0 ${o.id === value ? 'text-gold-600' : 'text-transparent'}`} />
                <span className="min-w-0">
                  <span className={`block text-sm truncate ${o.id === value ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>{o.label}</span>
                  {o.hint && <span className="block text-xs text-slate-400 truncate">{o.hint}</span>}
                </span>
              </button>
            ))}
            {matches.length === 0 && <p className="px-3 py-3 text-sm text-slate-400">{emptyLabel}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
