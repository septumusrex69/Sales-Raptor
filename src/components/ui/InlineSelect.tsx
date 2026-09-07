import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * Turns a badge you can read into a badge you can change. The status and class of a lead move
 * constantly while it's being worked, and sending someone into an Edit form to change one word
 * meant it mostly didn't get done — so the value is editable exactly where it's displayed.
 */
export function InlineSelect<T extends string>({
  value,
  options,
  onChange,
  disabled,
  children,
  align = 'left',
}: {
  value?: T
  options: readonly T[]
  onChange: (next: T) => void
  disabled?: boolean
  /** What's shown when closed — normally the badge itself. */
  children: ReactNode
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
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

  if (disabled) return <>{children}</>

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-lg hover:bg-slate-50 -mx-1 px-1 py-0.5 transition-colors"
        title="Click to change"
      >
        {children}
        <ChevronDown size={12} className="text-slate-300" />
      </button>
      {open && (
        <div
          className={`absolute z-30 mt-1.5 min-w-[10rem] rounded-lg border border-slate-200 bg-white shadow-lg py-1 ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setOpen(false)
                if (option !== value) onChange(option)
              }}
              className={`block w-full text-left text-sm px-3 py-1.5 hover:bg-slate-50 ${
                option === value ? 'font-medium text-brand-600' : 'text-slate-600'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
