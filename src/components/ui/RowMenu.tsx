import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

export interface RowMenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
}

export function RowMenu({ items, width = 'w-48', label, bordered = false }: {
  items: RowMenuItem[]
  /**
   * How wide the panel is. Defaults to the width every row menu in the app has always been.
   *
   * A menu whose longest item wraps onto two lines reads as a mistake, and the firm's own wording
   * is sometimes a sentence -- "Put back in the queue", not "Unfile" -- so the panel gives way
   * rather than the words.
   */
  width?: string
  /** Named where the icon alone would not say whose menu this is -- e.g. two on one row. */
  label?: string
  /**
   * Draw it as a button rather than as a bare icon.
   *
   * On a table row the dots sit alone in a column and read as a control from their position. On a
   * toolbar they sit at the end of a line of bordered buttons, and an unbordered icon there reads
   * as decoration -- so it takes the same shape as its neighbours.
   */
  bordered?: boolean
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

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen((o) => !o)} aria-label={label ?? 'More actions'} aria-expanded={open}
        className={bordered
          ? `px-3 py-2 rounded-lg border text-slate-500 hover:bg-slate-50 ${open ? 'border-slate-300 bg-slate-50' : 'border-slate-200'}`
          : 'p-1.5 rounded-lg hover:bg-slate-100 text-slate-400'}>
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className={`absolute right-0 top-full mt-1 ${width} bg-white rounded-xl shadow-lg border border-slate-100 py-1.5 z-40`}>
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                item.onClick()
                setOpen(false)
              }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-sm hover:bg-slate-50 ${item.danger ? 'text-red-600' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
