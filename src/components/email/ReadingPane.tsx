import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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

/** Where the divider sits, in pixels, remembered per browser. */
const SPLIT_KEY = 'raptor.email.split'
const DEFAULT_SPLIT = 352
/*
 * Narrower than this and a subject is unreadable; wider and the message itself is a column of
 * soup. Both ends are deliberate, so dragging cannot leave the pane unusable — which is the
 * usual way a resizable split goes wrong.
 */
const MIN_SPLIT = 260
const MAX_SPLIT = 640

function readSplit(): number {
  try {
    const raw = Number(localStorage.getItem(SPLIT_KEY))
    if (Number.isFinite(raw) && raw >= MIN_SPLIT && raw <= MAX_SPLIT) return raw
  } catch {
    // Private window, or site data blocked. The default is fine.
  }
  return DEFAULT_SPLIT
}

export function ReadingPane<T extends { id: string }>({
  items, selectedId, onSelect, renderRow, renderDetail, renderLead, emptyDetail,
}: {
  items: T[]
  selectedId: string | null
  onSelect: (item: T) => void
  /** One row in the left-hand list. `selected` so the caller can mark it. */
  renderRow: (item: T, selected: boolean) => ReactNode
  /** The message itself, in the right-hand pane. */
  renderDetail: (item: T) => ReactNode
  /**
   * Something beside each row, outside the button that opens it — a tick box, in practice.
   *
   * It has to be a sibling rather than a child: a checkbox inside a button is invalid, and the
   * button would swallow the click, so ticking a row to delete it would open and read it
   * instead. That is the opposite of what somebody clearing junk wants.
   */
  renderLead?: (item: T) => ReactNode
  /** Shown before anything is picked. */
  emptyDetail?: ReactNode
}) {
  const selected = items.find((i) => i.id === selectedId) ?? null
  const paneRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [split, setSplit] = useState(readSplit)
  const [dragging, setDragging] = useState(false)

  // A new message should be read from its top, not from wherever the last one was scrolled to.
  useEffect(() => { paneRef.current?.scrollTo({ top: 0 }) }, [selectedId])

  const put = useCallback((next: number) => {
    const clamped = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, Math.round(next)))
    setSplit(clamped)
    try { localStorage.setItem(SPLIT_KEY, String(clamped)) } catch { /* see readSplit */ }
  }, [])

  /*
   * Pointer events rather than mouse events, so this works with a trackpad, a mouse and an iPad
   * pencil or finger alike — which matters, because the firm works on iPads.
   *
   * setPointerCapture is what makes a drag survive the pointer leaving the 6px handle. Without
   * it, moving faster than React re-renders drops the drag, which feels like the divider
   * sticking.
   */
  function startDrag(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }

  function onDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    const left = gridRef.current?.getBoundingClientRect().left ?? 0
    put(e.clientX - left)
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
  }

  return (
    <div
      ref={gridRef}
      /*
       * Three columns at lg and up: list, handle, message. The handle is a real grid column
       * rather than something floated over the border, so nothing overlaps and its hit area is
       * honest. Below lg this is a plain one-column grid and the handle hides itself, which is
       * also where the caller stops using the split at all.
       *
       * The width travels as a CSS variable so only one custom property changes while dragging
       * — React re-renders, but the browser is not re-parsing a class string 60 times a second.
       */
      className="grid lg:grid-cols-[var(--pane-split)_6px_minmax(0,1fr)] lg:h-[38rem]"
      style={{ ['--pane-split' as string]: `${split}px` }}
    >
      {/*
        Each side scrolls on its own, which is the whole point of the shape: picking the
        twentieth message should not mean scrolling past nineteen to read it, and reading a long
        message should not move the list out from under you.
      */}
      <div className="lg:overflow-y-auto divide-y divide-slate-100">
        {items.map((item) => (
          <div key={item.id}
            className={`flex items-start ${item.id === selectedId ? 'bg-gold-50' : 'hover:bg-slate-50'}`}>
            {renderLead?.(item)}
            <button type="button" onClick={() => onSelect(item)}
              aria-current={item.id === selectedId}
              className="min-w-0 flex-1 text-left">
              {renderRow(item, item.id === selectedId)}
            </button>
          </div>
        ))}
      </div>

      {/*
        The divider, draggable.

        role="separator" with aria-valuenow is what makes it a control rather than decoration,
        and the arrow keys move it for anyone not using a pointer — a drag handle that only
        responds to dragging is unusable with a keyboard.
      */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the message list"
        aria-valuenow={split}
        aria-valuemin={MIN_SPLIT}
        aria-valuemax={MAX_SPLIT}
        tabIndex={0}
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); put(split - (e.shiftKey ? 48 : 16)) }
          if (e.key === 'ArrowRight') { e.preventDefault(); put(split + (e.shiftKey ? 48 : 16)) }
        }}
        className={`hidden lg:block relative cursor-col-resize touch-none select-none
          border-l border-slate-100 focus:outline-none
          ${dragging ? 'bg-gold-400' : 'hover:bg-gold-200 focus-visible:bg-gold-200'}`}
      >
        {/* A grip, so the strip reads as something you can take hold of. */}
        <span aria-hidden className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[3px] h-8 rounded-full bg-slate-200" />
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
