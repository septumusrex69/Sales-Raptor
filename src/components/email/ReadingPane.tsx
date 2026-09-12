import { useEffect, useRef, type ReactNode } from 'react'
import { MailOpen } from 'lucide-react'

/**
 * Outlook's shape, for any of Raptor's email lists.
 *
 * The list scrolls down the left; whichever message is selected is rendered beside it. Generic
 * over the item type on purpose — a mailbox message, a debtor's correspondence and a CRM email
 * activity are three different records in three different tables, and they are the same thing to
 * somebody reading their mail.
 *
 * Only rendered at lg and up. A split inside an iPad's width is a list too narrow to scan next
 * to a message too narrow to read; below that the caller shows its ordinary list instead. See
 * EmailViewSwitcher, which hides itself at the same breakpoint for the same reason.
 */
export function ReadingPane<T extends { id: string }>({
  items, selectedId, onSelect, renderRow, renderDetail, emptyDetail,
}: {
  items: T[]
  selectedId: string | null
  onSelect: (item: T) => void
  /** One row in the left-hand list. `selected` so the caller can mark it. */
  renderRow: (item: T, selected: boolean) => ReactNode
  /** The message itself, in the right-hand pane. */
  renderDetail: (item: T) => ReactNode
  /** Shown before anything is picked. */
  emptyDetail?: ReactNode
}) {
  const selected = items.find((i) => i.id === selectedId) ?? null
  const paneRef = useRef<HTMLDivElement>(null)

  // A new message should be read from its top, not from wherever the last one was scrolled to.
  useEffect(() => { paneRef.current?.scrollTo({ top: 0 }) }, [selectedId])

  return (
    <div className="grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:h-[38rem]">
      {/*
        Each side scrolls on its own, which is the whole point of the shape: picking the
        twentieth message should not mean scrolling past nineteen to read it, and reading a long
        message should not move the list out from under you.
      */}
      <div className="lg:overflow-y-auto lg:border-r border-slate-100 divide-y divide-slate-100">
        {items.map((item) => (
          <button key={item.id} type="button" onClick={() => onSelect(item)}
            aria-current={item.id === selectedId}
            className={`w-full text-left ${item.id === selectedId ? 'bg-gold-50' : 'hover:bg-slate-50'}`}>
            {renderRow(item, item.id === selectedId)}
          </button>
        ))}
      </div>

      <div ref={paneRef} className="lg:overflow-y-auto">
        {selected ? renderDetail(selected) : (
          <div className="h-full grid place-items-center py-16 px-6 text-center">
            <div>
              <MailOpen size={22} className="mx-auto text-slate-300" />
              <p className="text-sm text-slate-400 mt-3">
                {emptyDetail ?? 'Pick a message to read it.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
