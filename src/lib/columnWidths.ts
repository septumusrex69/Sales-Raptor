/**
 * COLUMNS SOMEBODY CAN WIDEN, AND FIT TO WHAT IS IN THEM.
 *
 * THE FIRM, on the accounts list with a long client's book in it: "it's starting to bulk up. So if
 * it's a long thing, it squeezes it in. So make it so that you can adjust these columns. And if you
 * double click on the column on the top, it expands so that you can read it ... automatically fits
 * to the script." Debtor names were wrapping onto four lines -- "Highveld / Glass & / Aluminium /
 * (Pty) Ltd" -- because the table was told to be exactly as wide as the screen and every column
 * was squeezed to make it so.
 *
 * THE SPREADSHEET'S RULES, because that is what the firm is describing and what they already know:
 * drag a column's right edge to size it, double-click that edge to fit it to its longest entry.
 * The table then scrolls sideways rather than squeezing, which is what makes a width mean anything.
 *
 * REMEMBERED PER DEVICE, in the browser, and only as a convenience: a width is how somebody likes
 * to read the list on their own screen, an iPad and a desktop want different ones, and losing it
 * costs one double-click. Storage that is blocked or full simply means the defaults.
 *
 * PURE where it can be, so check-column-widths can hold the arithmetic without a browser.
 */
import { useCallback, useEffect, useState } from 'react'

/* Narrower than this and a heading is unreadable and the edge is hard to find again. */
export const MIN_PX = 56
/* Wider than this and one column is a screen of its own. Fit stops here too. */
export const MAX_PX = 640

export const clampWidth = (px: number): number =>
  Math.round(Math.min(MAX_PX, Math.max(MIN_PX, px)))

/** What a drag from `start` by `dx` pixels makes the column. */
export const dragWidth = (start: number, dx: number): number => clampWidth(start + dx)

/**
 * The width that shows a column's longest entry on one line.
 *
 * `natural` is each cell's width with wrapping turned off, heading included; the widest wins, plus
 * a couple of pixels so the last letter does not sit hard against the next column.
 */
export function fitWidth(natural: number[]): number {
  const widest = natural.reduce((m, w) => (Number.isFinite(w) && w > m ? w : m), 0)
  return clampWidth(widest + 2)
}

/** Stored widths, read defensively: anything not a sane number for a known column is ignored. */
export function readWidths(raw: string | null, keys: string[]): Record<string, number> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, number> = {}
    for (const k of keys) {
      const v = parsed?.[k]
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = clampWidth(v)
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Widths for one table: the defaults, overridden by whatever this person set on this device.
 *
 * `changed` is whether any differ from the defaults, so a "Reset" is offered only when there is
 * something to reset -- a control that does nothing is a control somebody presses to find out.
 */
export function useColumnWidths(storageKey: string, defaults: Record<string, number>) {
  const keys = Object.keys(defaults)
  const [overrides, setOverrides] = useState<Record<string, number>>(() => {
    try { return readWidths(window.localStorage.getItem(storageKey), keys) } catch { return {} }
  })

  useEffect(() => {
    try {
      if (Object.keys(overrides).length === 0) window.localStorage.removeItem(storageKey)
      else window.localStorage.setItem(storageKey, JSON.stringify(overrides))
    } catch { /* nothing to remember it with */ }
  }, [overrides, storageKey])

  const setWidth = useCallback((key: string, px: number) => {
    setOverrides((o) => ({ ...o, [key]: clampWidth(px) }))
  }, [])
  const reset = useCallback(() => setOverrides({}), [])

  const widths: Record<string, number> = { ...defaults, ...overrides }
  const changed = keys.some((k) => overrides[k] !== undefined && overrides[k] !== defaults[k])
  return { widths, setWidth, reset, changed }
}
