import { useRef, type ReactNode } from 'react'
import clsx from 'clsx'
import { dragWidth, fitWidth } from '../../lib/columnWidths'

/**
 * A column heading whose right edge can be dragged, and double-clicked to fit. See columnWidths.ts.
 *
 * POINTER EVENTS, NOT MOUSE EVENTS, because the firm works on an iPad: one handler covers a mouse,
 * a finger and the Pencil. And the double is DETECTED HERE rather than left to `dblclick`, which
 * Safari on iOS does not reliably send for a double tap -- so "double-click to fit" works the same
 * under a finger as under a mouse.
 *
 * THE EDGE IS A REAL CONTROL: a button-sized strip with its own label, so it can be found by
 * somebody who has never been told it is there (the cursor and a hover line say so) and by a test.
 */
export function ResizableTh({
  label, width, onWidth, className, children,
}: {
  /** The column's name, for the edge's accessible label. */
  label: string
  width: number
  onWidth: (px: number) => void
  className?: string
  children: ReactNode
}) {
  const th = useRef<HTMLTableCellElement>(null)
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null)
  const lastTap = useRef(0)

  /*
   * FIT: every cell in this column, its TEXT measured with wrapping off, plus the cell's own
   * padding -- heading included, because a heading wider than every value should still be read.
   *
   * THE TEXT, NOT THE CELL. A table cell's scrollWidth does not report text running past it (the
   * first version read it and fitted every column to the width it already had), whereas a Range
   * around the cell's contents is laid out at full width even where the cell clips or ellipsises
   * it -- which is also what lets a truncated client name be fitted to its whole length.
   */
  function fit() {
    const cell = th.current
    const table = cell?.closest('table')
    if (!cell || !table) return
    const index = cell.cellIndex
    const natural: number[] = []
    const range = document.createRange()
    for (const row of Array.from(table.rows)) {
      const c = row.cells[index]
      if (!c) continue
      const before = c.style.whiteSpace
      c.style.whiteSpace = 'nowrap'
      /* The handle itself is in the heading; measure the words, not the strip beside them. */
      range.selectNodeContents(c)
      let text = 0
      for (const r of Array.from(range.getClientRects())) text = Math.max(text, r.width)
      const cs = getComputedStyle(c)
      natural.push(text + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight))
      c.style.whiteSpace = before
    }
    onWidth(fitWidth(natural))
  }

  function onPointerDown(e: React.PointerEvent<HTMLSpanElement>) {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, start: width, moved: false }
  }
  function onPointerMove(e: React.PointerEvent<HTMLSpanElement>) {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (Math.abs(dx) > 2) d.moved = true
    if (d.moved) onWidth(dragWidth(d.start, dx))
  }
  function onPointerUp(e: React.PointerEvent<HTMLSpanElement>) {
    const d = drag.current
    drag.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    if (!d || d.moved) return
    /* A TAP, NOT A DRAG. Two of them within 350ms is the double that fits. */
    const now = e.timeStamp
    if (now - lastTap.current < 350) { lastTap.current = 0; fit() } else lastTap.current = now
  }

  return (
    <th ref={th} className={clsx('relative', className)}>
      {children}
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize the ${label} column. Double-click to fit.`}
        title="Drag to resize · double-click to fit"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null }}
        /* The keyboard and assistive-tech route to the same fit, and a test's. */
        onDoubleClick={(e) => { e.preventDefault(); fit() }}
        className="absolute top-0 right-0 h-full w-3 -mr-1.5 z-10 cursor-col-resize touch-none select-none
          group flex justify-center"
      >
        <span className="w-px h-full bg-transparent group-hover:bg-gold-500" />
      </span>
    </th>
  )
}
