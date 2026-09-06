import { ChevronDown, ChevronUp } from 'lucide-react'

/**
 * A clickable column heading. One definition so every table sorts and looks the same —
 * the arrow only appears on the column actually doing the sorting, so at a glance you can
 * tell what the order in front of you means.
 */
export function SortHeader({
  label,
  active,
  dir,
  onSort,
  align = 'left',
}: {
  label: string
  /** True when this column is the one currently sorting the table. */
  active?: boolean
  dir?: 'asc' | 'desc'
  /** Omit to render a plain, non-sortable heading. */
  onSort?: () => void
  align?: 'left' | 'right' | 'center'
}) {
  return (
    <button
      type="button"
      onClick={onSort}
      className={`inline-flex items-center gap-1 ${onSort ? 'cursor-pointer hover:text-slate-600' : 'cursor-default'} ${
        align === 'right' ? 'flex-row-reverse' : ''
      }`}
    >
      {label}
      {active && (dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
    </button>
  )
}
